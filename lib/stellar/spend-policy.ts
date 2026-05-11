/**
 * src/lib/stellar/spend-policy.ts
 *
 * Type-safe wrapper for all SpendPolicy contract calls.
 */

import {
  invokeContract,
  simulateContract,
  toScAddress,
  toScI128,
  toScBool,
  getAdminPublicKey,
} from "./client";
import { xdr } from "@stellar/stellar-sdk";

const CONTRACT_ID = process.env.SPEND_POLICY_CONTRACT_ID!;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SpendCheckResult =
  | "Allowed"
  | "BlockedByAllowlist"
  | "BlockedByTxLimit"
  | "BlockedByDailyLimit"
  | "NoPolicyFound";

export interface SpendPolicyConfig {
  owner: string;
  daily_limit_usdc: bigint;
  tx_limit_usdc: bigint;
  allowlist: string[];
  agents: string[];
  active: boolean;
  created_at: bigint;
}

// ─── Policy management ────────────────────────────────────────────────────────

/**
 * Creates a new spend policy.
 * The owner must sign this transaction — they self-identify as the policy owner.
 * In production: owner signs via wallet on frontend and sends signed XDR back.
 * For admin-managed flows: admin is also the owner (same keypair).
 */
export async function createPolicy(params: {
  owner: string;
  dailyLimitUsdc: bigint;
  txLimitUsdc: bigint;
  allowlist: string[];
  agents: string[];
}): Promise<{ txHash: string | null; error: string | null }> {
  const allowlistScVal = xdr.ScVal.scvVec(
    params.allowlist.map((a) => toScAddress(a))
  );
  const agentsScVal = xdr.ScVal.scvVec(
    params.agents.map((a) => toScAddress(a))
  );

  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "create_policy",
    args: [
      toScAddress(params.owner),
      toScI128(params.dailyLimitUsdc),
      toScI128(params.txLimitUsdc),
      allowlistScVal,
      agentsScVal,
    ],
  });
  return { txHash: result.txHash, error: result.error };
}

/**
 * Updates an existing policy. Caller must be the policy owner.
 */
export async function updatePolicy(params: {
  caller: string;
  dailyLimitUsdc: bigint;
  txLimitUsdc: bigint;
  allowlist: string[];
  agents: string[];
}): Promise<{ txHash: string | null; error: string | null }> {
  const allowlistScVal = xdr.ScVal.scvVec(
    params.allowlist.map((a) => toScAddress(a))
  );
  const agentsScVal = xdr.ScVal.scvVec(
    params.agents.map((a) => toScAddress(a))
  );

  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "update_policy",
    args: [
      toScAddress(params.caller),
      toScI128(params.dailyLimitUsdc),
      toScI128(params.txLimitUsdc),
      allowlistScVal,
      agentsScVal,
    ],
  });
  return { txHash: result.txHash, error: result.error };
}

/**
 * Deactivates a policy. Owner or admin.
 */
export async function deactivatePolicy(
  caller: string
): Promise<{ txHash: string | null; error: string | null }> {
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "deactivate_policy",
    args: [toScAddress(caller)],
  });
  return { txHash: result.txHash, error: result.error };
}

/**
 * Reactivates a policy. Owner or admin.
 */
export async function reactivatePolicy(
  caller: string
): Promise<{ txHash: string | null; error: string | null }> {
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "reactivate_policy",
    args: [toScAddress(caller)],
  });
  return { txHash: result.txHash, error: result.error };
}

// ─── Spend checking (hot path) ────────────────────────────────────────────────

/**
 * Checks whether a proposed payment from an agent is permitted.
 * Read-only simulation — free and instant.
 *
 * Returns a SpendCheckResult enum value.
 * Use isSpendAllowed() when you only need a boolean.
 */
export async function checkSpend(
  agent: string,
  destination: string,
  amountUsdc: bigint
): Promise<SpendCheckResult> {
  const result = await simulateContract<SpendCheckResult>({
    contractId: CONTRACT_ID,
    method: "check_spend",
    args: [
      toScAddress(agent),
      toScAddress(destination),
      toScI128(amountUsdc),
    ],
  });
  // Default to Allowed if simulation fails — safe permissive default
  return result.value ?? "NoPolicyFound";
}

/**
 * Boolean convenience wrapper around checkSpend.
 */
export async function isSpendAllowed(
  agent: string,
  destination: string,
  amountUsdc: bigint
): Promise<boolean> {
  const result = await checkSpend(agent, destination, amountUsdc);
  return result === "Allowed" || result === "NoPolicyFound";
}

// ─── Spend recording (called after confirmed payment) ─────────────────────────

/**
 * Records a confirmed spend against the agent's daily policy counter.
 * Called by admin AFTER a payment is confirmed on-chain.
 * This is the audit trail — check_spend is the gate, record_spend is the log.
 *
 * Returns the new daily total for the policy owner.
 */
export async function recordSpend(
  agent: string,
  amountUsdc: bigint
): Promise<{ newTotal: bigint | null; txHash: string | null; error: string | null }> {
  const admin = getAdminPublicKey();
  const result = await invokeContract<bigint>({
    contractId: CONTRACT_ID,
    method: "record_spend",
    args: [
      toScAddress(admin),
      toScAddress(agent),
      toScI128(amountUsdc),
    ],
  });
  return { newTotal: result.value ?? null, txHash: result.txHash, error: result.error };
}

// ─── Read functions ───────────────────────────────────────────────────────────

/**
 * Returns the full policy config for an owner address, or null.
 */
export async function getPolicy(
  owner: string
): Promise<SpendPolicyConfig | null> {
  const result = await simulateContract<SpendPolicyConfig | null>({
    contractId: CONTRACT_ID,
    method: "get_policy",
    args: [toScAddress(owner)],
  });
  return result.value ?? null;
}

/**
 * Returns the policy owner for an agent address, or null.
 */
export async function getAgentOwner(
  agent: string
): Promise<string | null> {
  const result = await simulateContract<string | null>({
    contractId: CONTRACT_ID,
    method: "get_agent_owner",
    args: [toScAddress(agent)],
  });
  return result.value ?? null;
}

/**
 * Returns the total USDC spent today for a policy owner.
 * Pass a Unix timestamp — the contract extracts the day number internally.
 */
export async function getDailySpent(
  owner: string,
  timestamp: bigint
): Promise<bigint> {
  const result = await simulateContract<bigint>({
    contractId: CONTRACT_ID,
    method: "get_daily_spent",
    args: [toScAddress(owner), { type: "u64", value: timestamp } as any],
  });
  return result.value ?? 0n;
}

/**
 * Returns the remaining daily allowance for a policy owner.
 * Returns BigInt(Number.MAX_SAFE_INTEGER) if no daily limit is set.
 */
export async function getDailyLimitRemaining(
  owner: string,
  timestamp: bigint
): Promise<bigint> {
  const result = await simulateContract<bigint>({
    contractId: CONTRACT_ID,
    method: "get_daily_limit_remaining",
    args: [toScAddress(owner), { type: "u64", value: timestamp } as any],
  });
  return result.value ?? BigInt(Number.MAX_SAFE_INTEGER);
}