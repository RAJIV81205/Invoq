/**
 * src/routes/subscriptions.ts
 *
 * GET    /v1/subscriptions/:customerAddress  → get subscription record
 * DELETE /v1/subscriptions/:customerAddress  → cancel subscription
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { getSubscription, cancelSubscription } from "../lib/stellar/registry.js";
import { invalidateEntitlementCache } from "../lib/cache/redis.js";

const router = Router();

// GET /v1/subscriptions/:customerAddress
router.get(
  "/:customerAddress",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { customerAddress } = req.params;
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
    const { developerAddress } = res.locals.auth;
    const { customerAddress }  = req.params;
    const immediate = req.body?.immediate === true;

    const result = await cancelSubscription({
      caller:    developerAddress!,
      customer:  customerAddress,
      immediate,
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    // Bust entitlement cache for this customer
    await invalidateEntitlementCache(customerAddress);

    res.json({ txHash: result.txHash, immediate });
  })
);

export default router;