import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.get("/auth/ping", requireAuth, (req, res) => {
  const user = (req as unknown as { user: { id: string } }).user;
  res.json({ ok: true, userId: user.id });
});

export default router;
