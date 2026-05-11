/**
 * main.ts
 *
 * Process entry point.
 * Starts the Express HTTP server and all BullMQ background workers.
 */

import "dotenv/config";
import { createApp } from "./src/app.js";
import { startRenewalJob }          from "./src/jobs/renewal.js";
import { startGraceExpiryJob }      from "./src/jobs/grace-expiry.js";
import { startUsageFlushJob }       from "./src/jobs/usage-flush.js";
import { startWebhookDeliveryWorker } from "./src/jobs/webhook-delivery.js";

const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  const app = createApp();

  // ─── Start BullMQ workers ────────────────────────────────────────────────
  startRenewalJob();
  startGraceExpiryJob();
  startUsageFlushJob();
  startWebhookDeliveryWorker();

  // ─── Start HTTP server ───────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`[invoq-api] listening on port ${PORT}`);
    console.log(`[invoq-api] network: ${process.env.STELLAR_NETWORK ?? "testnet"}`);
  });
}

main().catch((err) => {
  console.error("[invoq-api] fatal startup error:", err);
  process.exit(1);
});