import "server-only";
import { Queue } from "bullmq";
import { after } from "next/server";
import { DIRECTOR_QUEUE, queueConnection, type DirectorJobData } from "@/lib/jobs/queues";
import { reportError } from "@/lib/observability/report";
import { redisUrl } from "@/lib/redis";
import { advanceDirector } from "./advance";

// Hands "move this Director project forward" to whoever runs it: the worker through BullMQ when Redis
// is configured, otherwise this process after the response. A project another caller holds (busy) or
// one over a rate limit (retry) is looked at again shortly, so a finished scene is never missed.

const globalForQueue = globalThis as unknown as { directorQueue?: Queue<DirectorJobData> };

const JOB_OPTIONS = { attempts: 8, backoff: { type: "fixed", delay: 15_000 }, removeOnComplete: { count: 500 }, removeOnFail: { count: 500 } } as const;
export const DIRECTOR_RETRY_MS = 15_000;

function queue() {
  globalForQueue.directorQueue ??= new Queue<DirectorJobData>(DIRECTOR_QUEUE, { connection: { ...queueConnection(), maxRetriesPerRequest: 1, connectTimeout: 2_000 } });
  return globalForQueue.directorQueue;
}

export async function dispatchDirector(orgId: string, directorId: string) {
  if (redisUrl()) {
    try {
      await queue().add("advance", { orgId, directorId }, JOB_OPTIONS);
      return;
    } catch (error) {
      reportError("director enqueue failed", error, { orgId });
    }
  }
  const run = () => runDirectorInline(orgId, directorId);
  try {
    after(run);
  } catch {
    // Outside a request (the worker or a test without one): run now, in the background.
    void run();
  }
}

/** Advances in this process; busy or rate-limited goes again after a short wait (a few times). */
export async function runDirectorInline(orgId: string, directorId: string, retryMs = DIRECTOR_RETRY_MS) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const outcome = await advanceDirector(orgId, directorId);
      if (outcome !== "busy" && outcome !== "retry") return outcome;
    } catch (error) {
      reportError("director advance crashed", error, { orgId });
      return "failed";
    }
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
  return "busy";
}
