import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { logError, logInfo, logWarn } from "../lib/logger";
import { createSupabaseAnon } from "../lib/supabase";
import { requireWhatsappNumber } from "../services/profileStatus";

const router = Router();

const bodySchema = z
  .object({
    listingId: z.string().uuid().optional(),
    demandId: z.string().uuid().optional()
  })
  .strict()
  .refine((value) => {
    const count = Number(Boolean(value.listingId)) + Number(Boolean(value.demandId));
    return count === 1;
  }, {
    message: "Provide exactly one of listingId or demandId.",
    path: ["listingId"]
  });

function toWhatsAppUrl(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  return `https://wa.me/${digits}`;
}

async function consumeRevealRateLimit(
  supabase: ReturnType<typeof createSupabaseAnon>,
  userId: string
) {
  const { data, error } = await supabase.rpc("consume_reveal_rate_limit", {
    p_user_id: userId
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean((row as any)?.allowed),
    retryAfterMs: Math.max(0, Number((row as any)?.retry_after_ms ?? 0) || 0)
  };
}

router.post("/contact-access", requireAuth, async (req, res, next) => {
  let listingId: string | undefined;
  let demandId: string | undefined;
  try {
    ({ listingId, demandId } = bodySchema.parse(req.body));
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  try {
    await requireWhatsappNumber(authToken, userId);
  } catch (profileStatusError: any) {
    if (String(profileStatusError?.code ?? "") === "WHATSAPP_REQUIRED") {
      logWarn(req, "reveal_blocked_whatsapp_missing", { userId, listingId: listingId ?? null, demandId: demandId ?? null });
      return res.status(403).json({ ok: false, error: "WHATSAPP_REQUIRED" });
    }
    logError(req, "profile_status_error", {
      code: profileStatusError?.code,
      message: profileStatusError?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  let rateLimit;
  try {
    rateLimit = await consumeRevealRateLimit(supabase, userId);
  } catch (rateLimitError: any) {
    logError(req, "reveal_rate_limit_error", {
      code: rateLimitError?.code,
      message: rateLimitError?.message,
      details: rateLimitError?.details,
      hint: rateLimitError?.hint
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!rateLimit.allowed) {
    logWarn(req, "reveal_rate_limited", {
      userId,
      listingId: listingId ?? null,
      demandId: demandId ?? null,
      retryAfterMs: rateLimit.retryAfterMs
    });
    return res.status(429).json({ ok: false, error: "RATE_LIMIT_EXCEEDED" });
  }

  if (demandId) {
    const { data: demandRow, error: demandLookupError } = await supabase
      .from("demands")
      .select("id,requester_user_id,status")
      .eq("id", demandId)
      .limit(1)
      .maybeSingle();

    if (demandLookupError) {
      logError(req, "reveal_demand_lookup_error", {
        code: demandLookupError.code,
        message: demandLookupError.message,
        details: (demandLookupError as any)?.details,
        hint: (demandLookupError as any)?.hint
      });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    if (!demandRow || (demandRow as any).status !== "open") {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    if ((demandRow as any).requester_user_id === userId) {
      return res.status(403).json({ ok: false, error: "OWN_DEMAND_REVEAL_BLOCKED" });
    }

    const { data, error } = await supabase.rpc("consume_token_and_get_demand_whatsapp", {
      p_demand_id: demandId
    });

    if (error) {
      const code = (error as any)?.code ?? "";
      const message = (error as any)?.message ?? "";

      if (code === "P0001" && message === "insufficient_tokens") {
        return res.status(402).json({ ok: false, error: "insufficient_tokens" });
      }
      if (code === "P0001" && message === "demand_not_active") {
        return res.status(400).json({ ok: false, error: "demand_not_active" });
      }
      if (code === "P0001" && message === "demand_has_no_contact") {
        return res.status(400).json({ ok: false, error: "demand_has_no_contact" });
      }
      if (code === "P0001" && message === "own_demand_reveal_blocked") {
        return res.status(403).json({ ok: false, error: "OWN_DEMAND_REVEAL_BLOCKED" });
      }

      logError(req, "reveal_demand_rpc_error", {
        code,
        message,
        details: (error as any)?.details,
        hint: (error as any)?.hint
      });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    const row = Array.isArray(data) ? data[0] : data;
    const whatsappRaw = (row as any)?.whatsapp_e164 ?? null;
    const didConsume = (row as any)?.did_consume ?? null;
    const whatsappUrl = whatsappRaw ? toWhatsAppUrl(whatsappRaw) : null;
    if (!whatsappUrl) {
      return res.status(400).json({ ok: false, error: "demand_has_no_contact" });
    }

    logInfo(req, "reveal_completed", {
      userId,
      targetType: "demand",
      demandId,
      didConsume
    });

    return res.json({
      ok: true,
      data: { demandId, whatsappUrl, didConsume }
    });
  }

  if (!listingId) {
    return res.status(400).json({ ok: false, error: "invalid_request" });
  }

  const { data: ownListingRow, error: ownListingCheckError } = await supabase
    .from("listings")
    .select("id")
    .eq("id", listingId)
    .eq("seller_profile_id", userId)
    .limit(1)
    .maybeSingle();

  if (ownListingCheckError) {
    logError(req, "reveal_listing_ownership_check_error", {
      code: ownListingCheckError.code,
      message: ownListingCheckError.message,
      details: (ownListingCheckError as any)?.details,
      hint: (ownListingCheckError as any)?.hint
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (ownListingRow) {
    return res.status(403).json({ ok: false, error: "CANNOT_REVEAL_OWN_LISTING" });
  }

  // Pilot invariant: only active SELL listings are revealable.
  const { data: activeCard, error: activeCardError } = await supabase
    .from("market_sell_cards_view")
    .select("listing_id")
    .eq("listing_id", listingId)
    .maybeSingle();

  if (activeCardError) {
    logError(req, "reveal_listing_active_check_error", {
      code: activeCardError.code,
      message: activeCardError.message,
      details: (activeCardError as any)?.details,
      hint: (activeCardError as any)?.hint
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!activeCard) {
    return res.status(400).json({ ok: false, error: "listing_not_active" });
  }

  const { data, error } = await supabase.rpc(
    "consume_token_and_get_whatsapp",
    { p_listing_id: listingId }
  );

  if (error) {
  const code = (error as any)?.code ?? "";
  const message = (error as any)?.message ?? "";

  // Treat the RPC-raised exception as a first-class business error
  if (code === "P0001" && message === "insufficient_tokens") {
    return res.status(402).json({ ok: false, error: "insufficient_tokens" });
  }
  if (code === "P0001" && message === "listing_not_active") {
    return res.status(400).json({ ok: false, error: "listing_not_active" });
  }

  logError(req, "reveal_listing_rpc_error", {
    code,
    message,
    details: (error as any)?.details,
    hint: (error as any)?.hint
  });
  return res.status(500).json({ ok: false, error: "unexpected_error" });
}


  const row = Array.isArray(data) ? data[0] : data;
  const whatsappRaw = (row as any)?.whatsapp_e164 ?? null;
  const didConsume = (row as any)?.did_consume ?? null;
  const whatsappUrl = whatsappRaw ? toWhatsAppUrl(whatsappRaw) : null;
  if (!whatsappUrl) {
    return res.status(400).json({ ok: false, error: "listing_has_no_contact" });
  }

  logInfo(req, "reveal_completed", {
    userId,
    targetType: "listing",
    listingId,
    didConsume
  });

  return res.json({
    ok: true,
    data: { listingId, whatsappUrl, didConsume }
  });
});

export default router;
