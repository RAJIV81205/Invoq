/**
 * src/lib/db/index.ts
 *
 * Mongo-backed off-chain state for Invoq.
 * Keeps helpers small and explicit instead of mirroring SQL ORM APIs.
 */

import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import {
  type ApiKeyRecord,
  type DeveloperRecord,
  type SubscriptionCacheRecord,
  type TransactionLogRecord,
  type UsageBufferRecord,
  type WebhookDeliveryRecord,
  type WebhookEndpointRecord,
} from "./schema.js";

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI
    ?? process.env.MONGO_URL;

  if (!uri) throw new Error("Missing env var: MONGODB_URI");
  return uri;
}

function getDatabaseName(uri: string): string {
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
  try {
    const parsed = new URL(uri);
    const name = parsed.pathname.replace(/^\/+/, "");
    return name || "invoq";
  } catch {
    return "invoq";
  }
}

declare global {
  var __mongoClient: MongoClient | undefined;
  var __mongoDbPromise: Promise<Db> | undefined;
}

function getClient(): MongoClient {
  if (!globalThis.__mongoClient) {
    globalThis.__mongoClient = new MongoClient(getMongoUri(), {
      maxPoolSize: 10,
    });
  }
  return globalThis.__mongoClient;
}

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection<DeveloperRecord>("developers").createIndexes([
      { key: { stellarAddress: 1 }, unique: true, name: "developers_stellar_address_idx" },
      { key: { email: 1 }, unique: true, name: "developers_email_idx" },
    ]),
    db.collection<ApiKeyRecord>("api_keys").createIndexes([
      { key: { keyHash: 1 }, unique: true, name: "api_keys_hash_idx" },
      { key: { developerId: 1 }, name: "api_keys_developer_idx" },
    ]),
    db.collection<WebhookEndpointRecord>("webhook_endpoints").createIndexes([
      { key: { developerId: 1 }, name: "webhook_endpoints_developer_idx" },
    ]),
    db.collection<WebhookDeliveryRecord>("webhook_deliveries").createIndexes([
      { key: { endpointId: 1 }, name: "webhook_deliveries_endpoint_idx" },
      { key: { developerId: 1 }, name: "webhook_deliveries_developer_idx" },
      { key: { status: 1 }, name: "webhook_deliveries_status_idx" },
      { key: { nextRetryAt: 1 }, name: "webhook_deliveries_next_retry_idx" },
    ]),
    db.collection<SubscriptionCacheRecord>("subscription_cache").createIndexes([
      { key: { customerAddress: 1 }, unique: true, name: "subscription_cache_customer_idx" },
      { key: { developerId: 1 }, name: "sub_cache_developer_idx" },
      { key: { developerAddress: 1 }, name: "sub_cache_developer_address_idx" },
      { key: { currentPeriodEnd: 1 }, name: "sub_cache_period_end_idx" },
      { key: { status: 1 }, name: "sub_cache_status_idx" },
    ]),
    db.collection<UsageBufferRecord>("usage_buffer").createIndexes([
      { key: { customerAddress: 1 }, name: "usage_buffer_customer_idx" },
      { key: { flushedAt: 1 }, name: "usage_buffer_unflushed_idx" },
    ]),
    db.collection<TransactionLogRecord>("transaction_log").createIndexes([
      { key: { txHash: 1 }, unique: true, name: "tx_log_hash_idx" },
      { key: { developerId: 1 }, name: "tx_log_developer_idx" },
      { key: { method: 1 }, name: "tx_log_method_idx" },
    ]),
  ]);
}

async function getDb(): Promise<Db> {
  if (!globalThis.__mongoDbPromise) {
    globalThis.__mongoDbPromise = (async () => {
      const client = getClient();
      await client.connect();
      const db = client.db(getDatabaseName(getMongoUri()));
      await ensureIndexes(db);
      return db;
    })();
  }

  return globalThis.__mongoDbPromise;
}

async function col<T extends Document>(name: string): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}

function stripId<T extends { _id?: unknown }>(doc: T | null): Omit<T, "_id"> | null {
  if (!doc) return null;
  const rest = { ...doc };
  delete rest._id;
  return rest;
}

// ─── Developers ──────────────────────────────────────────────────────────────

export async function findDeveloperByStellarAddress(stellarAddress: string): Promise<DeveloperRecord | null> {
  return stripId(await (await col<DeveloperRecord & { _id: string }>("developers")).findOne({ stellarAddress }));
}

export async function findDeveloperByEmail(email: string): Promise<DeveloperRecord | null> {
  return stripId(await (await col<DeveloperRecord & { _id: string }>("developers")).findOne({ email }));
}

export async function findDeveloperById(id: string): Promise<DeveloperRecord | null> {
  return stripId(await (await col<DeveloperRecord & { _id: string }>("developers")).findOne({ _id: id }));
}

export async function createDeveloper(doc: DeveloperRecord): Promise<void> {
  await (await col<DeveloperRecord & { _id: string }>("developers")).insertOne({ _id: doc.id, ...doc });
}

export async function updateDeveloper(id: string, patch: Partial<Omit<DeveloperRecord, "id">>): Promise<void> {
  await (await col<DeveloperRecord & { _id: string }>("developers")).updateOne(
    { _id: id },
    { $set: patch },
  );
}

// ─── API Keys ────────────────────────────────────────────────────────────────

export async function createApiKeyRecord(doc: ApiKeyRecord): Promise<void> {
  await (await col<ApiKeyRecord & { _id: string }>("api_keys")).insertOne({ _id: doc.id, ...doc });
}

export async function revokeApiKeyRecord(keyId: string, developerId: string): Promise<void> {
  await (await col<ApiKeyRecord & { _id: string }>("api_keys")).updateOne(
    { _id: keyId, developerId },
    { $set: { revoked: true } },
  );
}

export async function markApiKeyUsed(keyId: string): Promise<void> {
  await (await col<ApiKeyRecord & { _id: string }>("api_keys")).updateOne(
    { _id: keyId },
    { $set: { lastUsedAt: new Date() } },
  );
}

export async function findApiKeyWithDeveloperByHash(hash: string): Promise<{
  keyId: string;
  developerId: string;
  revoked: boolean;
  expiresAt: Date | null;
  stellarAddress: string;
} | null> {
  const keys = await col<ApiKeyRecord & { _id: string }>("api_keys");
  const key = await keys.findOne({ keyHash: hash });
  if (!key) return null;

  const dev = await findDeveloperById(key.developerId);
  if (!dev) return null;

  return {
    keyId: key._id,
    developerId: key.developerId,
    revoked: key.revoked,
    expiresAt: key.expiresAt ?? null,
    stellarAddress: dev.stellarAddress,
  };
}

export async function listApiKeysByDeveloper(developerId: string): Promise<ApiKeyRecord[]> {
  return (await (await col<ApiKeyRecord & { _id: string }>("api_keys"))
    .find({ developerId })
    .sort({ createdAt: -1 })
    .toArray())
    .map((row) => {
      return stripId(row) as ApiKeyRecord;
    });
}

export async function findRevokedApiKey(keyId: string, developerId: string): Promise<{ id: string } | null> {
  const row = await (await col<ApiKeyRecord & { _id: string }>("api_keys")).findOne({ _id: keyId, developerId, revoked: true });
  return row ? { id: row._id } : null;
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

export async function createWebhookEndpoint(doc: WebhookEndpointRecord): Promise<WebhookEndpointRecord> {
  await (await col<WebhookEndpointRecord & { _id: string }>("webhook_endpoints")).insertOne({ _id: doc.id, ...doc });
  return doc;
}

export async function listWebhookEndpointsByDeveloper(developerId: string): Promise<WebhookEndpointRecord[]> {
  return (await (await col<WebhookEndpointRecord & { _id: string }>("webhook_endpoints"))
    .find({ developerId })
    .toArray())
    .map((row) => {
      return stripId(row) as WebhookEndpointRecord;
    });
}

export async function deleteWebhookEndpoint(endpointId: string, developerId: string): Promise<void> {
  await (await col<WebhookEndpointRecord & { _id: string }>("webhook_endpoints")).deleteOne({ _id: endpointId, developerId });
}

export async function createWebhookDelivery(doc: WebhookDeliveryRecord): Promise<void> {
  await (await col<WebhookDeliveryRecord & { _id: string }>("webhook_deliveries")).insertOne({ _id: doc.id, ...doc });
}

export async function listWebhookDeliveriesByDeveloper(developerId: string): Promise<WebhookDeliveryRecord[]> {
  return (await (await col<WebhookDeliveryRecord & { _id: string }>("webhook_deliveries"))
    .find({ developerId })
    .sort({ createdAt: -1 })
    .toArray())
    .map((row) => {
      return stripId(row) as WebhookDeliveryRecord;
    });
}

export async function updateWebhookDelivery(
  deliveryId: string,
  patch: Partial<Omit<WebhookDeliveryRecord, "id">>,
): Promise<void> {
  await (await col<WebhookDeliveryRecord & { _id: string }>("webhook_deliveries")).updateOne(
    { _id: deliveryId },
    { $set: patch },
  );
}

export async function findWebhookEndpointsForDeveloper(developerId: string): Promise<WebhookEndpointRecord[]> {
  return listWebhookEndpointsByDeveloper(developerId);
}

// ─── Subscription Cache ──────────────────────────────────────────────────────

export async function upsertSubscriptionCache(record: SubscriptionCacheRecord): Promise<void> {
  await (await col<SubscriptionCacheRecord>("subscription_cache")).updateOne(
    { customerAddress: record.customerAddress },
    { $set: { ...record } },
    { upsert: true },
  );
}

export async function updateSubscriptionCache(
  customerAddress: string,
  patch: Partial<Omit<SubscriptionCacheRecord, "customerAddress">>,
): Promise<void> {
  await (await col<SubscriptionCacheRecord>("subscription_cache")).updateOne(
    { customerAddress },
    { $set: patch },
  );
}

export async function findSubscriptionCacheByCustomer(customerAddress: string): Promise<SubscriptionCacheRecord | null> {
  return (await (await col<SubscriptionCacheRecord & { _id?: string }>("subscription_cache")).findOne({ customerAddress })) as SubscriptionCacheRecord | null;
}

export async function listSubscriptionCacheByDeveloperAddress(developerAddress: string): Promise<SubscriptionCacheRecord[]> {
  return (await (await col<SubscriptionCacheRecord & { _id?: string }>("subscription_cache"))
    .find({ developerAddress })
    .sort({ syncedAt: -1 })
    .toArray()) as SubscriptionCacheRecord[];
}

export async function listSubscriptionCacheByDeveloperId(developerId: string): Promise<SubscriptionCacheRecord[]> {
  return (await (await col<SubscriptionCacheRecord & { _id?: string }>("subscription_cache"))
    .find({ developerId })
    .toArray()) as SubscriptionCacheRecord[];
}

export async function listSubscriptionCustomerAddressesByDeveloperAddress(developerAddress: string): Promise<string[]> {
  const rows = await listSubscriptionCacheByDeveloperAddress(developerAddress);
  return rows.map((row) => row.customerAddress);
}

export async function listDueSubscriptions(before: Date): Promise<SubscriptionCacheRecord[]> {
  return (await (await col<SubscriptionCacheRecord & { _id?: string }>("subscription_cache"))
    .find({ currentPeriodEnd: { $lt: before } })
    .toArray()) as SubscriptionCacheRecord[];
}

export async function listTrialingSubscriptions(): Promise<SubscriptionCacheRecord[]> {
  return (await (await col<SubscriptionCacheRecord & { _id?: string }>("subscription_cache"))
    .find({ status: "Trialing" })
    .toArray()) as SubscriptionCacheRecord[];
}

// ─── Usage Buffer ────────────────────────────────────────────────────────────

export async function insertUsageBufferBatch(rows: UsageBufferRecord[]): Promise<void> {
  if (rows.length === 0) return;
  await (await col<UsageBufferRecord & { _id: string }>("usage_buffer")).insertMany(
    rows.map((row) => ({ _id: row.id, ...row })),
  );
}

// ─── Transaction log ─────────────────────────────────────────────────────────

export async function listTransactionLogByDeveloper(developerId: string, limit = 50): Promise<TransactionLogRecord[]> {
  return (await (await col<TransactionLogRecord & { _id: string }>("transaction_log"))
    .find({ developerId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray())
    .map((row) => {
      return stripId(row) as TransactionLogRecord;
    });
}

// ─── Health ──────────────────────────────────────────────────────────────────

export async function pingDatabase(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a random UUID (works in Node.js 14.17+ and browsers) */
export function newId(): string {
  return crypto.randomUUID();
}

/** Returns current UTC timestamp as a JS Date */
export function now(): Date {
  return new Date();
}

/** Converts a Unix seconds timestamp (bigint from Stellar) to a JS Date */
export function fromUnixSeconds(seconds: bigint): Date {
  return new Date(Number(seconds) * 1000);
}

/** Converts a JS Date to Unix seconds bigint (for Stellar contract args) */
export function toUnixSeconds(date: Date): bigint {
  return BigInt(Math.floor(date.getTime() / 1000));
}

export * from "./schema.js";
