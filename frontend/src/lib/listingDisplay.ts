import type { MarketFieldDefinition } from "./marketForm";

type DisplayValue = string | number | null | undefined;

export type ListingIdentityValues = Partial<Record<string, DisplayValue>>;

function normalizeDisplayValue(value: DisplayValue) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value).trim();
  return text;
}

function snakeToCamel(value: string) {
  return value.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
}

function resolveFieldValue(source: Record<string, unknown>, fieldKey: string): DisplayValue {
  const normalizedKey = fieldKey.trim().toLowerCase();
  const camel = snakeToCamel(normalizedKey);
  const identity = source.identity && typeof source.identity === "object"
    ? (source.identity as Record<string, unknown>)
    : null;

  const candidates: unknown[] = [
    source[normalizedKey],
    source[camel],
    source[`${normalizedKey}_label_es`],
    source[`${camel}LabelEs`],
    source[`${normalizedKey}_label`],
    source[`${camel}Label`],
    source[`${normalizedKey}_display`],
    source[`${camel}Display`],
    identity?.[normalizedKey],
    identity?.[camel]
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDisplayValue(candidate as DisplayValue);
    if (normalized) {
      return candidate as DisplayValue;
    }
  }

  return undefined;
}

export function extractIdentityValuesForFields(
  source: Record<string, unknown>,
  orderedFields: MarketFieldDefinition[]
): ListingIdentityValues {
  const out: ListingIdentityValues = {};
  for (const field of orderedFields) {
    const value = resolveFieldValue(source, field.key);
    if (value !== undefined && value !== null && normalizeDisplayValue(value).length > 0) {
      out[field.key] = value;
    }
  }
  return out;
}

export function formatMarketListingIdentity(params: {
  orderedFields: MarketFieldDefinition[];
  values: ListingIdentityValues;
  fallback?: string;
  separator?: string;
  transform?: (value: string, fieldKey: string) => string;
}) {
  const fallback = params.fallback ?? "—";
  const separator = params.separator ?? " / ";
  const transform = params.transform ?? ((value: string) => value);

  const parts = params.orderedFields
    .map((field) => {
      const raw = params.values[field.key];
      const normalized = normalizeDisplayValue(raw);
      if (!normalized) {
        return null;
      }
      return transform(normalized, field.key);
    })
    .filter((value): value is string => value !== null);

  if (parts.length === 0) {
    return fallback;
  }

  return parts.join(separator);
}

export function formatMarketDemandIdentity(params: {
  orderedFields: MarketFieldDefinition[];
  values: ListingIdentityValues;
  fallback?: string;
  separator?: string;
  transform?: (value: string, fieldKey: string) => string;
}) {
  return formatMarketListingIdentity({
    orderedFields: params.orderedFields,
    values: params.values,
    fallback: params.fallback,
    separator: params.separator,
    transform: params.transform
  });
}

export function parseSignatureIdentityValues(signature?: string | null): Record<string, string> {
  const text = String(signature ?? "").trim();
  if (!text.includes("|")) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const part of text.split("|").slice(1)) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (!key || !value) {
      continue;
    }
    out[key] = value;
  }

  return out;
}

function normalizeToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function humanizeToken(value: string) {
  if (!value) {
    return "";
  }
  const normalized = value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeUiToken(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const lower = raw.toLowerCase();
  if (/^[a-z0-9_]+$/.test(lower)) {
    return humanizeToken(lower);
  }
  return raw;
}

function toDisplayLabel(value: unknown, map: Record<string, string>) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const token = normalizeToken(raw);
  if (map[token]) {
    return map[token];
  }

  if (/^[a-z0-9_]+$/.test(token)) {
    return humanizeToken(token);
  }

  return raw;
}

function tradeLabel(value: unknown) {
  return toDisplayLabel(value, {
    albanil: "Albanil"
  });
}

function experienceLabel(value: unknown) {
  return toDisplayLabel(value, {
    con_experiencia: "Con experiencia previa",
    sin_experiencia: "Sin experiencia previa",
    "1_3_years": "1 a 3 anos de experiencia",
    "3_5_years": "3 a 5 anos de experiencia",
    "5_plus_years": "Mas de 5 anos de experiencia"
  });
}

export function isHomeServicesIdentity(values: Record<string, unknown>) {
  return ["trade", "experience", "work_area", "detail"].some((key) => {
    const value = String(values[key] ?? "").trim();
    return value.length > 0;
  });
}

export function isAutomotiveIdentity(values: Record<string, unknown>) {
  const hasPart = String(values.part ?? "").trim().length > 0;
  const hasBrand = String(values.brand ?? "").trim().length > 0;
  const hasModel = String(values.model ?? "").trim().length > 0;
  const hasYear = String(values.year ?? "").trim().length > 0;
  return hasPart || hasBrand || hasModel || hasYear;
}

export function formatAutomotiveCardLines(values: Record<string, unknown>) {
  const partLine = normalizeUiToken(values.part);
  const brand = normalizeUiToken(values.brand);
  const model = normalizeUiToken(values.model);
  const year = normalizeUiToken(values.year);
  const vehicleLine = [brand, model, year].filter((item) => item.length > 0).join(" ").trim();

  return {
    partLine,
    vehicleLine
  };
}

export function formatAutomotiveIdentityLine(values: Record<string, unknown>) {
  const lines = formatAutomotiveCardLines(values);
  if (lines.partLine && lines.vehicleLine) {
    return `${lines.partLine} / ${lines.vehicleLine}`;
  }
  if (lines.partLine) {
    return lines.partLine;
  }
  if (lines.vehicleLine) {
    return lines.vehicleLine;
  }
  return "—";
}

export function formatHomeServicesNarrative(params: {
  intent: "BUY" | "SELL";
  identityValues: Record<string, unknown>;
  locationDepartment?: string | null;
}) {
  void params.intent;
  void params.locationDepartment;
  const trade = tradeLabel(params.identityValues.trade);
  const experience = experienceLabel(params.identityValues.experience);
  const normalizedTrade = trade || "Servicio";
  const headline = `Servicio de ${normalizedTrade}`.replace(/\s+/g, " ").trim();
  const secondaryLine = (experience || "Experiencia no especificada").trim();

  return {
    headline,
    secondaryLine
  };
}
