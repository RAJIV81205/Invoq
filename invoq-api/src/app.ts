import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createLogger } from "./lib/logger.js";
import { requestLogger, errorHandler } from "./middleware/error.js";
import { pingRedis } from "./lib/cache/redis.js";
import { db } from "./lib/db/index.js";
import { sql } from "drizzle-orm";

import plansRouter         from "./routes/plans.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import entitlementRouter   from "./routes/entitlement.js";
import usageRouter         from "./routes/usage.js";
import checkoutRouter      from "./routes/checkout.js";
import vaultRouter         from "./routes/vault.js";
import webhooksRouter      from "./routes/webhooks.js";

const log = createLogger("app");

// ─────────────────────────────────────────────────────────────────────────────
// Simple in-memory rate limiter (no extra deps)
// Allows N requests per windowMs per IP
// ─────────────────────────────────────────────────────────────────────────────
function buildRateLimiter(opts: {
  windowMs: number;
  max: number;
  message?: string;
}) {
  const counts = new Map<string, { count: number; resetAt: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of counts.entries()) {
      if (val.resetAt < now) counts.delete(key);
    }
  }, opts.windowMs).unref();

  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const ip  = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    const now = Date.now();
    let entry = counts.get(ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      counts.set(ip, entry);
    }
    entry.count++;
    res.setHeader("X-RateLimit-Limit",     opts.max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, opts.max - entry.count));
    res.setHeader("X-RateLimit-Reset",     Math.ceil(entry.resetAt / 1000));
    if (entry.count > opts.max) {
      log.warn("rate limit exceeded", { ip, path: req.path, count: entry.count });
      res.status(429).json({ error: opts.message ?? "Too many requests" });
      return;
    }
    next();
  };
}

export function createApp() {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors());

  // ── Body parsing ───────────────────────────────────────────────────────────
  app.use(express.json({ limit: "256kb" }));

  // ── Request logging ────────────────────────────────────────────────────────
  app.use(requestLogger());

  // ── Rate limiting: 300 req/min per IP globally ─────────────────────────────
  app.use(buildRateLimiter({ windowMs: 60_000, max: 300 }));

  // ── Health check (deep) ───────────────────────────────────────────────────
  app.get("/health", async (_req, res) => {
    const startMs = Date.now();

    const [redisOk, dbOk] = await Promise.all([
      pingRedis().catch(() => false),
      db.execute(sql`SELECT 1`).then(() => true).catch(() => false),
    ]);

    const status = redisOk && dbOk ? "ok" : "degraded";
    const code   = status === "ok" ? 200 : 503;

    log[status === "ok" ? "debug" : "warn"]("health check", {
      status,
      redis: redisOk,
      db:    dbOk,
      durationMs: Date.now() - startMs,
    });

    res.status(code).json({
      status,
      ts:    Date.now(),
      redis: redisOk ? "ok" : "error",
      db:    dbOk    ? "ok" : "error",
    });
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  app.use("/v1/plans",         plansRouter);
  app.use("/v1/subscriptions", subscriptionsRouter);
  app.use("/v1/entitlement",   entitlementRouter);
  app.use("/v1/usage",         usageRouter);
  app.use("/v1/checkout",      checkoutRouter);
  app.use("/v1/vault",         vaultRouter);
  app.use("/v1/webhooks",      webhooksRouter);

  // ── 404 ────────────────────────────────────────────────────────────────────
  app.use((req, res) => {
    log.warn("404 not found", { method: req.method, path: req.path });
    res.status(404).json({ error: "Not found" });
  });

  // ── Error handler (must be last) ───────────────────────────────────────────
  app.use(errorHandler);

  return app;
}