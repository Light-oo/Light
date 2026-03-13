import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { createSupabaseAnon } from "../lib/supabase";
import { resolveMarketConfiguration, type ResolvedMarket } from "../services/marketResolution";
import { loadFieldVocabulary, type VocabularyOption } from "../services/marketVocabulary";

const router = Router();

const idParamSchema = z.object({
  id: z.string().uuid()
});

const patchMeBodySchema = z.object({
  department_id: z.number().int().positive().nullable()
}).strict();

const updateDemandStatusBodySchema = z.object({
  status: z.literal("inactive")
}).strict();

type ListingSummaryRow = {
  id: string;
  marketKey: string;
  identityValues: Record<string, string>;
  signature: string;
  status: string;
  created_at: string | null;
  price: {
    amount: number | null;
    type: string | null;
    currency: string | null;
  };
  location: {
    department: string | null;
    municipality: string | null;
  };
};

type DemandSummaryRow = {
  id: string;
  marketKey: string;
  identityValues: Record<string, string>;
  signature: string;
  status: string;
  created_at: string | null;
  request: {
    detailsText: string | null;
  };
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeNullableText(value: unknown) {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    )
  );
}

async function buildMarketKeyByIdMap(
  supabase: ReturnType<typeof createSupabaseAnon>,
  marketIds: Array<string | null | undefined>
) {
  const uniqueIds = uniqueNonEmpty(marketIds);
  if (uniqueIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await supabase
    .from("markets")
    .select("id,key")
    .in("id", uniqueIds);

  if (error) {
    throw error;
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const id = normalizeText((row as any).id);
    const key = normalizeText((row as any).key);
    if (id && key) {
      map.set(id, key);
    }
  }
  return map;
}

function parseSignatureValues(signature: unknown): Record<string, string> {
  const text = normalizeText(signature);
  if (!text.includes("|")) {
    return {};
  }

  const parts = text.split("|").slice(1);
  const values: Record<string, string> = {};
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim().toLowerCase();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }
    values[key] = value;
  }
  return values;
}

function extractRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function dependencySignature(values: Record<string, string>) {
  return Object.entries(values)
    .filter(([, value]) => value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

async function buildResolvedMarketMap(
  supabase: ReturnType<typeof createSupabaseAnon>,
  marketKeys: string[]
) {
  const uniqueMarketKeys = uniqueNonEmpty(marketKeys);
  const entries = await Promise.all(
    uniqueMarketKeys.map(async (marketKey) => {
      const resolved = await resolveMarketConfiguration(marketKey, { supabase: supabase as any });
      return [marketKey, resolved] as const;
    })
  );
  return new Map<string, ResolvedMarket>(entries);
}

async function resolveDisplayIdentityValues(
  supabase: ReturnType<typeof createSupabaseAnon>,
  resolvedMarket: ResolvedMarket,
  identityValues: Record<string, string>
) {
  const displayIdentityValues: Record<string, string> = {};
  const dependencyMap = new Map<string, string[]>();
  const vocabularyCache = new Map<string, VocabularyOption[]>();

  for (const dependency of resolvedMarket.dependencies) {
    const childKey = normalizeText(dependency.fieldKey).toLowerCase();
    const parentKey = normalizeText(dependency.dependsOnFieldKey).toLowerCase();
    if (!childKey || !parentKey) {
      continue;
    }
    const current = dependencyMap.get(childKey) ?? [];
    if (!current.includes(parentKey)) {
      current.push(parentKey);
      dependencyMap.set(childKey, current);
    }
  }

  for (const field of resolvedMarket.fields) {
    const fieldKey = field.key.toLowerCase();
    const rawValue = identityValues[fieldKey];
    if (!rawValue) {
      continue;
    }

    const dependsOn = dependencyMap.get(fieldKey) ?? [];
    const selectedValues: Record<string, string> = {};
    for (const parentKey of dependsOn) {
      const parentValue = identityValues[parentKey];
      if (parentValue) {
        selectedValues[parentKey] = parentValue;
      }
    }

    const cacheKey = `${resolvedMarket.market.key}::${fieldKey}::${dependencySignature(selectedValues)}`;
    let options = vocabularyCache.get(cacheKey);
    if (!options) {
      try {
        const vocabulary = await loadFieldVocabulary({
          marketKey: resolvedMarket.market.key,
          fieldKey,
          selectedValues,
          resolvedMarket,
          supabase: supabase as any
        });
        options = vocabulary.options;
      } catch {
        options = [];
      }
      vocabularyCache.set(cacheKey, options);
    }

    const match = options.find(
      (option) => option.key.toLowerCase() === rawValue.toLowerCase() || option.id === rawValue
    );
    displayIdentityValues[fieldKey] = match?.label ?? rawValue;
  }

  return displayIdentityValues;
}

async function buildListingSummaries(
  supabase: ReturnType<typeof createSupabaseAnon>,
  rows: Array<Record<string, unknown>>
) {
  const marketKeyById = await buildMarketKeyByIdMap(
    supabase,
    rows.map((row) => normalizeText((row as any).market_id))
  );
  const resolvedMarketByKey = await buildResolvedMarketMap(
    supabase,
    rows.map((row) => marketKeyById.get(normalizeText((row as any).market_id)) ?? "")
  );

  return Promise.all(
    rows.map(async (row) => {
      const marketId = normalizeText((row as any).market_id);
      const marketKey = marketKeyById.get(marketId) ?? "";
      const signature = normalizeText((row as any).intention_signature);
      const identityValues = parseSignatureValues(signature);
      const resolvedMarket = resolvedMarketByKey.get(marketKey);
      const displayIdentityValues = resolvedMarket
        ? await resolveDisplayIdentityValues(supabase, resolvedMarket, identityValues)
        : identityValues;
      const pricing = extractRecord((row as any).pricing);
      const location = extractRecord((row as any).listing_locations);

      return {
        id: normalizeText((row as any).id),
        marketKey,
        identityValues: displayIdentityValues,
        signature,
        status: normalizeText((row as any).status),
        created_at: normalizeNullableText((row as any).created_at),
        price: {
          amount: normalizeNumber((pricing as any)?.price_amount),
          type: normalizeNullableText((pricing as any)?.price_type),
          currency: normalizeNullableText((pricing as any)?.currency)
        },
        location: {
          department: normalizeNullableText((location as any)?.department),
          municipality: normalizeNullableText((location as any)?.municipality)
        }
      } satisfies ListingSummaryRow;
    })
  );
}

async function buildDemandSummaries(
  supabase: ReturnType<typeof createSupabaseAnon>,
  rows: Array<Record<string, unknown>>
) {
  const marketKeyById = await buildMarketKeyByIdMap(
    supabase,
    rows.map((row) => normalizeText((row as any).market_id))
  );
  const resolvedMarketByKey = await buildResolvedMarketMap(
    supabase,
    rows.map((row) => marketKeyById.get(normalizeText((row as any).market_id)) ?? "")
  );

  return Promise.all(
    rows.map(async (row) => {
      const marketId = normalizeText((row as any).market_id);
      const marketKey = marketKeyById.get(marketId) ?? "";
      const signature = normalizeText((row as any).intention_signature);
      const identityValues = parseSignatureValues(signature);
      const resolvedMarket = resolvedMarketByKey.get(marketKey);
      const displayIdentityValues = resolvedMarket
        ? await resolveDisplayIdentityValues(supabase, resolvedMarket, identityValues)
        : identityValues;

      return {
        id: normalizeText((row as any).id),
        marketKey,
        identityValues: displayIdentityValues,
        signature,
        status: normalizeText((row as any).status),
        created_at: normalizeNullableText((row as any).created_at),
        request: {
          detailsText: normalizeNullableText((row as any).details_text)
        }
      } satisfies DemandSummaryRow;
    })
  );
}

router.get("/api/me", requireAuth, (req, res) => {
  const user = (req as unknown as { user: { id: string } }).user;
  res.json({ ok: true, userId: user.id });
});

router.patch("/api/me", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof patchMeBodySchema>;
  try {
    parsed = patchMeBodySchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const userId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  const { data, error } = await supabase
    .from("profiles")
    .update({ department_id: parsed.department_id })
    .eq("id", userId)
    .select("id,department_id")
    .maybeSingle();

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!data) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  return res.json({
    ok: true,
    data: {
      department_id: (data as any).department_id ?? null
    }
  });
});

router.get("/api/me/listings", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const userId = (req as unknown as { user: { id: string } }).user.id;

  const { data, error } = await supabase
    .from("listings")
    .select(
      "id,market_id,status,created_at,intention_signature,pricing(price_amount,price_type,currency),listing_locations(department,municipality)"
    )
    .eq("seller_profile_id", userId)
    .eq("listing_type", "sell")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  try {
    const rows = await buildListingSummaries(supabase, (data ?? []) as Array<Record<string, unknown>>);
    return res.json({ ok: true, data: rows });
  } catch (summaryError: any) {
    console.error("my_listings_summary_error", {
      code: summaryError?.code,
      message: summaryError?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

router.get("/api/me/buy-demands", requireAuth, async (req, res) => {
  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const userId = (req as unknown as { user: { id: string } }).user.id;

  const { data, error } = await supabase
    .from("demands")
    .select("*")
    .eq("requester_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  try {
    const rows = await buildDemandSummaries(supabase, (data ?? []) as Array<Record<string, unknown>>);
    return res.json({ ok: true, data: rows });
  } catch (summaryError: any) {
    console.error("my_demands_summary_error", {
      code: summaryError?.code,
      message: summaryError?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

router.patch("/api/me/buy-demands/:id/status", requireAuth, async (req, res, next) => {
  let id: string;
  let status: "inactive";
  try {
    ({ id } = idParamSchema.parse(req.params));
    ({ status } = updateDemandStatusBodySchema.parse(req.body));
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const userId = (req as unknown as { user: { id: string } }).user.id;

  const { data, error } = await supabase
    .from("demands")
    .update({ status })
    .eq("id", id)
    .eq("requester_user_id", userId)
    .eq("status", "open")
    .select("id,status")
    .maybeSingle();

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!data) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  return res.json({
    ok: true,
    data: {
      id: (data as any).id,
      status: (data as any).status
    }
  });
});

router.delete("/api/me/buy-demands/:id", requireAuth, async (req, res, next) => {
  let id: string;
  try {
    ({ id } = idParamSchema.parse(req.params));
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const userId = (req as unknown as { user: { id: string } }).user.id;

  const { data, error } = await supabase
    .from("demands")
    .delete()
    .eq("id", id)
    .eq("requester_user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("supabase_error", { code: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  if (!data) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  return res.json({ ok: true });
});

export default router;
