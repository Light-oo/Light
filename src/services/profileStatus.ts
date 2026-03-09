import { createSupabaseAnon, createSupabaseServiceRole } from "../lib/supabase";
import { randomInt } from "node:crypto";

export type ProfileStatus = {
  userId: string;
  role: string | null;
  tokens: number | null;
  whatsappE164: string | null;
  whatsappVerificationStatus: "missing" | "pending" | "verified";
  whatsappVerifiedAt: string | null;
  departmentId: number | null;
  departmentName: string | null;
  whatsappStatus: "missing" | "present";
  profileComplete: boolean;
};

function makeError(code: string, message: string) {
  const error = new Error(message);
  (error as any).code = code;
  return error;
}

function isDemandsStatusConstraintError(error: any) {
  const code = String(error?.code ?? "");
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""} ${error?.constraint ?? ""}`.toLowerCase();
  return code === "23514" && text.includes("demands_status_check");
}

export async function getProfileStatus(accessToken: string, userId: string): Promise<ProfileStatus> {
  const supabase = createSupabaseAnon({ accessToken });
  const { data, error } = await supabase
    .from("profiles")
    .select("id,role,tokens,whatsapp_e164,department_id,whatsapp_verification_status,whatsapp_verified_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const whatsappE164 = (data as any)?.whatsapp_e164 ?? null;
  const hasWhatsapp = Boolean(whatsappE164);
  const rawVerificationStatus = String((data as any)?.whatsapp_verification_status ?? "").toLowerCase();
  const whatsappVerificationStatus: ProfileStatus["whatsappVerificationStatus"] = !hasWhatsapp
    ? "missing"
    : rawVerificationStatus === "pending"
      ? "pending"
      : "verified";
  const whatsappVerifiedAt =
    typeof (data as any)?.whatsapp_verified_at === "string"
      ? (data as any).whatsapp_verified_at
      : null;
  const departmentIdRaw = (data as any)?.department_id;
  const departmentId =
    typeof departmentIdRaw === "number" && Number.isFinite(departmentIdRaw)
      ? departmentIdRaw
      : typeof departmentIdRaw === "string" && departmentIdRaw.trim().length > 0
        ? Number(departmentIdRaw)
        : null;
  let departmentName: string | null = null;
  if (Number.isFinite(departmentId as number) && departmentId !== null) {
    const { data: departmentRow, error: departmentError } = await supabase
      .from("departments")
      .select("name")
      .eq("id", departmentId)
      .maybeSingle();

    if (!departmentError) {
      const rawName = (departmentRow as any)?.name;
      if (typeof rawName === "string" && rawName.trim().length > 0) {
        departmentName = rawName.trim();
      }
    }
  }

  return {
    userId,
    role: (data as any)?.role ?? null,
    tokens: (data as any)?.tokens ?? null,
    whatsappE164,
    whatsappVerificationStatus,
    whatsappVerifiedAt,
    departmentId: Number.isFinite(departmentId as number) ? (departmentId as number) : null,
    departmentName,
    whatsappStatus: hasWhatsapp ? "present" : "missing",
    profileComplete: whatsappVerificationStatus === "verified"
  };
}

export async function requireWhatsappNumber(accessToken: string, userId: string): Promise<ProfileStatus> {
  const status = await getProfileStatus(accessToken, userId);
  if (!status.whatsappE164) {
    throw makeError("WHATSAPP_REQUIRED", "WHATSAPP_REQUIRED");
  }
  return status;
}

export function normalizeWhatsappE164(raw?: string | null) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/[\s-]+/g, "");
  if (!/^\+\d+$/.test(normalized)) {
    return null;
  }

  if (!/^\+503\d{8}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function generateWhatsappVerificationCode() {
  return String(randomInt(100000, 1000000));
}

export async function setWhatsappForCurrentUser(
  accessToken: string,
  userId: string,
  whatsappE164: string | null
) {
  const supabase = createSupabaseAnon({ accessToken });
  const { data: currentProfile, error: currentProfileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (currentProfileError) {
    throw currentProfileError;
  }

  if (!currentProfile) {
    throw makeError("PROFILE_NOT_FOUND", "profile_not_found");
  }

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
      throw makeError("WHATSAPP_IN_USE", "whatsapp_already_in_use");
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
    throw makeError("PROFILE_NOT_FOUND", "profile_not_found");
  }

  if (whatsappE164 === null) {
    let demandDeactivateError: any = null;
    for (const nextDemandStatus of ["inactive", "closed", "cancelled"]) {
      const { error: deactivateDemandsError } = await supabase
        .from("demands")
        .update({ status: nextDemandStatus })
        .eq("requester_user_id", userId)
        .eq("status", "open");

      if (!deactivateDemandsError) {
        demandDeactivateError = null;
        break;
      }

      if (isDemandsStatusConstraintError(deactivateDemandsError)) {
        demandDeactivateError = deactivateDemandsError;
        continue;
      }

      throw deactivateDemandsError;
    }

    if (demandDeactivateError) {
      throw demandDeactivateError;
    }

    const { error: deactivateListingsError } = await supabase
      .from("listings")
      .update({ status: "inactive" })
      .eq("seller_profile_id", userId)
      .eq("listing_type", "sell")
      .eq("status", "active");

    if (deactivateListingsError) {
      throw deactivateListingsError;
    }
  }
}

export async function startWhatsappVerificationForCurrentUser(
  accessToken: string,
  userId: string,
  whatsappE164: string
) {
  const supabase = createSupabaseAnon({ accessToken });
  const { data: currentProfile, error: currentProfileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (currentProfileError) {
    throw currentProfileError;
  }

  if (!currentProfile) {
    throw makeError("PROFILE_NOT_FOUND", "profile_not_found");
  }

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
    throw makeError("WHATSAPP_IN_USE", "whatsapp_already_in_use");
  }

  const verificationCode = generateWhatsappVerificationCode();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      whatsapp_e164: whatsappE164,
      whatsapp_verification_status: "pending",
      whatsapp_verified_at: null,
      whatsapp_verification_code: verificationCode
    })
    .eq("id", userId)
    .select("whatsapp_e164,whatsapp_verification_status,whatsapp_verification_code,whatsapp_verified_at")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw makeError("PROFILE_NOT_FOUND", "profile_not_found");
  }

  return {
    whatsappE164: String((data as any)?.whatsapp_e164 ?? whatsappE164),
    whatsappVerificationStatus: String((data as any)?.whatsapp_verification_status ?? "pending"),
    whatsappVerificationCode: String((data as any)?.whatsapp_verification_code ?? verificationCode),
    whatsappVerifiedAt:
      typeof (data as any)?.whatsapp_verified_at === "string"
        ? (data as any).whatsapp_verified_at
        : null
  };
}
