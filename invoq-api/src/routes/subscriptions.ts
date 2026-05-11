/**
 * src/routes/subscriptions.ts
 *
 * GET    /v1/subscriptions/:customerAddress  → get subscription record
 * DELETE /v1/subscriptions/:customerAddress  → cancel subscription
 */

import { Router } from "express";
import { StrKey } from "@stellar/stellar-sdk";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { getSubscription, cancelSubscription } from "../lib/stellar/registry.js";
import { invalidateEntitlementCache } from "../lib/cache/redis.js";
import { getAdminPublicKey } from "../lib/stellar/client.js";

const router = Router();

// GET /v1/subscriptions/:customerAddress
router.get(
  "/:customerAddress",
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
    const sub = await getSubscription(customerAddress);

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

// DELETE /v1/subscriptions/:customerAddress
// body: { immediate?: boolean }
router.delete(
  "/:customerAddress",
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
    const immediate = req.body?.immediate === true;

    // This route is backend-admin mediated, so the on-chain caller must be admin.
    const caller = getAdminPublicKey();
    const result = await cancelSubscription({
      caller,
      customer:  customerAddress,
      immediate,
    });

    if (result.error) {
      // Testnet occasionally confirms late; return pending with hash instead of hard failure.
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

    // Bust entitlement cache for this customer
    await invalidateEntitlementCache(customerAddress);

    res.json({ txHash: result.txHash, immediate });
  })
);

export default router;
