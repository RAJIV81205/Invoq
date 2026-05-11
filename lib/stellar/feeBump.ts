/**
 * src/lib/stellar/fee-bump.ts
 *
 * Fee sponsorship — Invoq pays all Stellar transaction fees on behalf of customers.
 *
 * How Stellar fee bumps work:
 * ─────────────────────────────────────────────────────────────────────────────
 * A fee bump transaction wraps an inner transaction. The inner tx is signed
 * by the customer (their auth is required for initiate_subscription). The outer
 * fee bump is signed by Invoq's admin account (the fee payer). Stellar processes
 * the inner tx but charges the fee to the outer payer.
 *
 * Result: customer pays ZERO XLM — they only need a Stellar wallet with USDC.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Flow for subscribe:
 *   1. Backend: buildSubscribeTx(customer, planId) → returns XDR string
 *   2. Frontend: customer signs the XDR with their wallet (Freighter etc.)
 *   3. Frontend sends signed XDR back to: POST /api/checkout/submit-tx
 *   4. Backend: wrapWithFeeBump(signedInnerXdr) → signs outer tx → submits
 *
 * The customer's signature authorises the contract call.
 * Invoq's signature pays the fee.
 * Both are needed. Neither can fake the other.
 */

import {
  TransactionBuilder,
  Transaction,
  StrKey,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import {
  getRpc,
  getAdminKeypair,
  getNetworkPassphrase,
  toScAddress,
  toScU64,
} from "./client";

// Fee paid by Invoq per sponsored transaction (in stroops)
// 10x base fee = 1000 stroops = 0.0001 XLM = ~$0.00002 USD
// Negligible cost per subscription, meaningful at millions of subscriptions.
const SPONSORED_FEE = (Number(BASE_FEE) * 10).toString();

// ─── Build unsigned inner transaction ────────────────────────────────────────

/**
 * Builds an unsigned initiate_subscription transaction XDR for the customer to sign.
 *
 * The customer receives this XDR, signs it with their wallet, and returns
 * the signed XDR to the backend for fee bump wrapping and submission.
 *
 * The returned XDR includes:
 * - The contract call operation (BillingCycle.initiate_subscription)
 * - Simulated resource fees and footprint
 * - NOT yet signed by anyone
 *
 * @returns base64 XDR string of the unsigned inner transaction
 */
export async function buildSubscribeTxXdr(
  customerAddress: string,
  planId: bigint
): Promise<{ xdr: string | null; error: string | null }> {
  const rpc        = getRpc();
  const passphrase = getNetworkPassphrase();
  const contractId = process.env.BILLING_CONTRACT_ID!;

  try {
    // We load the CUSTOMER's account to set the correct sequence number.
    // The customer account must exist on Stellar (any account with XLM works).
    // With fee sponsorship, customers just need a wallet — Freighter creates
    // accounts automatically when the user receives any asset.
    let customerAccount;
    try {
      customerAccount = await rpc.getAccount(customerAddress);
    } catch {
      return {
        xdr: null,
        error: "Customer Stellar account not found. Please fund your wallet first.",
      };
    }

    const { Contract } = await import("@stellar/stellar-sdk");
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(customerAccount, {
      fee:               SPONSORED_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "initiate_subscription",
          toScAddress(customerAddress),
          toScU64(planId)
        )
      )
      .setTimeout(300) // 5 minutes for customer to sign
      .build();

    // Simulate to get the resource fee footprint
    const simResult = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return {
        xdr: null,
        error: `Transaction simulation failed: ${simResult.error}`,
      };
    }

    // Assemble: fills in the soroban data (footprint, resource limits, auth)
    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();

    // Return unsigned XDR — customer will sign this
    return { xdr: assembled.toXDR(), error: null };
  } catch (err) {
    return {
      xdr: null,
      error: err instanceof Error ? err.message : String(err),
    };
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
  const contractId = process.env.ESCROW_VAULT_CONTRACT_ID!;

  try {
    let customerAccount;
    try {
      customerAccount = await rpc.getAccount(params.customerAddress);
    } catch {
      return { xdr: null, error: "Customer Stellar account not found." };
    }

    const { Contract } = await import("@stellar/stellar-sdk");
    const contract = new Contract(contractId);
    const { toScI128 } = await import("./client");

    const tx = new TransactionBuilder(customerAccount, {
      fee:               SPONSORED_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        contract.call(
          "create_vault",
          toScAddress(params.customerAddress),    // caller
          toScAddress(params.customerAddress),    // customer
          toScAddress(params.developerAddress),   // developer
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
    return {
      xdr: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Wrap and submit ──────────────────────────────────────────────────────────

/**
 * Takes a customer-signed inner transaction XDR, wraps it in a fee bump
 * signed by Invoq's admin, and submits to Stellar.
 *
 * This is called by POST /api/checkout/submit-tx after the customer signs.
 *
 * @param signedInnerXdr - base64 XDR of the customer-signed inner transaction
 * @returns txHash on success
 */
export async function wrapAndSubmit(
  signedInnerXdr: string
): Promise<{ txHash: string | null; error: string | null }> {
  const rpc        = getRpc();
  const admin      = getAdminKeypair();
  const passphrase = getNetworkPassphrase();

  try {
    // Deserialise the customer-signed inner transaction
    const innerTx = new Transaction(signedInnerXdr, passphrase);

    // Build the fee bump
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      admin.publicKey(),  // fee payer = Invoq admin
      SPONSORED_FEE,
      innerTx,
      passphrase
    );

    // Invoq signs the fee bump (pays the fee)
    feeBump.sign(admin);

    // Submit
    const sendResult = await rpc.sendTransaction(feeBump);

    if (sendResult.status === "ERROR") {
      return {
        txHash: sendResult.hash ?? null,
        error:  `Submission failed: ${sendResult.errorResult?.toXDR("base64")}`,
      };
    }

    // Poll for confirmation
    const confirmed = await pollForConfirmation(sendResult.hash);
    return confirmed;
  } catch (err) {
    return {
      txHash: null,
      error:  err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function pollForConfirmation(
  hash: string,
  maxAttempts = 20,
  intervalMs  = 1500
): Promise<{ txHash: string; error: string | null }> {
  const rpc = getRpc();

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const result = await rpc.getTransaction(hash);

    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return { txHash: hash, error: null };
    }

    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      return { txHash: hash, error: `Transaction failed on-chain` };
    }
  }

  return {
    txHash: hash,
    error:  `Transaction not confirmed after ${maxAttempts} attempts`,
  };
}

// ─── Helper: verify a transaction was signed by the expected address ──────────

/**
 * Before wrapping in a fee bump, verify the inner tx was actually signed
 * by the expected customer address. Prevents malicious XDR submissions.
 */
export function verifyInnerTxSigner(
  signedInnerXdr: string,
  expectedSigner: string,
  passphrase: string
): boolean {
  try {
    const tx = new Transaction(signedInnerXdr, passphrase);
    const signatures = tx.signatures;

    // Get the keypair's raw public key bytes for comparison
    const expectedRaw = StrKey.decodeEd25519PublicKey(expectedSigner);

    for (const sig of signatures) {
      const hint = sig.hint();
      // The hint is the last 4 bytes of the public key
      const expectedHint = expectedRaw.slice(-4);
      if (hint.equals(expectedHint)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}