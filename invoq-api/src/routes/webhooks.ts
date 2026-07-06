/**
 * src/routes/webhooks.ts
 *
 * POST   /v1/webhooks                      → register endpoint
 * GET    /v1/webhooks                      → list endpoints for developer
 * DELETE /v1/webhooks/:endpointId          → delete endpoint
 * GET    /v1/webhooks/log                  → delivery log (filterable)
 */

import { Router } from "express";
import { randomBytes } from "crypto";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookDeliveriesByDeveloper,
  listWebhookEndpointsByDeveloper,
  newId,
  now,
} from "../lib/db/index.js";

const router = Router();

// POST /v1/webhooks
// body: { url: string, events?: string[] }
router.post(
  "/",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerId } = res.locals.auth;
    const { url, events } = req.body;

    if (!url) {
      res.status(400).json({ error: "url required" });
      return;
    }

    const signingSecret = randomBytes(32).toString("hex");

    const endpoint = await createWebhookEndpoint({
      id:            newId(),
      developerId:   developerId!,
      url,
      signingSecret,
      events:        events ?? [],
      active:        true,
      createdAt:     now(),
    });

    res.status(201).json({
      id:            endpoint.id,
      url:           endpoint.url,
      events:        endpoint.events,
      signingSecret,             // returned ONCE — developer must store this
      active:        endpoint.active,
      createdAt:     endpoint.createdAt,
    });
  })
);

// GET /v1/webhooks
router.get(
  "/",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerId } = res.locals.auth;

    const endpoints = await listWebhookEndpointsByDeveloper(developerId!);

    res.json(endpoints);
  })
);

// DELETE /v1/webhooks/:endpointId
router.delete(
  "/:endpointId",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerId }  = res.locals.auth;
    const endpointId = req.params.endpointId;
    
    if (!endpointId || Array.isArray(endpointId)) {
      res.status(400).json({ error: "endpointId is required" });
      return;
    }

    await deleteWebhookEndpoint(endpointId, developerId!);

    res.json({ deleted: true });
  })
);

// GET /v1/webhooks/log?status=failed&limit=50
router.get(
  "/log",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerId } = res.locals.auth;
    const limit  = Math.min(Number(req.query.limit ?? 50), 200);
    const status = req.query.status as string | undefined;

    const rows = await listWebhookDeliveriesByDeveloper(developerId!);
    const filtered = status ? rows.filter((row) => row.status === status) : rows;

    res.json(filtered.slice(0, limit));
  })
);

export default router;
