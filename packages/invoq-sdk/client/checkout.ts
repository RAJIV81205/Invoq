// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Checkout (client-side)
// Handles the build-tx → wallet-sign → submit-tx flow for subscriptions.
// Works in browser or any environment with a Stellar wallet adapter.
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpClient } from "../shared/http";
import type {
  BuildTxResult,
  SubmitTxResult,
  BuildVaultTxParams,
} from "../shared/types.js";
import { InvoqError } from "../shared/error";

// ── Wallet adapter interface ─────────────────────────────────────────────────

/**
 * Minimal interface your wallet adapter must implement.
 * Works with Freighter, Albedo, WalletConnect, or any custom adapter.
 *
 * @example
 * // Freighter adapter
 * const wallet: WalletAdapter = {
 *   signTransaction: async (xdr) => {
 *     const { signedXDR } = await freighter.signTransaction(xdr, { network: "MAINNET" });
 *     return signedXDR;
 *   },
 * };
 */
export interface WalletAdapter {
  /**
   * Sign a Soroban transaction XDR and return the signed XDR.
   * @param xdr - Unsigned transaction XDR string from Invoq
   * @returns Signed transaction XDR string
   */
  signTransaction(xdr: string): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────

export class CheckoutResource {
  constructor(private readonly http: HttpClient) {}

  // ── Subscription flow ─────────────────────────────────────────────────────

  /**
   * Build an unsigned subscribe transaction XDR.
   * Pass the XDR to your wallet for signing, then call submitSubscription().
   *
   * @param customerAddress - Customer's Stellar wallet address (G...)
   * @param planId - Plan ID to subscribe to
   * @returns Unsigned XDR string
   *
   * @example
   * const { xdr } = await invoq.checkout.buildSubscribeTx(customerAddress, "1");
   * const signedXdr = await wallet.signTransaction(xdr);
   * const { txHash } = await invoq.checkout.submitSubscription(signedXdr, customerAddress, "1");
   */
  async buildSubscribeTx(
    customerAddress: string,
    planId: string | number | bigint,
  ): Promise<BuildTxResult> {
    this.assertAddress("customerAddress", customerAddress);
    return this.http.post<BuildTxResult>("/v1/checkout/build-tx", {
      customerAddress,
      planId: String(planId),
    });
  }

  /**
   * Submit a signed subscription transaction and sync state.
   * The Invoq backend wraps it in a fee-bump, submits to Stellar, and
   * updates the subscription cache on confirmation.
   *
   * @param signedXdr     - Signed XDR from wallet.signTransaction()
   * @param customerAddress - Must match the address that signed the tx
   * @param planId        - Same plan ID used in buildSubscribeTx()
   */
  async submitSubscription(
    signedXdr: string,
    customerAddress: string,
    planId: string | number | bigint,
  ): Promise<SubmitTxResult> {
    this.assertXdr(signedXdr);
    this.assertAddress("customerAddress", customerAddress);
    return this.http.post<SubmitTxResult>("/v1/checkout/submit-tx", {
      signedXdr,
      customerAddress,
      planId: String(planId),
    });
  }

  /**
   * One-shot helper: build, sign with wallet, and submit a subscription.
   * The wallet prompts the user to sign once.
   *
   * @example
   * const { txHash } = await invoq.checkout.subscribe(wallet, customerAddress, "1");
   */
  async subscribe(
    wallet: WalletAdapter,
    customerAddress: string,
    planId: string | number | bigint,
  ): Promise<SubmitTxResult> {
    const { xdr } = await this.buildSubscribeTx(customerAddress, planId);
    const signedXdr = await wallet.signTransaction(xdr);
    return this.submitSubscription(signedXdr, customerAddress, planId);
  }

  // ── Vault creation flow ───────────────────────────────────────────────────

  /**
   * Build an unsigned create-vault transaction XDR.
   * Customer must sign and submit via submitCreateVault().
   *
   * @param params.initialDeposit     - Initial USDC deposit in stroops
   * @param params.lowBalanceThreshold - Trigger vault.low_balance webhook below this
   * @param params.autoTopupAmount    - Suggested top-up amount when threshold hit
   *
   * @example
   * const { xdr } = await invoq.checkout.buildCreateVaultTx({
   *   customerAddress,
   *   developerAddress,
   *   initialDeposit: 50_000_000,      // 5 USDC
   *   lowBalanceThreshold: 10_000_000, // 1 USDC
   *   autoTopupAmount: 50_000_000,     // 5 USDC suggested top-up
   * });
   */
  async buildCreateVaultTx(params: BuildVaultTxParams): Promise<BuildTxResult> {
    this.assertAddress("customerAddress", params.customerAddress);
    this.assertAddress("developerAddress", params.developerAddress);
    this.assertPositiveAmount("initialDeposit", params.initialDeposit);

    return this.http.post<BuildTxResult>("/v1/checkout/build-vault-tx", {
      customerAddress:     params.customerAddress,
      developerAddress:    params.developerAddress,
      initialDeposit:      Number(params.initialDeposit),
      lowBalanceThreshold: Number(params.lowBalanceThreshold ?? 0),
      autoTopupAmount:     Number(params.autoTopupAmount ?? 0),
    });
  }

  /**
   * Submit a signed create-vault transaction.
   */
  async submitCreateVault(
    signedXdr: string,
    customerAddress: string,
  ): Promise<SubmitTxResult> {
    this.assertXdr(signedXdr);
    this.assertAddress("customerAddress", customerAddress);
    return this.http.post<SubmitTxResult>("/v1/checkout/submit-vault-tx", {
      signedXdr,
      customerAddress,
    });
  }

  /**
   * One-shot: build, sign, and submit a vault creation.
   *
   * @example
   * const { txHash } = await invoq.checkout.createVault(wallet, {
   *   customerAddress,
   *   developerAddress,
   *   initialDeposit: 50_000_000,
   * });
   */
  async createVault(
    wallet: WalletAdapter,
    params: BuildVaultTxParams,
  ): Promise<SubmitTxResult> {
    const { xdr } = await this.buildCreateVaultTx(params);
    const signedXdr = await wallet.signTransaction(xdr);
    return this.submitCreateVault(signedXdr, params.customerAddress);
  }

  // ── Vault withdraw flow ───────────────────────────────────────────────────

  /**
   * Build an unsigned vault withdraw transaction.
   * Customer signs to withdraw unspent USDC balance.
   */
  async buildWithdrawTx(params: {
    customerAddress: string;
    developerAddress: string;
    amount: number | bigint;
  }): Promise<BuildTxResult> {
    this.assertAddress("customerAddress", params.customerAddress);
    this.assertAddress("developerAddress", params.developerAddress);
    this.assertPositiveAmount("amount", params.amount);

    return this.http.post<BuildTxResult>("/v1/vault/build-withdraw-tx", {
      customerAddress:  params.customerAddress,
      developerAddress: params.developerAddress,
      amount:           Number(params.amount),
    });
  }

  /**
   * Submit signed vault withdraw transaction.
   */
  async submitWithdraw(
    signedXdr: string,
    customerAddress: string,
  ): Promise<SubmitTxResult> {
    this.assertXdr(signedXdr);
    this.assertAddress("customerAddress", customerAddress);
    return this.http.post<SubmitTxResult>("/v1/vault/submit-withdraw-tx", {
      signedXdr,
      customerAddress,
    });
  }

  /**
   * One-shot: build, sign, and submit a vault withdrawal.
   */
  async withdraw(
    wallet: WalletAdapter,
    params: { customerAddress: string; developerAddress: string; amount: number | bigint },
  ): Promise<SubmitTxResult> {
    const { xdr } = await this.buildWithdrawTx(params);
    const signedXdr = await wallet.signTransaction(xdr);
    return this.submitWithdraw(signedXdr, params.customerAddress);
  }

  // ── Vault threshold update flow ───────────────────────────────────────────

  /**
   * Build an unsigned vault threshold update transaction.
   */
  async buildUpdateThresholdTx(params: {
    customerAddress: string;
    developerAddress: string;
    newThreshold: number | bigint;
    newAutoTopup?: number | bigint;
  }): Promise<BuildTxResult> {
    this.assertAddress("customerAddress", params.customerAddress);
    this.assertAddress("developerAddress", params.developerAddress);

    return this.http.post<BuildTxResult>("/v1/vault/build-threshold-tx", {
      customerAddress:  params.customerAddress,
      developerAddress: params.developerAddress,
      newThreshold:     Number(params.newThreshold),
      newAutoTopup:     Number(params.newAutoTopup ?? 0),
    });
  }

  /**
   * Submit signed threshold update transaction.
   */
  async submitUpdateThreshold(
    signedXdr: string,
    customerAddress: string,
  ): Promise<SubmitTxResult> {
    this.assertXdr(signedXdr);
    this.assertAddress("customerAddress", customerAddress);
    return this.http.post<SubmitTxResult>("/v1/vault/submit-threshold-tx", {
      signedXdr,
      customerAddress,
    });
  }

  /**
   * One-shot: build, sign, and submit a threshold update.
   */
  async updateThreshold(
    wallet: WalletAdapter,
    params: {
      customerAddress: string;
      developerAddress: string;
      newThreshold: number | bigint;
      newAutoTopup?: number | bigint;
    },
  ): Promise<SubmitTxResult> {
    const { xdr } = await this.buildUpdateThresholdTx(params);
    const signedXdr = await wallet.signTransaction(xdr);
    return this.submitUpdateThreshold(signedXdr, params.customerAddress);
  }

  // ── Validation helpers ────────────────────────────────────────────────────

  private assertAddress(label: string, address: string): void {
    if (!address || typeof address !== "string") {
      throw new InvoqError({
        message: `${label} is required`,
        code: "VALIDATION_ERROR",
      });
    }
    if (!address.startsWith("G") || address.length !== 56) {
      throw new InvoqError({
        message: `${label} must be a valid Stellar G... address (56 chars). Got: "${address.slice(0, 20)}..."`,
        code: "VALIDATION_ERROR",
      });
    }
  }

  private assertXdr(xdr: string): void {
    if (!xdr || typeof xdr !== "string" || xdr.length < 10) {
      throw new InvoqError({
        message: "signedXdr is required and must be a valid XDR string from your wallet",
        code: "VALIDATION_ERROR",
      });
    }
  }

  private assertPositiveAmount(label: string, amount: number | bigint): void {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      throw new InvoqError({
        message: `${label} must be a positive number in stroops (1 USDC = 10_000_000). Got: ${amount}`,
        code: "VALIDATION_ERROR",
      });
    }
  }
}