/**
 * src/services/metering.ts
 *
 * Drains the Redis usage buffer and submits batched usage to the chain.
 * Called by the usage-flush job every 5 seconds.
 *
 * Flow:
 *   1. Scan Redis for all usage_buf:* keys
 *   2. Drain each buffer atomically
 *   3. Split into batches of 50 (contract limit)
 *   4. Call incrementUsageBatch per batch
 *   5. Insert usageBuffer rows as audit trail
 *   6. Fire usage.threshold webhooks for customers that crossed 50/80/95% of
 *      their plan's usage_limit (deduped per period in Redis).
 */

import {
  getPendingUsageCustomers,
  drainUsageBuffer,
  setUsageThreshold,
  getUsageThreshold,
} from "../lib/cache/redis.js";
import { incrementUsageBatch, getSubscription, checkEntitlementFull } from "../lib/stellar/registry.js";
import {
  insertUsageBufferBatch,
  findSubscriptionCacheByCustomer,
  newId,
  now,
} from "../lib/db/index.js";
import { fireWebhook } from "./webhook.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("metering");

const BATCH_SIZE = 50;
const THRESHOLDS = [50, 80, 95] as const;

export async function flushUsageBuffer(): Promise<{
  flushed: number;
  batches: number;
  thresholdEvents: number;
  error: string | null;
}> {
  const customers = await getPendingUsageCustomers();

  if (customers.length === 0) {
    return { flushed: 0, batches: 0, thresholdEvents: 0, error: null };
  }

  // Drain all buffers
  const entries: { customer: string; units: bigint }[] = [];

  for (const customer of customers) {
    const units = await drainUsageBuffer(customer);
    if (units > 0) {
      entries.push({ customer, units: BigInt(units) });
    }
  }

  if (entries.length === 0) {
    return { flushed: 0, batches: 0, thresholdEvents: 0, error: null };
  }

  // Split into batches of 50
  const batches: typeof entries[] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    batches.push(entries.slice(i, i + BATCH_SIZE));
  }

  let flushed = 0;
  let lastError: string | null = null;
  const affectedCustomers = new Set<string>();

  for (const batch of batches) {
    const result = await incrementUsageBatch(batch);

    if (result.error) {
      lastError = result.error;
      console.error("[metering] batch flush failed:", result.error);
      continue;
    }

    // Audit trail rows
    await insertUsageBufferBatch(
      batch.map((e) => ({
        id:              newId(),
        customerAddress: e.customer,
        developerId:     "system",
        units:           Number(e.units),
        flushedAt:       now(),
        txHash:          result.txHash ?? null,
        createdAt:       now(),
      }))
    );

    for (const e of batch) affectedCustomers.add(e.customer);
    flushed += batch.length;
  }

  // ── Threshold webhooks (best-effort, sequential per customer) ───────────
  let thresholdEvents = 0;
  if (affectedCustomers.size > 0) {
    for (const customer of affectedCustomers) {
      try {
        await maybeFireUsageThreshold(customer);
      } catch (err) {
        log.warn("usage threshold check failed", { customer, err: String(err) });
      }
    }
  }

  return { flushed, batches: batches.length, thresholdEvents, error: lastError };
}

async function maybeFireUsageThreshold(customer: string): Promise<void> {
  const sub = await getSubscription(customer);
  if (!sub) return;
  if (sub.usage_current === 0n) return;

  // Look up the plan to read usage_limit (SubscriptionRecord doesn't carry it).
  // We use a representative feature flag — the contract only enforces limits
  // via the plan; we just need the numeric value.
  const full = await checkEntitlementFull(customer, "usage");
  if (!full) return;
  const limit = full.usage_limit;
  if (limit === 0n) return; // unlimited

  const pct = Math.floor(
    Number((sub.usage_current * 10000n) / limit) / 100
  );

  // Pick the highest threshold the customer has crossed this period
  let crossed: number | null = null;
  for (const t of THRESHOLDS) {
    if (pct >= t) crossed = t;
  }
  if (crossed === null) return;

  const periodKey = sub.current_period_end.toString();
  const lastEmitted = await getUsageThreshold(customer, periodKey);
  if (lastEmitted !== null && lastEmitted >= crossed) return; // already fired for this band

  // Mark in cache and fire webhook
  await setUsageThreshold(customer, periodKey, crossed);

  const row = await findSubscriptionCacheByCustomer(customer);
  if (!row || !row.developerId) return;

  await fireWebhook({
    developerId: row.developerId,
    event:       "usage.threshold",
    payload: {
      customer:     customer,
      planId:       sub.plan_id.toString(),
      usageCurrent: sub.usage_current.toString(),
      usageLimit:   limit.toString(),
      thresholdPct: crossed,
    },
  });
}
