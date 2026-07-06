/**
 * src/routes/plans.ts
 *
 * POST   /v1/plans                    → create plan (admin signs on-chain)
 * POST   /v1/plans/build-tx           → build unsigned create_plan tx for developer to sign
 * POST   /v1/plans/submit-tx          → submit developer-signed create_plan tx with fee bump
 * GET    /v1/plans/:planId            → get plan config
 * PATCH  /v1/plans/:planId            → update plan (admin signs)
 * POST   /v1/plans/build-update-tx    → build unsigned update_plan tx
 * POST   /v1/plans/submit-update-tx   → submit developer-signed update_plan tx
 * DELETE /v1/plans/:planId            → deactivate plan (admin signs)
 * POST   /v1/plans/build-deactivate-tx   → build unsigned deactivate_plan tx
 * POST   /v1/plans/submit-deactivate-tx  → submit developer-signed deactivate_plan tx
 * POST   /v1/plans/:planId/reactivate    → reactivate plan (admin signs)
 * POST   /v1/plans/build-reactivate-tx   → build unsigned reactivate_plan tx
 * POST   /v1/plans/submit-reactivate-tx  → submit developer-signed reactivate_plan tx
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  createPlan,
  getPlan,
  getPlanCount,
  updatePlan,
  deactivatePlan,
  reactivatePlan,
} from "../lib/stellar/registry.js";
import { listSubscriptionCacheByDeveloperAddress } from "../lib/db/index.js";
import {
  buildPlanTxXdr,
  buildUpdatePlanTxXdr,
  buildDeactivatePlanTxXdr,
  buildReactivatePlanTxXdr,
  wrapAndSubmit,
} from "../lib/stellar/feeBump.js";

const router = Router();
type SerializedPlan = ReturnType<typeof serializePlan>;

// ─── POST /v1/plans — admin-signed create_plan_for (no wallet signature) ────
//
// Convenience for the dashboard: creates a plan with the developer's
// Stellar address as the owner. Invoq's admin key signs the contract call
// (via create_plan_for) and pays the fee. No Freighter signing required.
router.post(
  "/",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const { name, priceUsdc, intervalSeconds, trialSeconds, usageLimit, features } = req.body ?? {};
    if (!developerAddress || !name || priceUsdc === undefined || !intervalSeconds) {
      res.status(400).json({ error: "name, priceUsdc, intervalSeconds required" });
      return;
    }

    const { createPlan } = await import("../lib/stellar/registry.js");
    const result = await createPlan({
      owner:           developerAddress,
      name,
      priceUsdc:       BigInt(priceUsdc),
      intervalSeconds: BigInt(intervalSeconds),
      trialSeconds:    BigInt(trialSeconds ?? 0),
      usageLimit:      BigInt(usageLimit ?? 0),
      features:        Array.isArray(features) ? features : [],
    });

    if (result.error) { res.status(502).json({ error: result.error }); return; }

    // Use the returned planId if the contract returned one; otherwise
    // derive from getPlanCount.
    const planId = result.planId !== null
      ? result.planId.toString()
      : (await getPlanCount()).toString();

    res.status(201).json({ planId, txHash: result.txHash });
  })
);

// ─── List plans for the authenticated developer ────────────────────────────────
//
// Scans Registry plan IDs 1..plan_count in parallel batches of 50, filters
// by owner == developer's Stellar address, and returns the surviving plans
// (active + inactive). Caps the RPC surface to avoid stalls.
router.get(
  "/",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    if (!developerAddress) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const count = Number(await getPlanCount());
    if (count === 0) {
      res.json({ plans: [] });
      return;
    }

    const BATCH = 25;
    const out: SerializedPlan[] = [];
    for (let i = 1; i <= count; i += BATCH) {
      const ids: bigint[] = [];
      for (let j = i; j < i + BATCH && j <= count; j++) ids.push(BigInt(j));
      const plans = await Promise.all(ids.map(id => getPlan(id).catch(() => null)));
      for (const p of plans) {
        if (p && p.owner === developerAddress) {
          out.push({
            plan_id:           p.plan_id.toString(),
            name:              p.name,
            price_usdc:        p.price_usdc.toString(),
            interval_seconds:  p.interval_seconds.toString(),
            trial_seconds:     p.trial_seconds.toString(),
            usage_limit:       p.usage_limit.toString(),
            features:          p.features,
            active:            p.active,
            owner:             p.owner,
            created_at:        p.created_at.toString(),
          });
        }
      }
    }

    // Annotate with active-subscriber counts from cache
    const cacheRows = await listSubscriptionCacheByDeveloperAddress(developerAddress);

    const subsByPlan = new Map<number, { active: number; total: number }>();
    for (const r of cacheRows) {
      const key = Number(r.planId);
      const e = subsByPlan.get(key) ?? { active: 0, total: 0 };
      e.total += 1;
      if (r.status === "Active" || r.status === "Trialing" || r.status === "GracePeriod") e.active += 1;
      subsByPlan.set(key, e);
    }

    for (const p of out) {
      const s = subsByPlan.get(Number(p.plan_id));
      Object.assign(p, {
        active_subscribers: s?.active ?? 0,
        total_subscribers:  s?.total  ?? 0,
      });
    }

    res.json({ plans: out });
  })
);



// POST /v1/plans/build-tx
router.post(
  "/build-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const {
      developerAddress,
      name,
      priceUsdc,
      intervalSeconds,
      trialSeconds,
      usageLimit,
      features,
    } = req.body;

    if (!developerAddress || !name || priceUsdc === undefined || !intervalSeconds) {
      res.status(400).json({
        error: "developerAddress, name, priceUsdc, intervalSeconds required",
      });
      return;
    }

    console.log("[Plans] Building create_plan tx for developer:", developerAddress);

    const result = await buildPlanTxXdr({
      developerAddress,
      name,
      priceUsdc:       BigInt(priceUsdc),
      intervalSeconds: BigInt(intervalSeconds),
      trialSeconds:    BigInt(trialSeconds ?? 0),
      usageLimit:      BigInt(usageLimit ?? 0),
      features:        features ?? [],
    });

    if (result.error) {
      console.error("[Plans] buildPlanTxXdr failed:", result.error);
      res.status(502).json({ error: result.error });
      return;
    }

    console.log("[Plans] Built XDR, length:", result.xdr?.length);
    res.json({ xdr: result.xdr });
  })
);

// POST /v1/plans/submit-tx
router.post(
  "/submit-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { signedXdr, developerAddress } = req.body;

    if (!signedXdr) {
      res.status(400).json({ error: "signedXdr required" });
      return;
    }

    // Wrap with fee bump and submit.
    // Pass developerAddress for optional signer verification — prevents a
    // malicious actor from replaying another developer's signed XDR.
    const result = await wrapAndSubmit(signedXdr, developerAddress ?? undefined);

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    // Derive planId from the on-chain plan count after successful submission.
    // NOTE: We read AFTER confirmation so we get the final count.
    // In high-concurrency deployments, prefer returning planId from the
    // contract's return value (requires parsing result XDR) instead.
    const countAfter = await getPlanCount();
    const planId     = countAfter.toString();

    res.status(201).json({ planId, txHash: result.txHash });
  })
);

// POST /v1/plans/build-update-tx
router.post(
  "/build-update-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { developerAddress, planId, name, priceUsdc, usageLimit, features } = req.body;

    if (!developerAddress || !planId || !name || priceUsdc === undefined) {
      res.status(400).json({
        error: "developerAddress, planId, name, priceUsdc required",
      });
      return;
    }

    const result = await buildUpdatePlanTxXdr({
      developerAddress,
      planId:    BigInt(planId),
      name,
      priceUsdc: BigInt(priceUsdc),
      usageLimit: BigInt(usageLimit ?? 0),
      features:  features ?? [],
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ xdr: result.xdr });
  })
);

// POST /v1/plans/submit-update-tx
router.post(
  "/submit-update-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { signedXdr, developerAddress } = req.body;

    if (!signedXdr) {
      res.status(400).json({ error: "signedXdr required" });
      return;
    }

    const result = await wrapAndSubmit(signedXdr, developerAddress ?? undefined);

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ txHash: result.txHash });
  })
);

// POST /v1/plans/build-deactivate-tx
router.post(
  "/build-deactivate-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { developerAddress, planId } = req.body;

    if (!developerAddress || !planId) {
      res.status(400).json({ error: "developerAddress, planId required" });
      return;
    }

    const result = await buildDeactivatePlanTxXdr({
      developerAddress,
      planId: BigInt(planId),
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ xdr: result.xdr });
  })
);

// POST /v1/plans/submit-deactivate-tx
router.post(
  "/submit-deactivate-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { signedXdr, developerAddress } = req.body;

    if (!signedXdr) {
      res.status(400).json({ error: "signedXdr required" });
      return;
    }

    const result = await wrapAndSubmit(signedXdr, developerAddress ?? undefined);

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ txHash: result.txHash });
  })
);

// POST /v1/plans/build-reactivate-tx
router.post(
  "/build-reactivate-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { developerAddress, planId } = req.body;

    if (!developerAddress || !planId) {
      res.status(400).json({ error: "developerAddress, planId required" });
      return;
    }

    const result = await buildReactivatePlanTxXdr({
      developerAddress,
      planId: BigInt(planId),
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ xdr: result.xdr });
  })
);

// POST /v1/plans/submit-reactivate-tx
router.post(
  "/submit-reactivate-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { signedXdr, developerAddress } = req.body;

    if (!signedXdr) {
      res.status(400).json({ error: "signedXdr required" });
      return;
    }

    const result = await wrapAndSubmit(signedXdr, developerAddress ?? undefined);

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ txHash: result.txHash });
  })
);

// ─── Admin-signed plan operations (server holds key) ─────────────────────────

// POST /v1/plans
router.post(
  "/",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const { name, priceUsdc, intervalSeconds, trialSeconds, usageLimit, features } = req.body;

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
      console.error("[Plans] createPlan failed:", {
        owner: developerAddress,
        name,
        error: result.error,
        txHash: result.txHash,
      });
      res.status(502).json({ error: result.error });
      return;
    }

    res.status(201).json({
      planId: result.planId?.toString(),
      txHash: result.txHash,
    });
  })
);

// ─── Plan-ID–scoped routes ────────────────────────────────────────────────────

// GET /v1/plans/:planId
router.get(
  "/:planId",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const planId = parsePlanId(req.params.planId);
    if (planId === null) {
      res.status(400).json({ error: "planId must be a positive integer" });
      return;
    }

    const plan = await requireOwnedPlan(planId, developerAddress);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    res.json(serializePlan(plan));
  })
);

// PATCH /v1/plans/:planId
router.patch(
  "/:planId",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;

    const planId = parsePlanId(req.params.planId);
    if (planId === null) {
      res.status(400).json({ error: "planId must be a positive integer" });
      return;
    }
    const plan = await requireOwnedPlan(planId, developerAddress);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

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

    const planId = parsePlanId(req.params.planId);
    if (planId === null) {
      res.status(400).json({ error: "planId must be a positive integer" });
      return;
    }
    const plan = await requireOwnedPlan(planId, developerAddress);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

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

    const planId = parsePlanId(req.params.planId);
    if (planId === null) {
      res.status(400).json({ error: "planId must be a positive integer" });
      return;
    }
    const plan = await requireOwnedPlan(planId, developerAddress);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    const result = await reactivatePlan(developerAddress!, planId);

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ txHash: result.txHash });
  })
);

export default router;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse and validate a planId route param.
 * Returns null if the value is missing, non-numeric, or not a positive integer.
 */
function parsePlanId(param: string | string[] | undefined): bigint | null {
  if (!param || Array.isArray(param)) return null;
  try {
    const id = BigInt(param);
    return id > 0n ? id : null;
  } catch {
    return null;
  }
}

async function requireOwnedPlan(planId: bigint, developerAddress?: string | null) {
  if (!developerAddress) return null;
  const plan = await getPlan(planId);
  if (!plan || plan.owner !== developerAddress) return null;
  return plan;
}

function serializePlan(plan: Awaited<ReturnType<typeof getPlan>> extends infer T ? Exclude<T, null> : never) {
  return {
    ...plan,
    plan_id:          plan.plan_id.toString(),
    price_usdc:       plan.price_usdc.toString(),
    interval_seconds: plan.interval_seconds.toString(),
    trial_seconds:    plan.trial_seconds.toString(),
    usage_limit:      plan.usage_limit.toString(),
    created_at:       plan.created_at.toString(),
  };
}
