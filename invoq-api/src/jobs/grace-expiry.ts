/**
 * src/jobs/grace-expiry.ts
 *
 * BullMQ scheduled job — runs runGraceExpiry() every 15 minutes.
 * Expires grace periods and cancels subscriptions on chain.
 */

import { Queue, Worker } from "bullmq";
import { getRedisConnectionConfig } from "../lib/cache/redis.js";
import { runGraceExpiry } from "../services/billing.js";

const QUEUE_NAME = "grace-expiry";

export function startGraceExpiryJob(): void {
  const queue = new Queue(QUEUE_NAME, { connection: getRedisConnectionConfig() });

  queue.add(
    "run",
    {},
    {
      repeat:           { every: 15 * 60 * 1000 },
      removeOnComplete: 5,
      removeOnFail:     10,
    }
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log("[grace-expiry] running...");
      await runGraceExpiry();
      console.log("[grace-expiry] done");
    },
    { connection: getRedisConnectionConfig() }
  );

  worker.on("failed", (job, err) => {
    console.error(`[grace-expiry] job ${job?.id} failed:`, err.message);
  });
}