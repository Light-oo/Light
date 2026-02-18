import { createSupabaseAnon, createSupabaseServiceRole } from "../lib/supabase";
import { env } from "../config/env";
import { consumeFixedWindow } from "../lib/rateLimit";

type VerificationSource = "profiles" | "auth_metadata";

type VerificationState = {
  source: VerificationSource;
  code: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
};

export type ProfileStatus = {
  userId: string;
  role: string | null;
  tokens: number | null;
  whatsappE164: string | null;
  whatsappStatus: "missing" | "unverified" | "verified";
  whatsappVerified: boolean;
  profileComplete: boolean;
  verificationSource: VerificationSource;
};

const resendCooldownMs = env.VERIFY_CODE_COOLDOWN_SECONDS * 1000;
const codeTtlMs = 10 * 60 * 1000;
const verifyWindowMs = 60 * 60 * 1000;
const verifyMaxPerWindow = env.VERIFY_CODE_MAX_PER_HOUR;
const lastCodeSentAtByUser = new Map<string, number>();
const verifyAttemptsByUser = new Map<string, { count: number; startedAtMs: number }>();

function isMissingColumnError(error: any) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  return code === "42703" || message.includes("does not exist");
}

function parseTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function getWhatsappStatus(whatsappE164: string | null, verifiedAt: string | null) {
  if (!whatsappE164) {
    return "missing" as const;
  }
  if (verifiedAt) {
    return "verified" as const;
  }
  return "unverified" as const;
}

async function readVerificationStateFromProfiles(accessToken: string, userId: string) {
  const supabase = createSupabaseAnon({ accessToken });
  const { data, error } = await supabase
    .from("profiles")
    .select("whatsapp_verify_code,whatsapp_verify_expires_at,whatsapp_verified_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) {
      return null;
    }
    throw error;
  }

  return {
    source: "profiles" as const,
    code: (data as any)?.whatsapp_verify_code ?? null,
    expiresAt: (data as any)?.whatsapp_verify_expires_at ?? null,
    verifiedAt: (data as any)?.whatsapp_verified_at ?? null
  };
}

async function readVerificationStateFromAuthMetadata(userId: string) {
  const service = createSupabaseServiceRole();
  const { data, error } = await service.auth.admin.getUserById(userId);

  if (error) {
    throw error;
  }

  const metadata = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  return {
    source: "auth_metadata" as const,
    code: typeof metadata.whatsapp_verify_code === "string" ? metadata.whatsapp_verify_code : null,
    expiresAt: typeof metadata.whatsapp_verify_expires_at === "string" ? metadata.whatsapp_verify_expires_at : null,
    verifiedAt: typeof metadata.whatsapp_verified_at === "string" ? metadata.whatsapp_verified_at : null
  };
}

async function readVerificationState(accessToken: string, userId: string): Promise<VerificationState> {
  const fromProfile = await readVerificationStateFromProfiles(accessToken, userId);
  if (fromProfile) {
    return fromProfile;
  }
  return readVerificationStateFromAuthMetadata(userId);
}

async function writeVerificationStateToProfiles(
  accessToken: string,
  userId: string,
  patch: {
    code?: string | null;
    expiresAt?: string | null;
    verifiedAt?: string | null;
  }
) {
  const supabase = createSupabaseAnon({ accessToken });
  const payload: Record<string, string | null> = {};
  if ("code" in patch) payload.whatsapp_verify_code = patch.code ?? null;
  if ("expiresAt" in patch) payload.whatsapp_verify_expires_at = patch.expiresAt ?? null;
  if ("verifiedAt" in patch) payload.whatsapp_verified_at = patch.verifiedAt ?? null;

  const { error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", userId);

  if (error) {
    if (isMissingColumnError(error)) {
      return false;
    }
    throw error;
  }

  return true;
}

async function writeVerificationStateToAuthMetadata(
  userId: string,
  patch: {
    code?: string | null;
    expiresAt?: string | null;
    verifiedAt?: string | null;
  }
) {
  const service = createSupabaseServiceRole();
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error) {
    throw error;
  }

  const current = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  if ("code" in patch) next.whatsapp_verify_code = patch.code ?? null;
  if ("expiresAt" in patch) next.whatsapp_verify_expires_at = patch.expiresAt ?? null;
  if ("verifiedAt" in patch) next.whatsapp_verified_at = patch.verifiedAt ?? null;

  const { error: updateError } = await service.auth.admin.updateUserById(userId, {
    user_metadata: next
  });

  if (updateError) {
    throw updateError;
  }
}

async function writeVerificationState(
  accessToken: string,
  userId: string,
  source: VerificationSource,
  patch: {
    code?: string | null;
    expiresAt?: string | null;
    verifiedAt?: string | null;
  }
) {
  if (source === "profiles") {
    const doneInProfiles = await writeVerificationStateToProfiles(accessToken, userId, patch);
    if (doneInProfiles) {
      return;
    }
  }
  await writeVerificationStateToAuthMetadata(userId, patch);
}

function hasAnyVerificationData(state: VerificationState) {
  return Boolean(state.code || state.expiresAt || state.verifiedAt);
}

async function reconcileVerificationState(
  accessToken: string,
  userId: string,
  whatsappE164: string | null,
  state: VerificationState
) {
  // If phone is missing, verification data must be fully reset.
  if (!whatsappE164 && hasAnyVerificationData(state)) {
    await writeVerificationState(accessToken, userId, state.source, {
      code: null,
      expiresAt: null,
      verifiedAt: null
    });
    return {
      ...state,
      code: null,
      expiresAt: null,
      verifiedAt: null
    };
  }

  // If already verified, verification code fields should not linger.
  if (state.verifiedAt && (state.code || state.expiresAt)) {
    await writeVerificationState(accessToken, userId, state.source, {
      code: null,
      expiresAt: null
    });
    return {
      ...state,
      code: null,
      expiresAt: null
    };
  }

  return state;
}

export async function getProfileStatus(accessToken: string, userId: string): Promise<ProfileStatus> {
  const supabase = createSupabaseAnon({ accessToken });
  const { data, error } = await supabase
    .from("profiles")
    .select("id,role,tokens,whatsapp_e164")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const whatsappE164 = (data as any)?.whatsapp_e164 ?? null;
  const rawVerificationState = await readVerificationState(accessToken, userId);
  const verificationState = await reconcileVerificationState(
    accessToken,
    userId,
    whatsappE164,
    rawVerificationState
  );
  const whatsappStatus = getWhatsappStatus(whatsappE164, verificationState.verifiedAt);
  const profileComplete = whatsappE164 !== null && verificationState.verifiedAt !== null;
  return {
    userId,
    role: (data as any)?.role ?? null,
    tokens: (data as any)?.tokens ?? null,
    whatsappE164,
    whatsappStatus,
    whatsappVerified: profileComplete,
    profileComplete,
    verificationSource: verificationState.source
  };
}

export function normalizeWhatsappE164(raw?: string | null) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }

  if (hasPlus) {
    return `+${digits}`;
  }

  if (digits.startsWith("503") && digits.length > 8) {
    return `+${digits}`;
  }

  return `+503${digits}`;
}

export async function setWhatsappForCurrentUser(
  accessToken: string,
  userId: string,
  whatsappE164: string | null
) {
  const supabase = createSupabaseAnon({ accessToken });
  const { data: currentProfile, error: currentProfileError } = await supabase
    .from("profiles")
    .select("id,whatsapp_e164")
    .eq("id", userId)
    .maybeSingle();

  if (currentProfileError) {
    throw currentProfileError;
  }

  if (!currentProfile) {
    const missingProfileError = new Error("profile_not_found");
    (missingProfileError as any).code = "PROFILE_NOT_FOUND";
    throw missingProfileError;
  }

  const currentWhatsapp = (currentProfile as any).whatsapp_e164 ?? null;

  if (whatsappE164) {
    const service = createSupabaseServiceRole();
    const { data: alreadyUsed, error: duplicateCheckError } = await service
      .from("profiles")
      .select("id")
      .eq("whatsapp_e164", whatsappE164)
      .neq("id", userId)
      .limit(1)
      .maybeSingle();

    if (duplicateCheckError) {
      throw duplicateCheckError;
    }

    if (alreadyUsed) {
      const duplicateError = new Error("whatsapp_already_in_use");
      (duplicateError as any).code = "WHATSAPP_IN_USE";
      throw duplicateError;
    }
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ whatsapp_e164: whatsappE164 })
    .eq("id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    const missingProfileError = new Error("profile_not_found");
    (missingProfileError as any).code = "PROFILE_NOT_FOUND";
    throw missingProfileError;
  }

  const shouldResetVerification =
    whatsappE164 === null || currentWhatsapp !== whatsappE164;

  if (shouldResetVerification) {
    const verificationState = await readVerificationState(accessToken, userId);
    await writeVerificationState(accessToken, userId, verificationState.source, {
      code: null,
      expiresAt: null,
      verifiedAt: null
    });
  }
}

export async function generateVerificationCode(accessToken: string, userId: string) {
  const status = await getProfileStatus(accessToken, userId);
  if (!status.whatsappE164) {
    return { ok: false as const, error: "add_whatsapp_first" as const };
  }
  if (status.profileComplete) {
    return { ok: false as const, error: "already_verified" as const };
  }

  const now = Date.now();
  const lastSent = lastCodeSentAtByUser.get(userId) ?? 0;
  if (now - lastSent < resendCooldownMs) {
    return { ok: false as const, error: "cooldown_active" as const };
  }

  const rateResult = consumeFixedWindow(
    verifyAttemptsByUser,
    userId,
    verifyMaxPerWindow,
    verifyWindowMs
  );
  if (!rateResult.allowed) {
    return {
      ok: false as const,
      error: "rate_limited" as const
    };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(now + codeTtlMs).toISOString();

  const verificationState = await readVerificationState(accessToken, userId);
  await writeVerificationState(accessToken, userId, verificationState.source, {
    code,
    expiresAt,
    verifiedAt: null
  });

  lastCodeSentAtByUser.set(userId, now);

  return {
    ok: true as const,
    data: {
      code,
      expiresAt,
      pilotOnly: true
    }
  };
}

export async function verifyWhatsappCode(accessToken: string, userId: string, code: string) {
  const status = await getProfileStatus(accessToken, userId);
  if (!status.whatsappE164) {
    return { ok: false as const, error: "add_whatsapp_first" as const };
  }
  if (status.profileComplete) {
    return { ok: false as const, error: "already_verified" as const };
  }

  const state = await readVerificationState(accessToken, userId);
  if (!state.code || state.code !== code) {
    return { ok: false as const, error: "invalid_code" as const };
  }

  const expiresAtMs = parseTimestampMs(state.expiresAt);
  if (!expiresAtMs || expiresAtMs < Date.now()) {
    await writeVerificationState(accessToken, userId, state.source, {
      code: null,
      expiresAt: null
    });
    return { ok: false as const, error: "code_expired" as const };
  }

  const verifiedAt = new Date().toISOString();
  await writeVerificationState(accessToken, userId, state.source, {
    code: null,
    expiresAt: null,
    verifiedAt
  });

  return {
    ok: true as const,
    data: { verifiedAt }
  };
}
