/**
 * src/jobs/renewal.ts
 *
 * BullMQ scheduled job — runs runRenewalCycle() every 60 seconds.
 * Finds due subscriptions in subscriptionCache, calls processRenewals on chain.
 */

import { Queue, Worker } from "bullmq";
import { redis } from "../lib/cache/redis.js";
import { runRenewalCycle } from "../services/billing.js";

const QUEUE_NAME = "renewal";

export function startRenewalJob(): void {
  const queue = new Queue(QUEUE_NAME, { connection: redis() });

  // Repeatable job — every 60 seconds
  queue.add(
    "run",
    {},
    {
      repeat:       { every: 60_000 },
      removeOnComplete: 10,
      removeOnFail:     20,
    }
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log("[renewal] running cycle...");
      await runRenewalCycle();
      console.log("[renewal] cycle done");
    },
    { connection: redis() }
  );

  worker.on("failed", (job, err) => {
    console.error(`[renewal] job ${job?.id} failed:`, err.message);
  });
}