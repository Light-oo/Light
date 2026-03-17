import { createSupabaseAnon } from "../lib/supabase";
import type { ResolvedMarket } from "../services/marketResolution";
import { loadFieldVocabulary, type VocabularyOption } from "../services/marketVocabulary";

type RawRecord = Record<string, unknown>;
type SupabaseLike = ReturnType<typeof createSupabaseAnon>;

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function snakeToCamel(value: string) {
  return value.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
}

function dependencySignature(values: Record<string, string>) {
  return Object.entries(values)
    .filter(([, value]) => value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function resolveIdentityValue(
  row: Record<string, unknown>,
  fieldKey: string,
  signatureValues: Record<string, string>
) {
  const normalizedKey = fieldKey.toLowerCase();
  const camel = snakeToCamel(normalizedKey);
  const candidates = [
    row[`${normalizedKey}_label_es`],
    row[`${camel}LabelEs`],
    row[`${normalizedKey}_label`],
    row[`${camel}Label`],
    row[normalizedKey],
    row[camel],
    signatureValues[normalizedKey]
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
    if (typeof candidate === "string") {
      const value = candidate.trim();
      if (value.length > 0) {
        return value;
      }
    }
  }

  return null;
}

export function parseSignatureValues(signature: unknown): Record<string, string> {
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

export function buildIdentityValuesFromRow(
  row: Record<string, unknown>,
  resolvedMarket: ResolvedMarket,
  signatureValues: Record<string, string>
) {
  const identityValues: Record<string, string> = {};
  for (const field of resolvedMarket.fields) {
    const key = field.key.toLowerCase();
    const value = resolveIdentityValue(row, key, signatureValues);
    if (value) {
      identityValues[key] = value;
    }
  }
  return identityValues;
}

export async function resolveDisplayIdentityValues(params: {
  supabase: SupabaseLike;
  resolvedMarket: ResolvedMarket;
  identityValues: Record<string, string>;
}) {
  const { supabase, resolvedMarket, identityValues } = params;
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
