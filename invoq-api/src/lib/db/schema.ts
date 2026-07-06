/**
 * src/lib/db/schema.ts
 *
 * Plain TS data model for Invoq's off-chain state.
 * Mongo stores records as JSON-like docs, so keep shapes simple.
 */

export const subscriptionStatusValues = [
  "Trialing",
  "Active",
  "Paused",
  "GracePeriod",
  "Cancelled",
  "Expired",
] as const;

export type SubscriptionStatus = (typeof subscriptionStatusValues)[number];

export const webhookEventValues = [
  "subscription.created",
  "subscription.cancelled",
  "subscription.upgraded",
  "subscription.downgraded",
  "payment.renewed",
  "payment.failed",
  "payment.retry_succeeded",
  "usage.threshold",
  "trial.ending",
  "vault.low_balance",
  "vault.created",
  "vault.closed",
] as const;

export type WebhookEvent = (typeof webhookEventValues)[number];

export const webhookDeliveryStatusValues = [
  "pending",
  "delivered",
  "failed",
  "retrying",
] as const;

export type WebhookDeliveryStatus = (typeof webhookDeliveryStatusValues)[number];

export interface DeveloperRecord {
  id: string;
  stellarAddress: string;
  email: string;
  name: string;
  payoutAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyRecord {
  id: string;
  developerId: string;
  keyHash: string;
  keyPrefix: string;
  name: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revoked: boolean;
  createdAt: Date;
}

export interface WebhookEndpointRecord {
  id: string;
  developerId: string;
  url: string;
  signingSecret: string;
  events: string[];
  active: boolean;
  createdAt: Date;
}

export interface WebhookDeliveryRecord {
  id: string;
  endpointId: string;
  developerId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  httpStatus: number | null;
  responseBody: string | null;
  attemptCount: number;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface SubscriptionCacheRecord {
  customerAddress: string;
  planId: number;
  developerId: string;
  developerAddress: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  usageCurrent: number;
  syncedAt: Date;
}

export interface UsageBufferRecord {
  id: string;
  customerAddress: string;
  developerId: string;
  units: number;
  flushedAt: Date | null;
  txHash: string | null;
  createdAt: Date;
}

export interface TransactionLogRecord {
  id: string;
  developerId: string | null;
  txHash: string;
  method: string;
  contractId: string;
  status: string;
  errorMsg: string | null;
  createdAt: Date;
}
