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
 */

import {
  getPendingUsageCustomers,
  drainUsageBuffer,
} from "../lib/cache/redis.js";
import { incrementUsageBatch } from "../lib/stellar/registry.js";
import { db, usageBuffer, newId, now } from "../lib/db/index.js";

const BATCH_SIZE = 50;

export async function flushUsageBuffer(): Promise<{
  flushed: number;
  batches: number;
  error: string | null;
}> {
  const customers = await getPendingUsageCustomers();

  if (customers.length === 0) {
    return { flushed: 0, batches: 0, error: null };
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
    return { flushed: 0, batches: 0, error: null };
  }

  // Split into batches of 50
  const batches: typeof entries[] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    batches.push(entries.slice(i, i + BATCH_SIZE));
  }

  let flushed = 0;
  let lastError: string | null = null;

  for (const batch of batches) {
    const result = await incrementUsageBatch(batch);

    if (result.error) {
      lastError = result.error;
      console.error("[metering] batch flush failed:", result.error);
      continue;
    }

    // Audit trail rows
    await db.insert(usageBuffer).values(
      batch.map((e) => ({
        id:              newId(),
        customerAddress: e.customer,
        developerId:     "system",
        units:           e.units,
        flushedAt:       now(),
        txHash:          result.txHash ?? null,
        createdAt:       now(),
      }))
    );

    flushed += batch.length;
  }

  return { flushed, batches: batches.length, error: lastError };
}