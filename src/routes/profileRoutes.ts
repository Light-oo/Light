import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { logError, logInfo, logWarn } from "../lib/logger";
import {
  getProfileStatus,
  normalizeWhatsappE164,
  startWhatsappVerificationForCurrentUser,
  setWhatsappForCurrentUser
} from "../services/profileStatus";

const router = Router();

const setWhatsappBodySchema = z.object({
  whatsapp: z.union([z.string(), z.null()])
}).strict();
const startWhatsappVerificationBodySchema = z.object({
  whatsapp: z.string().min(1)
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
        whatsappVerificationStatus: status.whatsappVerificationStatus,
        whatsappVerifiedAt: status.whatsappVerifiedAt,
        departmentId: status.departmentId,
        departmentName: status.departmentName,
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
        whatsappVerificationStatus: status.whatsappVerificationStatus,
        whatsappVerifiedAt: status.whatsappVerifiedAt,
        departmentId: status.departmentId,
        departmentName: status.departmentName,
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

router.post("/profile/whatsapp/verification/start", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof startWhatsappVerificationBodySchema>;
  try {
    parsed = startWhatsappVerificationBodySchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  const normalized = normalizeWhatsappE164(parsed.whatsapp);
  if (!normalized) {
    return res.status(400).json({ ok: false, error: "INVALID_WHATSAPP_NUMBER" });
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;

  try {
    const verification = await startWhatsappVerificationForCurrentUser(authToken, userId, normalized);
    logInfo(req, "whatsapp_verification_started", {
      userId,
      whatsappVerificationStatus: verification.whatsappVerificationStatus
    });
    return res.json({
      ok: true,
      data: {
        whatsappE164: verification.whatsappE164,
        whatsappVerificationStatus: verification.whatsappVerificationStatus,
        whatsappVerificationCode: verification.whatsappVerificationCode,
        whatsappVerifiedAt: verification.whatsappVerifiedAt
      }
    });
  } catch (error: any) {
    if (String(error?.code ?? "") === "PROFILE_NOT_FOUND") {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    if (isDuplicateWhatsappError(error)) {
      logWarn(req, "whatsapp_verification_duplicate", { userId });
      return res.status(409).json({
        ok: false,
        error: "whatsapp_already_in_use"
      });
    }
    logError(req, "whatsapp_verification_start_error", {
      userId,
      code: error?.code,
      message: error?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

export default router;
