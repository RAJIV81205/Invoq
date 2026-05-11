/**
 * src/middleware/error.ts
 *
 * Global error handler. Must be registered LAST in Express (4 args).
 * Catches anything passed to next(err) or thrown in async routes
 * (wrap async handlers with asyncHandler below).
 */

import type { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error("[invoq-api] unhandled error:", err);

  const message =
    err instanceof Error ? err.message : "Internal server error";

  const status =
    (err as any)?.status ?? (err as any)?.statusCode ?? 500;

  res.status(status).json({ error: message });
}

/**
 * Wraps an async Express handler so errors are forwarded to errorHandler.
 * Use this on every async route:
 *   router.post("/plans", authenticate(), asyncHandler(async (req, res) => { ... }))
 */
import type { RequestHandler } from "express";

export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}