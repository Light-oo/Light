import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { createSupabaseAnon } from "../lib/supabase";

const router = Router();

const idOptionQuerySchema = z.object({
  brandId: z.string().uuid().optional(),
  brand_id: z.string().uuid().optional()
}).strict().superRefine((value, ctx) => {
  if (!value.brandId && !value.brand_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["brand_id"],
      message: "Required"
    });
  }
});

const partsQuerySchema = z.object({
  itemTypeId: z.string().uuid().optional(),
  item_type_id: z.string().uuid().optional()
}).strict().superRefine((value, ctx) => {
  if (!value.itemTypeId && !value.item_type_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["item_type_id"],
      message: "Required"
    });
  }
});

router.get("/catalog/brands", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const { data, error } = await supabase
    .from("brands")
    .select("id,label_es")
    .eq("active", true)
    .order("label_es", { ascending: true });

  if (error) {
    console.error("catalog_brands_error", {
      code: error.code,
      message: error.message,
      details: (error as any)?.details,
      hint: (error as any)?.hint
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  return res.json({
    ok: true,
    data: {
      options: (data ?? []).map((row) => ({
        id: row.id,
        label_es: row.label_es
      }))
    }
  });
});

router.get("/catalog/models", requireAuth, async (req, res, next) => {
  let parsedQuery: z.infer<typeof idOptionQuerySchema>;
  try {
    parsedQuery = idOptionQuerySchema.parse(req.query);
  } catch (err) {
    return next(err);
  }

  const brandId = parsedQuery.brand_id ?? parsedQuery.brandId!;
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const { data, error } = await supabase
    .from("models")
    .select("id,label_es")
    .eq("brand_id", brandId)
    .eq("active", true)
    .order("label_es", { ascending: true });

  if (error) {
    console.error("catalog_models_error", {
      code: error.code,
      message: error.message,
      details: (error as any)?.details,
      hint: (error as any)?.hint
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  return res.json({
    ok: true,
    data: {
      brand_id: brandId,
      options: (data ?? []).map((row) => ({
        id: row.id,
        label_es: row.label_es
      }))
    }
  });
});

router.get("/catalog/years", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const { data, error } = await supabase
    .from("year_options")
    .select("id,year")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("catalog_years_error", {
      code: error.code,
      message: error.message,
      details: (error as any)?.details,
      hint: (error as any)?.hint
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  return res.json({
    ok: true,
    data: {
      options: (data ?? []).map((row: any) => ({
        id: row.id,
        label_es: String(row.year ?? "")
      }))
    }
  });
});

router.get("/catalog/item-types", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const { data, error } = await supabase
    .from("item_types")
    .select("id,key,label_es")
    .eq("active", true)
    .order("label_es", { ascending: true });

  if (error) {
    console.error("catalog_item_types_error", {
      code: error.code,
      message: error.message,
      details: (error as any)?.details,
      hint: (error as any)?.hint
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  return res.json({
    ok: true,
    data: {
      options: (data ?? []).map((row) => ({
        id: row.id,
        key: row.key,
        label_es: row.label_es
      }))
    }
  });
});

router.get("/catalog/parts", requireAuth, async (req, res, next) => {
  let parsedQuery: z.infer<typeof partsQuerySchema>;
  try {
    parsedQuery = partsQuerySchema.parse(req.query);
  } catch (err) {
    return next(err);
  }

  const itemTypeId = parsedQuery.item_type_id ?? parsedQuery.itemTypeId!;
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const { data, error } = await supabase
    .from("parts")
    .select("id,key,label_es")
    .eq("item_type_id", itemTypeId)
    .eq("active", true)
    .order("label_es", { ascending: true });

  if (error) {
    console.error("catalog_parts_error", {
      code: error.code,
      message: error.message,
      details: (error as any)?.details,
      hint: (error as any)?.hint
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  return res.json({
    ok: true,
    data: {
      item_type_id: itemTypeId,
      options: (data ?? []).map((row) => ({
        id: row.id,
        key: row.key,
        label_es: row.label_es
      }))
    }
  });
});

export default router;
