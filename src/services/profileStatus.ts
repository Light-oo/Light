import { createSupabaseAnon, createSupabaseServiceRole } from "../lib/supabase";

export type ProfileStatus = {
  userId: string;
  role: string | null;
  tokens: number | null;
  whatsappE164: string | null;
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
    .select("id,role,tokens,whatsapp_e164")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const whatsappE164 = (data as any)?.whatsapp_e164 ?? null;
  const hasWhatsapp = Boolean(whatsappE164);

  return {
    userId,
    role: (data as any)?.role ?? null,
    tokens: (data as any)?.tokens ?? null,
    whatsappE164,
    whatsappStatus: hasWhatsapp ? "present" : "missing",
    profileComplete: hasWhatsapp
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
