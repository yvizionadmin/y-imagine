import "server-only";
import { Queue } from "bullmq";
import { after } from "next/server";
import { queueConnection, VIDEO_QUEUE, type VideoJobData } from "@/lib/jobs/queues";
import { reportError } from "@/lib/observability/report";
import { redisUrl } from "@/lib/redis";
import { runVideoJob } from "./runner";

// Hands a Studio video job to whoever runs it: the worker through BullMQ when Redis is configured,
// otherwise this process after the response (local runs without Redis, E2E). Both call runVideoJob.

const globalForQueue = globalThis as unknown as { videoQueue?: Queue<VideoJobData> };

const JOB_OPTIONS = { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: { count: 500 }, removeOnFail: { count: 500 } } as const;

function queue() {
  // The web process only adds jobs: fail fast while Redis is down instead of hanging the request.
  globalForQueue.videoQueue ??= new Queue<VideoJobData>(VIDEO_QUEUE, { connection: { ...queueConnection(), maxRetriesPerRequest: 1, connectTimeout: 2_000 } });
  return globalForQueue.videoQueue;
}

export async function dispatchVideoJob(orgId: string, jobId: string) {
  if (redisUrl()) {
    try {
      await queue().add("video", { orgId, jobId }, JOB_OPTIONS);
      return;
    } catch (error) {
      reportError("video enqueue failed", error, { orgId });
    }
  }
  after(() => runVideoJobInline(orgId, jobId));
}

const RETRY_DELAY_MS = 30_000;

/** Runs one job in this process; a rate-limited job waits and goes again (a few times). */
export async function runVideoJobInline(orgId: string, jobId: string, retryDelayMs = RETRY_DELAY_MS) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if ((await runVideoJob(orgId, jobId)) !== "retry") return;
    } catch (error) {
      reportError("video job crashed", error, { orgId });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
