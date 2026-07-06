/**
 * src/routes/vault.ts
 *
 * GET    /v1/vault?customer=G...&developer=G...  → get vault record + balance
 * POST   /v1/vault/debit                         → debit vault (admin/metering)
 * POST   /v1/vault/withdraw                      → withdraw (customer-signed flow)
 * DELETE /v1/vault                               → close vault
 * PATCH  /v1/vault/threshold                     → update low-balance threshold
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  getVault,
  debitVault,
  withdraw,
  closeVault,
  updateThreshold,
} from "../lib/stellar/escrow-vault.js";
import {
  buildWithdrawVaultTxXdr,
  buildDepositVaultTxXdr,
  buildUpdateVaultThresholdTxXdr,
  wrapAndSubmit,
  verifyInnerTxSigner,
} from "../lib/stellar/feeBump.js";
import { getNetworkPassphrase } from "../lib/stellar/client.js";
import {
  listSubscriptionCustomerAddressesByDeveloperAddress,
} from "../lib/db/index.js";
import { createLogger } from "../lib/logger.js";
import { fireWebhook } from "../services/webhook.js";

const log = createLogger("vault");

const router = Router();

// GET /v1/vault?customer=G...&developer=G...
router.get(
  "/",
  authenticate(),
  asyncHandler(async (req, res) => {
    const customer  = req.query.customer  as string;
    const developer = req.query.developer as string;

    if (!customer || !developer) {
      res.status(400).json({ error: "customer and developer query params required" });
      return;
    }

    const vault = await getVault(customer, developer);

    if (!vault) {
      res.status(404).json({ error: "Vault not found" });
      return;
    }

    res.json({
      ...vault,
      balance_usdc:          vault.balance_usdc.toString(),
      total_deposited:       vault.total_deposited.toString(),
      total_debited:         vault.total_debited.toString(),
      low_balance_threshold: vault.low_balance_threshold.toString(),
      auto_topup_amount:     vault.auto_topup_amount.toString(),
      created_at:            vault.created_at.toString(),
    });
  })
);

// POST /v1/vault/debit
// body: { customer, developer, amount, usageDescription }
router.post(
  "/debit",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { customer, developer, amount, usageDescription } = req.body;

    if (!customer || !developer || amount === undefined) {
      res.status(400).json({ error: "customer, developer, amount required" });
      return;
    }

    const result = await debitVault({
      customer,
      developer,
      amount:           BigInt(amount),
      usageDescription: usageDescription ?? "",
    });

    if (result.error) {
      if (
        result.txHash &&
        result.error.includes("Transaction not confirmed after")
      ) {
        res.status(202).json({
          txHash: result.txHash,
          pending: true,
          warning: result.error,
        });
        return;
      }
      res.status(502).json({ error: result.error });
      return;
    }

    // Fire vault.low_balance webhook if the new balance is at or below threshold.
    // Best-effort: read the vault for threshold; do not block the debit on it.
    if (res.locals.auth.developerId && result.remainingBalance !== null) {
      try {
        const v = await getVault(customer, developer);
        if (v && v.low_balance_threshold > 0n && result.remainingBalance <= v.low_balance_threshold) {
          await fireWebhook({
            developerId: res.locals.auth.developerId,
            event:       "vault.low_balance",
            payload: {
              customer:  customer,
              developer: developer,
              balance:   result.remainingBalance.toString(),
              threshold: v.low_balance_threshold.toString(),
            },
          });
        }
      } catch (err) {
        console.error("[vault] low_balance webhook failed:", err);
      }
    }

    res.json({
      txHash:           result.txHash,
      remainingBalance: result.remainingBalance?.toString(),
    });
  })
);

// POST /v1/vault/withdraw
// body: { caller, customer, developer, amount }
// Note: caller must be the customer — this is a customer-initiated action.
// In production the customer signs the tx on the frontend via build-vault-tx pattern.
// This endpoint is for cases where admin IS the customer (testnet / internal).
router.post(
  "/withdraw",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { caller, customer, developer, amount } = req.body;

    if (!caller || !customer || !developer || amount === undefined) {
      res.status(400).json({ error: "caller, customer, developer, amount required" });
      return;
    }

    const result = await withdraw({
      caller,
      customer,
      developer,
      amount: BigInt(amount),
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({
      txHash:           result.txHash,
      remainingBalance: result.remainingBalance?.toString(),
    });
  })
);

// POST /v1/vault/build-withdraw-tx
// body: { customerAddress, developerAddress, amount }
router.post(
  "/build-withdraw-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { customerAddress, developerAddress, amount } = req.body;

    if (!customerAddress || !developerAddress || amount === undefined) {
      res.status(400).json({ error: "customerAddress, developerAddress, amount required" });
      return;
    }

    const result = await buildWithdrawVaultTxXdr({
      customerAddress,
      developerAddress,
      amount: BigInt(amount),
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ xdr: result.xdr });
  })
);

// POST /v1/vault/submit-withdraw-tx
// body: { signedXdr, customerAddress }
router.post(
  "/submit-withdraw-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { signedXdr, customerAddress } = req.body;

    if (!signedXdr || !customerAddress) {
      res.status(400).json({ error: "signedXdr, customerAddress required" });
      return;
    }

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

    res.json({ txHash: result.txHash });
  })
);

// DELETE /v1/vault
// body: { caller, customer, developer }
router.delete(
  "/",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { caller, customer, developer } = req.body;

    if (!caller || !customer || !developer) {
      res.status(400).json({ error: "caller, customer, developer required" });
      return;
    }

    const result = await closeVault({ caller, customer, developer });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({
      txHash:   result.txHash,
      refunded: result.refunded?.toString(),
    });
  })
);

// PATCH /v1/vault/threshold
// body: { caller, customer, developer, newThreshold, newAutoTopup }
router.patch(
  "/threshold",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { caller, customer, developer, newThreshold, newAutoTopup } = req.body;

    if (!caller || !customer || !developer || newThreshold === undefined) {
      res.status(400).json({ error: "caller, customer, developer, newThreshold required" });
      return;
    }

    const result = await updateThreshold({
      caller,
      customer,
      developer,
      newThreshold: BigInt(newThreshold),
      newAutoTopup: BigInt(newAutoTopup ?? 0),
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ txHash: result.txHash });
  })
);

// POST /v1/vault/build-threshold-tx
// body: { customerAddress, developerAddress, newThreshold, newAutoTopup? }
router.post(
  "/build-threshold-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { customerAddress, developerAddress, newThreshold, newAutoTopup } = req.body;

    if (!customerAddress || !developerAddress || newThreshold === undefined) {
      res.status(400).json({
        error: "customerAddress, developerAddress, newThreshold required",
      });
      return;
    }

    const result = await buildUpdateVaultThresholdTxXdr({
      customerAddress,
      developerAddress,
      newThreshold: BigInt(newThreshold),
      newAutoTopup: BigInt(newAutoTopup ?? 0),
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ xdr: result.xdr });
  })
);

// POST /v1/vault/submit-threshold-tx
// body: { signedXdr, customerAddress }
router.post(
  "/submit-threshold-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { signedXdr, customerAddress } = req.body;

    if (!signedXdr || !customerAddress) {
      res.status(400).json({ error: "signedXdr, customerAddress required" });
      return;
    }

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

    res.json({ txHash: result.txHash });
  })
);

// GET /v1/vault/balances
// Returns all vaults known to this developer. For each unique customer in
// subscriptionCache we attempt to read the on-chain vault (capped at 20
// concurrent to avoid RPC storms). Customers without a vault are skipped.
router.get(
  "/balances",
  authenticate(),
  asyncHandler(async (req, res) => {
    const { developerAddress } = res.locals.auth;
    if (!developerAddress) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const unique = Array.from(new Set(await listSubscriptionCustomerAddressesByDeveloperAddress(developerAddress)));

    const out: any[] = [];
    const CONCURRENCY = 20;
    for (let i = 0; i < unique.length; i += CONCURRENCY) {
      const slice = unique.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (cust) => {
          try {
            const v = await getVault(cust, developerAddress);
            return v
              ? {
                  customer:            cust,
                  developer:           developerAddress,
                  balance_usdc:        v.balance_usdc.toString(),
                  total_deposited:     v.total_deposited.toString(),
                  total_debited:       v.total_debited.toString(),
                  low_balance_threshold: v.low_balance_threshold.toString(),
                  auto_topup_amount:   v.auto_topup_amount.toString(),
                  created_at:          v.created_at.toString(),
                }
              : null;
          } catch {
            return null;
          }
        })
      );
      for (const r of results) if (r) out.push(r);
    }

    res.json({ count: out.length, vaults: out });
  })
);


// body: { customerAddress, developerAddress, amount }
router.post(
  "/build-deposit-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { customerAddress, developerAddress, amount } = req.body;

    if (!customerAddress || !developerAddress || amount === undefined) {
      res.status(400).json({ error: "customerAddress, developerAddress, amount required" });
      return;
    }

    const result = await buildDepositVaultTxXdr({
      customerAddress,
      developerAddress,
      amount: BigInt(amount),
    });

    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    res.json({ xdr: result.xdr });
  })
);

// POST /v1/vault/submit-deposit-tx
// body: { signedXdr, customerAddress }
router.post(
  "/submit-deposit-tx",
  authenticate(["sk", "pk"]),
  asyncHandler(async (req, res) => {
    const { signedXdr, customerAddress } = req.body;

    if (!signedXdr || !customerAddress) {
      res.status(400).json({ error: "signedXdr, customerAddress required" });
      return;
    }

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

    res.json({ txHash: result.txHash });
  })
);

export default router;
