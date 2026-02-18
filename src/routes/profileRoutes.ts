import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { env } from "../config/env";
import { logError, logInfo, logWarn } from "../lib/logger";
import {
  generateVerificationCode,
  getProfileStatus,
  normalizeWhatsappE164,
  setWhatsappForCurrentUser,
  verifyWhatsappCode
} from "../services/profileStatus";

const router = Router();

const setWhatsappBodySchema = z.object({
  whatsapp: z.union([z.string(), z.null()])
}).strict();

const verifyCodeBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/)
}).strict();

function shouldExposeVerifyCode() {
  if (typeof env.PILOT_EXPOSE_VERIFY_CODE === "boolean") {
    return env.PILOT_EXPOSE_VERIFY_CODE;
  }
  return env.NODE_ENV !== "production";
}

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
        whatsappVerified: status.whatsappVerified,
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
    return res.status(400).json({
      ok: false,
      error: "invalid_request",
      issues: [
        {
          path: "whatsapp",
          message: "invalid_whatsapp",
          code: "custom"
        }
      ]
    });
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
        whatsappVerified: status.whatsappVerified,
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

router.post("/profile/whatsapp/verify-code/generate", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;

  try {
    const result = await generateVerificationCode(authToken, userId);
    if (!result.ok) {
      if (result.error === "add_whatsapp_first") {
        return res.status(400).json({ ok: false, error: "add_whatsapp_first" });
      }
      if (result.error === "cooldown_active") {
        return res.status(400).json({ ok: false, error: "cooldown_active" });
      }
      if (result.error === "rate_limited") {
        return res.status(429).json({ ok: false, error: "rate_limited" });
      }
      if (result.error === "already_verified") {
        return res.status(400).json({ ok: false, error: "already_verified" });
      }
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    logInfo(req, "verify_code_generated", { userId });
    const data = shouldExposeVerifyCode()
      ? result.data
      : {
          expiresAt: result.data.expiresAt
        };

    return res.json({
      ok: true,
      data
    });
  } catch (error: any) {
    logError(req, "generate_verify_code_error", {
      userId,
      code: error?.code,
      message: error?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

router.post("/profile/whatsapp/verify-code/resend", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;

  try {
    const result = await generateVerificationCode(authToken, userId);
    if (!result.ok) {
      if (result.error === "add_whatsapp_first") {
        return res.status(400).json({ ok: false, error: "add_whatsapp_first" });
      }
      if (result.error === "cooldown_active") {
        return res.status(400).json({ ok: false, error: "cooldown_active" });
      }
      if (result.error === "rate_limited") {
        return res.status(429).json({ ok: false, error: "rate_limited" });
      }
      if (result.error === "already_verified") {
        return res.status(400).json({ ok: false, error: "already_verified" });
      }
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    logInfo(req, "verify_code_resent", { userId });
    const data = shouldExposeVerifyCode()
      ? result.data
      : {
          expiresAt: result.data.expiresAt
        };

    return res.json({
      ok: true,
      data
    });
  } catch (error: any) {
    logError(req, "resend_verify_code_error", {
      userId,
      code: error?.code,
      message: error?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

router.post("/profile/whatsapp/verify-code/confirm", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof verifyCodeBodySchema>;
  try {
    parsed = verifyCodeBodySchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;

  try {
    const result = await verifyWhatsappCode(authToken, userId, parsed.code);
    if (!result.ok) {
      if (result.error === "add_whatsapp_first") {
        return res.status(400).json({ ok: false, error: "add_whatsapp_first" });
      }
      if (result.error === "invalid_code") {
        return res.status(400).json({ ok: false, error: "invalid_code" });
      }
      if (result.error === "code_expired") {
        return res.status(400).json({ ok: false, error: "code_expired" });
      }
      if (result.error === "already_verified") {
        return res.status(400).json({ ok: false, error: "already_verified" });
      }
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    const status = await getProfileStatus(authToken, userId);
    logInfo(req, "verify_code_confirmed", {
      userId,
      profileComplete: status.profileComplete
    });
    return res.json({
      ok: true,
      data: {
        verifiedAt: result.ok ? result.data.verifiedAt : null,
        whatsappStatus: status.whatsappStatus,
        whatsappVerified: status.whatsappVerified,
        profileComplete: status.profileComplete
      }
    });
  } catch (error: any) {
    logError(req, "confirm_verify_code_error", {
      userId,
      code: error?.code,
      message: error?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

export default router;
