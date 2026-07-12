/**
 * src/lib/stellar/feeBump.ts
 *
 * Fee sponsorship — Invoq pays all Stellar transaction fees on behalf of developers/customers.
 *
 * How Stellar fee bumps work (CAP-0015):
 * ─────────────────────────────────────────────────────────────────────────────
 * A fee-bump transaction wraps an inner transaction. The inner tx is signed
 * by the developer/customer (their auth is required for contract calls). The outer
 * fee bump is signed by Invoq's admin account (the fee payer). Stellar processes
 * the inner tx but charges the fee to the outer payer.
 *
 * Result: developer/customer pays ZERO XLM — they only need a Stellar wallet.
 *
 * Fee-bump validity rules (from Stellar docs):
 *   - fee-bump total fee  >= inner tx total fee
 *   - fee-bump total fee  >= network minimum × (innerOps + 1)
 *   - fee-bump per-op fee  = totalFee / (innerOps + 1)   (what buildFeeBumpTransaction takes)
 *
 * For Soroban txs: inner tx fee = inclusion fee + resource fee (set by assembleTransaction).
 * Static fees WILL cause "fee too small" rejections — we calculate dynamically.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Flow for developer-signed transactions:
 *   1. Backend: buildXxxTxXdr(params) → returns unsigned XDR string
 *   2. Frontend: developer signs with their wallet (Freighter etc.)
 *   3. Frontend: POST /api/.../submit-tx  { signedXdr }
 *   4. Backend:  wrapAndSubmit(signedXdr) → wraps in fee bump → signs → submits
 *
 * The developer's signature authorizes the contract call.
 * Invoq's signature pays the fee. Neither can fake the other.
 */

import {
  TransactionBuilder,
  Transaction,
  StrKey,
  BASE_FEE,
  Contract,
  xdr,
} from "@stellar/stellar-sdk";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import {
  getRpc,
  getAdminKeypair,
  getNetworkPassphrase,
  toScAddress,
  toScU64,
  toScString,
  toScI128,
  toScStringVec,
} from "./client.js";
import { SPEND_POLICY_CONTRACT_ADDRESS } from "../../config.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum per-operation fee we set on inner transactions.
 * 10× BASE_FEE = 1 000 stroops = 0.0001 XLM ≈ $0.00002.
 * For Soroban, assembleTransaction adds resource fees on top; this is just the
 * inclusion-fee floor.
 */
const MIN_INCLUSION_FEE_STROOPS = (Number(BASE_FEE) * 10).toString();

/**
 * Percentage headroom added to the computed fee-bump per-op fee.
 * Provides cushion against minor surge-pricing spikes without over-spending.
 */
const FEE_BUMP_UPLIFT_PCT = 20n; // 20 %

// ─── Fee-bump helpers ─────────────────────────────────────────────────────────

/**
 * Compute the per-operation fee to use for a fee-bump transaction.
 *
 * Stellar rule: fee-bump total must be >= inner tx total fee.
 *   fee-bump total = perOpFee × (innerOps + 1)
 *   ∴  perOpFee ≥ ceil(innerFee / (innerOps + 1))
 *
 * We add FEE_BUMP_UPLIFT_PCT percent headroom and floor at MIN_INCLUSION_FEE_STROOPS.
 */
function computeFeeBumpPerOpFee(innerTx: Transaction): string {
  const innerFeeSatoshis = BigInt(innerTx.fee);            // total fee in stroops
  const innerOpsCount    = BigInt(innerTx.operations.length);
  const totalOps         = innerOpsCount + 1n;             // +1 for the fee-bump itself

  // ceil division: (a + b - 1) / b
  const basePerOp = (innerFeeSatoshis + totalOps - 1n) / totalOps;

  // Add uplift for surge-pricing headroom
  const withUplift = (basePerOp * (100n + FEE_BUMP_UPLIFT_PCT)) / 100n;

  // Never go below our inclusion-fee floor
  const floor = BigInt(MIN_INCLUSION_FEE_STROOPS);
  return (withUplift > floor ? withUplift : floor).toString();
}

// ─── Unsigned inner-tx builders ───────────────────────────────────────────────

/**
 * Builds an unsigned create_plan transaction XDR for the developer to sign.
 */
export async function buildPlanTxXdr(params: {
  developerAddress: string;
  name: string;
  priceUsdc: bigint;
  intervalSeconds: bigint;
  trialSeconds: bigint;
  usageLimit: bigint;
  features: string[];
}): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS;

  if (!contractId) {
    return { xdr: null, error: "SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS not configured" };
  }

  try {
    let developerAccount;
    try {
      developerAccount = await rpc.getAccount(params.developerAddress);
    } catch {
      return {
        xdr: null,
        error: "Developer Stellar account not found. Please fund your wallet first.",
      };
    }

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(developerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "create_plan",
          toScAddress(params.developerAddress),
          toScString(params.name),
          toScI128(params.priceUsdc),
          toScU64(params.intervalSeconds),
          toScU64(params.trialSeconds),
          toScU64(params.usageLimit),
          toScStringVec(params.features)
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return {
        xdr: null,
        error: `Transaction simulation failed: ${simResult.error}`,
      };
    }

    // assembleTransaction merges resource fees + footprint into the tx.
    // After this, tx.fee = inclusion fee + resource fee.
    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Builds an unsigned update_plan transaction XDR for the developer to sign.
 */
export async function buildUpdatePlanTxXdr(params: {
  developerAddress: string;
  planId: bigint;
  name: string;
  priceUsdc: bigint;
  usageLimit: bigint;
  features: string[];
}): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS;

  if (!contractId) {
    return { xdr: null, error: "SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS not configured" };
  }

  try {
    let developerAccount;
    try {
      developerAccount = await rpc.getAccount(params.developerAddress);
    } catch {
      return { xdr: null, error: "Developer Stellar account not found." };
    }

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(developerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "update_plan",
          toScAddress(params.developerAddress),
          toScU64(params.planId),
          toScString(params.name),
          toScI128(params.priceUsdc),
          toScU64(params.usageLimit),
          toScStringVec(params.features)
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { xdr: null, error: `Transaction simulation failed: ${simResult.error}` };
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Builds an unsigned deactivate_plan transaction XDR for the developer to sign.
 */
export async function buildDeactivatePlanTxXdr(params: {
  developerAddress: string;
  planId: bigint;
}): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS;

  if (!contractId) {
    return { xdr: null, error: "SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS not configured" };
  }

  try {
    let developerAccount;
    try {
      developerAccount = await rpc.getAccount(params.developerAddress);
    } catch {
      return { xdr: null, error: "Developer Stellar account not found." };
    }

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(developerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "deactivate_plan",
          toScAddress(params.developerAddress),
          toScU64(params.planId)
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { xdr: null, error: `Transaction simulation failed: ${simResult.error}` };
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Builds an unsigned reactivate_plan transaction XDR for the developer to sign.
 */
export async function buildReactivatePlanTxXdr(params: {
  developerAddress: string;
  planId: bigint;
}): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS;

  if (!contractId) {
    return { xdr: null, error: "SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS not configured" };
  }

  try {
    let developerAccount;
    try {
      developerAccount = await rpc.getAccount(params.developerAddress);
    } catch {
      return { xdr: null, error: "Developer Stellar account not found." };
    }

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(developerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "reactivate_plan",
          toScAddress(params.developerAddress),
          toScU64(params.planId)
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { xdr: null, error: `Transaction simulation failed: ${simResult.error}` };
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function toScAddressVec(addresses: string[]) {
  return xdr.ScVal.scvVec(addresses.map((address) => toScAddress(address)));
}

async function buildSpendPolicyTx(params: {
  ownerAddress: string;
  method: string;
  args: xdr.ScVal[];
}): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = SPEND_POLICY_CONTRACT_ADDRESS;

  if (!contractId) {
    return { xdr: null, error: "SPEND_POLICY_CONTRACT_ADDRESS not configured" };
  }

  try {
    let ownerAccount;
    try {
      ownerAccount = await rpc.getAccount(params.ownerAddress);
    } catch {
      return { xdr: null, error: "Policy owner Stellar account not found." };
    }

    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(ownerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(contract.call(params.method, ...params.args))
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { xdr: null, error: `Transaction simulation failed: ${simResult.error}` };
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function buildSpendPolicyCreateTxXdr(params: {
  ownerAddress: string;
  dailyLimitUsdc: bigint;
  txLimitUsdc: bigint;
  allowlist: string[];
  agents: string[];
}): Promise<{ xdr: string | null; error: string | null }> {
  return buildSpendPolicyTx({
    ownerAddress: params.ownerAddress,
    method:       "create_policy",
    args: [
      toScAddress(params.ownerAddress),
      toScI128(params.dailyLimitUsdc),
      toScI128(params.txLimitUsdc),
      toScAddressVec(params.allowlist),
      toScAddressVec(params.agents),
    ],
  });
}

export async function buildSpendPolicyUpdateTxXdr(params: {
  ownerAddress: string;
  dailyLimitUsdc: bigint;
  txLimitUsdc: bigint;
  allowlist: string[];
  agents: string[];
}): Promise<{ xdr: string | null; error: string | null }> {
  return buildSpendPolicyTx({
    ownerAddress: params.ownerAddress,
    method:       "update_policy",
    args: [
      toScAddress(params.ownerAddress),
      toScI128(params.dailyLimitUsdc),
      toScI128(params.txLimitUsdc),
      toScAddressVec(params.allowlist),
      toScAddressVec(params.agents),
    ],
  });
}

export async function buildSpendPolicyDeactivateTxXdr(
  ownerAddress: string
): Promise<{ xdr: string | null; error: string | null }> {
  return buildSpendPolicyTx({
    ownerAddress,
    method: "deactivate_policy",
    args:   [toScAddress(ownerAddress)],
  });
}

export async function buildSpendPolicyReactivateTxXdr(
  ownerAddress: string
): Promise<{ xdr: string | null; error: string | null }> {
  return buildSpendPolicyTx({
    ownerAddress,
    method: "reactivate_policy",
    args:   [toScAddress(ownerAddress)],
  });
}

/**
 * Builds an unsigned initiate_subscription transaction XDR for the customer to sign.
 */
export async function buildSubscribeTxXdr(
  customerAddress: string,
  planId: bigint
): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.BILLING_CONTRACT_ID;

  if (!contractId) {
    return { xdr: null, error: "BILLING_CONTRACT_ID not configured" };
  }

  try {
    let customerAccount;
    try {
      customerAccount = await rpc.getAccount(customerAddress);
    } catch {
      return {
        xdr: null,
        error: "Customer Stellar account not found. Please fund your wallet first.",
      };
    }

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(customerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "initiate_subscription",
          toScAddress(customerAddress),
          toScU64(planId)
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { xdr: null, error: `Transaction simulation failed: ${simResult.error}` };
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Builds an unsigned create_vault transaction XDR for the customer to sign.
 */
export async function buildCreateVaultTxXdr(params: {
  customerAddress: string;
  developerAddress: string;
  initialDeposit: bigint;
  lowBalanceThreshold: bigint;
  autoTopupAmount: bigint;
}): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.ESCROW_VAULT_CONTRACT_ID;

  if (!contractId) {
    return { xdr: null, error: "ESCROW_VAULT_CONTRACT_ID not configured" };
  }

  try {
    let customerAccount;
    try {
      customerAccount = await rpc.getAccount(params.customerAddress);
    } catch {
      return { xdr: null, error: "Customer Stellar account not found." };
    }

    const contract = new Contract(contractId);
    const { toScI128 } = await import("./client.js");

    const tx = new TransactionBuilder(customerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "create_vault",
          toScAddress(params.customerAddress),
          toScAddress(params.customerAddress),
          toScAddress(params.developerAddress),
          toScI128(params.initialDeposit),
          toScI128(params.lowBalanceThreshold),
          toScI128(params.autoTopupAmount)
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { xdr: null, error: simResult.error };
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Builds an unsigned withdraw transaction XDR for the customer to sign.
 */
export async function buildWithdrawVaultTxXdr(params: {
  customerAddress: string;
  developerAddress: string;
  amount: bigint;
}): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.ESCROW_VAULT_CONTRACT_ID;

  if (!contractId) {
    return { xdr: null, error: "ESCROW_VAULT_CONTRACT_ID not configured" };
  }

  try {
    let customerAccount;
    try {
      customerAccount = await rpc.getAccount(params.customerAddress);
    } catch {
      return { xdr: null, error: "Customer Stellar account not found." };
    }

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(customerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "withdraw",
          toScAddress(params.customerAddress),
          toScAddress(params.customerAddress),
          toScAddress(params.developerAddress),
          toScI128(params.amount)
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { xdr: null, error: simResult.error };
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Builds an unsigned deposit transaction XDR for the customer to sign.
 */
export async function buildDepositVaultTxXdr(params: {
  customerAddress: string;
  developerAddress: string;
  amount: bigint;
}): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.ESCROW_VAULT_CONTRACT_ID;

  if (!contractId) {
    return { xdr: null, error: "ESCROW_VAULT_CONTRACT_ID not configured" };
  }

  try {
    let customerAccount;
    try {
      customerAccount = await rpc.getAccount(params.customerAddress);
    } catch {
      return { xdr: null, error: "Customer Stellar account not found." };
    }

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(customerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "deposit",
          toScAddress(params.customerAddress),
          toScAddress(params.customerAddress),
          toScAddress(params.developerAddress),
          toScI128(params.amount)
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { xdr: null, error: simResult.error };
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Builds an unsigned update_threshold transaction XDR for the customer to sign.
 */
export async function buildUpdateVaultThresholdTxXdr(params: {
  customerAddress: string;
  developerAddress: string;
  newThreshold: bigint;
  newAutoTopup: bigint;
}): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.ESCROW_VAULT_CONTRACT_ID;

  if (!contractId) {
    return { xdr: null, error: "ESCROW_VAULT_CONTRACT_ID not configured" };
  }

  try {
    let customerAccount;
    try {
      customerAccount = await rpc.getAccount(params.customerAddress);
    } catch {
      return { xdr: null, error: "Customer Stellar account not found." };
    }

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(customerAccount, {
      fee:               MIN_INCLUSION_FEE_STROOPS,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "update_threshold",
          toScAddress(params.customerAddress),
          toScAddress(params.customerAddress),
          toScAddress(params.developerAddress),
          toScI128(params.newThreshold),
          toScI128(params.newAutoTopup)
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { xdr: null, error: simResult.error };
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return { xdr: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Wrap and submit ──────────────────────────────────────────────────────────

/**
 * Takes a signed inner transaction XDR, wraps it in a fee-bump signed by
 * Invoq's admin, and submits to Stellar.
 *
 * Key production behaviour:
 * - Fee is computed dynamically from the inner tx so it always satisfies
 *   Stellar's validity constraint: fee-bump total >= inner tx total.
 * - Optional signer verification prevents spoofed XDR submissions.
 * - Polling uses exponential backoff with jitter to reduce RPC load.
 *
 * @param signedInnerXdr  Base64 XDR of the developer/customer-signed inner tx.
 * @param expectedSigner  If provided, the inner tx must be signed by this address.
 */
export async function wrapAndSubmit(
  signedInnerXdr: string,
  expectedSigner?: string
): Promise<{ txHash: string | null; error: string | null }> {
  const rpc        = getRpc();
  const admin      = getAdminKeypair();
  const passphrase = getNetworkPassphrase();

  try {
    // ── 1. Deserialise inner tx ──────────────────────────────────────────────
    let innerTx: Transaction;
    try {
      innerTx = new Transaction(signedInnerXdr, passphrase);
    } catch (err) {
      return { txHash: null, error: `Invalid XDR: ${err instanceof Error ? err.message : String(err)}` };
    }

    // ── 2. Optional signer verification ─────────────────────────────────────
    if (expectedSigner) {
      const valid = verifyInnerTxSigner(signedInnerXdr, expectedSigner, passphrase);
      if (!valid) {
        return {
          txHash: null,
          error: `Inner transaction was not signed by expected address ${expectedSigner}`,
        };
      }
    }

    // ── 3. Compute fee-bump per-op fee dynamically ───────────────────────────
    //
    // Stellar rule (from CAP-0015 and docs):
    //   fee-bump total fee >= inner tx total fee
    //   fee-bump total fee  = perOpFee × (innerOps + 1)
    //   ∴  perOpFee ≥ ceil(innerTx.fee / (innerOps + 1))
    //
    // For Soroban txs, innerTx.fee includes inclusion + resource fees (set by
    // assembleTransaction). A static constant WILL fail here.
    const perOpFee = computeFeeBumpPerOpFee(innerTx);

    console.log("[FeeBump] Building fee-bump", {
      innerFee:    innerTx.fee,
      innerOps:    innerTx.operations.length,
      perOpFee,
      feePayer:    admin.publicKey(),
    });

    // ── 4. Build fee-bump transaction ────────────────────────────────────────
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      admin.publicKey(), // fee payer (string public key)
      perOpFee,          // per-operation fee for the outer tx
      innerTx,           // signed inner transaction
      passphrase
    );

    // ── 5. Sign fee-bump with admin keypair ──────────────────────────────────
    feeBump.sign(admin);

    // ── 6. Submit ────────────────────────────────────────────────────────────
    console.log("[FeeBump] Submitting fee-bump transaction");
    const sendResult = await rpc.sendTransaction(feeBump);

    if (sendResult.status === "ERROR") {
      const xdrErr = sendResult.errorResult?.toXDR("base64") ?? "unknown";
      console.error("[FeeBump] Submission error:", { hash: sendResult.hash, xdrErr });
      return {
        txHash: sendResult.hash ?? null,
        error:  `Submission failed: ${xdrErr}`,
      };
    }

    console.log("[FeeBump] Submitted, polling for confirmation:", sendResult.hash);

    // ── 7. Poll with exponential backoff ─────────────────────────────────────
    const confirmed = await pollForConfirmation(sendResult.hash);

    if (confirmed.error) {
      console.error("[FeeBump] On-chain failure:", { hash: sendResult.hash, error: confirmed.error });
    } else {
      console.log("[FeeBump] Confirmed:", sendResult.hash);
    }

    return confirmed;
  } catch (err) {
    console.error("[FeeBump] wrapAndSubmit exception:", err);
    return { txHash: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────

/**
 * Poll for transaction confirmation using exponential backoff with jitter.
 *
 * Backoff schedule (approximate):
 *   attempt 1:  1.0 s base + jitter
 *   attempt 2:  1.5 s base + jitter
 *   attempt 3:  2.25 s base + jitter
 *   ...capped at MAX_INTERVAL_MS
 */
async function pollForConfirmation(
  hash: string,
  maxAttempts   = 40,
  baseIntervalMs = 1_000,
  maxIntervalMs  = 10_000
): Promise<{ txHash: string; error: string | null }> {
  const rpc = getRpc();

  for (let i = 0; i < maxAttempts; i++) {
    // Exponential backoff: base × 1.5^i, capped, plus up to 200 ms jitter
    const backoff = Math.min(baseIntervalMs * 1.5 ** i, maxIntervalMs);
    const jitter  = Math.random() * 200;
    await sleep(backoff + jitter);

    let result;
    try {
      result = await rpc.getTransaction(hash);
    } catch (rpcErr) {
      // Transient RPC error — keep trying
      console.warn(`[FeeBump] getTransaction RPC error (attempt ${i + 1}):`, rpcErr);
      continue;
    }

    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return { txHash: hash, error: null };
    }

    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      return { txHash: hash, error: "Transaction failed on-chain" };
    }

    // MISSING = still in queue — keep polling
  }

  return {
    txHash: hash,
    error:  `Transaction not confirmed after ${maxAttempts} attempts`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Signer verification ──────────────────────────────────────────────────────

/**
 * Verify that the inner transaction was signed by `expectedSigner`.
 *
 * Uses the 4-byte key hint in each DecoratedSignature. This is a fast
 * heuristic check — not a full cryptographic verify — but is sufficient to
 * reject obviously spoofed XDR before hitting the RPC node.
 *
 * For production workloads that need full verification, use
 * `Keypair.verify(txHash, signature)` with the decoded public key.
 */
export function verifyInnerTxSigner(
  signedInnerXdr: string,
  expectedSigner: string,
  passphrase: string
): boolean {
  try {
    const tx = new Transaction(signedInnerXdr, passphrase);
    const expectedRaw = StrKey.decodeEd25519PublicKey(expectedSigner);
    const expectedHint = expectedRaw.slice(-4);

    for (const sig of tx.signatures) {
      if (sig.hint().equals(expectedHint)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
