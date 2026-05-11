/**
 * src/middleware/auth.ts
 *
 * Express middleware for API key authentication.
 * Attaches auth result to res.locals.auth for use in route handlers.
 *
 * Usage:
 *   router.post("/plans", authenticate(), handler)           // sk only
 *   router.get("/checkout", authenticate(["sk","pk"]), handler)
 */

import type { Request, Response, NextFunction } from "express";
import { requireAuth } from "../lib/auth/api-key.js";
import type { KeyType, AuthResult } from "../lib/auth/api-key.js";

// Extend Express locals type so routes get full type safety
declare global {
  namespace Express {
    interface Locals {
      auth: AuthResult;
    }
  }
}

export function authenticate(allowedKeyTypes: KeyType[] = ["sk"]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const result = await requireAuth(req, allowedKeyTypes);

    if (!result.valid) {
      res.status(401).json({ error: result.error ?? "Unauthorized" });
      return;
    }

    res.locals.auth = result;
    next();
  };
}