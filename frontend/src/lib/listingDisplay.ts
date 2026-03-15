import type { MarketCardTemplate, MarketFieldDefinition } from "./marketForm";

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

export function buildGenericCardContent(params: {
  intentLabel: string;
  orderedFields: MarketFieldDefinition[];
  values: ListingIdentityValues;
  fallbackLabel?: string;
  secondarySeparator?: string;
}) {
  const fallbackLabel = params.fallbackLabel ?? "Publicacion";
  const secondarySeparator = params.secondarySeparator ?? " / ";
  const orderedValues = params.orderedFields
    .map((field) => normalizeDisplayValue(params.values[field.key]))
    .filter((value) => value.length > 0);

  const primaryValue = orderedValues[0] ?? fallbackLabel;
  const secondaryValues = orderedValues.slice(1);

  return {
    title: `${params.intentLabel} ${primaryValue}`.trim(),
    secondaryLine:
      secondaryValues.length > 0 ? secondaryValues.join(secondarySeparator) : null,
    metaLine: null
  };
}

function normalizeRenderedTemplate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  return normalized.length > 0 ? normalized : null;
}

export function renderTemplate(
  template: string | null | undefined,
  values: Record<string, DisplayValue>
) {
  if (!template) {
    return null;
  }

  const rendered = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const normalizedKey = key.trim();
    return normalizeDisplayValue(values[normalizedKey]);
  });

  return normalizeRenderedTemplate(rendered);
}

export function buildTemplateCardContent(params: {
  template: MarketCardTemplate;
  values: Record<string, DisplayValue>;
  fallbackLabel?: string;
}) {
  const fallbackLabel = params.fallbackLabel ?? "Publicacion";

  return {
    title: renderTemplate(params.template.titleTemplate, params.values) ?? fallbackLabel,
    secondaryLine: renderTemplate(params.template.subtitleTemplate, params.values),
    metaLine: renderTemplate(params.template.metaTemplate, params.values)
  };
}

export function buildCardRenderValues(params: {
  identityValues: Record<string, DisplayValue>;
  price?: string | null;
  location?: {
    department: string | null;
    municipality: string | null;
  } | null;
  detailsText?: string | null;
}) {
  const values: Record<string, DisplayValue> = {
    ...params.identityValues
  };

  if (params.price) {
    values.price = params.price;
  }

  if (params.location?.department) {
    values.department = params.location.department;
  }

  if (params.location?.municipality) {
    values.municipality = params.location.municipality;
  }

  if (params.detailsText) {
    values.detailsText = params.detailsText;
  }

  return values;
}

export function buildCardContent(params: {
  intentLabel: string;
  orderedFields: MarketFieldDefinition[];
  values: ListingIdentityValues;
  fallbackLabel?: string;
  secondarySeparator?: string;
  template?: MarketCardTemplate;
  price?: string | null;
  location?: {
    department: string | null;
    municipality: string | null;
  } | null;
  detailsText?: string | null;
}) {
  if (params.template) {
    return buildTemplateCardContent({
      template: params.template,
      values: buildCardRenderValues({
        identityValues: params.values,
        price: params.price,
        location: params.location,
        detailsText: params.detailsText
      }),
      fallbackLabel: params.fallbackLabel
    });
  }

  return buildGenericCardContent({
    intentLabel: params.intentLabel,
    orderedFields: params.orderedFields,
    values: params.values,
    fallbackLabel: params.fallbackLabel,
    secondarySeparator: params.secondarySeparator
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
