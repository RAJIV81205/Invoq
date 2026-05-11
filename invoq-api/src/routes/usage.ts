/**
 * src/routes/usage.ts
 *
 * POST /v1/usage/record
 *   → Buffers usage in Redis. Background job flushes to chain in batches.
 *   → Returns immediately — no chain wait on the hot path.
 *
 * GET /v1/usage/:customerAddress
 *   → Reads usage_current from subscription record on chain.
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { bufferUsage } from "../lib/cache/redis.js";
import { getSubscription } from "../lib/stellar/registry.js";

const router = Router();

// POST /v1/usage/record
// body: { customer: string, units: number }
router.post(
  "/record",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { customer, units } = req.body;

    if (!customer || units === undefined || units <= 0) {
      res.status(400).json({ error: "customer and units (> 0) required" });
      return;
    }

    const newBufferTotal = await bufferUsage(customer, Number(units));

    res.status(202).json({
      accepted: true,
      customer,
      units,
      bufferTotal: newBufferTotal,
    });
  })
);

// GET /v1/usage/:customerAddress
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
      customer:      customerAddress,
      usageCurrent:  sub.usage_current.toString(),
      periodStart:   sub.current_period_start.toString(),
      periodEnd:     sub.current_period_end.toString(),
      status:        sub.status,
    });
  })
);

export default router;