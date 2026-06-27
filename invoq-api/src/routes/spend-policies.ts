/**
 * src/routes/spend-policies.ts
 *
 * HTTP surface over the SpendPolicy contract.
 *
 *   POST   /v1/spend-policies                → create (admin signs)
 *   GET    /v1/spend-policies/:owner         → read policy
 *   PATCH  /v1/spend-policies/:owner         → update
 *   POST   /v1/spend-policies/:owner/deactivate
 *   POST   /v1/spend-policies/:owner/reactivate
 *   POST   /v1/spend-policies/check          → public gate (simulated, no auth)
 *   POST   /v1/spend-policies/record         → admin call after payment
 */

import { Router } from "express";
import { StrKey } from "@stellar/stellar-sdk";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  createPolicy,
  updatePolicy,
  deactivatePolicy,
  reactivatePolicy,
  checkSpend,
  recordSpend,
  getPolicy,
  getDailySpent,
  getDailyLimitRemaining,
} from "../lib/stellar/spend-policy.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("spend-policies");

const router = Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

function notConfigured(res: any): boolean {
  if (!process.env.SPEND_POLICY_CONTRACT_ADDRESS) {
    res.status(503).json({
      error: "SpendPolicy contract not configured. Set SPEND_POLICY_CONTRACT_ADDRESS in invoq-api .env",
    });
    return true;
  }
  return false;
}

function parseStroops(raw: unknown, label: string): bigint | null {
  if (raw === undefined || raw === null) return null;
  try {
    const n = BigInt(raw as any);
    return n >= 0n ? n : null;
  } catch {
    return null;
  }
}

function assertAddress(label: string, value: unknown): string | null {
  if (!value || typeof value !== "string" || !StrKey.isValidEd25519PublicKey(value)) {
    return `${label} must be a valid Stellar G... address`;
  }
  return null;
}

// ─── POST /v1/spend-policies ─────────────────────────────────────────────────

router.post(
  "/",
  authenticate(["sk"]),
  asyncHandler(async (req, res) => {
    if (notConfigured(res)) return;
    const { owner, dailyLimitUsdc, txLimitUsdc, allowlist, agents } = req.body ?? {};

    const ownerErr = assertAddress("owner", owner);
    if (ownerErr) { res.status(400).json({ error: ownerErr }); return; }

    const daily  = parseStroops(dailyLimitUsdc, "dailyLimitUsdc");
    const txLim  = parseStroops(txLimitUsdc,    "txLimitUsdc");
    if (daily === null) { res.status(400).json({ error: "dailyLimitUsdc is required (non-negative integer in stroops)" }); return; }
    if (txLim === null) { res.status(400).json({ error: "txLimitUsdc is required (non-negative integer in stroops)" }); return; }

    const allowlistArr = Array.isArray(allowlist) ? allowlist.filter(a => typeof a === "string") : [];
    const agentsArr    = Array.isArray(agents)     ? agents.filter(a => typeof a === "string")     : [];

    // In production the owner must sign. The create_policy contract function
    // does not take a caller param (it sets owner = invoker). When admin is
    // the same wallet as owner this works; otherwise the owner must sign the
    // tx on the frontend. For testnet/admin-as-owner this is the supported path.
    const result = await createPolicy({
      owner:         owner as string,
      dailyLimitUsdc: daily,
      txLimitUsdc:    txLim,
      allowlist:      allowlistArr,
      agents:         agentsArr,
    });

    if (result.error) { res.status(502).json({ error: result.error }); return; }

    log.info("spend policy created", { owner, txHash: result.txHash });
    res.status(201).json({ owner, txHash: result.txHash });
  })
);

// ─── GET /v1/spend-policies/:owner ───────────────────────────────────────────

router.get(
  "/:owner",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    if (notConfigured(res)) return;
    const owner = req.params.owner;
    if (!owner || Array.isArray(owner)) {
      res.status(400).json({ error: "owner is required" });
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(owner)) {
      res.status(400).json({ error: "owner must be a valid Stellar G... address" });
      return;
    }
    const policy = await getPolicy(owner);
    if (!policy) { res.status(404).json({ error: "No policy for this owner" }); return; }
    res.json({
      ...policy,
      daily_limit_usdc: policy.daily_limit_usdc.toString(),
      tx_limit_usdc:    policy.tx_limit_usdc.toString(),
      created_at:       policy.created_at.toString(),
    });
  })
);

// ─── PATCH /v1/spend-policies/:owner ──────────────────────────────────────────

router.patch(
  "/:owner",
  authenticate(["sk"]),
  asyncHandler(async (req, res) => {
    if (notConfigured(res)) return;
    const owner = req.params.owner;
    if (!owner || Array.isArray(owner)) {
      res.status(400).json({ error: "owner is required" });
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(owner)) {
      res.status(400).json({ error: "owner must be a valid Stellar G... address" });
      return;
    }
    const { dailyLimitUsdc, txLimitUsdc, allowlist, agents } = req.body ?? {};
    const daily = parseStroops(dailyLimitUsdc, "dailyLimitUsdc");
    const txLim = parseStroops(txLimitUsdc,    "txLimitUsdc");
    if (daily === null || txLim === null) {
      res.status(400).json({ error: "dailyLimitUsdc and txLimitUsdc are required (non-negative integer stroops)" });
      return;
    }
    const allowlistArr = Array.isArray(allowlist) ? allowlist.filter(a => typeof a === "string") : [];
    const agentsArr    = Array.isArray(agents)     ? agents.filter(a => typeof a === "string")     : [];

    const result = await updatePolicy({
      caller:         owner,
      dailyLimitUsdc: daily,
      txLimitUsdc:    txLim,
      allowlist:      allowlistArr,
      agents:         agentsArr,
    });
    if (result.error) { res.status(502).json({ error: result.error }); return; }
    res.json({ owner, txHash: result.txHash });
  })
);

// ─── POST /v1/spend-policies/:owner/deactivate ───────────────────────────────

router.post(
  "/:owner/deactivate",
  authenticate(["sk"]),
  asyncHandler(async (req, res) => {
    if (notConfigured(res)) return;
    const owner = req.params.owner;
    if (!owner || Array.isArray(owner)) {
      res.status(400).json({ error: "owner is required" });
      return;
    }
    const result = await deactivatePolicy(owner);
    if (result.error) { res.status(502).json({ error: result.error }); return; }
    res.json({ owner, txHash: result.txHash });
  })
);

// ─── POST /v1/spend-policies/:owner/reactivate ────────────────────────────────

router.post(
  "/:owner/reactivate",
  authenticate(["sk"]),
  asyncHandler(async (req, res) => {
    if (notConfigured(res)) return;
    const owner = req.params.owner;
    if (!owner || Array.isArray(owner)) {
      res.status(400).json({ error: "owner is required" });
      return;
    }
    const result = await reactivatePolicy(owner);
    if (result.error) { res.status(502).json({ error: result.error }); return; }
    res.json({ owner, txHash: result.txHash });
  })
);

// ─── POST /v1/spend-policies/check ───────────────────────────────────────────
//
// Read-only simulation. Public gate — no auth, but rate-limited at the app layer.
// Body: { agent, destination, amountUsdc }
//
router.post(
  "/check",
  asyncHandler(async (req, res) => {
    if (notConfigured(res)) return;
    const { agent, destination, amountUsdc } = req.body ?? {};
    const aErr = assertAddress("agent", agent);
    const dErr = assertAddress("destination", destination);
    if (aErr)      { res.status(400).json({ error: aErr }); return; }
    if (dErr)      { res.status(400).json({ error: dErr }); return; }
    const amount = parseStroops(amountUsdc, "amountUsdc");
    if (amount === null) {
      res.status(400).json({ error: "amountUsdc is required (non-negative integer in stroops)" });
      return;
    }

    const reason = await checkSpend(agent as string, destination as string, amount);
    const allowed = reason === "Allowed" || reason === "NoPolicyFound";
    res.json({ allowed, reason });
  })
);

// ─── POST /v1/spend-policies/record ──────────────────────────────────────────
//
// Admin-only — call after a confirmed payment to update the daily counter.
// Body: { agent, amountUsdc }
//
router.post(
  "/record",
  authenticate(["sk"]),
  asyncHandler(async (req, res) => {
    if (notConfigured(res)) return;
    const { agent, amountUsdc } = req.body ?? {};
    const aErr = assertAddress("agent", agent);
    if (aErr) { res.status(400).json({ error: aErr }); return; }
    const amount = parseStroops(amountUsdc, "amountUsdc");
    if (amount === null) {
      res.status(400).json({ error: "amountUsdc is required (non-negative integer in stroops)" });
      return;
    }
    const result = await recordSpend(agent as string, amount);
    if (result.error) { res.status(502).json({ error: result.error }); return; }
    res.json({ agent, txHash: result.txHash, newTotal: result.newTotal?.toString() ?? null });
  })
);

// ─── GET /v1/spend-policies/:owner/daily ─────────────────────────────────────
//
// Helper: returns today's spent + remaining allowance. Read-only.
router.get(
  "/:owner/daily",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    if (notConfigured(res)) return;
    const owner = req.params.owner;
    if (!owner || Array.isArray(owner)) {
      res.status(400).json({ error: "owner is required" });
      return;
    }
    const nowSecs = BigInt(Math.floor(Date.now() / 1000));
    const [spent, remaining] = await Promise.all([
      getDailySpent(owner, nowSecs),
      getDailyLimitRemaining(owner, nowSecs),
    ]);
    res.json({
      owner,
      timestamp:    nowSecs.toString(),
      spent:        spent.toString(),
      remaining:    remaining.toString(),
    });
  })
);

export default router;
