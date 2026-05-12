// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Vault (server-side)
// EscrowVault: prepaid credit model for usage-based billing.
// Customers deposit USDC upfront; server debits as usage occurs.
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpClient } from "../shared/http.js";
import type {
  Vault,
  DebitVaultParams,
  DebitVaultResult,
  CloseVaultParams,
  CloseVaultResult,
  UpdateThresholdParams,
} from "../shared/types.js";
import { InvoqError } from "../shared/error";

export class VaultResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Fetch vault details for a customer/developer pair.
   * Throws NOT_FOUND_ERROR if vault does not exist.
   *
   * @example
   * const vault = await invoq.vault.get(customerAddress, developerAddress);
   * console.log("Balance:", Number(vault.balance_usdc) / 10_000_000, "USDC");
   */
  async get(customerAddress: string, developerAddress: string): Promise<Vault> {
    this.assertAddresses({ customerAddress, developerAddress });
    return this.http.get<Vault>("/v1/vault", {
      customer:  customerAddress,
      developer: developerAddress,
    });
  }

  /**
   * Debit the customer's escrow vault for usage.
   * Called by your backend when the customer consumes a resource.
   * Admin-signed — customer does not need to sign this.
   *
   * @param params.amount - USDC amount in stroops (1 USDC = 10_000_000)
   * @param params.usageDescription - Human-readable description logged on-chain
   *
   * @example
   * await invoq.vault.debit({
   *   customer: customerAddress,
   *   developer: developerAddress,
   *   amount: 5_000_000,           // 0.5 USDC
   *   usageDescription: "150 tokens @ $0.003/1k",
   * });
   */
  async debit(params: DebitVaultParams): Promise<DebitVaultResult> {
    this.assertAddresses({
      customerAddress:  params.customer,
      developerAddress: params.developer,
    });
    this.assertPositiveAmount(params.amount);

    return this.http.post<DebitVaultResult>("/v1/vault/debit", {
      customer:         params.customer,
      developer:        params.developer,
      amount:           Number(params.amount),
      usageDescription: params.usageDescription ?? "",
    });
  }

  /**
   * Update the low-balance threshold and auto-topup amount for a vault.
   * Triggers vault.low_balance webhook when balance drops below threshold.
   *
   * NOTE: In production, customers sign this transaction client-side via
   * invoq.checkout.buildUpdateThresholdTx() + wallet signing.
   * This method is for admin/testnet scenarios where the caller IS the customer.
   */
  async updateThreshold(params: UpdateThresholdParams): Promise<{ txHash: string }> {
    this.assertAddresses({
      customerAddress:  params.customer,
      developerAddress: params.developer,
    });

    return this.http.patch<{ txHash: string }>("/v1/vault/threshold", {
      caller:       params.caller,
      customer:     params.customer,
      developer:    params.developer,
      newThreshold: Number(params.newThreshold),
      newAutoTopup: Number(params.newAutoTopup ?? 0),
    });
  }

  /**
   * Close a vault and refund any remaining USDC balance to the customer.
   * NOTE: In production, customers sign this client-side.
   * This method is for admin/testnet scenarios.
   *
   * @example
   * const { refunded } = await invoq.vault.close({
   *   caller: adminAddress,
   *   customer: customerAddress,
   *   developer: developerAddress,
   * });
   * console.log("Refunded:", Number(refunded) / 10_000_000, "USDC");
   */
  async close(params: CloseVaultParams): Promise<CloseVaultResult> {
    this.assertAddresses({
      customerAddress:  params.customer,
      developerAddress: params.developer,
    });

    return this.http.del<CloseVaultResult>("/v1/vault", {
      caller:    params.caller,
      customer:  params.customer,
      developer: params.developer,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private assertAddresses(addrs: {
    customerAddress: string;
    developerAddress: string;
  }): void {
    for (const [label, addr] of Object.entries({
      customerAddress:  addrs.customerAddress,
      developerAddress: addrs.developerAddress,
    })) {
      if (!addr || typeof addr !== "string") {
        throw new InvoqError({
          message: `${label} is required`,
          code: "VALIDATION_ERROR",
        });
      }
    }
  }

  private assertPositiveAmount(amount: number | bigint): void {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      throw new InvoqError({
        message: `amount must be a positive number (in stroops), got: ${amount}`,
        code: "VALIDATION_ERROR",
      });
    }
  }
}