// Background worker (Railway "worker" service: `npm run worker`). Registers the maintenance schedules
// and processes their jobs, and runs bulk Copy items. Runs outside Next.js, so it's started with the react-server condition
// (server-only modules load) and reads the same environment as the web service.
import * as Sentry from "@sentry/node";
import { DelayedError, Queue, Worker, type Job } from "bullmq";
import { runBatchItem } from "@/lib/copy/batch-runner";
import { runImageItem } from "@/lib/image-batch/runner";
import { closeStaleJobs, revalidateAllKeys } from "@/lib/jobs/maintenance";
import { COPY_BATCH_QUEUE, IMAGE_BATCH_QUEUE, MAINTENANCE_QUEUE, queueConnection, SCHEDULES, type CopyItemJob, type ImageItemJob, type MaintenanceJob } from "@/lib/jobs/queues";
import { sentryOptions } from "@/lib/observability/sentry-options";

// Same project as the web service, tagged by service; off without SENTRY_DSN.
Sentry.init({ ...sentryOptions(process.env.SENTRY_DSN), initialScope: { tags: { service: "worker" } } });

const HANDLERS: Record<MaintenanceJob, () => Promise<unknown>> = {
  "revalidate-keys": revalidateAllKeys,
  "close-stale-jobs": closeStaleJobs,
};

const connection = queueConnection();
const queue = new Queue(MAINTENANCE_QUEUE, { connection });

const worker = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => {
    const handler = HANDLERS[job.name as MaintenanceJob];
    if (!handler) throw new Error(`unknown job ${job.name}`);
    return handler();
  },
  { connection, concurrency: 1 },
);

/** A rate-limited item waits this long and runs again, without using up one of its attempts. */
const RATE_LIMIT_DELAY_MS = 20_000;

const copyWorker = new Worker<CopyItemJob>(
  COPY_BATCH_QUEUE,
  async (job, token) => {
    const outcome = await runBatchItem(job.data.orgId, job.data.itemId);
    if (outcome === "retry") {
      await job.moveToDelayed(Date.now() + RATE_LIMIT_DELAY_MS, token);
      throw new DelayedError();
    }
    return outcome;
  },
  // Provider calls take seconds; a few at once per worker. Per-org fairness comes from the job rate limits.
  { connection, concurrency: Number(process.env.COPY_BATCH_CONCURRENCY) || 3 },
);

const imageWorker = new Worker<ImageItemJob>(
  IMAGE_BATCH_QUEUE,
  async (job, token) => {
    const outcome = await runImageItem(job.data.orgId, job.data.itemId);
    if (outcome === "retry") {
      await job.moveToDelayed(Date.now() + RATE_LIMIT_DELAY_MS, token);
      throw new DelayedError();
    }
    return outcome;
  },
  // Image calls take 20-60 s and are heavy on memory (sharp); fewer at once than Copy.
  { connection, concurrency: Number(process.env.IMAGE_BATCH_CONCURRENCY) || 2 },
);

for (const w of [worker, copyWorker, imageWorker] as Worker[]) {
  w.on("completed", (job: Job, result) => console.log(JSON.stringify({ job: job.name, ok: true, result })));
  w.on("failed", (job, error) => {
    console.error(JSON.stringify({ job: job?.name, ok: false, error: error.name }));
    Sentry.captureException(error, { tags: { job: job?.name ?? "unknown" } });
  });
  w.on("error", (error) => console.error(JSON.stringify({ worker: "error", error: error.message })));
}

async function registerSchedules() {
  for (const [name, repeat] of Object.entries(SCHEDULES)) {
    await queue.upsertJobScheduler(name, repeat, { name, opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } } });
  }
  console.log(JSON.stringify({ worker: "started", queues: [MAINTENANCE_QUEUE, COPY_BATCH_QUEUE, IMAGE_BATCH_QUEUE], schedules: Object.keys(SCHEDULES) }));
}

registerSchedules().catch((error) => {
  console.error(JSON.stringify({ worker: "schedules failed", error: (error as Error).message }));
  process.exit(1);
});

// Railway sends SIGTERM on deploy: finish the current job, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    await Promise.all([worker.close(), copyWorker.close(), imageWorker.close()]);
    await queue.close();
    await Sentry.flush(2_000);
    process.exit(0);
  });
}
