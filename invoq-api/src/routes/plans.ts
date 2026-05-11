/**
 * src/routes/plans.ts
 *
 * POST   /v1/plans              → create plan (on-chain via SubscriptionRegistry)
 * GET    /v1/plans/:planId      → get plan config
 * PATCH  /v1/plans/:planId      → update plan
 * DELETE /v1/plans/:planId      → deactivate plan
 * POST   /v1/plans/:planId/reactivate → reactivate plan
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  createPlan,
  getPlan,
  updatePlan,
  deactivatePlan,
  reactivatePlan,
} from "../lib/stellar/registry.js";

const router = Router();

// POST /v1/plans
router.post(
  "/",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;

    const {
      name,
      priceUsdc,
      intervalSeconds,
      trialSeconds,
      usageLimit,
      features,
    } = req.body;

    if (!name || priceUsdc === undefined || !intervalSeconds) {
      res.status(400).json({ error: "name, priceUsdc, intervalSeconds required" });
      return;
    }

    const result = await createPlan({
      owner:           developerAddress!,
      name,
      priceUsdc:       BigInt(priceUsdc),
      intervalSeconds: BigInt(intervalSeconds),
      trialSeconds:    BigInt(trialSeconds ?? 0),
      usageLimit:      BigInt(usageLimit ?? 0),
      features:        features ?? [],
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.status(201).json({
      planId: result.planId?.toString(),
      txHash: result.txHash,
    });
  })
);

// GET /v1/plans/:planId
router.get(
  "/:planId",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const planId = BigInt(req.params.planId);
    const plan   = await getPlan(planId);

    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    res.json({
      ...plan,
      plan_id:          plan.plan_id.toString(),
      price_usdc:       plan.price_usdc.toString(),
      interval_seconds: plan.interval_seconds.toString(),
      trial_seconds:    plan.trial_seconds.toString(),
      usage_limit:      plan.usage_limit.toString(),
      created_at:       plan.created_at.toString(),
    });
  })
);

// PATCH /v1/plans/:planId
router.patch(
  "/:planId",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const planId = BigInt(req.params.planId);

    const { name, priceUsdc, usageLimit, features } = req.body;

    if (!name || priceUsdc === undefined) {
      res.status(400).json({ error: "name, priceUsdc required" });
      return;
    }

    const result = await updatePlan({
      caller:     developerAddress!,
      planId,
      name,
      priceUsdc:  BigInt(priceUsdc),
      usageLimit: BigInt(usageLimit ?? 0),
      features:   features ?? [],
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ txHash: result.txHash });
  })
);

// DELETE /v1/plans/:planId
router.delete(
  "/:planId",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const planId = BigInt(req.params.planId);

    const result = await deactivatePlan(developerAddress!, planId);

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ txHash: result.txHash });
  })
);

// POST /v1/plans/:planId/reactivate
router.post(
  "/:planId/reactivate",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const planId = BigInt(req.params.planId);

    const result = await reactivatePlan(developerAddress!, planId);

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ txHash: result.txHash });
  })
);

export default router;