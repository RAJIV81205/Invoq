/**
 * src/lib/db/index.ts
 *
 * PostgreSQL connection via Drizzle ORM.
 * Uses the `postgres` driver (faster than pg, native ESM).
 *
 * Single connection pool shared across all API routes.
 * Next.js hot-reload in dev mode creates multiple module instances,
 * so we store the pool on `globalThis` to prevent connection leaks.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

function env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

// ─── Connection pool ──────────────────────────────────────────────────────────

declare global {
  var __pgPool: postgres.Sql | undefined;
}

function getPool(): postgres.Sql {
  if (!globalThis.__pgPool) {
    globalThis.__pgPool = postgres(env("DATABASE_URL"), {
      max:         10,   // max 10 connections in pool
      idle_timeout: 30,  // close idle connections after 30s
      connect_timeout: 10,
    });
  }
  return globalThis.__pgPool;
}

// ─── Drizzle instance ─────────────────────────────────────────────────────────

export const db = drizzle(getPool(), { schema });

// ─── Re-export schema for convenience ────────────────────────────────────────

export * from "./schema.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a random UUID (works in Node.js 14.17+ and browsers) */
export function newId(): string {
  return crypto.randomUUID();
}

/** Returns current UTC timestamp as a JS Date */
export function now(): Date {
  return new Date();
}

/** Converts a Unix seconds timestamp (bigint from Stellar) to a JS Date */
export function fromUnixSeconds(seconds: bigint): Date {
  return new Date(Number(seconds) * 1000);
}

/** Converts a JS Date to Unix seconds bigint (for Stellar contract args) */
export function toUnixSeconds(date: Date): bigint {
  return BigInt(Math.floor(date.getTime() / 1000));
}