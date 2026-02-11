import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { createSupabaseAnon } from "../lib/supabase";

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
  const supabase = createSupabaseAnon({ accessToken: authToken });

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
