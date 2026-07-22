import { Router } from "express";
import { asyncHandler } from "../middleware/error.js";
import { getPublicPlatformStats } from "../services/platform-stats.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
    res.json(await getPublicPlatformStats());
  }),
);

export default router;
