/**
 * src/jobs/usage-flush.ts
 *
 * BullMQ scheduled job — flushes Redis usage buffer to chain every 5 seconds.
 * Decouples the hot-path recordUsage() API from the 5s Stellar tx time.
 */

import { Queue, Worker } from "bullmq";
import { redis } from "../lib/cache/redis.js";
import { flushUsageBuffer } from "../services/metering.js";

const QUEUE_NAME = "usage-flush";

export function startUsageFlushJob(): void {
  const queue = new Queue(QUEUE_NAME, { connection: redis() });

  queue.add(
    "run",
    {},
    {
      repeat:           { every: 5_000 },
      removeOnComplete: 5,
      removeOnFail:     10,
    }
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const result = await flushUsageBuffer();
      if (result.flushed > 0) {
        console.log(`[usage-flush] flushed ${result.flushed} entries in ${result.batches} batches`);
      }
      if (result.error) {
        console.error("[usage-flush] partial error:", result.error);
      }
    },
    { connection: redis() }
  );

  worker.on("failed", (job, err) => {
    console.error(`[usage-flush] job ${job?.id} failed:`, err.message);
  });
}