import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { createSupabaseAnon } from "../lib/supabase";
import { requireWhatsappNumber } from "../services/profileStatus";
import { searchOpenDemands } from "../services/demandSearch";

const router = Router();

const paginationQuerySchema = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional()
};

const buyListingsQuerySchema = z.object({
  mode: z.literal("BUY"),
  brandId: z.string().uuid(),
  modelId: z.string().uuid(),
  yearId: z.string().uuid(),
  itemTypeId: z.string().uuid(),
  partId: z.string().uuid(),
  detailsText: z.string().optional(),
  ...paginationQuerySchema
}).strict();

const sellListingsQuerySchema = z.object({
  mode: z.literal("SELL"),
  brandId: z.string().uuid().optional(),
  modelId: z.string().uuid().optional(),
  yearId: z.string().uuid().optional(),
  itemTypeId: z.string().uuid().optional(),
  partId: z.string().uuid().optional(),
  ...paginationQuerySchema
}).strict();

const listingsQuerySchema = z.discriminatedUnion("mode", [
  buyListingsQuerySchema,
  sellListingsQuerySchema
]);

function isDemandOpenDuplicate(error: any) {
  if ((error?.code ?? "") !== "23505") {
    return false;
  }
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`
    .toLowerCase();
  return text.includes("demands_open_unique_signature");
}

const demandsQuerySchema = z
  .object({
    brand_id: z.string().uuid().optional(),
    model_id: z.string().uuid().optional(),
    year_id: z.string().uuid().optional(),
    item_type_id: z.string().uuid().optional(),
    part_id: z.string().uuid().optional(),
    brandId: z.string().uuid().optional(),
    modelId: z.string().uuid().optional(),
    yearId: z.string().uuid().optional(),
    itemTypeId: z.string().uuid().optional(),
    partId: z.string().uuid().optional(),
    ...paginationQuerySchema
  })
  .strict();

router.get("/search/demands", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof demandsQuerySchema>;
  try {
    parsed = demandsQuerySchema.parse(req.query);
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const requesterUserId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const filters = {
    brandId: parsed.brandId ?? parsed.brand_id,
    modelId: parsed.modelId ?? parsed.model_id,
    yearId: parsed.yearId ?? parsed.year_id,
    itemTypeId: parsed.itemTypeId ?? parsed.item_type_id,
    partId: parsed.partId ?? parsed.part_id
  };

  console.info("search_demands_query", {
    requesterUserId,
    requesterProfileId: requesterUserId,
    table: "demands",
    where: {
      status: "open",
      ...(filters.brandId ? { brand_id: filters.brandId } : {}),
      ...(filters.modelId ? { model_id: filters.modelId } : {}),
      ...(filters.yearId ? { year_id: filters.yearId } : {}),
      ...(filters.itemTypeId ? { item_type_id: filters.itemTypeId } : {}),
      ...(filters.partId ? { part_id: filters.partId } : {})
    },
    orderBy: { created_at: "desc" },
    range: { from, to }
  });

  const { data, count, error } = await searchOpenDemands({
    supabase,
    filters,
    page,
    pageSize
  });

  if (error) {
    console.error("supabase_error", {
      route: "GET /search/demands",
      requesterUserId,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  console.info("search_demands_result", {
    requesterUserId,
    count: count ?? 0,
    rows: (data ?? []).length,
    filtersApplied: Object.values(filters).filter(Boolean).length
  });

  if ((count ?? 0) === 0) {
    console.warn("search_demands_empty_result", {
      requesterUserId,
      note: "If OPEN demands exist in DB but this is empty, verify SELECT RLS policy for authenticated users on public.demands.",
      statusFilter: "open",
      filters
    });
  }

  const results = (data ?? []).map((row: any) => ({
    cardType: "buy",
    demandId: row.id,
    what: {
      brandId: row.brand_id,
      modelId: row.model_id,
      yearId: row.year_id,
      itemTypeId: row.item_type_id,
      partId: row.part_id
    },
    request: {
      detailsText: row.details_text
    },
    audit: {
      createdAt: row.created_at,
      requesterUserId: row.requester_user_id,
      status: row.status
    }
  }));

  return res.json({
    ok: true,
    data: {
      results,
      page,
      pageSize,
      total: count ?? 0
    }
  });
});

router.get("/search/listings", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof listingsQuerySchema>;
  try {
    parsed = listingsQuerySchema.parse(req.query);
  } catch (err) {
    return next(err);
  }

  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 20;

  const authToken = (req as unknown as { authToken: string }).authToken;
  const requesterUserId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  if (parsed.mode === "SELL") {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let demandsQuery = supabase
      .from("demands")
      .select(
        "id,requester_user_id,status,brand_id,model_id,year_id,item_type_id,part_id,details_text,created_at",
        { count: "exact" }
      )
      .eq("status", "open");

    if (parsed.brandId) {
      demandsQuery = demandsQuery.eq("brand_id", parsed.brandId);
    }
    if (parsed.modelId) {
      demandsQuery = demandsQuery.eq("model_id", parsed.modelId);
    }
    if (parsed.yearId) {
      demandsQuery = demandsQuery.eq("year_id", parsed.yearId);
    }
    if (parsed.itemTypeId) {
      demandsQuery = demandsQuery.eq("item_type_id", parsed.itemTypeId);
    }
    if (parsed.partId) {
      demandsQuery = demandsQuery.eq("part_id", parsed.partId);
    }

    const { data, count, error } = await demandsQuery
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("supabase_error", { code: error.code, message: error.message });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    const results = (data ?? []).map((row: any) => ({
      cardType: "buy",
      demandId: row.id,
      what: {
        brandId: row.brand_id,
        modelId: row.model_id,
        yearId: row.year_id,
        itemTypeId: row.item_type_id,
        partId: row.part_id
      },
      request: {
        detailsText: row.details_text
      },
      audit: {
        createdAt: row.created_at,
        requesterUserId: row.requester_user_id,
        status: row.status
      }
    }));

    return res.json({
      ok: true,
      results,
      page,
      pageSize,
      total: count ?? 0
    });
  }

  const { data, error } = await supabase.rpc("get_sell_cards", {
    brand_id: parsed.brandId,
    model_id: parsed.modelId,
    year_id: parsed.yearId,
    item_type_id: parsed.itemTypeId,
    part_id: parsed.partId,
    page,
    page_size: pageSize
  });

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (data && data.length > 0) {
    const requiredColumns = [
      "listing_id",
      "brand_id",
      "brand_label_es",
      "model_id",
      "model_label_es",
      "year_id",
      "year",
      "item_type_id",
      "item_type_label_es",
      "part_id",
      "part_label_es",
      "price_amount",
      "price_type",
      "currency",
      "department",
      "municipality",
      "created_at"
    ];
    const missing = requiredColumns.filter((col) => !(col in data[0]));
    if (missing.length > 0) {
      console.error("missing_columns", { missing });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }
  }

  let buyRows = (data ?? []) as any[];
  let selfOwnedHiddenCount = 0;

  if (buyRows.length > 0) {
    const listingIds = buyRows.map((row) => row.listing_id).filter(Boolean);
    if (listingIds.length > 0) {
      const { data: ownListings, error: ownListingsError } = await supabase
        .from("listings")
        .select("id")
        .eq("seller_profile_id", requesterUserId)
        .in("id", listingIds);

      if (ownListingsError) {
        console.error("supabase_error", {
          code: ownListingsError.code,
          message: ownListingsError.message
        });
        return res.status(500).json({ ok: false, error: "unexpected_error" });
      }

      if (ownListings && ownListings.length > 0) {
        selfOwnedHiddenCount = ownListings.length;
        const ownIds = new Set(ownListings.map((row: any) => row.id));
        buyRows = buyRows.filter((row) => !ownIds.has(row.listing_id));
      }
    }
  }

  const results = buyRows.map((row: any) => ({
    cardType: "sell",
    listingId: row.listing_id,
    what: {
      brandId: row.brand_id,
      brandLabelEs: row.brand_label_es,
      modelId: row.model_id,
      modelLabelEs: row.model_label_es,
      yearId: row.year_id,
      year: row.year,
      itemTypeId: row.item_type_id,
      itemTypeLabelEs: row.item_type_label_es,
      partId: row.part_id,
      partLabelEs: row.part_label_es
    },
    price: {
      amount: row.price_amount,
      type: row.price_type,
      currency: row.currency
    },
    location: {
      department: row.department,
      municipality: row.municipality
    },
    audit: {
      createdAt: row.created_at
    }
  }));

  let zeroResultsData: Record<string, unknown> | undefined;

  if (results.length === 0) {
    if (selfOwnedHiddenCount > 0) {
      return res.json({
        ok: true,
        results,
        page,
        pageSize,
        total: 0,
        data: {
          reason: "ONLY_OWN_LISTINGS"
        }
      });
    }

    try {
      await requireWhatsappNumber(authToken, requesterUserId);
    } catch (whatsappGuardError: any) {
      if (String(whatsappGuardError?.code ?? "") === "WHATSAPP_REQUIRED") {
        return res.json({
          ok: true,
          results,
          page,
          pageSize,
          total: 0,
          data: {
            reason: "WHATSAPP_REQUIRED"
          }
        });
      }
      console.error("supabase_error", {
        code: whatsappGuardError?.code,
        message: whatsappGuardError?.message
      });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    const demandSignature = {
      requester_user_id: requesterUserId,
      status: "open",
      brand_id: parsed.brandId,
      model_id: parsed.modelId,
      year_id: parsed.yearId,
      item_type_id: parsed.itemTypeId,
      part_id: parsed.partId
    };

    const { error: insertError } = await supabase.from("demands").insert({
      ...demandSignature,
      details_text: parsed.detailsText ?? null
    });

    if (insertError) {
      if (isDemandOpenDuplicate(insertError)) {
        const incomingDetailsText = parsed.detailsText?.trim() ?? "";
        console.warn("handled_duplicate_demand_existing_open", {
          code: insertError.code,
          message: insertError.message,
          ...demandSignature
        });
        const { data: existingDemand, error: existingDemandError } = await supabase
          .from("demands")
          .select("id,details_text")
          .eq("requester_user_id", requesterUserId)
          .eq("status", "open")
          .eq("brand_id", parsed.brandId)
          .eq("model_id", parsed.modelId)
          .eq("year_id", parsed.yearId)
          .eq("item_type_id", parsed.itemTypeId)
          .eq("part_id", parsed.partId)
          .limit(1)
          .maybeSingle();

        if (existingDemandError) {
          console.error("supabase_error", {
            code: existingDemandError.code,
            message: existingDemandError.message
          });
          return res.status(500).json({ ok: false, error: "unexpected_error" });
        }

        if (!existingDemand) {
          console.warn("handled_duplicate_demand_missing_after_select", demandSignature);
        } else if (incomingDetailsText.length > 0) {
          const { error: updateExistingDemandError } = await supabase
            .from("demands")
            .update({
              details_text: incomingDetailsText,
              updated_at: new Date().toISOString()
            })
            .eq("id", existingDemand.id)
            .eq("requester_user_id", requesterUserId)
            .eq("status", "open");

          if (updateExistingDemandError) {
            console.error("supabase_error", {
              code: updateExistingDemandError.code,
              message: updateExistingDemandError.message
            });
            return res.status(500).json({ ok: false, error: "unexpected_error" });
          }

          console.warn("handled_duplicate_demand_updated_details", {
            demandId: existingDemand.id,
            didUpdateDetails: true
          });
          zeroResultsData = {
            ...(zeroResultsData ?? {}),
            demandAction: "updated"
          };
        } else {
          zeroResultsData = {
            ...(zeroResultsData ?? {}),
            demandAction: "existing"
          };
        }
      } else {
      console.error("supabase_error", {
        code: insertError.code,
        message: insertError.message
      });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
      }
    } else {
      zeroResultsData = {
        ...(zeroResultsData ?? {}),
        demandAction: "created"
      };
    }
  }

  const responsePayload: Record<string, unknown> = {
    ok: true,
    results,
    page,
    pageSize,
    total: results.length
  };

  if (zeroResultsData) {
    responsePayload.data = zeroResultsData;
  }

  return res.json(responsePayload);
});

export default router;
