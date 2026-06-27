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

export const developers = pgTable(
  "developers",
  {
    id:             text("id").primaryKey(),
    stellarAddress: varchar("stellar_address", { length: 56 }).notNull(),
    email:          varchar("email", { length: 255 }).notNull(),
    name:           varchar("name", { length: 255 }).notNull(),
    payoutAddress:  varchar("payout_address", { length: 56 }),
    createdAt:      timestamp("created_at").notNull().defaultNow(),
    updatedAt:      timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    stellarIdx: uniqueIndex("developers_stellar_address_idx").on(t.stellarAddress),
    emailIdx:   uniqueIndex("developers_email_idx").on(t.email),
  })
);

// ─── API Keys ─────────────────────────────────────────────────────────────────

export const apiKeys = pgTable(
  "api_keys",
  {
    id:          text("id").primaryKey(),
    developerId: text("developer_id")
                   .notNull()
                   .references(() => developers.id, { onDelete: "cascade" }),
    keyHash:     varchar("key_hash", { length: 64 }).notNull(),
    keyPrefix:   varchar("key_prefix", { length: 16 }).notNull(),
    name:        varchar("name", { length: 100 }),
    lastUsedAt:  timestamp("last_used_at"),
    expiresAt:   timestamp("expires_at"),
    revoked:     boolean("revoked").notNull().default(false),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    hashIdx:      uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    developerIdx: index("api_keys_developer_idx").on(t.developerId),
  })
);

// ─── Webhook Endpoints ────────────────────────────────────────────────────────

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id:            text("id").primaryKey(),
    developerId:   text("developer_id")
                     .notNull()
                     .references(() => developers.id, { onDelete: "cascade" }),
    url:           varchar("url", { length: 2048 }).notNull(),
    signingSecret: varchar("signing_secret", { length: 64 }).notNull(),
    events:        jsonb("events").$type<string[]>().notNull().default([]),
    active:        boolean("active").notNull().default(true),
    createdAt:     timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    developerIdx: index("webhook_endpoints_developer_idx").on(t.developerId),
  })
);

// ─── Webhook Delivery Log ─────────────────────────────────────────────────────

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id:           text("id").primaryKey(),
    endpointId:   text("endpoint_id")
                    .notNull()
                    .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    developerId:  text("developer_id").notNull(),
    event:        webhookEventEnum("event").notNull(),
    payload:      jsonb("payload").notNull(),
    status:       webhookDeliveryStatusEnum("status").notNull().default("pending"),
    httpStatus:   integer("http_status"),
    responseBody: text("response_body"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt:  timestamp("next_retry_at"),
    deliveredAt:  timestamp("delivered_at"),
    createdAt:    timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    endpointIdx:  index("webhook_deliveries_endpoint_idx").on(t.endpointId),
    developerIdx: index("webhook_deliveries_developer_idx").on(t.developerId),
    statusIdx:    index("webhook_deliveries_status_idx").on(t.status),
    nextRetryIdx: index("webhook_deliveries_next_retry_idx").on(t.nextRetryAt),
  })
);

// ─── Subscription Cache ───────────────────────────────────────────────────────

export const subscriptionCache = pgTable(
  "subscription_cache",
  {
    customerAddress:    varchar("customer_address", { length: 56 }).primaryKey(),
    planId:             bigint("plan_id", { mode: "number" }).notNull(),
    developerId:        text("developer_id").notNull(),
    developerAddress:   varchar("developer_address", { length: 56 }).notNull(),
    status:             subscriptionStatusEnum("status").notNull(),
    currentPeriodStart: timestamp("current_period_start").notNull(),
    currentPeriodEnd:   timestamp("current_period_end").notNull(),
    cancelAtPeriodEnd:  boolean("cancel_at_period_end").notNull().default(false),
    usageCurrent:       bigint("usage_current", { mode: "number" }).notNull().default(0),
    syncedAt:           timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => ({
    periodEndIdx: index("sub_cache_period_end_idx").on(t.currentPeriodEnd),
    statusIdx:    index("sub_cache_status_idx").on(t.status),
    developerIdx: index("sub_cache_developer_idx").on(t.developerId),
  })
);

// ─── Usage Buffer ─────────────────────────────────────────────────────────────

export const usageBuffer = pgTable(
  "usage_buffer",
  {
    id:              text("id").primaryKey(),
    customerAddress: varchar("customer_address", { length: 56 }).notNull(),
    developerId:     text("developer_id").notNull(),
    units:           bigint("units", { mode: "number" }).notNull(),
    flushedAt:       timestamp("flushed_at"),
    txHash:          varchar("tx_hash", { length: 64 }),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    unflushedIdx: index("usage_buffer_unflushed_idx")
                    .on(t.flushedAt)
                    .where(sql`flushed_at IS NULL`),
    customerIdx:  index("usage_buffer_customer_idx").on(t.customerAddress),
  })
);

// ─── Transaction Log ──────────────────────────────────────────────────────────

export const transactionLog = pgTable(
  "transaction_log",
  {
    id:          text("id").primaryKey(),
    developerId: text("developer_id"),
    txHash:      varchar("tx_hash", { length: 64 }).notNull(),
    method:      varchar("method", { length: 100 }).notNull(),
    contractId:  varchar("contract_id", { length: 56 }).notNull(),
    status:      varchar("status", { length: 20 }).notNull(),
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
  apiKeys:           many(apiKeys),
  webhookEndpoints:  many(webhookEndpoints),
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