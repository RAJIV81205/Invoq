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
  buildUpdateVaultThresholdTxXdr,
  wrapAndSubmit,
  verifyInnerTxSigner,
} from "../lib/stellar/feeBump.js";
import { getNetworkPassphrase } from "../lib/stellar/client.js";

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

export default router;
