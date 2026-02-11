import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { createSupabaseAnon } from "../lib/supabase";

const router = Router();

const querySchema = z.object({
  mode: z.literal("BUY"),
  brandId: z.string().uuid(),
  modelId: z.string().uuid(),
  yearId: z.string().uuid(),
  itemTypeId: z.string().uuid(),
  partId: z.string().uuid(),
  detailsText: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional()
});

const demandsQuerySchema = z
  .object({
    brandId: z.string().uuid().optional(),
    modelId: z.string().uuid().optional(),
    yearId: z.string().uuid().optional(),
    itemTypeId: z.string().uuid().optional(),
    partId: z.string().uuid().optional()
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
  const supabase = createSupabaseAnon({ accessToken: authToken });

  let query = supabase
    .from("demands")
    .select(
      "id,requester_user_id,status,brand_id,model_id,year_id,item_type_id,part_id,details_text,created_at"
    )
    .eq("status", "open");

  if (parsed.brandId) {
    query = query.eq("brand_id", parsed.brandId);
  }
  if (parsed.modelId) {
    query = query.eq("model_id", parsed.modelId);
  }
  if (parsed.yearId) {
    query = query.eq("year_id", parsed.yearId);
  }
  if (parsed.itemTypeId) {
    query = query.eq("item_type_id", parsed.itemTypeId);
  }
  if (parsed.partId) {
    query = query.eq("part_id", parsed.partId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  return res.json({ ok: true, data: data ?? [] });
});

router.get("/search/listings", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof querySchema>;
  try {
    parsed = querySchema.parse(req.query);
  } catch (err) {
    return next(err);
  }

  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 20;

  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });

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

  const results = (data ?? []).map((row: any) => ({
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

  if (results.length === 0) {
    const requesterId = (req as unknown as { user: { id: string } }).user.id;
    const { error: insertError } = await supabase.from("demands").insert({
      requester_user_id: requesterId,
      status: "open",
      brand_id: parsed.brandId,
      model_id: parsed.modelId,
      year_id: parsed.yearId,
      item_type_id: parsed.itemTypeId,
      part_id: parsed.partId,
      details_text: parsed.detailsText ?? null
    });

    if (insertError) {
      console.error("supabase_error", {
        code: insertError.code,
        message: insertError.message
      });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }
  }

  return res.json({
    ok: true,
    results,
    page,
    pageSize,
    total: results.length
  });
});

export default router;
