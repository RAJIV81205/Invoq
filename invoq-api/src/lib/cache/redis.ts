/**
 * src/lib/cache/redis.ts
 *
 * Upstash Redis client + caching helpers for Invoq.
 */

import { Redis } from "@upstash/redis";

// ─────────────────────────────────────────────────────────────────────────────
// Singleton client
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  var __redis: Redis | undefined;
}

function getRedis(): Redis {
  if (!globalThis.__redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url) {
      throw new Error("Missing env var: UPSTASH_REDIS_REST_URL");
    }

    if (!token) {
      throw new Error("Missing env var: UPSTASH_REDIS_REST_TOKEN");
    }

    globalThis.__redis = new Redis({
      url,
      token,
    });
  }

  return globalThis.__redis;
}

export function redis(): Redis {
  return getRedis();
}

/**
 * Get Redis connection config for BullMQ.
 * BullMQ expects ioredis-compatible connection options, not Upstash Redis client.
 */
export function getRedisConnectionConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Missing Redis environment variables");
  }

  // Parse the Upstash REST URL to extract host and port
  const urlObj = new URL(url);
  
  return {
    host: urlObj.hostname,
    port: parseInt(urlObj.port || '443'),
    password: token,
    tls: urlObj.protocol === 'https:' ? {} : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TTL constants
// ─────────────────────────────────────────────────────────────────────────────

const ENTITLEMENT_TTL_SECONDS = 10;
const USAGE_BUFFER_TTL_SECONDS = 300;

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
};

// ─────────────────────────────────────────────────────────────────────────────
// Entitlement cache
// ─────────────────────────────────────────────────────────────────────────────

export async function getCachedEntitlement(
  customer: string,
  feature: string
): Promise<boolean | null> {
  const val = await redis().get<string>(
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
    {
      ex: ENTITLEMENT_TTL_SECONDS,
    }
  );
}

/**
 * Invalidate entitlement cache for a customer.
 *
 * Upstash supports scan().
 */
export async function invalidateEntitlementCache(
  customer: string
): Promise<void> {
  const pattern = `ent:${customer}:*`;

  let cursor = 0;

  do {
    const [nextCursor, foundKeys] = await redis().scan(
      cursor,
      {
        match: pattern,
        count: 100,
      }
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
 *
 * Upstash doesn't support EVAL in all plans reliably,
 * so use MULTI transaction instead.
 */
export async function drainUsageBuffer(
  customer: string
): Promise<number> {
  const key = keys.usageBuffer(customer);

  const current = await redis().get<string>(key);

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
      {
        match: "usage_buf:*",
        count: 200,
      }
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
    {
      ex: ttl,
    }
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
      {
        match: "grace:*",
        count: 200,
      }
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

export async function pingRedis(): Promise<boolean> {
  try {
    const result = await redis().ping();

    return result === "PONG";
  } catch {
    return false;
  }
}