/**
 * src/lib/db/schema.ts
 *
 * PostgreSQL schema for Invoq's off-chain state.
 *
 * The on-chain contracts store all billing truth (plans, subscriptions,
 * usage, payments). This database stores everything that the chain doesn't:
 *
 * - Developer accounts and API keys
 * - Webhook endpoint configs and delivery logs
 * - Usage buffer (pending usage records batched before chain submission)
 * - Cached subscription state (for fast renewal queries without chain reads)
 * - Audit log of all on-chain transactions
 */

import {
  pgTable,
  text,
  varchar,
  bigint,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "Trialing",
  "Active",
  "Paused",
  "GracePeriod",
  "Cancelled",
  "Expired",
]);

export const webhookEventEnum = pgEnum("webhook_event", [
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
]);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
  "retrying",
]);

// ─── Developers ───────────────────────────────────────────────────────────────
// A developer account represents one Invoq customer (a builder using the platform).
// Their Stellar wallet address is the on-chain identifier.
// The `id` is the off-chain UUID used in all DB relations.

export const developers = pgTable(
  "developers",
  {
    id:             text("id").primaryKey(),                           // UUID
    stellarAddress: varchar("stellar_address", { length: 56 }).notNull(), // G...
    email:          varchar("email", { length: 255 }).notNull(),
    name:           varchar("name", { length: 255 }).notNull(),
    createdAt:      timestamp("created_at").notNull().defaultNow(),
    updatedAt:      timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    stellarIdx: uniqueIndex("developers_stellar_address_idx").on(t.stellarAddress),
    emailIdx:   uniqueIndex("developers_email_idx").on(t.email),
  })
);

// ─── API Keys ─────────────────────────────────────────────────────────────────
// API keys are hashed (SHA-256) before storage — we never store the plaintext.
// The key prefix (first 8 chars, e.g. "sk_live_") is stored for display.
// One developer can have multiple keys (rotation support).

export const apiKeys = pgTable(
  "api_keys",
  {
    id:          text("id").primaryKey(),               // UUID
    developerId: text("developer_id")
                   .notNull()
                   .references(() => developers.id, { onDelete: "cascade" }),
    keyHash:     varchar("key_hash", { length: 64 }).notNull(), // SHA-256 hex
    keyPrefix:   varchar("key_prefix", { length: 16 }).notNull(), // "sk_live_abc123"
    name:        varchar("name", { length: 100 }),       // optional label
    lastUsedAt:  timestamp("last_used_at"),
    expiresAt:   timestamp("expires_at"),               // null = never expires
    revoked:     boolean("revoked").notNull().default(false),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    hashIdx:      uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    developerIdx: index("api_keys_developer_idx").on(t.developerId),
  })
);

// ─── Webhook Endpoints ────────────────────────────────────────────────────────
// Where to deliver webhook events for each developer.
// Each endpoint has its own HMAC signing secret.

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id:            text("id").primaryKey(),
    developerId:   text("developer_id")
                     .notNull()
                     .references(() => developers.id, { onDelete: "cascade" }),
    url:           varchar("url", { length: 2048 }).notNull(),
    signingSecret: varchar("signing_secret", { length: 64 }).notNull(), // hex, 32 bytes
    // Which events to deliver to this endpoint. Empty = all events.
    events:        jsonb("events").$type<string[]>().notNull().default([]),
    active:        boolean("active").notNull().default(true),
    createdAt:     timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    developerIdx: index("webhook_endpoints_developer_idx").on(t.developerId),
  })
);

// ─── Webhook Delivery Log ─────────────────────────────────────────────────────
// Every webhook delivery attempt is logged for debugging and audit.

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id:           text("id").primaryKey(),
    endpointId:   text("endpoint_id")
                    .notNull()
                    .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    developerId:  text("developer_id").notNull(),
    event:        webhookEventEnum("event").notNull(),
    payload:      jsonb("payload").notNull(),            // full webhook body
    status:       webhookDeliveryStatusEnum("status").notNull().default("pending"),
    httpStatus:   integer("http_status"),                // response code (null if failed)
    responseBody: text("response_body"),                 // first 1000 chars of response
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt:  timestamp("next_retry_at"),
    deliveredAt:  timestamp("delivered_at"),
    createdAt:    timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    endpointIdx:    index("webhook_deliveries_endpoint_idx").on(t.endpointId),
    developerIdx:   index("webhook_deliveries_developer_idx").on(t.developerId),
    statusIdx:      index("webhook_deliveries_status_idx").on(t.status),
    nextRetryIdx:   index("webhook_deliveries_next_retry_idx").on(t.nextRetryAt),
  })
);

// ─── Subscription Cache ───────────────────────────────────────────────────────
// Mirror of on-chain subscription state for fast off-chain queries.
// Used by the renewal cron to find due subscriptions without reading the chain.
// Updated whenever a subscription state change is observed (from events or API calls).

export const subscriptionCache = pgTable(
  "subscription_cache",
  {
    customerAddress:    varchar("customer_address", { length: 56 }).primaryKey(),
    planId:             bigint("plan_id", { mode: "bigint" }).notNull(),
    developerId:        text("developer_id").notNull(),
    developerAddress:   varchar("developer_address", { length: 56 }).notNull(),
    status:             subscriptionStatusEnum("status").notNull(),
    currentPeriodStart: timestamp("current_period_start").notNull(),
    currentPeriodEnd:   timestamp("current_period_end").notNull(),
    cancelAtPeriodEnd:  boolean("cancel_at_period_end").notNull().default(false),
    usageCurrent:       bigint("usage_current", { mode: "bigint" }).notNull().default(0n),
    // Last time this row was synced from the chain
    syncedAt:           timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => ({
    // Used by renewal cron: find all subscriptions where period_end <= now
    periodEndIdx:  index("sub_cache_period_end_idx").on(t.currentPeriodEnd),
    statusIdx:     index("sub_cache_status_idx").on(t.status),
    developerIdx:  index("sub_cache_developer_idx").on(t.developerId),
  })
);

// ─── Usage Buffer ─────────────────────────────────────────────────────────────
// Usage records land here first. A background worker flushes them to the chain
// in batches of up to 50 every 5 seconds. This decouples the hot-path API
// from the 5-second Stellar transaction time.

export const usageBuffer = pgTable(
  "usage_buffer",
  {
    id:              text("id").primaryKey(),
    customerAddress: varchar("customer_address", { length: 56 }).notNull(),
    developerId:     text("developer_id").notNull(),
    units:           bigint("units", { mode: "bigint" }).notNull(),
    // null = not yet flushed to chain
    flushedAt:       timestamp("flushed_at"),
    txHash:          varchar("tx_hash", { length: 64 }),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // Used by flush worker: find all unflushed records
    unflushedIdx:  index("usage_buffer_unflushed_idx")
                     .on(t.flushedAt)
                     .where(sql`flushed_at IS NULL`),
    customerIdx:   index("usage_buffer_customer_idx").on(t.customerAddress),
  })
);

// ─── Transaction Log ──────────────────────────────────────────────────────────
// Audit trail of every on-chain transaction submitted by Invoq.

export const transactionLog = pgTable(
  "transaction_log",
  {
    id:          text("id").primaryKey(),
    developerId: text("developer_id"),              // null for system txns
    txHash:      varchar("tx_hash", { length: 64 }).notNull(),
    method:      varchar("method", { length: 100 }).notNull(), // e.g. "create_plan"
    contractId:  varchar("contract_id", { length: 56 }).notNull(),
    status:      varchar("status", { length: 20 }).notNull(),  // "success" | "failed"
    errorMsg:    text("error_msg"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    txHashIdx:    uniqueIndex("tx_log_hash_idx").on(t.txHash),
    developerIdx: index("tx_log_developer_idx").on(t.developerId),
    methodIdx:    index("tx_log_method_idx").on(t.method),
  })
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const developerRelations = relations(developers, ({ many }) => ({
  apiKeys:          many(apiKeys),
  webhookEndpoints: many(webhookEndpoints),
  webhookDeliveries: many(webhookDeliveries),
}));

export const apiKeyRelations = relations(apiKeys, ({ one }) => ({
  developer: one(developers, {
    fields:     [apiKeys.developerId],
    references: [developers.id],
  }),
}));

export const webhookEndpointRelations = relations(webhookEndpoints, ({ one, many }) => ({
  developer:  one(developers, {
    fields:     [webhookEndpoints.developerId],
    references: [developers.id],
  }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveryRelations = relations(webhookDeliveries, ({ one }) => ({
  endpoint: one(webhookEndpoints, {
    fields:     [webhookDeliveries.endpointId],
    references: [webhookEndpoints.id],
  }),
}));