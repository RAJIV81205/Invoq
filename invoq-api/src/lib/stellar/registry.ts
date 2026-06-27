/**
 * src/lib/stellar/registry.ts
 *
 * Type-safe wrapper for all SubscriptionRegistry contract calls.
 *
 * Every public contract function has a corresponding JS function here.
 * Read-only functions use simulateContract (free, instant).
 * Write functions use invokeContract (costs XLM, ~5s on Stellar).
 */

import {
  invokeContract,
  simulateContract,
  toScAddress,
  toScString,
  toScI128,
  toScU64,
  toScBool,
  toScStringVec,
  getAdminPublicKey,
} from "./client.js";
import { xdr } from "@stellar/stellar-sdk";
import { SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS } from "../../config.js";

const CONTRACT_ID = SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS!;

// ─── Types mirroring the Rust contract structs ─────────────────────────────────

export type SubStatus =
  | "Trialing"
  | "Active"
  | "Paused"
  | "GracePeriod"
  | "Cancelled"
  | "Expired";

export interface PlanConfig {
  plan_id: bigint;
  name: string;
  price_usdc: bigint;
  interval_seconds: bigint;
  trial_seconds: bigint;
  usage_limit: bigint;
  features: string[];
  active: boolean;
  owner: string;
  created_at: bigint;
}

export interface SubscriptionRecord {
  customer: string;
  plan_id: bigint;
  status: SubStatus;
  started_at: bigint;
  current_period_start: bigint;
  current_period_end: bigint;
  trial_end: bigint;
  cancel_at_period_end: boolean;
  usage_current: bigint;
}

export interface EntitlementResult {
  entitled: boolean;
  status: SubStatus;
  plan_id: bigint;
  usage_current: bigint;
  usage_limit: bigint;
  current_period_end: bigint;
}

export interface UsageBatchEntry {
  customer: string;
  units: bigint;
}

// ─── Plan management ──────────────────────────────────────────────────────────

export async function createPlan(params: {
  owner: string;
  name: string;
  priceUsdc: bigint;
  intervalSeconds: bigint;
  trialSeconds: bigint;
  usageLimit: bigint;
  features: string[];
}): Promise<{ planId: bigint | null; txHash: string | null; error: string | null }> {
  // Use create_plan_for since the admin is signing on behalf of the developer
  const admin = getAdminPublicKey();
  const result = await invokeContract<bigint>({
    contractId: CONTRACT_ID,
    method: "create_plan_for",
    args: [
      toScAddress(admin),           // caller (admin)
      toScAddress(params.owner),    // owner (developer)
      toScString(params.name),
      toScI128(params.priceUsdc),
      toScU64(params.intervalSeconds),
      toScU64(params.trialSeconds),
      toScU64(params.usageLimit),
      toScStringVec(params.features),
    ],
  });

  return {
    planId:  result.value ?? null,
    txHash:  result.txHash,
    error:   result.error,
  };
}

export async function updatePlan(params: {
  caller: string;
  planId: bigint;
  name: string;
  priceUsdc: bigint;
  usageLimit: bigint;
  features: string[];
}): Promise<{ txHash: string | null; error: string | null }> {
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "update_plan",
    args: [
      toScAddress(params.caller),
      toScU64(params.planId),
      toScString(params.name),
      toScI128(params.priceUsdc),
      toScU64(params.usageLimit),
      toScStringVec(params.features),
    ],
  });
  return { txHash: result.txHash, error: result.error };
}

export async function deactivatePlan(
  caller: string,
  planId: bigint
): Promise<{ txHash: string | null; error: string | null }> {
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "deactivate_plan",
    args: [toScAddress(caller), toScU64(planId)],
  });
  return { txHash: result.txHash, error: result.error };
}

export async function reactivatePlan(
  caller: string,
  planId: bigint
): Promise<{ txHash: string | null; error: string | null }> {
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "reactivate_plan",
    args: [toScAddress(caller), toScU64(planId)],
  });
  return { txHash: result.txHash, error: result.error };
}

export async function getPlan(planId: bigint): Promise<PlanConfig | null> {
  const result = await simulateContract<PlanConfig | null>({
    contractId: CONTRACT_ID,
    method: "get_plan",
    args: [toScU64(planId)],
  });
  return result.value ?? null;
}

export async function getPlanCount(): Promise<bigint> {
  const result = await simulateContract<bigint>({
    contractId: CONTRACT_ID,
    method: "plan_count",
    args: [],
  });
  return result.value ?? 0n;
}

// ─── Subscription management ──────────────────────────────────────────────────

export async function setStatus(params: {
  caller: string;
  customer: string;
  status: SubStatus;
}): Promise<{ txHash: string | null; error: string | null }> {
  const statusScVal =
    params.status === "Trialing"    ? xdr.ScVal.scvSymbol("Trialing")
  : params.status === "Active"      ? xdr.ScVal.scvSymbol("Active")
  : params.status === "Paused"      ? xdr.ScVal.scvSymbol("Paused")
  : params.status === "GracePeriod" ? xdr.ScVal.scvSymbol("GracePeriod")
  : params.status === "Cancelled"   ? xdr.ScVal.scvSymbol("Cancelled")
  :                                  xdr.ScVal.scvSymbol("Expired");

  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "update_status",
    args: [
      toScAddress(params.caller),
      toScAddress(params.customer),
      statusScVal,
    ],
  });
  return { txHash: result.txHash, error: result.error };
}

export async function cancelSubscription(params: {
  caller: string;
  customer: string;
  immediate: boolean;
}): Promise<{ txHash: string | null; error: string | null }> {
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "cancel_subscription",
    args: [
      toScAddress(params.caller),
      toScAddress(params.customer),
      toScBool(params.immediate),
    ],
  });
  return { txHash: result.txHash, error: result.error };
}

export async function getSubscription(
  customer: string
): Promise<SubscriptionRecord | null> {
  const result = await simulateContract<SubscriptionRecord | null>({
    contractId: CONTRACT_ID,
    method: "get_subscription",
    args: [toScAddress(customer)],
  });
  return result.value ?? null;
}

export async function renewSubscription(params: {
  customer: string;
  newPeriodStart: bigint;
  newPeriodEnd: bigint;
}): Promise<{ txHash: string | null; error: string | null }> {
  const admin = getAdminPublicKey();
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "renew_subscription",
    args: [
      toScAddress(admin),
      toScAddress(params.customer),
      toScU64(params.newPeriodStart),
      toScU64(params.newPeriodEnd),
    ],
  });
  return { txHash: result.txHash, error: result.error };
}

// ─── Entitlement (hot path — caller should cache result in Redis) ─────────────

export async function checkEntitlement(
  customer: string,
  feature: string
): Promise<boolean> {
  const result = await simulateContract<boolean>({
    contractId: CONTRACT_ID,
    method: "check_entitlement",
    args: [toScAddress(customer), toScString(feature)],
  });
  return result.value ?? false;
}

export async function checkEntitlementFull(
  customer: string,
  feature: string
): Promise<EntitlementResult | null> {
  const result = await simulateContract<EntitlementResult | null>({
    contractId: CONTRACT_ID,
    method: "check_entitlement_full",
    args: [toScAddress(customer), toScString(feature)],
  });
  return result.value ?? null;
}

export async function isSubscribed(customer: string): Promise<boolean> {
  const result = await simulateContract<boolean>({
    contractId: CONTRACT_ID,
    method: "is_subscribed",
    args: [toScAddress(customer)],
  });
  return result.value ?? false;
}

// ─── Usage metering ───────────────────────────────────────────────────────────

export async function incrementUsage(
  customer: string,
  units: bigint
): Promise<{ newTotal: bigint | null; txHash: string | null; error: string | null }> {
  const admin = getAdminPublicKey();
  const result = await invokeContract<bigint>({
    contractId: CONTRACT_ID,
    method: "increment_usage",
    args: [toScAddress(admin), toScAddress(customer), toScU64(units)],
  });
  return { newTotal: result.value ?? null, txHash: result.txHash, error: result.error };
}

export async function incrementUsageBatch(
  entries: UsageBatchEntry[]
): Promise<{ successCount: number | null; txHash: string | null; error: string | null }> {
  const admin = getAdminPublicKey();

  // Build Vec<UsageBatchEntry> as ScVal
  const entriesScVal = xdr.ScVal.scvVec(
    entries.map((e) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("customer"),
          val: toScAddress(e.customer),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("units"),
          val: toScU64(e.units),
        }),
      ])
    )
  );

  const result = await invokeContract<number>({
    contractId: CONTRACT_ID,
    method: "increment_usage_batch",
    args: [toScAddress(admin), entriesScVal],
  });
  return { successCount: result.value ?? null, txHash: result.txHash, error: result.error };
}

// ─── Admin / operator ─────────────────────────────────────────────────────────

export async function setOperator(
  operator: string
): Promise<{ txHash: string | null; error: string | null }> {
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "set_operator",
    args: [toScAddress(operator)],
  });
  return { txHash: result.txHash, error: result.error };
}

export async function getAdmin(): Promise<string | null> {
  const result = await simulateContract<string>({
    contractId: CONTRACT_ID,
    method: "get_admin",
    args: [],
  });
  return result.value ?? null;
}

export async function getOperator(): Promise<string | null> {
  const result = await simulateContract<string | null>({
    contractId: CONTRACT_ID,
    method: "get_operator",
    args: [],
  });
  return result.value ?? null;
}