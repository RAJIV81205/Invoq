/**
 * src/lib/auth/api-key.ts
 *
 * API key lifecycle: generation, hashing, validation.
 *
 * SECRET KEY  (sk_live_...)
 *   - Backend only. Full access.
 *   - Authorization: Bearer sk_live_...
 *
 * PUBLISHABLE KEY  (pk_live_...)
 *   - Safe for frontend. Read-only + checkout only.
 *   - X-Invoq-Key: pk_live_...
 *
 * Storage: SHA-256 hash only. Plaintext shown once, never stored.
 */

import { createHash, randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { db, apiKeys, developers, newId, now } from "../db/index.js";
import type { Request } from "express";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KeyType = "sk" | "pk";
export type KeyEnv  = "live" | "test";
const API_KEY_REGEX = /^(sk|pk)_(live|test)_([a-f0-9]{64})$/;

export interface AuthResult {
  valid: boolean;
  developerId: string | null;
  developerAddress: string | null;
  keyId: string | null;
  keyType: KeyType | null;
  keyEnv: KeyEnv | null;
  error: string | null;
}

const INVALID: AuthResult = {
  valid: false,
  developerId: null,
  developerAddress: null,
  keyId: null,
  keyType: null,
  keyEnv: null,
  error: null,
};

// ─── Generation ───────────────────────────────────────────────────────────────

export function generateApiKey(
  type: KeyType,
  env: KeyEnv = "live"
): { plaintext: string; hash: string; prefix: string } {
  const random    = randomBytes(32).toString("hex");
  const plaintext = `${type}_${env}_${random}`;
  const hash      = hashApiKey(plaintext);
  const prefix    = plaintext.slice(0, 14);
  return { plaintext, hash, prefix };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function getKeyType(key: string): KeyType | null {
  const match = key.match(API_KEY_REGEX);
  if (!match) return null;
  return match[1] as KeyType;
}

export function getKeyEnv(key: string): KeyEnv | null {
  const match = key.match(API_KEY_REGEX);
  if (!match) return null;
  return match[2] as KeyEnv;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export async function createApiKey(params: {
  developerId: string;
  type: KeyType;
  env?: KeyEnv;
  name?: string;
  expiresAt?: Date;
}): Promise<{ plaintext: string; keyId: string }> {
  const { plaintext, hash, prefix } = generateApiKey(params.type, params.env ?? "live");
  const keyId = newId();

  await db.insert(apiKeys).values({
    id:          keyId,
    developerId: params.developerId,
    keyHash:     hash,
    keyPrefix:   prefix,
    name:        params.name ?? null,
    expiresAt:   params.expiresAt ?? null,
    revoked:     false,
    createdAt:   now(),
  });

  return { plaintext, keyId };
}

export async function revokeApiKey(keyId: string, developerId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revoked: true })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.developerId, developerId)));
}

// ─── Validation ───────────────────────────────────────────────────────────────

export async function validateApiKey(plaintext: string): Promise<AuthResult> {
  const keyType = getKeyType(plaintext);
  if (!keyType) return { ...INVALID, error: "Invalid key format" };
  const keyEnv = getKeyEnv(plaintext);
  if (!keyEnv) return { ...INVALID, error: "Invalid key format" };

  const hash = hashApiKey(plaintext);

  const rows = await db
    .select({
      keyId:          apiKeys.id,
      developerId:    apiKeys.developerId,
      revoked:        apiKeys.revoked,
      expiresAt:      apiKeys.expiresAt,
      stellarAddress: developers.stellarAddress,
    })
    .from(apiKeys)
    .innerJoin(developers, eq(apiKeys.developerId, developers.id))
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);

  if (rows.length === 0) return { ...INVALID, error: "Invalid API key" };

  const row = rows[0];

  if (!row)                    return { ...INVALID, error: "Developer has no Stellar address" };

  if (row.revoked)                          return { ...INVALID, error: "API key has been revoked" };
  if (row.expiresAt && row.expiresAt < now()) return { ...INVALID, error: "API key has expired" };

  // fire-and-forget last used update
  db.update(apiKeys)
    .set({ lastUsedAt: now() })
    .where(eq(apiKeys.id, row.keyId))
    .catch(() => {});

  return {
    valid:            true,
    developerId:      row.developerId,
    developerAddress: row.stellarAddress,
    keyId:            row.keyId,
    keyType,
    keyEnv,
    error:            null,
  };
}

// ─── Express helpers ──────────────────────────────────────────────────────────

/**
 * Extracts API key from Express request.
 * Authorization: Bearer sk_live_...   → secret key
 * X-Invoq-Key: pk_live_...            → publishable key
 */
export function extractApiKey(req: Request): string | null {
  const authHeader = req.headers["authorization"];
  const auth = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const invoqKey = req.headers["x-invoq-key"];
  const headerKey = typeof invoqKey === "string" ? invoqKey.trim() : null;

  // Reject ambiguous/mismatched auth sources.
  if (auth && headerKey && auth !== headerKey) return null;

  if (headerKey) return headerKey;
  if (auth) return auth;

  return null;
}

/**
 * Full auth check for Express route handlers.
 * @param allowedKeyTypes - defaults to sk only
 */
export async function requireAuth(
  req: Request,
  allowedKeyTypes: KeyType[] = ["sk"]
): Promise<AuthResult> {
  const authHeader = req.headers["authorization"];
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const xHeader = typeof req.headers["x-invoq-key"] === "string"
    ? req.headers["x-invoq-key"].trim()
    : null;
  if (bearer && xHeader && bearer !== xHeader) {
    return { ...INVALID, error: "Authorization and X-Invoq-Key headers do not match" };
  }

  const key = extractApiKey(req);
  if (!key) return { ...INVALID, error: "Missing API key" };

  const result = await validateApiKey(key);
  if (!result.valid) return result;

  if (!allowedKeyTypes.includes(result.keyType!)) {
    return {
      ...INVALID,
      error: `This endpoint requires a ${allowedKeyTypes.join(" or ")} key`,
    };
  }

  return result;
}
