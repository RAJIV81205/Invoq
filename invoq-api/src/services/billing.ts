/**
 * src/services/billing.ts
 *
 * Orchestrates the renewal cycle:
 *   1. Query subscriptionCache for due renewals
 *   2. Call processRenewals on BillingCycle contract (max 30 per batch)
 *   3. Fire payment.renewed or payment.failed webhooks
 *   4. Update subscriptionCache rows
 *
 * And grace expiry:
 *   1. Get grace period customers from Redis
 *   2. Call expireGracePeriods on BillingCycle contract
 *   3. Fire subscription.cancelled webhooks
 *   4. Invalidate entitlement cache
 */

import { lt, eq, inArray } from "drizzle-orm";
import { db, subscriptionCache, now } from "../lib/db/index.js";
import {
  processRenewals,
  expireGracePeriods,
} from "../lib/stellar/billing.js";
import {
  getGracePeriodCustomers,
  clearGracePeriod,
  invalidateEntitlementCache,
} from "../lib/cache/redis.js";
import { fireWebhook } from "./webhook.js";
import { getSubscription } from "../lib/stellar/registry.js";
import { fromUnixSeconds } from "../lib/db/index.js";

const RENEWAL_BATCH_SIZE = 30;
const GRACE_BATCH_SIZE   = 50;

// ─── Renewal ──────────────────────────────────────────────────────────────────

export async function runRenewalCycle(): Promise<void> {
  // Find all subscriptions whose period has ended
  const due = await db
    .select()
    .from(subscriptionCache)
    .where(lt(subscriptionCache.currentPeriodEnd, now()));

  if (due.length === 0) return;

  // Batch into groups of 30
  for (let i = 0; i < due.length; i += RENEWAL_BATCH_SIZE) {
    const batch = due.slice(i, i + RENEWAL_BATCH_SIZE);
    const customers = batch.map((r) => r.customerAddress);

    const result = await processRenewals(customers);

    if (result.error) {
      console.error("[billing] processRenewals error:", result.error);
      continue;
    }

    // Sync each customer's updated state from chain and fire webhooks
    for (const row of batch) {
      const sub = await getSubscription(row.customerAddress);
      if (!sub) continue;

      const succeeded = sub.status === "Active";

      // Update cache
      await db
        .update(subscriptionCache)
        .set({
          status:             sub.status,
          currentPeriodStart: fromUnixSeconds(sub.current_period_start),
          currentPeriodEnd:   fromUnixSeconds(sub.current_period_end),
          usageCurrent:       sub.usage_current,
          syncedAt:           now(),
        })
        .where(eq(subscriptionCache.customerAddress, row.customerAddress));

      // Bust entitlement cache
      await invalidateEntitlementCache(row.customerAddress);

      // Fire webhook
      await fireWebhook({
        developerId: row.developerId,
        event:       succeeded ? "payment.renewed" : "payment.failed",
        payload: {
          customer:  row.customerAddress,
          planId:    row.planId.toString(),
          txHash:    result.txHash,
          status:    sub.status,
          periodEnd: sub.current_period_end.toString(),
        },
      });
    }
  }
}

// ─── Grace expiry ─────────────────────────────────────────────────────────────

export async function runGraceExpiry(): Promise<void> {
  const customers = await getGracePeriodCustomers();
  if (customers.length === 0) return;

  for (let i = 0; i < customers.length; i += GRACE_BATCH_SIZE) {
    const batch = customers.slice(i, i + GRACE_BATCH_SIZE);

    const result = await expireGracePeriods(batch);

    if (result.error) {
      console.error("[billing] expireGracePeriods error:", result.error);
      continue;
    }

    // For each expired customer: clear Redis, invalidate entitlement, fire webhook
    for (const customer of batch) {
      await clearGracePeriod(customer);
      await invalidateEntitlementCache(customer);

      // Look up developerId from cache
      const cacheRow = await db
        .select()
        .from(subscriptionCache)
        .where(eq(subscriptionCache.customerAddress, customer))
        .limit(1);

      if (cacheRow.length === 0) continue;
      const row = cacheRow[0];

   
      await db
        .update(subscriptionCache)
        .set({ status: "Cancelled", syncedAt: now() })
        .where(eq(subscriptionCache.customerAddress, customer));

      await fireWebhook({
        developerId: row.developerId,
        event:       "subscription.cancelled",
        payload: {
          customer,
          planId: row.planId.toString(),
          reason: "grace_period_expired",
        },
      });
    }
  }
}