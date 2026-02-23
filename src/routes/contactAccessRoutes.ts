import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { logWarn } from "../lib/logger";
import { createSupabaseAnon } from "../lib/supabase";
import { requireWhatsappNumber } from "../services/profileStatus";

const router = Router();

type RevealRateBucket = {
  lastRevealAtMs: number | null;
  revealTimestampsMs: number[];
};

const revealRateStore = new Map<string, RevealRateBucket>();
const revealMinIntervalMs = 2_000;
const revealRollingWindowMs = 60_000;
const revealRollingWindowMax = 10;

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

function consumeRevealRateLimit(userId: string) {
  const now = Date.now();
  const current = revealRateStore.get(userId) ?? {
    lastRevealAtMs: null,
    revealTimestampsMs: []
  };

  if (current.lastRevealAtMs !== null && now - current.lastRevealAtMs < revealMinIntervalMs) {
    return {
      allowed: false,
      retryAfterMs: revealMinIntervalMs - (now - current.lastRevealAtMs)
    };
  }

  const windowStart = now - revealRollingWindowMs;
  const recent = current.revealTimestampsMs.filter((ts) => ts > windowStart);

  if (recent.length >= revealRollingWindowMax) {
    const oldestInWindow = recent[0] ?? now;
    return {
      allowed: false,
      retryAfterMs: Math.max(0, oldestInWindow + revealRollingWindowMs - now)
    };
  }

  recent.push(now);
  revealRateStore.set(userId, {
    lastRevealAtMs: now,
    revealTimestampsMs: recent
  });

  return { allowed: true as const, retryAfterMs: 0 };
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
    console.error("profile_status_error", {
      code: profileStatusError?.code,
      message: profileStatusError?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  const rateLimit = consumeRevealRateLimit(userId);
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
      console.error("supabase_error", {
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

      console.error("supabase_error", {
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
    console.error("supabase_error", {
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
    console.error("supabase_error", {
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

  console.error("supabase_error", {
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

  return res.json({
    ok: true,
    data: { listingId, whatsappUrl, didConsume }
  });
});

export default router;
