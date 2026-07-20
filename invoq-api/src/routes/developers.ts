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

import { Router, type Request } from "express";
import { StrKey } from "@stellar/stellar-sdk";
import {
  createDeveloper,
  findDeveloperByEmail,
  findDeveloperById,
  findDeveloperByStellarAddress,
  newId,
  now,
  updateDeveloper,
} from "../lib/db/index.js";
import { createApiKey } from "../lib/auth/api-key.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { createLogger } from "../lib/logger.js";
import { hashPassword, verifyPassword } from "../lib/auth/password.js";

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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 12 && password.length <= 256;
}

const failedLogins = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 5;

function loginRateKey(req: Request, email: string): string {
  return `${req.ip ?? req.socket?.remoteAddress ?? "unknown"}:${email}`;
}

function loginBlocked(key: string): boolean {
  const nowMs = Date.now();
  const current = failedLogins.get(key);
  if (!current || current.resetAt <= nowMs) {
    failedLogins.set(key, { count: 0, resetAt: nowMs + LOGIN_WINDOW_MS });
    return false;
  }
  return current.count >= LOGIN_MAX_ATTEMPTS;
}

// ─── POST /v1/developers/signup ──────────────────────────────────────────────
//
// Self-custodied onboarding.
//   body: { stellarAddress, email, name, password }
//   - validates the Stellar address and email
//   - upserts the developers row (idempotent on stellarAddress)
//   - mints the first sk_live_ key and returns the plaintext ONCE
//
router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const { stellarAddress, email: rawEmail, name, password } = req.body ?? {};
    const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : rawEmail;

    if (!isValidStellarAddress(stellarAddress)) {
      res.status(400).json({ error: "stellarAddress must be a valid Stellar G... address" });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "email is required and must be a valid address" });
      return;
    }
    if (!isValidPassword(password)) {
      res.status(400).json({ error: "password is required and must be 12-256 characters" });
      return;
    }
    if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 255) {
      res.status(400).json({ error: "name is required (1-255 chars)" });
      return;
    }

    // Never rotate keys for an existing account from signup.
    const existingByAddress = await findDeveloperByStellarAddress(stellarAddress);

    if (existingByAddress) {
      res.status(409).json({ error: "Account already exists; sign in instead" });
      return;
    }

    const existingByEmail = await findDeveloperByEmail(email);
    if (existingByEmail) {
      res.status(409).json({
        error: "Email already registered with a different Stellar address",
      });
      return;
    }

    const developerId = newId();
    await createDeveloper({
      id:             developerId,
      stellarAddress,
      email,
      passwordHash:   await hashPassword(password),
      name:           name.trim(),
      payoutAddress:  null,
      createdAt:      now(),
      updatedAt:      now(),
    });

    const created = await createApiKey({
      developerId,
      type: "sk",
      env:  "live",
      name: "default",
    });

    log.info("developer signup", {
      developerId,
      stellarAddress,
      isNew: true,
      keyId: created.keyId,
    });

    res.status(201).json({
      developerId,
      stellarAddress,
      email,
      name:       name.trim(),
      secretKey:  created.plaintext,
      keyId:      created.keyId,
      env:        "live",
      created:    true,
    });
  })
);

// ─── POST /v1/developers/login ───────────────────────────────────────────────
//
// Mints a fresh sk_live_ key only after password verification.
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email: rawEmail, password } = req.body ?? {};
    const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : rawEmail;
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "email is required" });
      return;
    }
    if (typeof password !== "string" || password.length === 0) {
      res.status(400).json({
        error: "email or password is invalid",
      });
      return;
    }

    const rateKey = loginRateKey(req, email);
    if (loginBlocked(rateKey)) {
      res.status(429).json({ error: "Too many login attempts. Try again later." });
      return;
    }

    const dev = await findDeveloperByEmail(email);
    if (!dev || !(await verifyPassword(password, dev.passwordHash))) {
      const current = failedLogins.get(rateKey);
      if (current) current.count += 1;
      res.status(401).json({ error: "email or password is invalid" });
      return;
    }
    failedLogins.delete(rateKey);

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
    const dev = await findDeveloperById(auth.developerId);
    if (!dev) {
      res.status(404).json({ error: "Developer not found" });
      return;
    }
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
    const patch: { name?: string; payoutAddress?: string | null; updatedAt: Date } = {
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
      patch.payoutAddress = payoutAddress === null ? null : payoutAddress;
    }
    if (Object.keys(patch).length === 1) {
      res.status(400).json({ error: "No mutable fields supplied" });
      return;
    }
    await updateDeveloper(auth.developerId, patch);

    res.json({ ok: true });
  })
);

export default router;
