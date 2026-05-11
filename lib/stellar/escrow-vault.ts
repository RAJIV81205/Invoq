/**
 * src/lib/stellar/escrow-vault.ts
 *
 * Type-safe wrapper for all EscrowVault contract calls.
 *
 * Important: deposit, withdraw, and create_vault require the CUSTOMER to sign,
 * not the admin. The same XDR-handoff pattern from billing.ts applies here:
 * - Backend builds the unsigned transaction XDR
 * - Frontend presents it to the customer's wallet for signing
 * - Customer signs and submits directly to Stellar
 *
 * Only debit_vault and close_vault (admin variant) can be called by the backend.
 */

import {
  invokeContract,
  simulateContract,
  toScAddress,
  toScI128,
  toScString,
  getAdminPublicKey,
} from "./client";

const CONTRACT_ID = process.env.ESCROW_VAULT_CONTRACT_ID!;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaultRecord {
  customer: string;
  developer: string;
  balance_usdc: bigint;
  total_deposited: bigint;
  total_debited: bigint;
  low_balance_threshold: bigint;
  auto_topup_amount: bigint;
  created_at: bigint;
}

// ─── Vault lifecycle ──────────────────────────────────────────────────────────

/**
 * Creates a vault and deposits the initial amount.
 * REQUIRES CUSTOMER SIGNATURE — admin cannot call on their behalf.
 *
 * In production: backend builds unsigned XDR → frontend signs → customer submits.
 * For testnet/admin-as-customer: works directly if admin IS the customer.
 */
export async function createVault(params: {
  caller: string;
  customer: string;
  developer: string;
  initialDeposit: bigint;
  lowBalanceThreshold: bigint;
  autoTopupAmount: bigint;
}): Promise<{ vault: VaultRecord | null; txHash: string | null; error: string | null }> {
  const result = await invokeContract<VaultRecord>({
    contractId: CONTRACT_ID,
    method: "create_vault",
    args: [
      toScAddress(params.caller),
      toScAddress(params.customer),
      toScAddress(params.developer),
      toScI128(params.initialDeposit),
      toScI128(params.lowBalanceThreshold),
      toScI128(params.autoTopupAmount),
    ],
  });
  return { vault: result.value ?? null, txHash: result.txHash, error: result.error };
}

/**
 * Deposits additional USDC into an existing vault.
 * REQUIRES CUSTOMER SIGNATURE.
 */
export async function deposit(params: {
  caller: string;
  customer: string;
  developer: string;
  amount: bigint;
}): Promise<{ newBalance: bigint | null; txHash: string | null; error: string | null }> {
  const result = await invokeContract<bigint>({
    contractId: CONTRACT_ID,
    method: "deposit",
    args: [
      toScAddress(params.caller),
      toScAddress(params.customer),
      toScAddress(params.developer),
      toScI128(params.amount),
    ],
  });
  return { newBalance: result.value ?? null, txHash: result.txHash, error: result.error };
}

// ─── Metering (admin-only — called by Invoq backend) ─────────────────────────

/**
 * Debits a usage amount from a vault and transfers it to the developer.
 * ADMIN ONLY — the core revenue flow called by the metering service.
 *
 * Funds flow: vault (this contract) → developer wallet, instantly on Stellar.
 * If the vault balance falls below the threshold, a VaultLowBalance event fires
 * and auto top-up is attempted if configured.
 *
 * @param usageDescription - Human-readable label for audit trail ("1000 tokens")
 */
export async function debitVault(params: {
  customer: string;
  developer: string;
  amount: bigint;
  usageDescription: string;
}): Promise<{ remainingBalance: bigint | null; txHash: string | null; error: string | null }> {
  const admin = getAdminPublicKey();
  const result = await invokeContract<bigint>({
    contractId: CONTRACT_ID,
    method: "debit_vault",
    args: [
      toScAddress(admin),
      toScAddress(params.customer),
      toScAddress(params.developer),
      toScI128(params.amount),
      toScString(params.usageDescription),
    ],
  });
  return { remainingBalance: result.value ?? null, txHash: result.txHash, error: result.error };
}

// ─── Withdrawal (customer-signed) ─────────────────────────────────────────────

/**
 * Withdraws USDC from a vault back to the customer.
 * REQUIRES CUSTOMER SIGNATURE — no lock-up, no fee.
 */
export async function withdraw(params: {
  caller: string;
  customer: string;
  developer: string;
  amount: bigint;
}): Promise<{ remainingBalance: bigint | null; txHash: string | null; error: string | null }> {
  const result = await invokeContract<bigint>({
    contractId: CONTRACT_ID,
    method: "withdraw",
    args: [
      toScAddress(params.caller),
      toScAddress(params.customer),
      toScAddress(params.developer),
      toScI128(params.amount),
    ],
  });
  return { remainingBalance: result.value ?? null, txHash: result.txHash, error: result.error };
}

/**
 * Permanently closes a vault and refunds the remaining balance.
 * Customer OR admin can call this.
 *
 * @returns Amount refunded (0 if vault was already empty).
 */
export async function closeVault(params: {
  caller: string;
  customer: string;
  developer: string;
}): Promise<{ refunded: bigint | null; txHash: string | null; error: string | null }> {
  const result = await invokeContract<bigint>({
    contractId: CONTRACT_ID,
    method: "close_vault",
    args: [
      toScAddress(params.caller),
      toScAddress(params.customer),
      toScAddress(params.developer),
    ],
  });
  return { refunded: result.value ?? null, txHash: result.txHash, error: result.error };
}

// ─── Configuration (customer-signed) ─────────────────────────────────────────

/**
 * Updates the low-balance alert threshold and auto top-up amount.
 * REQUIRES CUSTOMER SIGNATURE.
 */
export async function updateThreshold(params: {
  caller: string;
  customer: string;
  developer: string;
  newThreshold: bigint;
  newAutoTopup: bigint;
}): Promise<{ txHash: string | null; error: string | null }> {
  const result = await invokeContract({
    contractId: CONTRACT_ID,
    method: "update_threshold",
    args: [
      toScAddress(params.caller),
      toScAddress(params.customer),
      toScAddress(params.developer),
      toScI128(params.newThreshold),
      toScI128(params.newAutoTopup),
    ],
  });
  return { txHash: result.txHash, error: result.error };
}

// ─── Read functions ───────────────────────────────────────────────────────────

/**
 * Returns the full VaultRecord for a (customer, developer) pair, or null.
 */
export async function getVault(
  customer: string,
  developer: string
): Promise<VaultRecord | null> {
  const result = await simulateContract<VaultRecord | null>({
    contractId: CONTRACT_ID,
    method: "get_vault",
    args: [toScAddress(customer), toScAddress(developer)],
  });
  return result.value ?? null;
}

/**
 * Returns the current USDC balance for a vault, or 0n if not found.
 */
export async function getBalance(
  customer: string,
  developer: string
): Promise<bigint> {
  const result = await simulateContract<bigint>({
    contractId: CONTRACT_ID,
    method: "get_balance",
    args: [toScAddress(customer), toScAddress(developer)],
  });
  return result.value ?? 0n;
}

/**
 * Returns whether a vault exists for the given pair.
 */
export async function vaultExists(
  customer: string,
  developer: string
): Promise<boolean> {
  const result = await simulateContract<boolean>({
    contractId: CONTRACT_ID,
    method: "vault_exists",
    args: [toScAddress(customer), toScAddress(developer)],
  });
  return result.value ?? false;
}