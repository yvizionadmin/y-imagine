import "server-only";
import { Queue } from "bullmq";
import { after } from "next/server";
import { queueConnection, VIDEO_EDIT_QUEUE, type VideoEditJobData } from "@/lib/jobs/queues";
import { reportError } from "@/lib/observability/report";
import { redisUrl } from "@/lib/redis";
import { runEditRender } from "./runner";

// Hands an editor export to whoever renders it: the worker through BullMQ when Redis is configured,
// otherwise this process after the response (local runs without Redis, E2E). Both call runEditRender.

const globalForQueue = globalThis as unknown as { videoEditQueue?: Queue<VideoEditJobData> };

// A failed render is final (the user can export again), so no retries.
const JOB_OPTIONS = { attempts: 1, removeOnComplete: { count: 500 }, removeOnFail: { count: 500 } } as const;

function queue() {
  // The web process only adds jobs: fail fast while Redis is down instead of hanging the request.
  globalForQueue.videoEditQueue ??= new Queue<VideoEditJobData>(VIDEO_EDIT_QUEUE, { connection: { ...queueConnection(), maxRetriesPerRequest: 1, connectTimeout: 2_000 } });
  return globalForQueue.videoEditQueue;
}

export async function dispatchEditRender(orgId: string, editId: string) {
  if (redisUrl()) {
    try {
      await queue().add("render", { orgId, editId }, JOB_OPTIONS);
      return;
    } catch (error) {
      reportError("video edit enqueue failed", error, { orgId });
    }
  }
  after(() =>
    runEditRender(orgId, editId).catch((error) => {
      reportError("video edit render crashed", error, { orgId });
    }),
  );
}
