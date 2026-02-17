import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { createSupabaseAnon } from "../lib/supabase";

const router = Router();

const locationSchema = z.object({
  department: z.string().trim().min(1),
  municipality: z.string().trim().min(1)
});

const createListingSchema = z.object({
  brandId: z.string().uuid(),
  modelId: z.string().uuid(),
  yearId: z.string().uuid(),
  itemTypeId: z.string().uuid(),
  partId: z.string().uuid(),
  price: z
    .object({
      amount: z.number().positive(),
      type: z.literal("fixed")
    })
    .strict(),
  location: locationSchema.optional()
})
  .strict();

const listingIdParamSchema = z.object({
  listingId: z.string().uuid()
});

const statusBodySchema = z.object({
  status: z.union([z.literal("active"), z.literal("inactive")])
}).strict();

function debugSupabaseError(step: string, error: any) {
  console.error("listings_step_error", {
    step,
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint
  });
}

function dbErrorResponse(step: string, error: any) {
  return {
    ok: false,
    error: "unexpected_error",
    step,
    code: error?.code ?? null,
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null
  };
}

function isDuplicateListingError(error: any) {
  const code = error?.code ?? "";
  const message = String(error?.message ?? "").toLowerCase();
  if (code === "23505") {
    return true;
  }
  return code === "P0001" && message.includes("duplicate_listing");
}

router.post("/listings", requireAuth, async (req, res, next) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  console.log("listings_auth_context", {
    userId,
    jwtForwarded: Boolean(authToken),
    authHeaderShape: authToken ? `Bearer(token_length:${authToken.length})` : null,
    supabaseClientKey: "anon"
  });

  // Seller gate from DB source-of-truth.
  const { data: sellerProfile, error: sellerGateError } = await supabase
    .from("profiles")
    .select("id,role")
    .eq("id", userId)
    .maybeSingle();

  if (sellerGateError) {
    debugSupabaseError("seller_gate_profile", sellerGateError);
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!sellerProfile || sellerProfile.role !== "seller") {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  let parsed: z.infer<typeof createListingSchema>;
  try {
    parsed = createListingSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  console.log("listings_step_payload", {
    step: "profile_select",
    payload: { id: userId }
  });
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,whatsapp_e164")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    debugSupabaseError("profile_select", profileError);
    return res.status(500).json(dbErrorResponse("profile_select", profileError));
  }

  if (!profile) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  if (!profile.whatsapp_e164 || profile.whatsapp_e164.trim().length === 0) {
    return res.status(400).json({
      ok: false,
      error: "invalid_request",
      issues: [
        {
          path: "profile.whatsappE164",
          message: "seller_has_no_contact",
          code: "custom"
        }
      ]
    });
  }

  const duplicateCheckPayload = {
    seller_profile_id: userId,
    listing_type: "sell",
    status: "active",
    brand_id: parsed.brandId,
    model_id: parsed.modelId,
    year_id: parsed.yearId,
    item_type_id: parsed.itemTypeId,
    part_id: parsed.partId
  };
  console.log("listings_step_payload", {
    step: "duplicate_check",
    payload: duplicateCheckPayload
  });
  const { data: duplicateRow, error: duplicateCheckError } = await supabase
    .from("item_specs")
    .select("listing_id,listings!inner(id)")
    .eq("brand_id", parsed.brandId)
    .eq("model_id", parsed.modelId)
    .eq("year_id", parsed.yearId)
    .eq("item_type_id", parsed.itemTypeId)
    .eq("part_id", parsed.partId)
    .eq("listings.seller_profile_id", userId)
    .eq("listings.listing_type", "sell")
    .eq("listings.status", "active")
    .limit(1)
    .maybeSingle();

  if (duplicateCheckError) {
    debugSupabaseError("duplicate_check", duplicateCheckError);
    return res
      .status(500)
      .json(dbErrorResponse("duplicate_check", duplicateCheckError));
  }

  if (duplicateRow) {
    return res.status(409).json({ ok: false, error: "duplicate_listing" });
  }

  const listingId = randomUUID();
  const listingPayload = {
    id: listingId,
    listing_type: "sell",
    status: "active",
    seller_profile_id: userId
  };
  console.log("listings_step_payload", {
    step: "insert_listings",
    payload: listingPayload
  });
  const { error: listingError } = await supabase
    .from("listings")
    .insert(listingPayload);

  if (listingError) {
    debugSupabaseError("insert_listings", listingError);
    if (isDuplicateListingError(listingError)) {
      return res.status(409).json({ ok: false, error: "duplicate_listing" });
    }
    return res.status(500).json(dbErrorResponse("insert_listings", listingError));
  }

  const itemSpecsPayload = {
    listing_id: listingId,
    brand_id: parsed.brandId,
    model_id: parsed.modelId,
    year_id: parsed.yearId,
    item_type_id: parsed.itemTypeId,
    part_id: parsed.partId
  };
  console.log("listings_step_payload", {
    step: "insert_item_specs",
    payload: itemSpecsPayload
  });
  const { error: specError } = await supabase.from("item_specs").insert(itemSpecsPayload);

  if (specError) {
    debugSupabaseError("insert_item_specs", specError);
    if (isDuplicateListingError(specError)) {
      return res.status(409).json({ ok: false, error: "duplicate_listing" });
    }
    return res.status(500).json(dbErrorResponse("insert_item_specs", specError));
  }

  const pricingPayload = {
    listing_id: listingId,
    price_amount: parsed.price.amount,
    price_type: parsed.price.type,
    currency: "USD"
  };
  console.log("listings_step_payload", {
    step: "insert_pricing",
    payload: pricingPayload
  });
  const { error: pricingError } = await supabase.from("pricing").insert(pricingPayload);

  if (pricingError) {
    debugSupabaseError("insert_pricing", pricingError);
    if (isDuplicateListingError(pricingError)) {
      return res.status(409).json({ ok: false, error: "duplicate_listing" });
    }
    return res.status(500).json(dbErrorResponse("insert_pricing", pricingError));
  }

  if (parsed.location) {
    const locationPayload = {
      listing_id: listingId,
      department: parsed.location.department,
      municipality: parsed.location.municipality
    };
    console.log("listings_step_payload", {
      step: "insert_listing_locations",
      payload: locationPayload
    });
    const { error: locationError } = await supabase
      .from("listing_locations")
      .insert(locationPayload);

    if (locationError) {
      debugSupabaseError("insert_listing_locations", locationError);
      if (isDuplicateListingError(locationError)) {
        return res.status(409).json({ ok: false, error: "duplicate_listing" });
      }
      return res
        .status(500)
        .json(dbErrorResponse("insert_listing_locations", locationError));
    }
  }

  return res.status(201).json({
    ok: true,
    data: { listingId }
  });
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
    debugSupabaseError("patch_status_profile_select", profileError);
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!profile || profile.role !== "seller") {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const { data: updatedListing, error: updateError } = await supabase
    .from("listings")
    .update({ status })
    .eq("id", listingId)
    .eq("seller_profile_id", userId)
    .select("id,status")
    .maybeSingle();

  if (updateError) {
    debugSupabaseError("patch_status_update", updateError);
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
