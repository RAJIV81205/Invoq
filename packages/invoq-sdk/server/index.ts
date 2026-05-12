// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Server-side Client
// Use with sk_live_... or sk_test_... API keys on your backend only.
// Never expose secret keys in browser/client code.
// ─────────────────────────────────────────────────────────────────────────────

import { HttpClient } from "../shared/http";
import type { InvoqConfig } from "../shared/types";
import { InvoqError } from "../shared/error";
import { PlansResource } from "./plans";
import { SubscriptionsResource } from "./subscriptions";
import { EntitlementResource } from "./entitlement";
import { UsageResource } from "./usage";
import { VaultResource } from "./vault";
import { WebhooksResource } from "./webhooks";
import { KeysResource } from "./keys";

export class InvoqServer {
  private readonly http: HttpClient;

  /** Manage subscription plans — create, update, deactivate, reactivate */
  readonly plans: PlansResource;

  /** Manage customer subscriptions — get status, cancel */
  readonly subscriptions: SubscriptionsResource;

  /**
   * Check feature entitlements.
   * Hot path — cached in Redis. Call on every API request.
   */
  readonly entitlement: EntitlementResource;

  /** Record and query usage metering */
  readonly usage: UsageResource;

  /** Manage EscrowVault — debit, close, update thresholds */
  readonly vault: VaultResource;

  /** Manage webhook endpoints and verify incoming payloads */
  readonly webhooks: WebhooksResource;

  /** Manage API keys (list/create publishable/revoke) */
  readonly keys: KeysResource;

  constructor(config: InvoqConfig) {
    // Guard: prevent accidental use of publishable key on server
    if (config.apiKey.startsWith("pk_")) {
      console.warn(
        "[invoq-sdk] WARNING: InvoqServer initialized with a publishable key (pk_...)." +
        " Server SDK requires a secret key (sk_...). Sensitive endpoints will return 401.",
      );
    }

    if (!config.apiKey.startsWith("sk_") && !config.apiKey.startsWith("pk_")) {
      throw new InvoqError({
        message:
          "Invalid API key format. Server keys start with 'sk_live_' or 'sk_test_'. " +
          "Got: " + config.apiKey.slice(0, 10) + "...",
        code: "AUTH_ERROR",
      });
    }

    this.http          = new HttpClient(config);
    this.plans         = new PlansResource(this.http);
    this.subscriptions = new SubscriptionsResource(this.http);
    this.entitlement   = new EntitlementResource(this.http);
    this.usage         = new UsageResource(this.http);
    this.vault         = new VaultResource(this.http);
    this.webhooks      = new WebhooksResource(this.http);
    this.keys          = new KeysResource(this.http);
  }
}

// ── Re-export error types for consumers ─────────────────────────────────────

export {
  InvoqError,
  InvoqApiError,
  InvoqNetworkError,
  InvoqTimeoutError,
  InvoqSignatureError,
} from "../shared/error";

export type { InvoqErrorCode } from "../shared/error";

// ── Re-export all types ──────────────────────────────────────────────────────

export type {
  InvoqConfig,
  Plan,
  CreatePlanParams,
  UpdatePlanParams,
  CreatePlanResult,
  UpdatePlanResult,
  Subscription,
  SubscriptionStatus,
  CancelSubscriptionResult,
  EntitlementResult,
  EntitlementFullResult,
  RecordUsageResult,
  UsageResult,
  Vault,
  DebitVaultParams,
  DebitVaultResult,
  UpdateThresholdParams,
  CloseVaultParams,
  CloseVaultResult,
  WebhookEndpoint,
  WebhookEndpointWithSecret,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEvent,
  WebhookPayloadBase,
  SubscriptionEventData,
  PaymentEventData,
  UsageThresholdData,
  VaultEventData,
  ApiKeyType,
  ApiKeyEnv,
  ApiKeyInfo,
  CreatePublishableKeyParams,
  CreatePublishableKeyResult,
  CreateSecretKeyResult,
} from "../shared/types";

export default InvoqServer;
