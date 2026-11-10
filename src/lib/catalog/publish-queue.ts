import "server-only";
import { Queue } from "bullmq";
import { after } from "next/server";
import { PUBLISH_QUEUE, queueConnection, type PublishJobData } from "@/lib/jobs/queues";
import { reportError } from "@/lib/observability/report";
import { redisUrl } from "@/lib/redis";
import { runPublish } from "./publish";

// Hands each image upload to the worker through BullMQ when Redis is configured, otherwise this
// process after the response (one at a time). Both call runPublish.

const globalForQueue = globalThis as unknown as { publishQueue?: Queue<PublishJobData> };

const JOB_OPTIONS = { attempts: 3, backoff: { type: "exponential", delay: 20_000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } } as const;
const RETRY_DELAY_MS = 20_000;

function queue() {
  globalForQueue.publishQueue ??= new Queue<PublishJobData>(PUBLISH_QUEUE, { connection: { ...queueConnection(), maxRetriesPerRequest: 1, connectTimeout: 2_000 } });
  return globalForQueue.publishQueue;
}

export async function dispatchPublishes(orgId: string, generationIds: string[]) {
  if (!generationIds.length) return;
  if (redisUrl()) {
    try {
      await queue().addBulk(generationIds.map((generationId) => ({ name: "publish", data: { orgId, generationId }, opts: JOB_OPTIONS })));
      return;
    } catch (error) {
      reportError("store upload enqueue failed", error, { orgId });
    }
  }
  after(() => runPublishesInline(orgId, generationIds));
}

/** Uploads one after another in this process; a throttled one waits and goes again (a few times). */
export async function runPublishesInline(orgId: string, generationIds: string[], retryDelayMs = RETRY_DELAY_MS) {
  for (const id of generationIds) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if ((await runPublish(orgId, id)) !== "retry") break;
      } catch (error) {
        reportError("store upload crashed", error, { orgId });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
