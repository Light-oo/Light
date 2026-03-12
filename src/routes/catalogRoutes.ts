import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { createSupabaseAnon } from "../lib/supabase";
import { resolveMarketConfiguration, type ResolvedMarket } from "../services/marketResolution";
import {
  getAvailableMarketsContract,
  getMarketDefinitionContract,
  getMarketFieldOptionsContract,
  getMarketVocabularySnapshotContract
} from "../services/marketCatalog";
import { mapEngineResponseToHttpStatus, toPublicEngineErrorPayload } from "../services/engineErrorAdapter";

const router = Router();

const idOptionQuerySchema = z.object({
  brandId: z.string().trim().min(1).optional(),
  brand_id: z.string().trim().min(1).optional()
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
  itemTypeId: z.string().trim().min(1).optional(),
  item_type_id: z.string().trim().min(1).optional()
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

function pickFieldKey(resolvedMarket: ResolvedMarket, candidates: string[]) {
  const keys = new Set(resolvedMarket.fields.map((field) => field.key.toLowerCase()));
  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (keys.has(normalized)) {
      return normalized;
    }
  }
  return null;
}

function mapOptionsForLegacyCatalogResponse(
  options: Array<{ id: string | null; label: string }>
) {
  return options.map((option) => ({
    id: option.id,
    label_es: option.label
  }));
}

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
  const resolvedMarket = await resolveMarketConfiguration("automotive", { supabase: supabase as any });
  const brandFieldKey = pickFieldKey(resolvedMarket, ["brand"]);
  if (!brandFieldKey) {
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  const response = await getMarketFieldOptionsContract({
    marketKey: "automotive",
    fieldKey: brandFieldKey,
    selectedValues: {},
    supabase
  });

  if (!response.ok) {
    return res.status(mapEngineResponseToHttpStatus(response)).json(toPublicEngineErrorPayload(response));
  }

  return res.json({
    ok: true,
    data: {
      options: mapOptionsForLegacyCatalogResponse(response.data.options)
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
  const resolvedMarket = await resolveMarketConfiguration("automotive", { supabase: supabase as any });
  const modelFieldKey = pickFieldKey(resolvedMarket, ["model"]);
  const brandFieldKey = pickFieldKey(resolvedMarket, ["brand"]);
  if (!modelFieldKey || !brandFieldKey) {
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  const response = await getMarketFieldOptionsContract({
    marketKey: "automotive",
    fieldKey: modelFieldKey,
    selectedValues: {
      [brandFieldKey]: brandId
    },
    supabase
  });

  if (!response.ok) {
    return res.status(mapEngineResponseToHttpStatus(response)).json(toPublicEngineErrorPayload(response));
  }

  return res.json({
    ok: true,
    data: {
      brand_id: brandId,
      options: mapOptionsForLegacyCatalogResponse(response.data.options)
    }
  });
});

router.get("/catalog/years", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const resolvedMarket = await resolveMarketConfiguration("automotive", { supabase: supabase as any });
  const yearFieldKey = pickFieldKey(resolvedMarket, ["year"]);
  if (!yearFieldKey) {
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  const response = await getMarketFieldOptionsContract({
    marketKey: "automotive",
    fieldKey: yearFieldKey,
    selectedValues: {},
    supabase
  });

  if (!response.ok) {
    return res.status(mapEngineResponseToHttpStatus(response)).json(toPublicEngineErrorPayload(response));
  }

  return res.json({
    ok: true,
    data: {
      options: mapOptionsForLegacyCatalogResponse(response.data.options)
    }
  });
});

router.get("/catalog/item-types", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const resolvedMarket = await resolveMarketConfiguration("automotive", { supabase: supabase as any });
  const itemTypeFieldKey = pickFieldKey(resolvedMarket, ["system", "item_type"]);
  if (!itemTypeFieldKey) {
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  const response = await getMarketFieldOptionsContract({
    marketKey: "automotive",
    fieldKey: itemTypeFieldKey,
    selectedValues: {},
    supabase
  });

  if (!response.ok) {
    return res.status(mapEngineResponseToHttpStatus(response)).json(toPublicEngineErrorPayload(response));
  }

  return res.json({
    ok: true,
    data: {
      options: response.data.options.map((option) => ({
        id: option.id,
        key: option.key,
        label_es: option.label
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
  const resolvedMarket = await resolveMarketConfiguration("automotive", { supabase: supabase as any });
  const partFieldKey = pickFieldKey(resolvedMarket, ["part"]);
  const itemTypeFieldKey = pickFieldKey(resolvedMarket, ["system", "item_type"]);
  if (!partFieldKey || !itemTypeFieldKey) {
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  const response = await getMarketFieldOptionsContract({
    marketKey: "automotive",
    fieldKey: partFieldKey,
    selectedValues: {
      [itemTypeFieldKey]: itemTypeId
    },
    supabase
  });

  if (!response.ok) {
    return res.status(mapEngineResponseToHttpStatus(response)).json(toPublicEngineErrorPayload(response));
  }

  return res.json({
    ok: true,
    data: {
      item_type_id: itemTypeId,
      options: response.data.options.map((option) => ({
        id: option.id,
        key: option.key,
        label_es: option.label
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
