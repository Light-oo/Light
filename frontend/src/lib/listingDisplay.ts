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

function tradeLabel(value: unknown) {
  const token = normalizeToken(value);
  const map: Record<string, string> = {
    albanil: "albañil"
  };
  if (map[token]) {
    return map[token];
  }
  return humanizeToken(token).toLowerCase();
}

function experienceLabel(value: unknown) {
  const token = normalizeToken(value);
  const map: Record<string, string> = {
    "1_3_years": "1 a 3 años de experiencia",
    "3_5_years": "3 a 5 años de experiencia",
    "5_plus_years": "más de 5 años de experiencia"
  };
  if (map[token]) {
    return map[token];
  }
  if (token.includes("año")) {
    return token;
  }
  return humanizeToken(token).toLowerCase();
}

function warrantyLabel(value: unknown) {
  const token = normalizeToken(value);
  if (["yes", "si", "sí", "true", "1"].includes(token)) {
    return "que garantiza su trabajo";
  }
  if (["no", "false", "0"].includes(token)) {
    return "sin garantía declarada";
  }
  return humanizeToken(token).toLowerCase();
}

function travelRangeLabel(value: unknown, workArea?: string | null) {
  const token = normalizeToken(value);
  if (token === "local") {
    const normalizedArea = String(workArea ?? "").trim();
    return normalizedArea ? `Disponible en ${normalizedArea}.` : "Disponible en su zona.";
  }
  if (token === "department") {
    return "Puede trabajar dentro de su departamento.";
  }
  if (token === "interdepartmental") {
    return "Puede moverse entre departamentos.";
  }
  if (token === "national") {
    return "Puede trabajar en todo el país.";
  }
  return humanizeToken(token);
}

export function isHomeServicesIdentity(values: Record<string, unknown>) {
  return ["trade", "warranty", "experience", "travel_range", "work_area"].some((key) => {
    const value = String(values[key] ?? "").trim();
    return value.length > 0;
  });
}

export function formatHomeServicesNarrative(params: {
  intent: "BUY" | "SELL";
  identityValues: Record<string, unknown>;
  locationDepartment?: string | null;
}) {
  const trade = tradeLabel(params.identityValues.trade);
  const experience = experienceLabel(params.identityValues.experience);
  const warranty = warrantyLabel(params.identityValues.warranty);
  const workAreaFromIdentity = String(params.identityValues.work_area ?? "").trim();
  const locationDepartment = String(params.locationDepartment ?? "").trim();
  const workArea = workAreaFromIdentity || locationDepartment;
  const travelRange = travelRangeLabel(params.identityValues.travel_range, workArea);

  const actor = params.intent === "BUY" ? "Busco" : "Ofrezco";
  const article = params.intent === "BUY" ? "un" : "servicio de";

  const headlineParts = [
    actor,
    article,
    trade || "servicio",
    experience ? `con ${experience}` : "",
    warranty || ""
  ].filter((part) => part && String(part).trim().length > 0);

  const headline = `${headlineParts.join(" ")}.`.replace(/\s+/g, " ").trim();
  const locationLine = travelRange || (workArea ? `Disponible en ${workArea}.` : "Disponible en El Salvador.");

  return {
    headline,
    locationLine
  };
}
