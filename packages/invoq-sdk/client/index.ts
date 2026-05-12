// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Client-side Client
// Use with pk_live_... or pk_test_... API keys in browser/mobile apps.
// Safe to expose in frontend code — publishable keys have read-only access
// to sensitive endpoints and cannot perform admin operations.
// ─────────────────────────────────────────────────────────────────────────────

import { HttpClient } from "../shared/http";
import type { InvoqConfig } from "../shared/types";
import { InvoqError } from "../shared/error";
import { CheckoutResource } from "./checkout";
import { ClientEntitlementResource } from "./entitlement";

export class InvoqClient {
  private readonly http: HttpClient;

  /**
   * Checkout flows — build XDR transactions for wallet signing.
   * Handles subscribe, create vault, withdraw, update threshold.
   */
  readonly checkout: CheckoutResource;

  /**
   * Read-only entitlement checks — safe with pk_ key.
   * Use to gate UI features based on the connected wallet's plan.
   */
  readonly entitlement: ClientEntitlementResource;

  constructor(config: InvoqConfig) {
    // Guard: warn if accidentally using secret key client-side
    if (config.apiKey.startsWith("sk_")) {
      console.warn(
        "[invoq-sdk] WARNING: InvoqClient initialized with a secret key (sk_...)." +
        " Use a publishable key (pk_live_... / pk_test_...) in browser environments." +
        " Secret keys should only be used server-side.",
      );
    }

    if (!config.apiKey.startsWith("pk_") && !config.apiKey.startsWith("sk_")) {
      throw new InvoqError({
        message:
          "Invalid API key format. Client keys start with 'pk_live_' or 'pk_test_'. " +
          "Got: " + config.apiKey.slice(0, 10) + "...",
        code: "AUTH_ERROR",
      });
    }

    this.http        = new HttpClient(config);
    this.checkout    = new CheckoutResource(this.http);
    this.entitlement = new ClientEntitlementResource(this.http);
  }
}

// ── Re-export error types ─────────────────────────────────────────────────────

export {
  InvoqError,
  InvoqApiError,
  InvoqNetworkError,
  InvoqTimeoutError,
} from "../shared/error";

export type { InvoqErrorCode } from "../shared/error";

// ── Re-export types used client-side ─────────────────────────────────────────

export type {
  InvoqConfig,
  EntitlementResult,
  BuildTxResult,
  SubmitTxResult,
  BuildVaultTxParams,
  BuildWithdrawVaultParams,
  BuildUpdateThresholdParams,
} from "../shared/types.js";

export type { WalletAdapter } from "./checkout";

export default InvoqClient;