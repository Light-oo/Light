import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { createSupabaseAnon } from "../lib/supabase";
import {
  getAvailableMarketsContract,
  getMarketDefinitionContract,
  getMarketFieldOptionsContract,
  getMarketVocabularySnapshotContract
} from "../services/marketCatalog";
import { mapEngineResponseToHttpStatus, toPublicEngineErrorPayload } from "../services/engineErrorAdapter";

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

const marketKeyParamSchema = z.object({
  marketKey: z.string().trim().min(1)
});

const marketFieldOptionsParamSchema = z.object({
  marketKey: z.string().trim().min(1),
  fieldKey: z.string().trim().min(1)
});

function collectSelectedValues(query: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
      if (first !== undefined) {
        out[normalizedKey] = first;
      }
      continue;
    }
    const asText = String(value).trim();
    if (asText.length === 0) {
      continue;
    }
    out[normalizedKey] = asText;
  }
  return out;
}

router.get("/catalog/markets/:marketKey", requireAuth, async (req, res, next) => {
  let parsedParams: z.infer<typeof marketKeyParamSchema>;
  try {
    parsedParams = marketKeyParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const response = await getMarketDefinitionContract({
    marketKey: parsedParams.marketKey,
    supabase
  });

  if (!response.ok) {
    return res
      .status(mapEngineResponseToHttpStatus(response))
      .json(toPublicEngineErrorPayload(response, { marketKey: parsedParams.marketKey }));
  }

  return res.json(response);
});

router.get("/catalog/markets", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const response = await getAvailableMarketsContract({ supabase });
  if (!response.ok) {
    return res.status(mapEngineResponseToHttpStatus(response)).json(toPublicEngineErrorPayload(response));
  }
  return res.json(response);
});

router.get("/catalog/markets/:marketKey/fields/:fieldKey/options", requireAuth, async (req, res, next) => {
  let parsedParams: z.infer<typeof marketFieldOptionsParamSchema>;
  try {
    parsedParams = marketFieldOptionsParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const selectedValues = collectSelectedValues(req.query as Record<string, unknown>);

  const response = await getMarketFieldOptionsContract({
    marketKey: parsedParams.marketKey,
    fieldKey: parsedParams.fieldKey,
    selectedValues,
    supabase
  });

  if (!response.ok) {
    console.error("catalog_market_field_options_error", {
      marketKey: parsedParams.marketKey,
      fieldKey: parsedParams.fieldKey,
      selectedValues,
      code: response.error.code,
      message: response.error.message
    });
    return res
      .status(mapEngineResponseToHttpStatus(response))
      .json(
        toPublicEngineErrorPayload(response, {
          marketKey: parsedParams.marketKey
        })
      );
  }

  return res.json(response);
});

router.get("/catalog/markets/:marketKey/vocabulary", requireAuth, async (req, res, next) => {
  let parsedParams: z.infer<typeof marketKeyParamSchema>;
  try {
    parsedParams = marketKeyParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const selectedValues = collectSelectedValues(req.query as Record<string, unknown>);

  const response = await getMarketVocabularySnapshotContract({
    marketKey: parsedParams.marketKey,
    selectedValues,
    supabase
  });

  if (!response.ok) {
    return res
      .status(mapEngineResponseToHttpStatus(response))
      .json(toPublicEngineErrorPayload(response, { marketKey: parsedParams.marketKey }));
  }

  return res.json(response);
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

router.get("/catalog/departments", async (req, res) => {
  try {
    const authToken = (req as unknown as { authToken?: string }).authToken;
    const supabase = createSupabaseAnon(
      authToken
        ? { accessToken: authToken }
        : undefined
    );

    const { data, error } = await supabase
      .from("departments")
      .select("id,name,sort_order")
      .order("id", { ascending: true });

    if (error) {
      console.error("catalog/departments error", error);
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    const departments = (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name
    }));

    return res.json({
      ok: true,
      departments,
      data: {
        options: departments
      }
    });
  } catch (err) {
    console.error("catalog/departments exception", err);
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

export default router;
