/**
 * src/services/webhook.ts
 *
 * Signs and enqueues webhook deliveries.
 * Called by jobs (renewal, grace-expiry) and routes (checkout submit-tx).
 *
 * Delivery flow:
 *   fireWebhook() → insert webhookDeliveries row (pending)
 *               → enqueue BullMQ job
 *   webhook-delivery worker → HTTP POST with HMAC sig → update row status
 */

import { createHmac } from "crypto";
import { eq } from "drizzle-orm";
import { Queue } from "bullmq";
import { db, webhookEndpoints, webhookDeliveries, newId, now } from "../lib/db/index.js";
import { redis } from "../lib/cache/redis.js";
import type { webhookEventEnum } from "../lib/db/schema.js";

type WebhookEvent = typeof webhookEventEnum.enumValues[number];

// BullMQ queue
const webhookQueue = new Queue("webhook-delivery", {
  connection: redis(),
});

export async function fireWebhook(params: {
  developerId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { developerId, event, payload } = params;

  // Find all active endpoints for this developer that listen to this event
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.developerId, developerId));

  const active = endpoints.filter(
    (ep) =>
      ep.active &&
      (ep.events.length === 0 || (ep.events as string[]).includes(event))
  );

  if (active.length === 0) return;

  for (const endpoint of active) {
    const deliveryId = newId();
    const fullPayload = {
      id:          deliveryId,
      event,
      created_at:  Math.floor(Date.now() / 1000),
      data:        payload,
    };

    // HMAC signature — developer verifies this
    const sig = signPayload(fullPayload, endpoint.signingSecret);

    await db.insert(webhookDeliveries).values({
      id:           deliveryId,
      endpointId:   endpoint.id,
      developerId,
      event,
      payload:      fullPayload,
      status:       "pending",
      attemptCount: 0,
      createdAt:    now(),
    });

    await webhookQueue.add(
      "deliver",
      {
        deliveryId,
        endpointId: endpoint.id,
        url:        endpoint.url,
        payload:    fullPayload,
        signature:  sig,
      },
      {
        attempts:    5,
        backoff: { type: "exponential", delay: 5000 },
      }
    );
  }
}

export function signPayload(
  payload: Record<string, unknown>,
  secret: string
): string {
  const body = JSON.stringify(payload);
  return createHmac("sha256", secret).update(body).digest("hex");
}