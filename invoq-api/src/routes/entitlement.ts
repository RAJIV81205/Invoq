/**
 * src/routes/entitlement.ts
 *
 * GET /v1/entitlement?customer=G...&feature=pro
 *   → Redis cache first (10s TTL), fallback to chain simulation.
 *   → Returns { entitled: boolean } in under 10ms on cache hit.
 *
 * GET /v1/entitlement/full?customer=G...&feature=pro
 *   → Full EntitlementResult from chain (no cache). Use for dashboards.
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  checkEntitlement,
  checkEntitlementFull,
} from "../lib/stellar/registry.js";
import {
  getCachedEntitlement,
  setCachedEntitlement,
} from "../lib/cache/redis.js";

const router = Router();

// GET /v1/entitlement?customer=G...&feature=pro
router.get(
  "/",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const customer = req.query.customer as string;
    const feature  = req.query.feature  as string;

    if (!customer || !feature) {
      res.status(400).json({ error: "customer and feature query params required" });
      return;
    }

    // Cache hit
    const cached = await getCachedEntitlement(customer, feature);
    if (cached !== null) {
      res.json({ entitled: cached, source: "cache" });
      return;
    }

    // Cache miss → hit chain
    const entitled = await checkEntitlement(customer, feature);
    await setCachedEntitlement(customer, feature, entitled);

    res.json({ entitled, source: "chain" });
  })
);

// GET /v1/entitlement/full?customer=G...&feature=pro
router.get(
  "/full",
  authenticate(),
  asyncHandler(async (req, res) => {
    const customer = req.query.customer as string;
    const feature  = req.query.feature  as string;

    if (!customer || !feature) {
      res.status(400).json({ error: "customer and feature query params required" });
      return;
    }

    const result = await checkEntitlementFull(customer, feature);

    if (!result) {
      res.status(404).json({ error: "No subscription found for customer" });
      return;
    }

    res.json({
      ...result,
      plan_id:            result.plan_id.toString(),
      usage_current:      result.usage_current.toString(),
      usage_limit:        result.usage_limit.toString(),
      current_period_end: result.current_period_end.toString(),
    });
  })
);

export default router;