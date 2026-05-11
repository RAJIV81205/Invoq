/**
 * src/lib/auth/api-key.ts
 *
 * API key lifecycle: generation, hashing, validation, middleware.
 *
 * Two key types:
 *
 * SECRET KEY  (sk_live_...)
 *   - Backend only. Never exposed to browser.
 *   - Full access: plan management, usage recording, entitlement checks.
 *   - Passed as: Authorization: Bearer sk_live_...
 *
 * PUBLISHABLE KEY  (pk_live_...)
 *   - Safe for frontend / browser.
 *   - Read-only + checkout only: build subscribe tx, check public plan info.
 *   - Cannot create plans, record usage, or access developer data.
 *   - Passed as: X-Invoq-Key: pk_live_...
 *
 * Storage:
 *   Only a SHA-256 hash of the key is stored in the database.
 *   The plaintext is shown ONCE on creation and never again.
 *   If lost, the developer generates a new key.
 */

import { createHash, randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { db, apiKeys, developers, newId, now } from "../db";
import type { NextRequest } from "next/server";

// ─── Key generation ───────────────────────────────────────────────────────────

type KeyType = "sk" | "pk";
type KeyEnv  = "live" | "test";

/**
 * Generates a new API key.
 * Format: {type}_{env}_{32 random hex bytes}
 * Example: sk_live_a3f9c2e1d8b7...
 *
 * Returns the plaintext key (shown once) and its hash (stored in DB).
 */
export function generateApiKey(
  type: KeyType,
  env: KeyEnv = "live"
): { plaintext: string; hash: string; prefix: string } {
  const random    = randomBytes(32).toString("hex"); // 64 hex chars
  const plaintext = `${type}_${env}_${random}`;
  const hash      = hashApiKey(plaintext);
  const prefix    = plaintext.slice(0, 14); // "sk_live_a3f9c2"

  return { plaintext, hash, prefix };
}

/**
 * SHA-256 hash of an API key for database storage.
 */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Determines the key type from the plaintext prefix.
 */
export function getKeyType(key: string): KeyType | null {
  if (key.startsWith("sk_")) return "sk";
  if (key.startsWith("pk_")) return "pk";
  return null;
}

// ─── Key storage ──────────────────────────────────────────────────────────────

/**
 * Creates and stores a new API key for a developer.
 * Returns the plaintext key — this is the ONLY time it is returned.
 */
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

/**
 * Revokes an API key by ID. Soft delete — marks as revoked.
 */
export async function revokeApiKey(keyId: string, developerId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revoked: true })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.developerId, developerId)));
}

// ─── Key validation ───────────────────────────────────────────────────────────

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

/**
 * Validates an API key string against the database.
 * Updates last_used_at on successful validation.
 *
 * Returns full AuthResult including developer info.
 */
export async function validateApiKey(plaintext: string): Promise<AuthResult> {
  const keyType = getKeyType(plaintext);
  if (!keyType) return { ...INVALID, error: "Invalid key format" };

  const hash = hashApiKey(plaintext);

  const rows = await db
    .select({
      keyId:           apiKeys.id,
      developerId:     apiKeys.developerId,
      revoked:         apiKeys.revoked,
      expiresAt:       apiKeys.expiresAt,
      stellarAddress:  developers.stellarAddress,
    })
    .from(apiKeys)
    .innerJoin(developers, eq(apiKeys.developerId, developers.id))
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);

  if (rows.length === 0) {
    return { ...INVALID, error: "Invalid API key" };
  }

  const row = rows[0];

  if (row.revoked) {
    return { ...INVALID, error: "API key has been revoked" };
  }

  if (row.expiresAt && row.expiresAt < new Date()) {
    return { ...INVALID, error: "API key has expired" };
  }

  // Update last used timestamp (fire-and-forget — don't await)
  db.update(apiKeys)
    .set({ lastUsedAt: now() })
    .where(eq(apiKeys.id, row.keyId))
    .catch(() => {}); // non-critical

  return {
    valid:            true,
    developerId:      row.developerId,
    developerAddress: row.stellarAddress,
    keyId:            row.keyId,
    keyType,
    error:            null,
  };
}

// ─── Next.js middleware helpers ───────────────────────────────────────────────

/**
 * Extracts the API key from a Next.js request.
 * Checks Authorization header first, then X-Invoq-Key header.
 *
 * Authorization: Bearer sk_live_...
 * X-Invoq-Key: pk_live_...
 */
export function extractApiKey(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const invoqHeader = req.headers.get("x-invoq-key");
  if (invoqHeader) return invoqHeader.trim();

  return null;
}

/**
 * Full auth middleware for Next.js Route Handlers.
 *
 * Usage in a route handler:
 *   const auth = await requireAuth(req)
 *   if (!auth.valid) return authError(auth.error)
 *   // auth.developerId, auth.developerAddress are now available
 *
 * @param allowedKeyTypes - which key types are accepted. Default: sk only.
 */
export async function requireAuth(
  req: NextRequest,
  allowedKeyTypes: KeyType[] = ["sk"]
): Promise<AuthResult> {
  const key = extractApiKey(req);
  if (!key) {
    return { ...INVALID, error: "Missing API key" };
  }

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

/**
 * Standard 401 JSON response for auth failures.
 */
export function authError(message: string | null): Response {
  return Response.json(
    { error: message ?? "Unauthorized" },
    { status: 401 }
  );
}

/**
 * Standard 403 JSON response for insufficient permissions.
 */
export function forbiddenError(message: string): Response {
  return Response.json({ error: message }, { status: 403 });
}