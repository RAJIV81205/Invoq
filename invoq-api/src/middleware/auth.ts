import type { Request, Response, NextFunction } from "express";
import { requireAuth } from "../lib/auth/api-key.js";
import type { KeyType, AuthResult } from "../lib/auth/api-key.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("auth");

declare global {
  namespace Express {
    interface Locals {
      auth: AuthResult;
    }
  }
}

export function authenticate(allowedKeyTypes: KeyType[] = ["sk"]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await requireAuth(req, allowedKeyTypes);

    if (!result.valid) {
      log.warn("auth rejected", {
        error:       result.error,
        keyTypes:    allowedKeyTypes,
        method:      req.method,
        path:        req.path,
        ip:          req.ip ?? req.socket?.remoteAddress,
      });
      res.status(401).json({ error: result.error ?? "Unauthorized" });
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