/**
 * src/lib/stellar/client.ts
 *
 * Core Stellar + Soroban client layer.
 *
 * Single source of truth for:
 * - RPC server connection
 * - Admin keypair (used to sign all contract calls)
 * - Generic contract invocation (simulation → sign → submit → poll)
 * - XDR ↔ JS value conversion helpers
 */

import {
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  xdr,
  scValToNative,
  nativeToScVal,
  BASE_FEE,
  Account,
} from "@stellar/stellar-sdk";

// ─── Config ───────────────────────────────────────────────────────────────────

function env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

const RPC_URL      = env("STELLAR_RPC_URL");
const ADMIN_SECRET = env("STELLAR_ADMIN_SECRET");
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;

// ─── Singletons ───────────────────────────────────────────────────────────────

let _rpc: SorobanRpc.Server | null = null;
let _admin: Keypair | null = null;

export function getRpc(): SorobanRpc.Server {
  if (!_rpc) {
    _rpc = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  }
  return _rpc;
}

export function getAdminKeypair(): Keypair {
  if (!_admin) {
    _admin = Keypair.fromSecret(ADMIN_SECRET);
  }
  return _admin;
}

export function getAdminPublicKey(): string {
  return getAdminKeypair().publicKey();
}

export function getNetworkPassphrase(): string {
  return NETWORK_PASSPHRASE;
}

// ─── Core invocation pipeline ─────────────────────────────────────────────────
//
// Soroban call lifecycle:
//   1. Build transaction with contract call operation
//   2. Simulate → get fee estimate + auth entries
//   3. Restore ledger entries if needed (archival)
//   4. Sign with admin keypair
//   5. Submit to RPC
//   6. Poll until confirmed or failed
//   7. Return the result ScVal

export interface InvokeOptions {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  /** Override the signing keypair (default: admin) */
  keypair?: Keypair;
}

export interface InvokeResult<T = unknown> {
  success: boolean;
  value: T | null;
  txHash: string | null;
  error: string | null;
}

/**
 * Invoke a Soroban contract method and return the native JS result.
 *
 * Handles the full simulate → sign → submit → poll lifecycle.
 * Returns a typed InvokeResult — never throws (errors are captured).
 */
export async function invokeContract<T = unknown>(
  opts: InvokeOptions
): Promise<InvokeResult<T>> {
  const rpc     = getRpc();
  const keypair = opts.keypair ?? getAdminKeypair();

  try {
    // Load the account to get the current sequence number
    const stellarAccount = await rpc.getAccount(keypair.publicKey());

    // Build the transaction
    const contract = new Contract(opts.contractId);
    const txBuilder = new TransactionBuilder(stellarAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(opts.method, ...opts.args))
      .setTimeout(30)
      .build();

    // Simulate first to get resource fees and check for errors
    const simResult = await rpc.simulateTransaction(txBuilder);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return {
        success: false,
        value: null,
        txHash: null,
        error: `Simulation failed: ${simResult.error}`,
      };
    }

    if (SorobanRpc.Api.isSimulationRestore(simResult)) {
      // Ledger entry needs restoration — submit the restore transaction first
      await handleRestore(simResult, keypair, stellarAccount);
      // Reload account after restore tx
      const refreshedAccount = await rpc.getAccount(keypair.publicKey());
      return invokeContract({ ...opts, keypair });
    }

    // Assemble the final transaction with simulation results
    const assembled = SorobanRpc.assembleTransaction(txBuilder, simResult).build();
    assembled.sign(keypair);

    const sendResult = await rpc.sendTransaction(assembled);

    if (sendResult.status === "ERROR") {
      return {
        success: false,
        value: null,
        txHash: sendResult.hash,
        error: `Submission failed: ${sendResult.errorResult?.toXDR("base64")}`,
      };
    }

    // Poll for confirmation
    const confirmed = await pollTransaction(sendResult.hash);

    if (!confirmed.success) {
      return {
        success: false,
        value: null,
        txHash: sendResult.hash,
        error: confirmed.error,
      };
    }

    // Extract the return value from the transaction result
    const resultVal = confirmed.resultValue;
    const native    = resultVal ? (scValToNative(resultVal) as T) : null;

    return { success: true, value: native, txHash: sendResult.hash, error: null };
  } catch (err) {
    return {
      success: false,
      value: null,
      txHash: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read-only contract simulation (no tx submission, no fees).
 * Used for entitlement checks, plan reads, etc.
 */
export async function simulateContract<T = unknown>(
  opts: Omit<InvokeOptions, "keypair">
): Promise<{ success: boolean; value: T | null; error: string | null }> {
  const rpc = getRpc();
  const keypair = getAdminKeypair();

  try {
    const stellarAccount = await rpc.getAccount(keypair.publicKey());

    const contract = new Contract(opts.contractId);
    const tx = new TransactionBuilder(stellarAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(opts.method, ...opts.args))
      .setTimeout(30)
      .build();

    const simResult = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return { success: false, value: null, error: simResult.error };
    }

    const resultVal = (simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse)
      .result?.retval;
    const native = resultVal ? (scValToNative(resultVal) as T) : null;

    return { success: true, value: native, error: null };
  } catch (err) {
    return {
      success: false,
      value: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────

interface PollResult {
  success: boolean;
  resultValue: xdr.ScVal | null;
  error: string | null;
}

async function pollTransaction(
  hash: string,
  maxAttempts = 20,
  intervalMs  = 1500
): Promise<PollResult> {
  const rpc = getRpc();

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    const result = await rpc.getTransaction(hash);

    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      const resultVal =
        result.returnValue ?? null;
      return { success: true, resultValue: resultVal, error: null };
    }

    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      return {
        success: false,
        resultValue: null,
        error: `Transaction failed: ${result.resultXdr}`,
      };
    }

    // MISSING = still processing, keep polling
  }

  return {
    success: false,
    resultValue: null,
    error: `Transaction not confirmed after ${maxAttempts} attempts`,
  };
}

// ─── Restore handler ──────────────────────────────────────────────────────────

async function handleRestore(
  simResult: SorobanRpc.Api.SimulateTransactionRestoreResponse,
  keypair: Keypair,
  account: Account
): Promise<void> {
  const rpc = getRpc();

  const restoreTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const restore = SorobanRpc.assembleTransaction(
    new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    }).setTimeout(30).build(),
    simResult
  ).build();

  restore.sign(keypair);
  const sent = await rpc.sendTransaction(restore);
  if (sent.status !== "PENDING") {
    throw new Error(`Restore transaction failed: ${sent.status}`);
  }
  await pollTransaction(sent.hash);
}

// ─── ScVal helpers ────────────────────────────────────────────────────────────

/** Convert a JS string to a Soroban String ScVal */
export function toScString(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "string" });
}

/** Convert a JS string to a Soroban Symbol ScVal */
export function toScSymbol(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "symbol" });
}

/** Convert a Stellar address string to an Address ScVal */
export function toScAddress(address: string): xdr.ScVal {
  return nativeToScVal(address, { type: "address" });
}

/** Convert a JS bigint / number to a u64 ScVal */
export function toScU64(n: bigint | number): xdr.ScVal {
  return nativeToScVal(BigInt(n), { type: "u64" });
}

/** Convert a JS bigint / number to an i128 ScVal */
export function toScI128(n: bigint | number): xdr.ScVal {
  return nativeToScVal(BigInt(n), { type: "i128" });
}

/** Convert a JS boolean to a Bool ScVal */
export function toScBool(b: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(b);
}

/** Convert a JS string[] to a Soroban Vec<String> ScVal */
export function toScStringVec(arr: string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(arr.map((s) => toScString(s)));
}

/** Convert a JS string[] (addresses) to a Soroban Vec<Address> ScVal */
export function toScAddressVec(arr: string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(arr.map((a) => toScAddress(a)));
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Formats a USDC stroop amount to human-readable USDC string */
export function stroopsToUsdc(stroops: bigint | number): string {
  return (Number(stroops) / 10_000_000).toFixed(7);
}

/** Converts a USDC float to stroops (bigint) */
export function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * 10_000_000));
}