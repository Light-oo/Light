import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { requireAuth } from "../middleware/requireAuth";
import { logError, logInfo, logWarn } from "../lib/logger";
import { consumeFixedWindow } from "../lib/rateLimit";
import { createSupabaseAnon, createSupabaseServiceRole } from "../lib/supabase";

const router = Router();
const service = createSupabaseServiceRole();
const signupRateStore = new Map<string, { count: number; startedAtMs: number }>();
const signupRateMax = env.SIGNUP_RATE_LIMIT_MAX_PER_HOUR;
const signupRateWindowMs = 60 * 60 * 1000;

const signupBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  confirm_password: z.string().min(1)
}).superRefine((value, ctx) => {
  if (value.password !== value.confirm_password) {
    ctx.addIssue({
      path: ["confirm_password"],
      code: z.ZodIssueCode.custom,
      message: "password_mismatch"
    });
  }
});

router.get("/auth/ping", requireAuth, (req, res) => {
  const user = (req as unknown as { user: { id: string } }).user;
  res.json({ ok: true, userId: user.id });
});

router.post("/auth/signup", async (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const rateKey = `signup:${ip}`;
  const rateResult = consumeFixedWindow(
    signupRateStore,
    rateKey,
    signupRateMax,
    signupRateWindowMs
  );
  if (!rateResult.allowed) {
    logWarn(req, "signup_rate_limited", { ip, retryAfterSeconds: rateResult.retryAfterSeconds });
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }

  let parsed: z.infer<typeof signupBodySchema>;
  try {
    parsed = signupBodySchema.parse(req.body);
  } catch (err) {
    return next(err);
  }
  logInfo(req, "signup_attempt", { ip, emailDomain: parsed.email.split("@")[1] ?? null });

  const { data: createdUser, error: createError } = await service.auth.admin.createUser({
    email: parsed.email,
    password: parsed.password,
    email_confirm: true
  });

  if (createError) {
    const message = String(createError.message ?? "").toLowerCase();
    if (message.includes("already") || message.includes("registered")) {
      logWarn(req, "signup_email_exists", { ip });
      return res.status(409).json({ ok: false, error: "email_already_in_use" });
    }

    logError(req, "signup_create_error", {
      ip,
      message: createError.message,
      status: (createError as any)?.status
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  const userId = createdUser.user?.id;
  if (!userId) {
    logError(req, "signup_missing_user_id", { ip });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  const anon = createSupabaseAnon();
  const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({
    email: parsed.email,
    password: parsed.password
  });

  if (signInError || !signedIn.session) {
    logError(req, "signup_signin_error", {
      ip,
      message: signInError?.message,
      status: (signInError as any)?.status
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  logInfo(req, "signup_success", { ip, userId });

  return res.status(201).json({
    ok: true,
    data: {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
      expires_in: signedIn.session.expires_in,
      token_type: signedIn.session.token_type,
      user: {
        id: signedIn.user.id,
        email: signedIn.user.email ?? parsed.email
      }
    }
  });
});

export default router;
