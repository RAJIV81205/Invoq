/**
 * src/jobs/webhook-delivery.ts
 *
 * BullMQ worker — processes webhook-delivery queue.
 * HTTP POSTs payload to developer's endpoint with HMAC signature header.
 * Updates webhookDeliveries row with result.
 * BullMQ handles retries with exponential backoff (configured in webhook.ts fireWebhook).
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { redis } from "../lib/cache/redis.js";
import { db, webhookDeliveries, now } from "../lib/db/index.js";

const QUEUE_NAME    = "webhook-delivery";
const RESPONSE_TRIM = 1000; // store first 1000 chars of response body

export function startWebhookDeliveryWorker(): void {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { deliveryId, url, payload, signature } = job.data as {
        deliveryId: string;
        url:        string;
        payload:    Record<string, unknown>;
        signature:  string;
      };

      let httpStatus:   number | null = null;
      let responseBody: string | null = null;
      let success = false;

      try {
        const response = await fetch(url, {
          method:  "POST",
          headers: {
            "Content-Type":       "application/json",
            "X-Invoq-Signature":  `sha256=${signature}`,
            "X-Invoq-Event":      String(payload.event ?? ""),
          },
          body:    JSON.stringify(payload),
          signal:  AbortSignal.timeout(10_000), // 10s timeout
        });

        httpStatus   = response.status;
        const text   = await response.text().catch(() => "");
        responseBody = text.slice(0, RESPONSE_TRIM);
        success      = response.ok;

        if (!response.ok) {
          // Throw so BullMQ retries
          throw new Error(`Endpoint returned ${response.status}`);
        }
      } catch (err) {
        // Update row as retrying / failed
        await db
          .update(webhookDeliveries)
          .set({
            status:       "retrying",
            httpStatus,
            responseBody,
            attemptCount: (job.attemptsMade ?? 0) + 1,
            nextRetryAt:  new Date(Date.now() + 5000 * Math.pow(2, job.attemptsMade ?? 0)),
          })
          .where(eq(webhookDeliveries.id, deliveryId));

        throw err; // rethrow → BullMQ retries
      }

      // Success
      await db
        .update(webhookDeliveries)
        .set({
          status:       "delivered",
          httpStatus,
          responseBody,
          attemptCount: (job.attemptsMade ?? 0) + 1,
          deliveredAt:  now(),
        })
        .where(eq(webhookDeliveries.id, deliveryId));
    },
    {
      connection:  redis(),
      concurrency: 10,
    }
  );

  worker.on("failed", async (job, err) => {
    // Mark as permanently failed after all retries exhausted
    if (job && job.attemptsMade >= (job.opts.attempts ?? 5)) {
      await db
        .update(webhookDeliveries)
        .set({ status: "failed" })
        .where(eq(webhookDeliveries.id, job.data.deliveryId));
    }
    console.error(`[webhook-delivery] job ${job?.id} failed:`, err.message);
  });
}