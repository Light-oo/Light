import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { logError, logInfo, logWarn } from "../lib/logger";
import {
  getProfileStatus,
  normalizeWhatsappE164,
  setWhatsappForCurrentUser
} from "../services/profileStatus";

const router = Router();

const setWhatsappBodySchema = z.object({
  whatsapp: z.union([z.string(), z.null()])
}).strict();

function isDuplicateWhatsappError(error: any) {
  const code = String(error?.code ?? "");
  if (code === "WHATSAPP_IN_USE") {
    return true;
  }
  if (code === "23505") {
    return true;
  }
  return String(error?.message ?? "").toLowerCase().includes("whatsapp");
}

router.get("/profile/status", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;

  try {
    const status = await getProfileStatus(authToken, userId);
    return res.json({
      ok: true,
      data: {
        role: status.role,
        tokens: status.tokens,
        whatsappE164: status.whatsappE164,
        whatsappStatus: status.whatsappStatus,
        profileComplete: status.profileComplete
      }
    });
  } catch (error: any) {
    logError(req, "profile_status_error", {
      userId,
      code: error?.code,
      message: error?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

router.post("/profile/whatsapp", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof setWhatsappBodySchema>;
  try {
    parsed = setWhatsappBodySchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  const rawWhatsapp = typeof parsed.whatsapp === "string" ? parsed.whatsapp : null;
  const normalized = normalizeWhatsappE164(rawWhatsapp);
  if (rawWhatsapp !== null && rawWhatsapp.trim() !== "" && !normalized) {
    return res.status(400).json({ ok: false, error: "INVALID_WHATSAPP_NUMBER" });
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;

  try {
    await setWhatsappForCurrentUser(authToken, userId, normalized);
    const status = await getProfileStatus(authToken, userId);
    logInfo(req, "whatsapp_set", {
      userId,
      whatsappStatus: status.whatsappStatus
    });
    return res.json({
      ok: true,
      data: {
        whatsappE164: status.whatsappE164,
        whatsappStatus: status.whatsappStatus,
        profileComplete: status.profileComplete
      }
    });
  } catch (error: any) {
    if (String(error?.code ?? "") === "PROFILE_NOT_FOUND") {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    if (isDuplicateWhatsappError(error)) {
      logWarn(req, "whatsapp_set_duplicate", { userId });
      return res.status(409).json({
        ok: false,
        error: "whatsapp_already_in_use"
      });
    }
    logError(req, "set_whatsapp_error", {
      userId,
      code: error?.code,
      message: error?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

export default router;
