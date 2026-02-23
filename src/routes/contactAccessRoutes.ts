import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { logWarn } from "../lib/logger";
import { createSupabaseAnon } from "../lib/supabase";
import { getProfileStatus } from "../services/profileStatus";

const router = Router();

const bodySchema = z.object({
  listingId: z.string().uuid()
});

function toWhatsAppUrl(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  return `https://wa.me/${digits}`;
}

router.post("/contact-access", requireAuth, async (req, res, next) => {
  let listingId: string;
  try {
    ({ listingId } = bodySchema.parse(req.body));
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  try {
    const profileStatus = await getProfileStatus(authToken, userId);
    if (!profileStatus.profileComplete) {
      logWarn(req, "reveal_blocked_profile_incomplete", { userId, listingId });
      return res.status(400).json({ ok: false, error: "add_whatsapp_first" });
    }
  } catch (profileStatusError: any) {
    console.error("profile_status_error", {
      code: profileStatusError?.code,
      message: profileStatusError?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
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
