/**
 * src/routes/checkout.ts
 *
 * POST /v1/checkout/build-tx
 *   → Builds unsigned initiate_subscription XDR.
 *   → Frontend presents to customer wallet (Freighter etc.) for signing.
 *
 * POST /v1/checkout/submit-tx
 *   → Receives customer-signed XDR, wraps in fee bump, submits to Stellar.
 *   → Invoq pays the transaction fee. Customer pays only USDC.
 *
 * POST /v1/checkout/build-vault-tx
 *   → Builds unsigned create_vault XDR for customer to sign.
 *
 * POST /v1/checkout/submit-vault-tx
 *   → Receives customer-signed vault creation XDR, wraps in fee bump, submits to Stellar.
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  buildSubscribeTxXdr,
  buildCreateVaultTxXdr,
  wrapAndSubmit,
  verifyInnerTxSigner,
} from "../lib/stellar/feeBump.js";
import { getNetworkPassphrase } from "../lib/stellar/client.js";
import { db, subscriptionCache, newId, now } from "../lib/db/index.js";
import { invalidateEntitlementCache } from "../lib/cache/redis.js";
import { getSubscription } from "../lib/stellar/registry.js";
import { fromUnixSeconds } from "../lib/db/index.js";
import { fireWebhook } from "../services/webhook.js";

const router = Router();

// POST /v1/checkout/build-tx
// body: { customerAddress: string, planId: string }
router.post(
  "/build-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { customerAddress, planId } = req.body;

    if (!customerAddress || !planId) {
      res.status(400).json({ error: "customerAddress and planId required" });
      return;
    }

    const result = await buildSubscribeTxXdr(customerAddress, BigInt(planId));

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ xdr: result.xdr });
  })
);

// POST /v1/checkout/submit-tx
// body: { signedXdr: string, customerAddress: string, planId: string }
router.post(
  "/submit-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    const { signedXdr, customerAddress, planId } = req.body;

    if (!signedXdr || !customerAddress || !planId) {
      res.status(400).json({ error: "signedXdr, customerAddress, planId required" });
      return;
    }

    // Verify inner tx was actually signed by the customer — prevents malicious XDR
    const passphrase = getNetworkPassphrase();
    const signerValid = verifyInnerTxSigner(signedXdr, customerAddress, passphrase);
    if (!signerValid) {
      res.status(400).json({ error: "Transaction signature does not match customerAddress" });
      return;
    }

    const result = await wrapAndSubmit(signedXdr);

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    // Sync subscription cache from chain
    const sub = await getSubscription(customerAddress);
    if (sub && developerAddress) {
      await db
        .insert(subscriptionCache)
        .values({
          customerAddress,
          planId:             Number(planId),
          developerId:        res.locals.auth.developerId!,
          developerAddress,
          status:             sub.status,
          currentPeriodStart: fromUnixSeconds(sub.current_period_start),
          currentPeriodEnd:   fromUnixSeconds(sub.current_period_end),
          cancelAtPeriodEnd:  sub.cancel_at_period_end,
          usageCurrent:       Number(sub.usage_current),
          syncedAt:           now(),
        })
        .onConflictDoUpdate({
          target: subscriptionCache.customerAddress,
          set: {
            status:             sub.status,
            currentPeriodStart: fromUnixSeconds(sub.current_period_start),
            currentPeriodEnd:   fromUnixSeconds(sub.current_period_end),
            usageCurrent:       Number(sub.usage_current),
            syncedAt:           now(),
          },
        });
    }

    // Bust entitlement cache
    await invalidateEntitlementCache(customerAddress);

    // Fire subscription.created webhook
    if (sub && res.locals.auth.developerId) {
      try {
        await fireWebhook({
          developerId: res.locals.auth.developerId,
          event:       "subscription.created",
          payload: {
            customer:  customerAddress,
            planId:    String(planId),
            txHash:    result.txHash,
            status:    sub.status,
            periodEnd: sub.current_period_end.toString(),
          },
        });
      } catch (err) {
        // Webhook failure must not break the response
        console.error("[checkout] subscription.created webhook failed:", err);
      }
    }

    res.json({ txHash: result.txHash });
  })
);

// POST /v1/checkout/build-vault-tx
// body: { customerAddress, developerAddress, initialDeposit, lowBalanceThreshold, autoTopupAmount }
router.post(
  "/build-vault-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const {
      customerAddress,
      developerAddress,
      initialDeposit,
      lowBalanceThreshold,
      autoTopupAmount,
    } = req.body;

    if (!customerAddress || !developerAddress || initialDeposit === undefined) {
      res.status(400).json({
        error: "customerAddress, developerAddress, initialDeposit required",
      });
      return;
    }

    const result = await buildCreateVaultTxXdr({
      customerAddress,
      developerAddress,
      initialDeposit:      BigInt(initialDeposit),
      lowBalanceThreshold: BigInt(lowBalanceThreshold ?? 0),
      autoTopupAmount:     BigInt(autoTopupAmount ?? 0),
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ xdr: result.xdr });
  })
);

// POST /v1/checkout/submit-vault-tx
// body: { signedXdr: string, customerAddress: string }
router.post(
  "/submit-vault-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { signedXdr, customerAddress } = req.body;

    if (!signedXdr || !customerAddress) {
      res.status(400).json({ error: "signedXdr, customerAddress required" });
      return;
    }

    // Verify inner tx was actually signed by the customer
    const passphrase = getNetworkPassphrase();
    const signerValid = verifyInnerTxSigner(signedXdr, customerAddress, passphrase);
    if (!signerValid) {
      res.status(400).json({ error: "Transaction signature does not match customerAddress" });
      return;
    }

    const result = await wrapAndSubmit(signedXdr);

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    // Fire vault.created webhook (best-effort)
    if (res.locals.auth.developerId) {
      try {
        await fireWebhook({
          developerId: res.locals.auth.developerId,
          event:       "vault.created",
          payload: {
            customer:  customerAddress,
            developer: res.locals.auth.developerAddress,
            txHash:    result.txHash,
          },
        });
      } catch (err) {
        console.error("[checkout] vault.created webhook failed:", err);
      }
    }

    res.json({ txHash: result.txHash });
  })
);

export default router;