import "server-only";
import { Queue } from "bullmq";
import { after } from "next/server";
import { ITEM_JOB_OPTIONS } from "@/lib/copy/batch-queue";
import { IMAGE_BATCH_QUEUE, queueConnection, type ImageItemJob } from "@/lib/jobs/queues";
import { reportError } from "@/lib/observability/report";
import { redisUrl } from "@/lib/redis";
import { runImageItem } from "./runner";

// Hands bulk image items to whoever runs them: the worker through BullMQ when Redis is configured,
// otherwise this process after the response (local runs without Redis, E2E). Both call runImageItem.

const globalForQueue = globalThis as unknown as { imageBatchQueue?: Queue<ImageItemJob> };

function queue() {
  // The web process only adds jobs: fail fast while Redis is down instead of hanging the request.
  globalForQueue.imageBatchQueue ??= new Queue<ImageItemJob>(IMAGE_BATCH_QUEUE, { connection: { ...queueConnection(), maxRetriesPerRequest: 1, connectTimeout: 2_000 } });
  return globalForQueue.imageBatchQueue;
}

export async function dispatchImageItems(orgId: string, itemIds: string[]) {
  if (!itemIds.length) return;
  if (redisUrl()) {
    try {
      await queue().addBulk(itemIds.map((itemId) => ({ name: "image-item", data: { orgId, itemId }, opts: ITEM_JOB_OPTIONS })));
      return;
    } catch (error) {
      reportError("bulk image enqueue failed", error, { orgId });
    }
  }
  after(() => runImageItemsInline(orgId, itemIds));
}

const INLINE_CONCURRENCY = 2;
const RETRY_DELAY_MS = 15_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs items in this process, a few at a time; rate-limited items wait and go again. */
export async function runImageItemsInline(orgId: string, itemIds: string[], retryDelayMs = RETRY_DELAY_MS) {
  const todo = [...itemIds];
  const lane = async () => {
    for (let id = todo.shift(); id; id = todo.shift()) {
      try {
        if ((await runImageItem(orgId, id)) === "retry") {
          await wait(retryDelayMs);
          todo.push(id);
        }
      } catch (error) {
        reportError("bulk image item crashed", error, { orgId });
      }
    }
  };
  await Promise.all(Array.from({ length: INLINE_CONCURRENCY }, lane));
}
