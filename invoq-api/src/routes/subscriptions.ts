/**
 * src/routes/subscriptions.ts
 *
 * GET    /v1/subscriptions                           → list developer's customers
 * GET    /v1/subscriptions/:customerAddress          → get subscription record
 * GET    /v1/subscriptions/:customerAddress/history  → subscription + payments
 * DELETE /v1/subscriptions/:customerAddress          → cancel subscription
 * POST   /v1/subscriptions/:customerAddress/pause    → pause subscription
 * POST   /v1/subscriptions/:customerAddress/resume   → resume paused subscription
 */

import { Router } from "express";
import { StrKey } from "@stellar/stellar-sdk";
import { desc, eq } from "drizzle-orm";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  getSubscription,
  cancelSubscription,
  setStatus,
  getPlan,
} from "../lib/stellar/registry.js";
import { invalidateEntitlementCache } from "../lib/cache/redis.js";
import { getAdminPublicKey } from "../lib/stellar/client.js";
import {
  db,
  subscriptionCache,
  webhookDeliveries,
  transactionLog,
} from "../lib/db/index.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("subscriptions");

const router = Router();

// ─── GET /v1/subscriptions ──────────────────────────────────────────────────
//
// List all known subscribers for the authenticated developer.
// Reads from subscriptionCache (already synced by the renewal/checkout flows).
router.get(
  "/",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerId, developerAddress } = res.locals.auth;
    if (!developerId || !developerAddress) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const rows = await db
      .select()
      .from(subscriptionCache)
      .where(eq(subscriptionCache.developerAddress, developerAddress))
      .orderBy(desc(subscriptionCache.syncedAt));

    res.json({
      count: rows.length,
      subscriptions: rows.map((r) => ({
        customerAddress:    r.customerAddress,
        planId:             r.planId,
        status:             r.status,
        currentPeriodStart: r.currentPeriodStart,
        currentPeriodEnd:   r.currentPeriodEnd,
        cancelAtPeriodEnd:  r.cancelAtPeriodEnd,
        usageCurrent:       r.usageCurrent,
        syncedAt:           r.syncedAt,
      })),
    });
  })
);

// ─── GET /v1/subscriptions/:customerAddress ─────────────────────────────────

router.get(
  "/:customerAddress",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const customerAddress = req.params.customerAddress;
    if (!customerAddress || Array.isArray(customerAddress)) {
      res.status(400).json({ error: "customerAddress is required" });
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(customerAddress)) {
      res.status(400).json({ error: "Invalid Stellar address" });
      return;
    }
    const sub = await getAuthorizedSubscription(customerAddress, developerAddress);

    if (!sub) {
      res.status(404).json({ error: "No subscription found for this address" });
      return;
    }

    res.json({
      ...sub,
      plan_id:              sub.plan_id.toString(),
      started_at:           sub.started_at.toString(),
      current_period_start: sub.current_period_start.toString(),
      current_period_end:   sub.current_period_end.toString(),
      trial_end:            sub.trial_end.toString(),
      usage_current:        sub.usage_current.toString(),
    });
  })
);

// ─── GET /v1/subscriptions/:customerAddress/history ─────────────────────────

router.get(
  "/:customerAddress/history",
  authenticate(),
  asyncHandler(async (req, res) => {
    const customerAddress = req.params.customerAddress;
    if (!customerAddress || Array.isArray(customerAddress)) {
      res.status(400).json({ error: "customerAddress is required" });
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(customerAddress)) {
      res.status(400).json({ error: "Invalid Stellar address" });
      return;
    }
    const { developerId } = res.locals.auth;
    const { developerAddress } = res.locals.auth;
    if (!developerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sub = await getAuthorizedSubscription(customerAddress, developerAddress);
    if (!sub) {
      res.status(404).json({ error: "No subscription found for this address" });
      return;
    }

    const deliveryRows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.developerId, developerId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    const events = deliveryRows.filter((row) => payloadMatchesCustomer(row.payload, customerAddress));

    // On-chain transaction log rows for this customer (best-effort).
    // transaction_log has no customerAddress column; we filter by developer
    // and rely on the recent tx hash from cache to attach. For now we return
    // a structured empty list — webhook events carry the payment timeline.
    const txRows = await db
      .select()
      .from(transactionLog)
      .where(eq(transactionLog.developerId, developerId))
      .orderBy(desc(transactionLog.createdAt))
      .limit(50);

    res.json({
      subscription: sub
        ? {
            ...sub,
            plan_id:              sub.plan_id.toString(),
            started_at:           sub.started_at.toString(),
            current_period_start: sub.current_period_start.toString(),
            current_period_end:   sub.current_period_end.toString(),
            trial_end:            sub.trial_end.toString(),
            usage_current:        sub.usage_current.toString(),
          }
        : null,
      events: events.map((e) => ({
        id:          e.id,
        event:       e.event,
        status:      e.status,
        httpStatus:  e.httpStatus,
        attempt:     e.attemptCount,
        deliveredAt: e.deliveredAt,
        createdAt:   e.createdAt,
        payload:     e.payload,
      })),
      transactions: txRows.map((t) => ({
        id:        t.id,
        txHash:    t.txHash,
        method:    t.method,
        contractId: t.contractId,
        status:    t.status,
        errorMsg:  t.errorMsg,
        createdAt: t.createdAt,
      })),
    });
  })
);

// ─── DELETE /v1/subscriptions/:customerAddress ──────────────────────────────

router.delete(
  "/:customerAddress",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const customerAddress = req.params.customerAddress;
    if (!customerAddress || Array.isArray(customerAddress)) {
      res.status(400).json({ error: "customerAddress is required" });
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(customerAddress)) {
      res.status(400).json({ error: "Invalid Stellar address" });
      return;
    }
    const sub = await getAuthorizedSubscription(customerAddress, developerAddress);
    if (!sub) {
      res.status(404).json({ error: "No subscription found for this address" });
      return;
    }
    const immediate = req.body?.immediate === true;

    const caller = getAdminPublicKey();
    const result = await cancelSubscription({
      caller,
      customer:  customerAddress,
      immediate,
    });

    if (result.error) {
      if (
        result.txHash &&
        result.error.includes("Transaction not confirmed after")
      ) {
        await invalidateEntitlementCache(customerAddress);
        res.status(202).json({
          txHash: result.txHash,
          immediate,
          pending: true,
          warning: result.error,
        });
        return;
      }
      res.status(502).json({ error: result.error });
      return;
    }

    await invalidateEntitlementCache(customerAddress);

    res.json({ txHash: result.txHash, immediate });
  })
);

// ─── POST /v1/subscriptions/:customerAddress/pause ──────────────────────────

router.post(
  "/:customerAddress/pause",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const customerAddress = req.params.customerAddress;
    if (!customerAddress || Array.isArray(customerAddress)) {
      res.status(400).json({ error: "customerAddress is required" });
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(customerAddress)) {
      res.status(400).json({ error: "Invalid Stellar address" });
      return;
    }
    const sub = await getAuthorizedSubscription(customerAddress, developerAddress);
    if (!sub) {
      res.status(404).json({ error: "No subscription found for this address" });
      return;
    }
    const caller = getAdminPublicKey();
    const result = await setStatus({ caller, customer: customerAddress, status: "Paused" });
    if (result.error) { res.status(502).json({ error: result.error }); return; }
    await invalidateEntitlementCache(customerAddress);

    // Mark in cache
    await db
      .update(subscriptionCache)
      .set({ status: "Paused", cancelAtPeriodEnd: true, syncedAt: new Date() })
      .where(eq(subscriptionCache.customerAddress, customerAddress));

    log.info("subscription paused", { customerAddress, txHash: result.txHash });
    res.json({ customerAddress, status: "Paused", txHash: result.txHash });
  })
);

// ─── POST /v1/subscriptions/:customerAddress/resume ─────────────────────────

router.post(
  "/:customerAddress/resume",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const customerAddress = req.params.customerAddress;
    if (!customerAddress || Array.isArray(customerAddress)) {
      res.status(400).json({ error: "customerAddress is required" });
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(customerAddress)) {
      res.status(400).json({ error: "Invalid Stellar address" });
      return;
    }
    const sub = await getAuthorizedSubscription(customerAddress, developerAddress);
    if (!sub) {
      res.status(404).json({ error: "No subscription found for this address" });
      return;
    }
    const caller = getAdminPublicKey();
    const result = await setStatus({ caller, customer: customerAddress, status: "Active" });
    if (result.error) { res.status(502).json({ error: result.error }); return; }
    await invalidateEntitlementCache(customerAddress);

    await db
      .update(subscriptionCache)
      .set({ status: "Active", cancelAtPeriodEnd: false, syncedAt: new Date() })
      .where(eq(subscriptionCache.customerAddress, customerAddress));

    log.info("subscription resumed", { customerAddress, txHash: result.txHash });
    res.json({ customerAddress, status: "Active", txHash: result.txHash });
  })
);

export default router;

async function getAuthorizedSubscription(customerAddress: string, developerAddress?: string | null) {
  if (!developerAddress) return null;

  const cached = await db
    .select()
    .from(subscriptionCache)
    .where(eq(subscriptionCache.customerAddress, customerAddress))
    .limit(1);
  if (cached[0]?.developerAddress === developerAddress) {
    return getSubscription(customerAddress);
  }

  const sub = await getSubscription(customerAddress);
  if (!sub) return null;

  const plan = await getPlan(sub.plan_id);
  if (!plan || plan.owner !== developerAddress) return null;
  return sub;
}

function payloadMatchesCustomer(payload: unknown, customerAddress: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const candidate = (payload as { customer?: unknown }).customer;
  return typeof candidate === "string" && candidate === customerAddress;
}
