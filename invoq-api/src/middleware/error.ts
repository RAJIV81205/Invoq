import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createLogger } from "../lib/logger.js";

const log = createLogger("http");

// ─────────────────────────────────────────────────────────────────────────────
// Request logger — logs every inbound request and its outcome
// ─────────────────────────────────────────────────────────────────────────────
export function requestLogger(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    // Capture outgoing status after response finishes
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const level = res.statusCode >= 500 ? "error"
                  : res.statusCode >= 400 ? "warn"
                  : "info";

      log[level]("request", {
        method:     req.method,
        path:       req.path,
        query:      Object.keys(req.query).length ? req.query : undefined,
        status:     res.statusCode,
        durationMs,
        ip:         req.ip ?? req.socket?.remoteAddress,
        userAgent:  req.headers["user-agent"],
        keyPrefix:  typeof req.headers["authorization"] === "string"
                      ? req.headers["authorization"].slice(7, 21) + "…"
                      : typeof req.headers["x-invoq-key"] === "string"
                        ? (req.headers["x-invoq-key"] as string).slice(0, 14) + "…"
                        : undefined,
      });
    });

    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error handler — structured JSON error response + logs
// ─────────────────────────────────────────────────────────────────────────────
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : "Internal server error";
  const status  = (err as { status?: number; statusCode?: number })?.status
                ?? (err as { statusCode?: number })?.statusCode
                ?? 500;

  log.error("unhandled error", {
    status,
    error:  message,
    stack:  err instanceof Error ? err.stack : undefined,
    method: req.method,
    path:   req.path,
  });

  res.status(status).json({ error: message });
}

// ─────────────────────────────────────────────────────────────────────────────
// Async handler — wraps async route handlers so thrown errors reach errorHandler
// ─────────────────────────────────────────────────────────────────────────────
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}