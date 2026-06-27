/**
 * src/jobs/trial-ending.ts
 *
 * BullMQ scheduled job — runs runTrialEnding() every 6 hours.
 * Fires the trial.ending webhook for customers whose trial ends within 72h.
 */

import { Queue, Worker } from "bullmq";
import { getRedisConnectionConfig } from "../lib/cache/redis.js";
import { runTrialEnding } from "../services/billing.js";

const QUEUE_NAME = "trial-ending";

export function startTrialEndingJob(): void {
  const queue = new Queue(QUEUE_NAME, { connection: getRedisConnectionConfig() });

  queue.add(
    "run",
    {},
    {
      repeat:           { every: 6 * 60 * 60 * 1000 },
      removeOnComplete: 5,
      removeOnFail:     10,
    }
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log("[trial-ending] running...");
      await runTrialEnding();
      console.log("[trial-ending] done");
    },
    { connection: getRedisConnectionConfig() }
  );

  worker.on("failed", (job, err) => {
    console.error(`[trial-ending] job ${job?.id} failed:`, err.message);
  });
}
