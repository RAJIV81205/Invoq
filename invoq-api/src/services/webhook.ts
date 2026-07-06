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
import { Queue } from "bullmq";
import {
  createWebhookDelivery,
  findWebhookEndpointsForDeveloper,
  newId,
  now,
} from "../lib/db/index.js";
import { getRedisConnectionConfig } from "../lib/cache/redis.js";
import type { WebhookEvent } from "../lib/db/schema.js";

// BullMQ queue
const webhookQueue = new Queue("webhook-delivery", {
  connection: getRedisConnectionConfig(),
});

export async function fireWebhook(params: {
  developerId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { developerId, event, payload } = params;

  // Find all active endpoints for this developer that listen to this event
  const endpoints = await findWebhookEndpointsForDeveloper(developerId);

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

    await createWebhookDelivery({
      id:           deliveryId,
      endpointId:   endpoint.id,
      developerId,
      event,
      payload:      fullPayload,
      status:       "pending",
      httpStatus:   null,
      responseBody: null,
      attemptCount: 0,
      nextRetryAt:  null,
      deliveredAt:  null,
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
