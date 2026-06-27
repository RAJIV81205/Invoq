import { lt, eq, and } from "drizzle-orm";
import { db, subscriptionCache, now } from "../lib/db/index.js";
import { processRenewals, expireGracePeriods, retryPayment } from "../lib/stellar/billing.js";
import {
  getGracePeriodCustomers,
  clearGracePeriod,
  invalidateEntitlementCache,
  getTrialWarned,
  setTrialWarned,
} from "../lib/cache/redis.js";
import { fireWebhook } from "./webhook.js";
import { getSubscription } from "../lib/stellar/registry.js";
import { fromUnixSeconds } from "../lib/db/index.js";
import { createLogger } from "../lib/logger.js";

const log             = createLogger("billing");
const RENEWAL_BATCH   = 30;
const GRACE_BATCH     = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Renewal cycle — called every 60s by the renewal job
// ─────────────────────────────────────────────────────────────────────────────
export async function runRenewalCycle(): Promise<void> {
  const cycleStart = Date.now();

  const due = await db
    .select()
    .from(subscriptionCache)
    .where(lt(subscriptionCache.currentPeriodEnd, now()));

  if (due.length === 0) {
    log.debug("renewal cycle: no subscriptions due");
    return;
  }

  log.info("renewal cycle: subscriptions due", { count: due.length });

  let renewed       = 0;
  let failed        = 0;
  let contractErrors = 0;

  for (let i = 0; i < due.length; i += RENEWAL_BATCH) {
    const batch     = due.slice(i, i + RENEWAL_BATCH);
    const customers = batch.map((r) => r.customerAddress);
    const batchIdx  = Math.floor(i / RENEWAL_BATCH) + 1;

    log.info("renewal batch: submitting", {
      batch:     batchIdx,
      customers: customers.length,
      addresses: customers,
    });

    const result = await processRenewals(customers);

    if (result.error) {
      log.error("renewal batch: contract call failed", {
        batch:  batchIdx,
        error:  result.error,
        txHash: result.txHash,
      });
      contractErrors++;
      continue;
    }

    log.info("renewal batch: contract call succeeded", {
      batch:   batchIdx,
      txHash:  result.txHash,
      summary: result.summary,
    });

    for (const row of batch) {
      const sub = await getSubscription(row.customerAddress);
      if (!sub) {
        log.warn("renewal batch: subscription not found after renewal", {
          customer: row.customerAddress,
        });
        continue;
      }

      const succeeded = sub.status === "Active";

      await db
        .update(subscriptionCache)
        .set({
          status:             sub.status,
          currentPeriodStart: fromUnixSeconds(sub.current_period_start),
          currentPeriodEnd:   fromUnixSeconds(sub.current_period_end),
          usageCurrent:       Number(sub.usage_current),
          syncedAt:           now(),
        })
        .where(eq(subscriptionCache.customerAddress, row.customerAddress));

      await invalidateEntitlementCache(row.customerAddress);

      const event = succeeded ? "payment.renewed" : "payment.failed";

      log.info("renewal: subscription updated", {
        customer:  row.customerAddress,
        planId:    row.planId,
        oldStatus: row.status,
        newStatus: sub.status,
        event,
      });

      await fireWebhook({
        developerId: row.developerId,
        event,
        payload: {
          customer:  row.customerAddress,
          planId:    row.planId.toString(),
          txHash:    result.txHash,
          status:    sub.status,
          periodEnd: sub.current_period_end.toString(),
        },
      });

      succeeded ? renewed++ : failed++;
    }
  }

  log.info("renewal cycle: complete", {
    durationMs:     Date.now() - cycleStart,
    total:          due.length,
    renewed,
    failed,
    contractErrors,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Grace expiry — called every 15min by the grace-expiry job
// ─────────────────────────────────────────────────────────────────────────────
export async function runGraceExpiry(): Promise<void> {
  const cycleStart = Date.now();
  const customers  = await getGracePeriodCustomers();

  if (customers.length === 0) {
    log.debug("grace expiry: no customers in grace period");
    return;
  }

  log.info("grace expiry: checking customers", { count: customers.length });

  let expired        = 0;
  let contractErrors = 0;

  for (let i = 0; i < customers.length; i += GRACE_BATCH) {
    const batch    = customers.slice(i, i + GRACE_BATCH);
    const batchIdx = Math.floor(i / GRACE_BATCH) + 1;

    log.info("grace expiry batch: submitting", {
      batch:     batchIdx,
      customers: batch.length,
    });

    const result = await expireGracePeriods(batch);

    if (result.error) {
      log.error("grace expiry batch: contract call failed", {
        batch:  batchIdx,
        error:  result.error,
        txHash: result.txHash,
      });
      contractErrors++;
      continue;
    }

    log.info("grace expiry batch: contract call succeeded", {
      batch:   batchIdx,
      expired: result.expired,
      txHash:  result.txHash,
    });

    for (const customer of batch) {
      await clearGracePeriod(customer);
      await invalidateEntitlementCache(customer);

      const cacheRow = await db
        .select()
        .from(subscriptionCache)
        .where(eq(subscriptionCache.customerAddress, customer))
        .limit(1);

      if (cacheRow.length === 0 || !cacheRow[0]) {
        log.warn("grace expiry: no cache row found for customer", { customer });
        continue;
      }

      const row = cacheRow[0];

      await db
        .update(subscriptionCache)
        .set({ status: "Cancelled", syncedAt: now() })
        .where(eq(subscriptionCache.customerAddress, customer));

      log.info("grace expiry: subscription cancelled", {
        customer,
        planId:    row.planId,
        developerId: row.developerId,
      });

      await fireWebhook({
        developerId: row.developerId,
        event:       "subscription.cancelled",
        payload: {
          customer,
          planId: row.planId.toString(),
          reason: "grace_period_expired",
        },
      });

      expired++;
    }
  }

  log.info("grace expiry: complete", {
    durationMs:     Date.now() - cycleStart,
    total:          customers.length,
    expired,
    contractErrors,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trial-ending — fires trial.ending once per trial (Redis-deduped)
//
// Scans all active trial subscriptions and emits the event when the trial
// ends within the next 72 hours. Dedupe key in Redis.
// ─────────────────────────────────────────────────────────────────────────────
const TRIAL_WARNING_WINDOW_SECS = 72 * 60 * 60; // 72h

export async function runTrialEnding(): Promise<void> {
  const rows = await db
    .select()
    .from(subscriptionCache)
    .where(eq(subscriptionCache.status, "Trialing"));

  if (rows.length === 0) return;

  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  let fired = 0;

  for (const row of rows) {
    const sub = await getSubscription(row.customerAddress);
    if (!sub || sub.trial_end === 0n) continue;

    const remaining = sub.trial_end - nowSecs;
    if (remaining <= 0n || remaining > BigInt(TRIAL_WARNING_WINDOW_SECS)) continue;

    const dedupeKey = sub.trial_end.toString();
    const lastFired = await getTrialWarned(row.customerAddress);
    if (lastFired === dedupeKey) continue;

    await setTrialWarned(row.customerAddress, dedupeKey);

    await fireWebhook({
      developerId: row.developerId,
      event:       "trial.ending",
      payload: {
        customer:  row.customerAddress,
        planId:    sub.plan_id.toString(),
        trialEnd:  sub.trial_end.toString(),
        remaining: remaining.toString(),
      },
    });
    fired++;
  }

  if (fired > 0) {
    log.info("trial.ending fired", { count: fired, scanned: rows.length });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry cycle — retries payments for GracePeriod customers whose grace
// window still has >= 12h. Fires payment.retry_succeeded on success.
// ─────────────────────────────────────────────────────────────────────────────
const RETRY_MIN_REMAINING_SECS = 12 * 60 * 60; // 12h

export async function runRetryCycle(): Promise<void> {
  const cycleStart = Date.now();
  const customers  = await getGracePeriodCustomers();

  if (customers.length === 0) {
    log.debug("retry cycle: no grace customers");
    return;
  }

  log.info("retry cycle: candidates", { count: customers.length });

  let succeeded = 0;
  let failed    = 0;

  for (const customer of customers) {
    const sub = await getSubscription(customer);
    if (!sub || sub.status !== "GracePeriod") continue;

    // Only retry if the grace window still has enough time
    const nowSecs = BigInt(Math.floor(Date.now() / 1000));
    if (sub.current_period_end === 0n) continue;
    const remaining = sub.current_period_end - nowSecs;
    if (remaining < BigInt(RETRY_MIN_REMAINING_SECS)) continue;

    const result = await retryPayment(customer);

    if (result.error) {
      failed++;
      log.warn("retry cycle: retryPayment failed", { customer, error: result.error });
      continue;
    }

    if (result.succeeded === true) {
      await clearGracePeriod(customer);
      await invalidateEntitlementCache(customer);

      // Refresh cache from chain
      const fresh = await getSubscription(customer);
      if (fresh) {
        await db
          .update(subscriptionCache)
          .set({
            status:             fresh.status,
            currentPeriodStart: fromUnixSeconds(fresh.current_period_start),
            currentPeriodEnd:   fromUnixSeconds(fresh.current_period_end),
            usageCurrent:       Number(fresh.usage_current),
            syncedAt:           now(),
          })
          .where(eq(subscriptionCache.customerAddress, customer));
      }

      const cacheRow = await db
        .select()
        .from(subscriptionCache)
        .where(eq(subscriptionCache.customerAddress, customer))
        .limit(1);
      const row = cacheRow[0];
      if (row) {
        await fireWebhook({
          developerId: row.developerId,
          event:       "payment.retry_succeeded",
          payload: {
            customer:  customer,
            planId:    sub.plan_id.toString(),
            txHash:    result.txHash,
            periodEnd: sub.current_period_end.toString(),
          },
        });
      }
      succeeded++;
    } else {
      failed++;
    }
  }

  log.info("retry cycle: complete", {
    durationMs: Date.now() - cycleStart,
    total:      customers.length,
    succeeded,
    failed,
  });
}