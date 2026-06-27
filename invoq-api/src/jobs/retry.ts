/**
 * src/jobs/retry.ts
 *
 * BullMQ scheduled job — runs runRetryCycle() every 5 minutes.
 * Retries USDC payments for customers in GracePeriod whose grace window
 * still has >= 12h. Fires payment.retry_succeeded webhook on success.
 */

import { Queue, Worker } from "bullmq";
import { getRedisConnectionConfig } from "../lib/cache/redis.js";
import { runRetryCycle } from "../services/billing.js";

const QUEUE_NAME = "payment-retry";

export function startRetryJob(): void {
  const queue = new Queue(QUEUE_NAME, { connection: getRedisConnectionConfig() });

  queue.add(
    "run",
    {},
    {
      repeat:           { every: 5 * 60 * 1000 },
      removeOnComplete: 5,
      removeOnFail:     10,
    }
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log("[payment-retry] running cycle...");
      await runRetryCycle();
      console.log("[payment-retry] cycle done");
    },
    { connection: getRedisConnectionConfig() }
  );

  worker.on("failed", (job, err) => {
    console.error(`[payment-retry] job ${job?.id} failed:`, err.message);
  });
}
