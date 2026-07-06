import { Router } from "express";
import { asyncHandler } from "../middleware/error.js";
import { authenticate } from "../middleware/auth.js";
import { createApiKey, revokeApiKey } from "../lib/auth/api-key.js";
import {
  findRevokedApiKey,
  listApiKeysByDeveloper,
} from "../lib/db/index.js";

const router = Router();

router.get(
  "/",
  authenticate(["sk"]),
  asyncHandler(async (_req, res) => {
    const developerId = res.locals.auth.developerId!;
    const rows = await listApiKeysByDeveloper(developerId);

    res.json(
      rows.map((row) => ({
        ...row,
        type: row.keyPrefix.startsWith("sk_") ? "sk" : "pk",
        env: row.keyPrefix.includes("_test_") ? "test" : "live",
      })),
    );
  }),
);

router.post(
  "/publishable",
  authenticate(["sk"]),
  asyncHandler(async (req, res) => {
    const developerId = res.locals.auth.developerId!;
    const authEnv = res.locals.auth.keyEnv ?? "live";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const expiresAtRaw = req.body?.expiresAt;

    let expiresAt: Date | undefined;
    if (expiresAtRaw !== undefined && expiresAtRaw !== null) {
      const parsed = new Date(String(expiresAtRaw));
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "expiresAt must be a valid ISO date string" });
        return;
      }
      expiresAt = parsed;
    }

    const created = await createApiKey({
      developerId,
      type: "pk",
      env: authEnv,
      name: name || undefined,
      expiresAt,
    });

    res.status(201).json({
      keyId: created.keyId,
      key: created.plaintext,
      type: "pk",
      env: authEnv,
      name: name || null,
      expiresAt: expiresAt?.toISOString() ?? null,
    });
  }),
);

router.post(
  "/secret",
  authenticate(["sk"]),
  asyncHandler(async (req, res) => {
    const developerId = res.locals.auth.developerId!;
    const authEnv = res.locals.auth.keyEnv ?? "live";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const expiresAtRaw = req.body?.expiresAt;

    let expiresAt: Date | undefined;
    if (expiresAtRaw !== undefined && expiresAtRaw !== null) {
      const parsed = new Date(String(expiresAtRaw));
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "expiresAt must be a valid ISO date string" });
        return;
      }
      expiresAt = parsed;
    }

    const created = await createApiKey({
      developerId,
      type: "sk",
      env: authEnv,
      name: name || undefined,
      expiresAt,
    });

    res.status(201).json({
      keyId: created.keyId,
      key: created.plaintext,
      type: "sk",
      env: authEnv,
      name: name || null,
      expiresAt: expiresAt?.toISOString() ?? null,
    });
  }),
);

router.delete(
  "/:keyId",
  authenticate(["sk"]),
  asyncHandler(async (req, res) => {
    const developerId = res.locals.auth.developerId!;
    const keyIdParam = req.params.keyId;
    const keyId = Array.isArray(keyIdParam) ? keyIdParam[0] : keyIdParam;

    if (!keyId) {
      res.status(400).json({ error: "keyId is required" });
      return;
    }

    await revokeApiKey(keyId, developerId);

    const row = await findRevokedApiKey(keyId, developerId);

    if (!row) {
      res.status(404).json({ error: "API key not found" });
      return;
    }

    res.json({ revoked: true, keyId });
  }),
);

export default router;
