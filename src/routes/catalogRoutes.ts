import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { logError, logSystemError } from "../lib/logger";
import { createSupabaseAnon } from "../lib/supabase";
import {
  getAvailableMarketsContract,
  getMarketDefinitionContract,
  getMarketFieldOptionsContract,
  getMarketVocabularySnapshotContract
} from "../services/marketCatalog";
import { mapEngineResponseToHttpStatus, toPublicEngineErrorPayload } from "../services/engineErrorAdapter";

const router = Router();

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
    logError(req, "catalog_market_field_options_error", {
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
      logSystemError("catalog_departments_error", {
        code: (error as any)?.code,
        message: (error as any)?.message,
        details: (error as any)?.details,
        hint: (error as any)?.hint
      });
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
    logSystemError("catalog_departments_exception", {
      message: (err as any)?.message,
      stack: (err as any)?.stack
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

export default router;
