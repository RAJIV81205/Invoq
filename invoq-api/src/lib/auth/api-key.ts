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

export interface AuthResult {
  valid: boolean;
  developerId: string | null;
  developerAddress: string | null;
  keyId: string | null;
  keyType: KeyType | null;
  error: string | null;
}

const INVALID: AuthResult = {
  valid: false,
  developerId: null,
  developerAddress: null,
  keyId: null,
  keyType: null,
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
  if (key.startsWith("sk_")) return "sk";
  if (key.startsWith("pk_")) return "pk";
  return null;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export async function createApiKey(params: {
  developerId: string;
  type: KeyType;
  name?: string;
  expiresAt?: Date;
}): Promise<{ plaintext: string; keyId: string }> {
  const { plaintext, hash, prefix } = generateApiKey(params.type);
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
  const auth = req.headers["authorization"];
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();

  const invoqKey = req.headers["x-invoq-key"];
  if (typeof invoqKey === "string") return invoqKey.trim();

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