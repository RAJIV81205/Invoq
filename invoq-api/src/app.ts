/**
 * src/app.ts
 *
 * Express app factory.
 * Registers global middleware, mounts all route groups.
 * Exported as a factory so main.ts can call createApp() and start listening.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";

import { errorHandler } from "./middleware/error.js";

import plansRouter        from "./routes/plans.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import entitlementRouter  from "./routes/entitlement.js";
import usageRouter        from "./routes/usage.js";
import checkoutRouter     from "./routes/checkout.js";
import vaultRouter        from "./routes/vault.js";
import webhooksRouter     from "./routes/webhooks.js";

export function createApp() {
  const app = express();

  // ─── Global middleware ──────────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // ─── Health check ───────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", ts: Date.now() });
  });

  // ─── Routes ─────────────────────────────────────────────────────────────────
  app.use("/v1/plans",         plansRouter);
  app.use("/v1/subscriptions", subscriptionsRouter);
  app.use("/v1/entitlement",   entitlementRouter);
  app.use("/v1/usage",         usageRouter);
  app.use("/v1/checkout",      checkoutRouter);
  app.use("/v1/vault",         vaultRouter);
  app.use("/v1/webhooks",      webhooksRouter);

  // ─── 404 ────────────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // ─── Error handler (must be last) ───────────────────────────────────────────
  app.use(errorHandler);

  return app;
}