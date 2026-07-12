import type { Request, Response, NextFunction } from "express";
import { requireAuth } from "../lib/auth/api-key.js";
import type { KeyType, AuthResult } from "../lib/auth/api-key.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("auth");

declare module "express-serve-static-core" {
  interface Locals {
    auth: AuthResult;
  }
}

export function authenticate(allowedKeyTypes: KeyType[] = ["sk"]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await requireAuth(req, allowedKeyTypes);

    if (!result.valid) {
      const status =
        typeof result.error === "string" && result.error.startsWith("This endpoint requires a ")
          ? 403
          : 401;
      log.warn("auth rejected", {
        error:       result.error,
        status,
        keyTypes:    allowedKeyTypes,
        method:      req.method,
        path:        req.path,
        ip:          req.ip ?? req.socket?.remoteAddress,
      });
      res.status(status).json({ error: result.error ?? "Unauthorized" });
      return;
    }

    log.debug("auth accepted", {
      developerId: result.developerId,
      keyId:       result.keyId,
      keyType:     result.keyType,
      method:      req.method,
      path:        req.path,
    });

    res.locals.auth = result;
    next();
  };
}
