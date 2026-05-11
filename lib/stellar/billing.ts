/**
 * src/lib/stellar/billing.ts
 *
 * Type-safe wrapper for all BillingCycle contract calls.
 */

import {
  invokeContract,
  simulateContract,
  toScAddress,
  toScU64,
} from "./client";
import { xdr } from "@stellar/stellar-sdk";
import { BILLING_CYCLE_CONTRACT_ADDRESS } from "../config";

const CONTRACT_ID = BILLING_CYCLE_CONTRACT_ADDRESS!;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GraceRecord {
  customer: string;
  grace_started_at: bigint;
  amount_usdc: bigint;
  plan_owner: string;
  new_period_start: bigint;
  new_period_end: bigint;
}

export interface RenewalSummary {
  renewed: number;
  grace_entered: number;
  grace_retry_failed: number;
  skipped: number;
}

// ─── Customer-facing ──────────────────────────────────────────────────────────

/**
 * Initiates a subscription for a customer.
 * The customer wallet must sign this transaction — this cannot be called by admin.
 * In the API flow: the customer signs via their wallet adapter on the frontend,
 * and the signed tx is submitted here.
 *
 * For the Invoq API: we provide the transaction XDR to the frontend,
 * the customer signs it, and sends it back. OR the customer calls the contract
 * directly. See the /api/subscriptions route for the full flow.
 */
export async function initiateSubscription(params: {
  customer: string;
  planId: bigint;
}): Promise<{ txHash: string | null; error: string | null }> {
  // NOTE: initiate_subscription requires customer.require_auth() in the contract.
  // This means the customer must sign the transaction — admin cannot call this
  // on their behalf. The API route that calls this function must receive a
  // customer-signed transaction, not construct one itself.
  //
  // For testnet / internal use: if ADMIN is also the customer (same keypair),
  // this works directly. For production, the frontend handles signing.
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "initiate_subscription",
    args: [toScAddress(params.customer), toScU64(params.planId)],
  });
  return { txHash: result.txHash, error: result.error };
}

// ─── Admin / cron ─────────────────────────────────────────────────────────────

/**
 * Processes renewal payments for a batch of due customers.
 * Called by the renewal cron job every 60 seconds.
 * Max 30 customers per call.
 */
export async function processRenewals(
  customers: string[]
): Promise<{ summary: RenewalSummary | null; txHash: string | null; error: string | null }> {
  const customersScVal = xdr.ScVal.scvVec(
    customers.map((c) => toScAddress(c))
  );

  const result = await invokeContract<RenewalSummary>({
    contractId: CONTRACT_ID,
    method: "process_renewals",
    args: [customersScVal],
  });

  return {
    summary:  result.value ?? null,
    txHash:   result.txHash,
    error:    result.error,
  };
}

/**
 * Expires grace periods for customers that have exceeded the grace window.
 * Called by the grace expiry cron job every 15 minutes.
 * Max 50 customers per call.
 */
export async function expireGracePeriods(
  customers: string[]
): Promise<{ expired: number | null; txHash: string | null; error: string | null }> {
  const customersScVal = xdr.ScVal.scvVec(
    customers.map((c) => toScAddress(c))
  );

  const result = await invokeContract<number>({
    contractId: CONTRACT_ID,
    method: "expire_grace_periods",
    args: [customersScVal],
  });

  return {
    expired: result.value ?? null,
    txHash:  result.txHash,
    error:   result.error,
  };
}

/**
 * Manually retries a failed payment for a customer in GracePeriod.
 */
export async function retryPayment(
  customer: string
): Promise<{ succeeded: boolean | null; txHash: string | null; error: string | null }> {
  const result = await invokeContract<boolean>({
    contractId: CONTRACT_ID,
    method: "retry_payment",
    args: [toScAddress(customer)],
  });
  return { succeeded: result.value ?? null, txHash: result.txHash, error: result.error };
}

/**
 * Updates the global grace period duration.
 */
export async function setGracePeriod(
  seconds: bigint
): Promise<{ txHash: string | null; error: string | null }> {
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "set_grace_period",
    args: [toScU64(seconds)],
  });
  return { txHash: result.txHash, error: result.error };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getGraceRecord(
  customer: string
): Promise<GraceRecord | null> {
  const result = await simulateContract<GraceRecord | null>({
    contractId: CONTRACT_ID,
    method: "get_grace_record",
    args: [toScAddress(customer)],
  });
  return result.value ?? null;
}

export async function getGracePeriod(): Promise<bigint> {
  const result = await simulateContract<bigint>({
    contractId: CONTRACT_ID,
    method: "get_grace_period",
    args: [],
  });
  return result.value ?? 259200n;
}

export async function getBillingAdmin(): Promise<string | null> {
  const result = await simulateContract<string>({
    contractId: CONTRACT_ID,
    method: "get_admin",
    args: [],
  });
  return result.value ?? null;
}