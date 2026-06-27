/**
 * src/routes/developers.ts
 *
 * Developer self-custodied onboarding + profile.
 *
 *   POST /v1/developers/signup   →  create developer + first sk_live_ key
 *   POST /v1/developers/login    →  mint a fresh sk_live_ key for the given email
 *   GET  /v1/developers/me       →  current developer (auth: sk)
 *   PATCH /v1/developers/me      →  update name / payoutAddress (auth: sk)
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { StrKey } from "@stellar/stellar-sdk";
import { db, developers, newId, now } from "../lib/db/index.js";
import { createApiKey } from "../lib/auth/api-key.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("developers");

const router = Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

function isValidStellarAddress(addr: string): boolean {
  if (!addr || typeof addr !== "string") return false;
  return StrKey.isValidEd25519PublicKey(addr);
}

function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  if (email.length > 255) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── POST /v1/developers/signup ──────────────────────────────────────────────
//
// Self-custodied onboarding.
//   body: { stellarAddress, email, name }
//   - validates the Stellar address and email
//   - upserts the developers row (idempotent on stellarAddress)
//   - mints the first sk_live_ key and returns the plaintext ONCE
//
router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const { stellarAddress, email, name } = req.body ?? {};

    if (!isValidStellarAddress(stellarAddress)) {
      res.status(400).json({ error: "stellarAddress must be a valid Stellar G... address" });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "email is required and must be a valid address" });
      return;
    }
    if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 255) {
      res.status(400).json({ error: "name is required (1-255 chars)" });
      return;
    }

    // Idempotency: a developer is uniquely identified by stellarAddress.
    const existingByAddress = await db
      .select()
      .from(developers)
      .where(eq(developers.stellarAddress, stellarAddress))
      .limit(1);

    let developerId: string;
    let isNew = false;

    if (existingByAddress.length > 0 && existingByAddress[0]) {
      const row = existingByAddress[0];
      if (row.email !== email) {
        res.status(409).json({
          error: "Stellar address already registered with a different email",
        });
        return;
      }
      developerId = row.id;
    } else {
      const existingByEmail = await db
        .select()
        .from(developers)
        .where(eq(developers.email, email))
        .limit(1);

      if (existingByEmail.length > 0) {
        res.status(409).json({
          error: "Email already registered with a different Stellar address",
        });
        return;
      }

      developerId = newId();
      await db.insert(developers).values({
        id:             developerId,
        stellarAddress,
        email,
        name:           name.trim(),
        createdAt:      now(),
        updatedAt:      now(),
      });
      isNew = true;
    }

    const created = await createApiKey({
      developerId,
      type: "sk",
      env:  "live",
      name: isNew ? "default" : "rotated",
    });

    log.info("developer signup", {
      developerId,
      stellarAddress,
      isNew,
      keyId: created.keyId,
    });

    res.status(isNew ? 201 : 200).json({
      developerId,
      stellarAddress,
      email,
      name:       name.trim(),
      secretKey:  created.plaintext,
      keyId:      created.keyId,
      env:        "live",
      created:    isNew,
    });
  })
);

// ─── POST /v1/developers/login ───────────────────────────────────────────────
//
// Mints a fresh sk_live_ key for a given email (key rotation on every login).
// Requires confirm=true to prevent accidental plaintext-key leakage.
//
// In production this should be paired with a magic-link / OTP flow that
// proves control of the email. The dashboard wires that in front of this
// endpoint; the API surface is intentionally minimal.
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, confirm } = req.body ?? {};
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "email is required" });
      return;
    }
    if (confirm !== true) {
      res.status(400).json({
        error: "login requires confirm=true - issuing a secret key is sensitive",
      });
      return;
    }

    const rows = await db
      .select()
      .from(developers)
      .where(eq(developers.email, email))
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      res.status(404).json({ error: "No developer found for that email" });
      return;
    }

    const dev = rows[0];

    const created = await createApiKey({
      developerId: dev.id,
      type:        "sk",
      env:         "live",
      name:        "login",
    });

    log.info("developer login - new key issued", {
      developerId: dev.id,
      keyId:       created.keyId,
    });

    res.json({
      developerId:    dev.id,
      stellarAddress: dev.stellarAddress,
      email:          dev.email,
      name:           dev.name,
      secretKey:      created.plaintext,
      keyId:          created.keyId,
      env:            "live",
    });
  })
);

// ─── GET /v1/developers/me ───────────────────────────────────────────────────

router.get(
  "/me",
  authenticate(["sk"]),
  asyncHandler(async (_req, res) => {
    const auth = res.locals.auth;
    if (!auth.developerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rows = await db
      .select()
      .from(developers)
      .where(eq(developers.id, auth.developerId))
      .limit(1);
    if (rows.length === 0 || !rows[0]) {
      res.status(404).json({ error: "Developer not found" });
      return;
    }
    const dev = rows[0];
    res.json({
      id:             dev.id,
      stellarAddress: dev.stellarAddress,
      email:          dev.email,
      name:           dev.name,
      payoutAddress:  dev.payoutAddress ?? null,
      createdAt:      dev.createdAt,
      updatedAt:      dev.updatedAt,
    });
  })
);

// ─── PATCH /v1/developers/me ─────────────────────────────────────────────────

router.patch(
  "/me",
  authenticate(["sk"]),
  asyncHandler(async (req, res) => {
    const auth = res.locals.auth;
    if (!auth.developerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { name, payoutAddress } = req.body ?? {};
    const patch: { name?: string; payoutAddress?: string; updatedAt: Date } = {
      updatedAt: now(),
    };
    if (typeof name === "string") {
      if (name.trim().length === 0 || name.length > 255) {
        res.status(400).json({ error: "name must be 1-255 chars" });
        return;
      }
      patch.name = name.trim();
    }
    if (payoutAddress !== undefined) {
      if (payoutAddress !== null && !isValidStellarAddress(payoutAddress)) {
        res.status(400).json({ error: "payoutAddress must be a valid Stellar G... address" });
        return;
      }
      patch.payoutAddress = payoutAddress ?? undefined;
    }
    if (Object.keys(patch).length === 1) {
      res.status(400).json({ error: "No mutable fields supplied" });
      return;
    }
    await db
      .update(developers)
      .set(patch)
      .where(eq(developers.id, auth.developerId));

    res.json({ ok: true });
  })
);

export default router;
