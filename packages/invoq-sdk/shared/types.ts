// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Shared Types
// All bigint-on-chain values come back as strings from the REST API.
// ─────────────────────────────────────────────────────────────────────────────

// ── Subscription status ───────────────────────────────────────────────────────

export type SubscriptionStatus =
  | "Trialing"
  | "Active"
  | "Paused"
  | "GracePeriod"
  | "Cancelled"
  | "Expired";

// ── Webhook events ────────────────────────────────────────────────────────────

export type WebhookEvent =
  | "subscription.created"
  | "subscription.cancelled"
  | "subscription.upgraded"
  | "subscription.downgraded"
  | "payment.renewed"
  | "payment.failed"
  | "payment.retry_succeeded"
  | "usage.threshold"
  | "trial.ending"
  | "vault.low_balance"
  | "vault.created"
  | "vault.closed";

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "retrying";

// ── Plans ─────────────────────────────────────────────────────────────────────

export interface Plan {
  plan_id: string;           // bigint as string
  name: string;
  price_usdc: string;        // stroops as string — divide by 10_000_000 for USDC
  interval_seconds: string;
  trial_seconds: string;
  usage_limit: string;       // "0" = unlimited
  features: string[];
  active: boolean;
  owner: string;             // Stellar address
  created_at: string;        // unix timestamp as string
}

export interface CreatePlanParams {
  name: string;
  /** USDC in stroops (1 USDC = 10_000_000 stroops) */
  priceUsdc: number | bigint;
  /** Billing interval in seconds. 2592000 = 30 days */
  intervalSeconds: number | bigint;
  /** Trial period in seconds. 0 = no trial */
  trialSeconds?: number | bigint;
  /** Max usage units per period. 0 = unlimited */
  usageLimit?: number | bigint;
  features?: string[];
}

export interface UpdatePlanParams {
  name: string;
  priceUsdc: number | bigint;
  usageLimit?: number | bigint;
  features?: string[];
}

export interface CreatePlanResult {
  planId: string;
  txHash: string;
}

export interface UpdatePlanResult {
  txHash: string;
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export interface Subscription {
  customer: string;           // Stellar address
  plan_id: string;
  status: SubscriptionStatus;
  started_at: string;         // unix seconds as string
  current_period_start: string;
  current_period_end: string;
  trial_end: string;
  cancel_at_period_end: boolean;
  usage_current: string;
}

export interface CancelSubscriptionResult {
  txHash: string;
  immediate: boolean;
  /** true if cancel submitted but not yet confirmed on-chain */
  pending?: boolean;
  warning?: string;
}

// ── Entitlement ───────────────────────────────────────────────────────────────

export interface EntitlementResult {
  entitled: boolean;
  /** "cache" = Redis hit, "chain" = Soroban query */
  source?: "cache" | "chain";
}

export interface EntitlementFullResult {
  entitled: boolean;
  status: SubscriptionStatus;
  plan_id: string;
  usage_current: string;
  usage_limit: string;
  current_period_end: string;
}

// ── Usage ─────────────────────────────────────────────────────────────────────

export interface RecordUsageResult {
  accepted: boolean;
  customer: string;
  units: number;
  /** Current Redis buffer total before flush */
  bufferTotal: number;
}

export interface UsageResult {
  customer: string;
  usageCurrent: string;
  periodStart: string;
  periodEnd: string;
  status: SubscriptionStatus;
}

// ── Vault ─────────────────────────────────────────────────────────────────────

export interface Vault {
  customer: string;
  developer: string;
  balance_usdc: string;
  total_deposited: string;
  total_debited: string;
  low_balance_threshold: string;
  auto_topup_amount: string;
  created_at: string;
}

export interface DebitVaultParams {
  customer: string;
  developer: string;
  amount: number | bigint;
  usageDescription?: string;
}

export interface DebitVaultResult {
  txHash: string;
  remainingBalance: string;
}

export interface UpdateThresholdParams {
  caller: string;
  customer: string;
  developer: string;
  newThreshold: number | bigint;
  newAutoTopup?: number | bigint;
}

export interface CloseVaultParams {
  caller: string;
  customer: string;
  developer: string;
}

export interface CloseVaultResult {
  txHash: string;
  refunded: string;
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
}

export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  /** Only returned on creation — store this securely */
  signingSecret: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  developerId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  httpStatus: number | null;
  responseBody: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

// ── Webhook payload shapes (for constructEvent) ────────────────────────────

export interface WebhookPayloadBase {
  id: string;
  event: WebhookEvent;
  created_at: number;
  data: Record<string, unknown>;
}

export interface SubscriptionEventData {
  customer: string;
  planId: string;
  txHash?: string;
  status?: SubscriptionStatus;
  reason?: string;
  periodEnd?: string;
}

export interface PaymentEventData {
  customer: string;
  planId: string;
  txHash?: string;
  status?: SubscriptionStatus;
  periodEnd?: string;
}

export interface UsageThresholdData {
  customer: string;
  planId: string;
  usageCurrent: string;
  usageLimit: string;
  thresholdPct: number;
}

export interface VaultEventData {
  customer: string;
  developer: string;
  balance?: string;
  threshold?: string;
}

// ── Checkout (client-side) ────────────────────────────────────────────────────

export interface BuildTxResult {
  /** Unsigned Soroban transaction XDR — pass to wallet for signing */
  xdr: string;
}

export interface SubmitTxResult {
  txHash: string;
}

export interface BuildVaultTxParams {
  customerAddress: string;
  developerAddress: string;
  /** USDC in stroops */
  initialDeposit: number | bigint;
  lowBalanceThreshold?: number | bigint;
  autoTopupAmount?: number | bigint;
}

export interface BuildWithdrawVaultParams {
  customerAddress: string;
  developerAddress: string;
  amount: number | bigint;
}

export interface BuildUpdateThresholdParams {
  customerAddress: string;
  developerAddress: string;
  newThreshold: number | bigint;
  newAutoTopup?: number | bigint;
}

// ── SDK config ────────────────────────────────────────────────────────────────

export interface InvoqConfig {
  /** Your Invoq API key — sk_live_... for server, pk_live_... for client */
  apiKey: string;
  /** Override base URL. Defaults to https://api.invoq.dev */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: 30000 */
  timeoutMs?: number;
  /** Log all requests/responses to console. Default: false */
  debug?: boolean;
}