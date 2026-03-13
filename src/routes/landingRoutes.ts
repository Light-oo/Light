import { Router } from "express";
import { createSupabaseServiceRole } from "../lib/supabase";
import { resolveMarketConfiguration, type ResolvedMarket } from "../services/marketResolution";
import { loadFieldVocabulary, type VocabularyOption } from "../services/marketVocabulary";

const router = Router();

type RawRecord = Record<string, unknown>;

type LandingDemandRow = {
  id: string;
  market_key: string | null;
  status: string | null;
  created_at: string | null;
  intention_signature: string | null;
  details_text: string | null;
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

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    )
  );
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

function dependencySignature(values: Record<string, string>) {
  return Object.entries(values)
    .filter(([, value]) => value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

async function buildResolvedMarketMap(marketKeys: string[]) {
  const uniqueMarketKeys = uniqueNonEmpty(marketKeys);
  const entries = await Promise.all(
    uniqueMarketKeys.map(async (marketKey) => {
      const resolved = await resolveMarketConfiguration(marketKey);
      return [marketKey, resolved] as const;
    })
  );
  return new Map<string, ResolvedMarket>(entries);
}

async function resolveDisplayIdentityValues(
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
          resolvedMarket
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

router.get("/landing/latest-demands", async (_req, res) => {
  try {
    const supabase = createSupabaseServiceRole();
    const { data, error } = await supabase
      .from("demands")
      .select("id,market_key,status,created_at,intention_signature,details_text")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) {
      console.error("landing_latest_demands_query_error", {
        code: error.code,
        message: error.message,
        details: (error as any)?.details,
        hint: (error as any)?.hint
      });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    const rows = (data ?? []) as LandingDemandRow[];
    const resolvedMarketByKey = await buildResolvedMarketMap(
      rows.map((row) => normalizeText(row.market_key))
    );

    const payload = await Promise.all(
      rows.map(async (row) => {
        const marketKey = normalizeText(row.market_key);
        const signature = normalizeText(row.intention_signature);
        const identityValues = parseSignatureValues(signature);
        const resolvedMarket = resolvedMarketByKey.get(marketKey);
        const displayIdentityValues = resolvedMarket
          ? await resolveDisplayIdentityValues(resolvedMarket, identityValues)
          : identityValues;

        return {
          id: normalizeText(row.id),
          marketKey,
          identityValues: displayIdentityValues,
          signature,
          status: normalizeNullableText(row.status),
          created_at: normalizeNullableText(row.created_at),
          request: {
            detailsText: normalizeNullableText(row.details_text)
          }
        };
      })
    );

    return res.json(payload);
  } catch (error: any) {
    console.error("landing_latest_demands_error", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      stack: error?.stack
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

export default router;
