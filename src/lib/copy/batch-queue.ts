import "server-only";
import { Queue } from "bullmq";
import { after } from "next/server";
import { COPY_BATCH_QUEUE, queueConnection, type CopyItemJob } from "@/lib/jobs/queues";
import { reportError } from "@/lib/observability/report";
import { redisUrl } from "@/lib/redis";
import { runBatchItem } from "./batch-runner";

// Hands bulk Copy items to whoever runs them: the worker through BullMQ when Redis is configured,
// otherwise this process after the response (local runs without Redis, E2E). Both call runBatchItem.

const globalForQueue = globalThis as unknown as { copyBatchQueue?: Queue<CopyItemJob> };

function queue() {
  // The web process only adds jobs: fail fast while Redis is down instead of hanging the request.
  globalForQueue.copyBatchQueue ??= new Queue<CopyItemJob>(COPY_BATCH_QUEUE, { connection: { ...queueConnection(), maxRetriesPerRequest: 1, connectTimeout: 2_000 } });
  return globalForQueue.copyBatchQueue;
}

export const ITEM_JOB_OPTIONS = { attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } } as const;

export async function dispatchItems(orgId: string, itemIds: string[]) {
  if (!itemIds.length) return;
  if (redisUrl()) {
    try {
      await queue().addBulk(itemIds.map((itemId) => ({ name: "copy-item", data: { orgId, itemId }, opts: ITEM_JOB_OPTIONS })));
      return;
    } catch (error) {
      reportError("bulk copy enqueue failed", error, { orgId });
    }
  }
  after(() => runInline(orgId, itemIds));
}

const INLINE_CONCURRENCY = 2;
const RETRY_DELAY_MS = 15_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs items in this process, a few at a time; rate-limited items wait and go again. */
export async function runInline(orgId: string, itemIds: string[], retryDelayMs = RETRY_DELAY_MS) {
  const todo = [...itemIds];
  const lane = async () => {
    for (let id = todo.shift(); id; id = todo.shift()) {
      try {
        if ((await runBatchItem(orgId, id)) === "retry") {
          await wait(retryDelayMs);
          todo.push(id);
        }
      } catch (error) {
        reportError("bulk copy item crashed", error, { orgId });
      }
    }
  };
  await Promise.all(Array.from({ length: INLINE_CONCURRENCY }, lane));
}
