import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { logWarn } from "../lib/logger";
import { createSupabaseAnon } from "../lib/supabase";
import { requireWhatsappNumber } from "../services/profileStatus";
import {
  createMarketAwareSellListing,
  MarketListingCreationError
} from "../services/marketListingCreation";

const router = Router();

const locationSchema = z.object({
  department: z.string().trim().min(1),
  municipality: z.string().trim().min(1)
});

const createListingSchema = z.object({
  marketKey: z.string().trim().min(1),
  price: z
    .object({
      amount: z.unknown().optional(),
      type: z.unknown().optional()
    })
    .strict()
    .optional(),
  location: locationSchema.optional()
}).passthrough();

const listingIdParamSchema = z.object({
  listingId: z.string().uuid()
});

const statusBodySchema = z.object({
  status: z.union([z.literal("active"), z.literal("inactive")])
}).strict();

function logDbError(step: string, error: any) {
  console.error("listings_step_error", {
    step,
    code: error?.code,
    constraint: error?.constraint,
    message: error?.message,
    details: error?.details,
    hint: error?.hint
  });
}

router.post("/listings", requireAuth, async (req, res, next) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    logDbError("profile_select", profileError);
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!profile) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  let parsed: z.infer<typeof createListingSchema>;
  try {
    parsed = createListingSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  try {
    await requireWhatsappNumber(authToken, userId);
  } catch (profileStatusError: any) {
    if (String(profileStatusError?.code ?? "") === "WHATSAPP_REQUIRED") {
      return res.status(403).json({
        ok: false,
        error: "WHATSAPP_REQUIRED",
        message: "WhatsApp is required.",
        marketKey: typeof req.body?.marketKey === "string" ? req.body.marketKey.trim().toLowerCase() : undefined
      });
    }
    logDbError("profile_status", profileStatusError);
    return res.status(500).json({
      ok: false,
      error: "unexpected_error",
      message: "Unexpected listing creation error.",
      marketKey: typeof req.body?.marketKey === "string" ? req.body.marketKey.trim().toLowerCase() : undefined
    });
  }

  if (profile.role !== "seller") {
    const { error: roleUpgradeError } = await supabase
      .from("profiles")
      .update({ role: "seller" })
      .eq("id", userId)
      .neq("role", "seller");

    if (roleUpgradeError) {
      logDbError("role_upgrade", roleUpgradeError);
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }
  }

  const marketKey = parsed.marketKey.trim().toLowerCase();

  try {
    const result = await createMarketAwareSellListing({
      accessToken: authToken,
      userId,
      marketKey,
      payload: req.body as Record<string, unknown>,
      location: parsed.location
    });

    return res.status(201).json({
      ok: true,
      data: { listingId: result.listingId }
    });
  } catch (error) {
    if (error instanceof MarketListingCreationError) {
      if (error.status === 400) {
        return res.status(400).json({
          ok: false,
          error: "invalid_request",
          message: "Payload validation failed.",
          marketKey,
          issues: error.issues ?? []
        });
      }
      if (error.code === "duplicate_listing" && error.status === 409) {
        return res.status(409).json({
          ok: false,
          error: "duplicate_listing",
          message: "An active listing already exists for this signature.",
          marketKey
        });
      }
      if (error.code === "partial_cleanup_failed") {
        logDbError("market_listing_creation_cleanup", error);
        return res.status(500).json({
          ok: false,
          error: "partial_cleanup_failed",
          message: error.message,
          marketKey
        });
      }
      logDbError("market_listing_creation", error);
      return res.status(500).json({
        ok: false,
        error: "unexpected_error",
        message: "Unexpected listing creation error.",
        marketKey
      });
    }

    logDbError("market_listing_creation", error);
    return res.status(500).json({
      ok: false,
      error: "unexpected_error",
      message: "Unexpected listing creation error.",
      marketKey
    });
  }
});

router.patch("/listings/:listingId/status", requireAuth, async (req, res, next) => {
  let listingId: string;
  let status: "active" | "inactive";
  try {
    ({ listingId } = listingIdParamSchema.parse(req.params));
    ({ status } = statusBodySchema.parse(req.body));
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    logDbError("patch_status_profile_select", profileError);
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!profile || profile.role !== "seller") {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  try {
    await requireWhatsappNumber(authToken, userId);
  } catch (profileStatusError: any) {
    if (String(profileStatusError?.code ?? "") === "WHATSAPP_REQUIRED") {
      logWarn(req, "listing_status_blocked_whatsapp_missing", { userId, listingId });
      return res.status(403).json({ ok: false, error: "WHATSAPP_REQUIRED" });
    }
    logDbError("patch_status_whatsapp_guard", profileStatusError);
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  const { data: updatedListing, error: updateError } = await supabase
    .from("listings")
    .update({ status })
    .eq("id", listingId)
    .eq("seller_profile_id", userId)
    .select("id,status")
    .maybeSingle();

  if (updateError) {
    logDbError("patch_status_update", updateError);
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!updatedListing) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  return res.json({
    ok: true,
    data: {
      listingId: updatedListing.id,
      status: updatedListing.status
    }
  });
});

export default router;
