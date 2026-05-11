import "dotenv/config";
import { createApp } from "./src/app.js";
import { createLogger } from "./src/lib/logger.js";
import { startRenewalJob }            from "./src/jobs/renewal.js";
import { startGraceExpiryJob }        from "./src/jobs/grace-expiry.js";
import { startUsageFlushJob }         from "./src/jobs/usage-flush.js";
import { startWebhookDeliveryWorker } from "./src/jobs/webhook-delivery.js";
import type { Server } from "http";

const log  = createLogger("main");
const PORT = Number(process.env.PORT ?? 3001);

async function main(): Promise<void> {
  log.info("invoq-api starting", {
    port:    PORT,
    network: process.env.STELLAR_NETWORK ?? "testnet",
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: process.env.LOG_LEVEL ?? "info",
  });

  const app = createApp();

  // ── Background jobs ────────────────────────────────────────────────────────
  log.info("starting background jobs");
  startRenewalJob();
  log.info("job started: renewal (every 60s)");
  startGraceExpiryJob();
  log.info("job started: grace-expiry (every 15min)");
  startUsageFlushJob();
  log.info("job started: usage-flush (every 5s)");
  startWebhookDeliveryWorker();
  log.info("job started: webhook-delivery (concurrency=10)");

  // ── HTTP server ────────────────────────────────────────────────────────────
  const server: Server = app.listen(PORT, () => {
    log.info("http server listening", {
      port:    PORT,
      network: process.env.STELLAR_NETWORK ?? "testnet",
    });
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  function shutdown(signal: string): void {
    log.info("shutdown signal received", { signal });
    server.close((err) => {
      if (err) {
        log.error("error closing http server", { error: err.message });
        process.exit(1);
      }
      log.info("http server closed, exiting");
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      log.error("graceful shutdown timeout, forcing exit");
      process.exit(1);
    }, 15_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    log.error("uncaught exception", {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    log.error("unhandled promise rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack:  reason instanceof Error ? reason.stack : undefined,
    });
    process.exit(1);
  });
}

main().catch((err) => {
  // Use raw stderr before logger might be unavailable
  process.stderr.write(
    JSON.stringify({ ts: new Date().toISOString(), level: "error", module: "main", msg: "fatal startup error", error: String(err) }) + "\n"
  );
  process.exit(1);
});