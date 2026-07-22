/**
 * src/lib/cache/redis.ts
 *
 * Local Redis client + caching helpers for Invoq.
 */

import RedisModule from "ioredis";
import type { Redis as RedisClient, RedisOptions } from "ioredis";

// ─────────────────────────────────────────────────────────────────────────────
// Singleton client
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  var __redis: RedisClient | undefined;
}

const Redis = RedisModule as unknown as new (options?: RedisOptions) => RedisClient;

function buildRedisConfig(): RedisOptions {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const urlObj = new URL(redisUrl);
    return {
      host: urlObj.hostname,
      port: Number.parseInt(urlObj.port || "6379", 10),
      username: urlObj.username || undefined,
      password: urlObj.password || undefined,
      db: urlObj.pathname && urlObj.pathname !== "/" ? Number.parseInt(urlObj.pathname.slice(1), 10) : undefined,
      tls: urlObj.protocol === "rediss:" ? {} : undefined,
    };
  }

  return {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.REDIS_PORT ?? "6379", 10),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    db: process.env.REDIS_DB ? Number.parseInt(process.env.REDIS_DB, 10) : undefined,
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,
  };
}

function getRedis(): RedisClient {
  if (!globalThis.__redis) {
    globalThis.__redis = new Redis(buildRedisConfig());
  }

  return globalThis.__redis!;
}

export function redis(): RedisClient {
  return getRedis();
}

/**
 * Get Redis connection config for BullMQ.
 * BullMQ expects ioredis-compatible connection options.
 */
export function getRedisConnectionConfig() {
  return buildRedisConfig();
}

// ─────────────────────────────────────────────────────────────────────────────
// TTL constants
// ─────────────────────────────────────────────────────────────────────────────

const ENTITLEMENT_TTL_SECONDS = 10;
const USAGE_BUFFER_TTL_SECONDS = 300;
const DEVELOPER_PLANS_TTL_SECONDS = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Key builders
// ─────────────────────────────────────────────────────────────────────────────

const keys = {
  entitlement: (customer: string, feature: string) =>
    `ent:${customer}:${feature}`,

  usageBuffer: (customer: string) =>
    `usage_buf:${customer}`,

  gracePeriod: (customer: string) =>
    `grace:${customer}`,

  usageThreshold: (customer: string, periodEnd: string) =>
    `usage_thresh:${customer}:${periodEnd}`,

  trialWarned: (customer: string) =>
    `trial_warned:${customer}`,

  developerPlans: (developerAddress: string) =>
    `plans:${developerAddress}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Developer plan list cache
// ─────────────────────────────────────────────────────────────────────────────

export async function getCachedDeveloperPlans<T>(developerAddress: string): Promise<T | null> {
  try {
    const value = await redis().get(keys.developerPlans(developerAddress));
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function setCachedDeveloperPlans(
  developerAddress: string,
  plans: unknown,
): Promise<void> {
  try {
    await redis().set(
      keys.developerPlans(developerAddress),
      JSON.stringify(plans),
      "EX",
      DEVELOPER_PLANS_TTL_SECONDS,
    );
  } catch {
    // Cache outage must not break plan reads.
  }
}

export async function invalidateDeveloperPlans(developerAddress?: string | null): Promise<void> {
  if (!developerAddress) return;
  try {
    await redis().del(keys.developerPlans(developerAddress));
  } catch {
    // Cache outage must not turn a confirmed on-chain mutation into an error.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entitlement cache
// ─────────────────────────────────────────────────────────────────────────────

export async function getCachedEntitlement(
  customer: string,
  feature: string
): Promise<boolean | null> {
  const val = await redis().get(
    keys.entitlement(customer, feature)
  );

  if (val === null) return null;

  return val === "1";
}

export async function setCachedEntitlement(
  customer: string,
  feature: string,
  entitled: boolean
): Promise<void> {
  await redis().set(
    keys.entitlement(customer, feature),
    entitled ? "1" : "0",
    "EX",
    ENTITLEMENT_TTL_SECONDS,
  );
}

/**
 * Invalidate entitlement cache for a customer.
 */
export async function invalidateEntitlementCache(
  customer: string
): Promise<void> {
  const pattern = `ent:${customer}:*`;

  let cursor = 0;

  do {
    const [nextCursor, foundKeys] = await redis().scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );

    cursor = Number(nextCursor);

    if (foundKeys.length > 0) {
      await redis().del(...foundKeys);
    }
  } while (cursor !== 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage buffer
// ─────────────────────────────────────────────────────────────────────────────

export async function bufferUsage(
  customer: string,
  units: number
): Promise<number> {
  const key = keys.usageBuffer(customer);

  const val = await redis().incrby(key, units);

  await redis().expire(
    key,
    USAGE_BUFFER_TTL_SECONDS
  );

  return Number(val);
}

/**
 * Read and clear usage buffer.
 */
export async function drainUsageBuffer(
  customer: string
): Promise<number> {
  const key = keys.usageBuffer(customer);

  const current = await redis().get(key);

  if (!current) {
    return 0;
  }

  // Transaction
  await redis().multi()
    .del(key)
    .exec();

  return Number(current);
}

/**
 * Returns all customers with pending usage.
 */
export async function getPendingUsageCustomers(): Promise<string[]> {
  const customers: string[] = [];

  let cursor = 0;

  do {
    const [nextCursor, foundKeys] = await redis().scan(
      cursor,
      "MATCH",
      "usage_buf:*",
      "COUNT",
      200,
    );

    cursor = Number(nextCursor);

    for (const k of foundKeys) {
      customers.push(
        k.replace("usage_buf:", "")
      );
    }

  } while (cursor !== 0);

  return customers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grace period tracking
// ─────────────────────────────────────────────────────────────────────────────

export async function markGracePeriod(
  customer: string,
  graceExpiresAt: number
): Promise<void> {
  const ttl =
    graceExpiresAt -
    Math.floor(Date.now() / 1000) +
    3600;

  if (ttl <= 0) return;

  await redis().set(
    keys.gracePeriod(customer),
    graceExpiresAt.toString(),
    "EX",
    ttl,
  );
}

export async function clearGracePeriod(
  customer: string
): Promise<void> {
  await redis().del(
    keys.gracePeriod(customer)
  );
}

export async function getGracePeriodCustomers(): Promise<string[]> {
  const customers: string[] = [];

  let cursor = 0;

  do {
    const [nextCursor, foundKeys] = await redis().scan(
      cursor,
      "MATCH",
      "grace:*",
      "COUNT",
      200,
    );

    cursor = Number(nextCursor);

    for (const k of foundKeys) {
      customers.push(
        k.replace("grace:", "")
      );
    }

  } while (cursor !== 0);

  return customers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────

// ─── Usage threshold tracking ────────────────────────────────────────────────
//
// Stores the highest threshold band (50 / 80 / 95) already emitted for a
// customer in a given billing period. Prevents duplicate webhooks.
export async function getUsageThreshold(
  customer: string,
  periodEnd: string,
): Promise<number | null> {
  const v = await redis().get(keys.usageThreshold(customer, periodEnd));
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function setUsageThreshold(
  customer: string,
  periodEnd: string,
  thresholdPct: number,
): Promise<void> {
  // TTL slightly longer than the period so the entry expires after renewal.
  // Cap to 32 days (~billing period safety).
  await redis().set(
    keys.usageThreshold(customer, periodEnd),
    String(thresholdPct),
    "EX",
    60 * 60 * 24 * 32,
  );
}

// ─── Trial-ending dedupe ─────────────────────────────────────────────────────
//
// Once a customer's trial.ending webhook has fired, we don't fire it again
// until the next trial_end timestamp.
export async function getTrialWarned(customer: string): Promise<string | null> {
  const v = await redis().get(keys.trialWarned(customer));
  return v ?? null;
}

export async function setTrialWarned(
  customer: string,
  trialEndUnix: string,
): Promise<void> {
  // TTL = 40 days — safe for a 30-day trial plus renewal cycle.
  await redis().set(
    keys.trialWarned(customer),
    trialEndUnix,
    "EX",
    60 * 60 * 24 * 40,
  );
}

export async function pingRedis(): Promise<boolean> {
  try {
    const result = await redis().ping();

    return typeof result === "string" && result.toUpperCase() === "PONG";
  } catch {
    return false;
  }
}
