import { randomUUID } from "crypto";
import { logSystemError } from "../lib/logger";
import { createSupabaseAnon } from "../lib/supabase";
import type { ResolvedMarket, ResolvedMarketField, ResolvedMarketRule } from "./marketResolution";
import { resolveMarketConfiguration } from "./marketResolution";
import { isMarketFieldRequiredForFlow, validateMarketPayload } from "./dynamicValidation";
import { buildIntentionSignature } from "./signatureBuilder";
import { loadFieldVocabulary } from "./marketVocabulary";
import { engineOk, type EngineContractResponse } from "./engineContracts";
import { adaptEngineError, engineValidationFailure } from "./engineErrorAdapter";

type RawRecord = Record<string, unknown>;

type CreateMarketAwareSellListingInput = {
  accessToken: string;
  userId: string;
  marketKey: string;
  payload: Record<string, unknown>;
  location?: {
    department: string;
    municipality: string;
  };
  supabase?: ReturnType<typeof createSupabaseAnon>;
};

async function hasActiveSellerMarketCertification(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  userId: string;
  resolvedMarket: ResolvedMarket;
}) {
  const { supabase, userId, resolvedMarket } = params;
  const marketCandidates = resolvedMarket.market.id
    ? [
        { column: "market_id", value: resolvedMarket.market.id },
        { column: "market_key", value: resolvedMarket.market.key }
      ]
    : [{ column: "market_key", value: resolvedMarket.market.key }];
  const activeCandidates = [
    { column: "active", value: true },
    { column: "status", value: "active" }
  ];
  const profileCandidates = ["profile_id", "user_id"];
  let sawMissingColumn = false;

  for (const profileColumn of profileCandidates) {
    for (const marketCandidate of marketCandidates) {
      for (const activeCandidate of activeCandidates) {
        const { data, error } = await supabase
          .from("profile_market_certifications")
          .select("id")
          .eq(profileColumn, userId)
          .eq(marketCandidate.column, marketCandidate.value)
          .eq(activeCandidate.column, activeCandidate.value as any)
          .limit(1)
          .maybeSingle();

        if (!error) {
          return Boolean(data);
        }

        if (isMissingColumnError(error)) {
          sawMissingColumn = true;
          continue;
        }

        throw new MarketListingCreationError(
          "listing_certification_lookup_failed",
          `Listing certification lookup failed: ${error.message}`,
          500
        );
      }
    }
  }

  if (sawMissingColumn) {
    throw new MarketListingCreationError(
      "listing_certification_lookup_failed",
      "profile_market_certifications does not expose the expected profile/market activity columns.",
      500
    );
  }

  return false;
}

export class MarketListingCreationError extends Error {
  code: string;
  status: number;
  issues?: Array<{ path: string; message: string; code: string }>;

  constructor(
    code: string,
    message: string,
    status: number,
    issues?: Array<{ path: string; message: string; code: string }>
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function toBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on", "active", "enabled"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off", "inactive", "disabled"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function toFiniteNumberOrNull(value: unknown): number | null {
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

function isMissingColumnError(error: any) {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "pgrst204" ||
    code === "pgrst202" ||
    message.includes("column") ||
    details.includes("column")
  );
}

function isDuplicateListingError(error: any) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  const constraint = String(error?.constraint ?? "").toLowerCase();
  if (constraint.includes("listings_s1_active_sell_uq")) {
    return true;
  }
  if (code === "23505" && constraint.includes("listings")) {
    return true;
  }
  return code === "P0001" && message.includes("duplicate_listing");
}

function assertEngineSignatureFormat(signature: string, marketKey: string) {
  const normalizedMarketKey = marketKey.trim().toLowerCase();
  const normalizedSignature = signature.trim().toLowerCase();
  if (!normalizedSignature.startsWith(`${normalizedMarketKey}|`)) {
    throw new MarketListingCreationError(
      "invalid_signature_format",
      "Listing signature does not match engine canonical format.",
      500
    );
  }

  const parts = normalizedSignature.split("|").slice(1);
  for (const part of parts) {
    const value = part.split("=").slice(1).join("=").trim();
    if (value && looksLikeUuid(value)) {
      throw new MarketListingCreationError(
        "invalid_signature_format",
        "Listing signature contains legacy UUID components.",
        500
      );
    }
  }
}

function snakeToCamel(value: string) {
  return value.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
}

function getFieldRuleMap(field: ResolvedMarketField, rules: ResolvedMarketRule[]) {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(field.raw)) {
    map.set(key.toLowerCase(), value);
  }
  for (const rule of rules) {
    if ((rule.fieldKey ?? "").toLowerCase() !== field.key.toLowerCase()) {
      continue;
    }
    map.set(rule.ruleKey.toLowerCase(), rule.ruleValue);
  }
  return map;
}

function getSourceDefinition(field: ResolvedMarketField, ruleMap: Map<string, unknown>) {
  const sourceType =
    toStringOrNull(
      field.raw.option_source_type ??
      field.raw.options_source_type ??
      field.raw.source_type ??
      field.raw.catalog_source_type
    ) ??
    toStringOrNull(
      ruleMap.get("option_source_type") ??
      ruleMap.get("options_source_type") ??
      ruleMap.get("source_type") ??
      ruleMap.get("catalog_source_type")
    ) ??
    "table";

  const sourceRef =
    toStringOrNull(
      field.raw.option_source_ref ??
      field.raw.options_source_ref ??
      field.raw.source_ref ??
      field.raw.catalog_source_ref
    ) ??
    toStringOrNull(
      ruleMap.get("option_source_ref") ??
      ruleMap.get("options_source_ref") ??
      ruleMap.get("source_ref") ??
      ruleMap.get("catalog_source_ref")
    );

  const inputType =
    toStringOrNull(
      field.raw.input_type ??
      field.raw.inputType ??
      ruleMap.get("input_type") ??
      ruleMap.get("inputtype")
    ) ?? null;

  return {
    sourceType: sourceType.trim().toLowerCase(),
    sourceRef,
    inputType: inputType ? inputType.trim().toLowerCase() : null
  };
}

async function applyProfileDerivedValues(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  userId: string;
  resolvedMarket: ResolvedMarket;
  payload: Record<string, unknown>;
}) {
  const { supabase, userId, resolvedMarket, payload } = params;
  const derivedFields = resolvedMarket.fields.filter((field) => {
    const ruleMap = getFieldRuleMap(field, resolvedMarket.rules);
    const source = getSourceDefinition(field, ruleMap);
    return source.sourceType === "profile_field" || source.inputType === "derived_profile_value";
  });

  if (derivedFields.length === 0) {
    return;
  }

  const profileColumns = Array.from(
    new Set(
      derivedFields
        .map((field) => {
          const ruleMap = getFieldRuleMap(field, resolvedMarket.rules);
          const source = getSourceDefinition(field, ruleMap);
          return source.sourceRef?.trim();
        })
        .filter((column): column is string => Boolean(column && column.length > 0))
    )
  );
  if (profileColumns.length === 0) {
    return;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(profileColumns.join(","))
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new MarketListingCreationError(
      "profile_derived_value_failed",
      `Failed resolving profile-derived values: ${error.message}`,
      500
    );
  }

  if (!data || typeof data !== "object") {
    return;
  }

  for (const field of derivedFields) {
    const fieldKey = field.key.toLowerCase();
    const ruleMap = getFieldRuleMap(field, resolvedMarket.rules);
    const source = getSourceDefinition(field, ruleMap);
    const sourceRef = source.sourceRef?.trim();
    if (!sourceRef) {
      continue;
    }
    const rawValue = (data as Record<string, unknown>)[sourceRef];
    const normalized = toStringOrNull(rawValue);
    if (!normalized) {
      continue;
    }
    payload[fieldKey] = normalized;
  }
}

function extractCanonicalMarketPayload(
  payload: Record<string, unknown>,
  resolvedMarket: ResolvedMarket
) {
  const canonicalPayload: Record<string, unknown> = {};
  const fieldKeys = new Set(resolvedMarket.fields.map((field) => field.key.toLowerCase()));
  for (const [rawKey, rawValue] of Object.entries(payload)) {
    const normalizedKey = rawKey.trim().toLowerCase();
    if (!fieldKeys.has(normalizedKey)) {
      continue;
    }
    canonicalPayload[normalizedKey] = rawValue;
  }
  return canonicalPayload;
}

function collectNonCanonicalFieldKeyIssues(
  payload: Record<string, unknown>,
  resolvedMarket: ResolvedMarket
) {
  const allowedTopLevelKeys = new Set(["marketkey", "price", "location"]);
  const fieldKeys = new Set(resolvedMarket.fields.map((field) => field.key.toLowerCase()));
  const issues: Array<{ path: string; message: string; code: string }> = [];

  for (const rawKey of Object.keys(payload)) {
    const normalizedKey = rawKey.trim().toLowerCase();
    if (!normalizedKey || allowedTopLevelKeys.has(normalizedKey)) {
      continue;
    }
    if (fieldKeys.has(normalizedKey)) {
      continue;
    }

    const looksLikeLegacyAlias = resolvedMarket.fields.some((field) => {
      const fieldKey = field.key.toLowerCase();
      const camel = snakeToCamel(fieldKey).toLowerCase();
      return (
        normalizedKey === camel ||
        normalizedKey === `${fieldKey}_id` ||
        normalizedKey === `${camel}id`
      );
    });

    issues.push({
      path: rawKey,
      code: looksLikeLegacyAlias ? "non_canonical_field_key" : "unknown_field",
      message: looksLikeLegacyAlias
        ? `Field "${rawKey}" is not allowed. Use canonical field key names from market metadata.`
        : `Field "${rawKey}" is not defined for market "${resolvedMarket.market.key}".`
    });
  }

  return issues;
}

function mapIncomingPayloadToMarketFields(
  payload: Record<string, unknown>,
  resolvedMarket: ResolvedMarket
) {
  const mapped: Record<string, unknown> = {};
  for (const field of resolvedMarket.fields) {
    const fieldKey = field.key.toLowerCase();
    if (payload[fieldKey] !== undefined) {
      mapped[fieldKey] = payload[fieldKey];
    }
  }
  return mapped;
}

function getFieldByKey(resolvedMarket: ResolvedMarket, fieldKey: string) {
  return resolvedMarket.fields.find(
    (field) => field.key.toLowerCase() === fieldKey.trim().toLowerCase()
  ) ?? null;
}

function normalizePricePayload(params: {
  payload: Record<string, unknown>;
  resolvedMarket: ResolvedMarket;
}) {
  const priceField = getFieldByKey(params.resolvedMarket, "price");
  if (!priceField) {
    return {
      normalizedPriceValue: null as number | null,
      priceType: null as "fixed" | null,
      issues: [] as Array<{ path: string; message: string; code: string }>
    };
  }

  const rawPrice = params.payload.price;
  if (rawPrice === undefined || rawPrice === null || rawPrice === "") {
    return {
      normalizedPriceValue: null as number | null,
      priceType: null as "fixed" | null,
      issues: [] as Array<{ path: string; message: string; code: string }>
    };
  }

  if (!rawPrice || typeof rawPrice !== "object" || Array.isArray(rawPrice)) {
    return {
      normalizedPriceValue: null as number | null,
      priceType: null as "fixed" | null,
      issues: [
        {
          path: "price",
          code: "invalid_field_value",
          message: "Field \"price\" must be an object with amount and type."
        }
      ]
    };
  }

  const priceRow = rawPrice as Record<string, unknown>;
  const amount = toFiniteNumberOrNull(priceRow.amount);
  const rawType = toStringOrNull(priceRow.type)?.trim().toLowerCase() ?? null;

  if (priceRow.amount !== undefined && amount === null) {
    return {
      normalizedPriceValue: null as number | null,
      priceType: null as "fixed" | null,
      issues: [
        {
          path: "price.amount",
          code: "invalid_field_value",
          message: "Field \"price.amount\" must be numeric."
        }
      ]
    };
  }

  if (amount !== null && (amount <= 0 || amount > 10000)) {
    return {
      normalizedPriceValue: null as number | null,
      priceType: null as "fixed" | null,
      issues: [
        {
          path: "price.amount",
          code: "invalid_field_value",
          message: "Field \"price.amount\" must be greater than 0 and less than or equal to 10000."
        }
      ]
    };
  }

  if (rawType !== null && rawType !== "fixed") {
    return {
      normalizedPriceValue: null as number | null,
      priceType: null as "fixed" | null,
      issues: [
        {
          path: "price.type",
          code: "invalid_field_value",
          message: "Field \"price.type\" must be \"fixed\"."
        }
      ]
    };
  }

  return {
    normalizedPriceValue: amount,
    priceType: amount === null ? null : "fixed",
    issues: [] as Array<{ path: string; message: string; code: string }>
  };
}

function buildLegacyUuidIssues(
  mappedPayload: Record<string, unknown>,
  resolvedMarket: ResolvedMarket
) {
  const issues: Array<{ path: string; message: string; code: string }> = [];
  for (const field of resolvedMarket.fields) {
    const fieldKey = field.key.toLowerCase();
    const rawValue = toStringOrNull(mappedPayload[fieldKey]);
    if (!rawValue) {
      continue;
    }
    if (!looksLikeUuid(rawValue)) {
      continue;
    }
    issues.push({
      path: fieldKey,
      code: "legacy_uuid_value_not_allowed",
      message: `Field "${fieldKey}" must use canonical key values, not UUID identifiers.`
    });
  }
  return issues;
}

function getMarketScopeCandidates(resolvedMarket: ResolvedMarket) {
  const candidates: Array<{ column: string; value: string }> = [];
  if (resolvedMarket.market.key) {
    candidates.push({ column: "market_key", value: resolvedMarket.market.key });
  }
  if (resolvedMarket.market.id) {
    candidates.push({ column: "market_id", value: resolvedMarket.market.id });
  }
  return candidates;
}

async function hasActiveDuplicateBySignature(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  sellerUserId: string;
  signature: string;
  resolvedMarket: ResolvedMarket;
}) {
  const { supabase, sellerUserId, signature, resolvedMarket } = params;
  const scopeCandidates = getMarketScopeCandidates(resolvedMarket);
  let missingScopeColumnCount = 0;

  for (const scope of scopeCandidates) {
    const { data, error } = await supabase
      .from("listings")
      .select("id")
      .eq("seller_profile_id", sellerUserId)
      .eq("listing_type", "sell")
      .eq("status", "active")
      .eq("intention_signature", signature)
      .eq(scope.column, scope.value)
      .limit(1)
      .maybeSingle();

    if (!error) {
      return Boolean(data);
    }
    if (isMissingColumnError(error)) {
      missingScopeColumnCount += 1;
      continue;
    }
    throw new MarketListingCreationError(
      "duplicate_check_failed",
      `Duplicate check failed: ${error.message}`,
      500
    );
  }

  if (scopeCandidates.length > 0 && missingScopeColumnCount === scopeCandidates.length) {
    throw new MarketListingCreationError(
      "market_scope_not_persisted",
      "Listings table does not expose market scope columns required for duplicate detection.",
      500
    );
  }

  return false;
}

async function insertListingWithMarketScope(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  resolvedMarket: ResolvedMarket;
  basePayload: Record<string, unknown>;
}) {
  const { supabase, resolvedMarket, basePayload } = params;
  const scopeCandidates = getMarketScopeCandidates(resolvedMarket);
  let missingScopeColumnCount = 0;

  for (const scope of scopeCandidates) {
    const payload = {
      ...basePayload,
      [scope.column]: scope.value
    };
    const { error } = await supabase.from("listings").insert(payload);
    if (!error) {
      return;
    }
    if (isDuplicateListingError(error)) {
      throw new MarketListingCreationError("duplicate_listing", "duplicate_listing", 409);
    }
    if (isMissingColumnError(error)) {
      missingScopeColumnCount += 1;
      continue;
    }
    throw new MarketListingCreationError("insert_listings_failed", error.message, 500);
  }

  if (scopeCandidates.length > 0 && missingScopeColumnCount === scopeCandidates.length) {
    throw new MarketListingCreationError(
      "market_scope_not_persisted",
      "Listings table does not expose market scope columns.",
      500
    );
  }

  const { error } = await supabase.from("listings").insert(basePayload);
  if (error) {
    if (isDuplicateListingError(error)) {
      throw new MarketListingCreationError("duplicate_listing", "duplicate_listing", 409);
    }
    throw new MarketListingCreationError("insert_listings_failed", error.message, 500);
  }
}

async function cleanupPartialListingInsert(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  listingId: string;
  sellerUserId: string;
}) {
  const { supabase, listingId, sellerUserId } = params;
  const cleanupErrors: Array<{ table: string; code: string; message: string }> = [];

  const safeDelete = async (table: string, filters: Array<[string, string]>) => {
    let query = supabase.from(table).delete();
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    const { error } = await query;
    if (error) {
      logSystemError("partial_listing_cleanup_error", {
        table,
        listingId,
        code: error.code,
        message: error.message
      });
      cleanupErrors.push({
        table,
        code: String(error.code ?? "unknown"),
        message: String(error.message ?? "cleanup_failed")
      });
    }
  };

  await safeDelete("listing_locations", [["listing_id", listingId]]);
  await safeDelete("pricing", [["listing_id", listingId]]);
  await safeDelete("item_specs", [["listing_id", listingId]]);
  await safeDelete("listings", [["id", listingId], ["seller_profile_id", sellerUserId]]);

  if (cleanupErrors.length > 0) {
    const summary = cleanupErrors
      .map((item) => `${item.table}:${item.code}:${item.message}`)
      .join("; ");
    throw new MarketListingCreationError(
      "partial_cleanup_failed",
      `Cleanup failed after listing error: ${summary}`,
      500
    );
  }
}

async function ensureListingSignaturePersisted(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  listingId: string;
  sellerUserId: string;
  signature: string;
}) {
  const { supabase, listingId, sellerUserId, signature } = params;
  const { data, error } = await supabase
    .from("listings")
    .select("id,intention_signature")
    .eq("id", listingId)
    .eq("seller_profile_id", sellerUserId)
    .maybeSingle();

  if (error) {
    throw new MarketListingCreationError(
      "listing_signature_verify_failed",
      `Listing signature verify failed: ${error.message}`,
      500
    );
  }

  if (!data) {
    throw new MarketListingCreationError(
      "listing_signature_verify_failed",
      "Listing row was not found after insert.",
      500
    );
  }

  const persistedSignature = toStringOrNull((data as RawRecord).intention_signature);
  if (persistedSignature) {
    return;
  }

  const { error: updateError } = await supabase
    .from("listings")
    .update({ intention_signature: signature })
    .eq("id", listingId)
    .eq("seller_profile_id", sellerUserId);

  if (updateError) {
    throw new MarketListingCreationError(
      "listing_signature_verify_failed",
      `Listing signature recovery failed: ${updateError.message}`,
      500
    );
  }
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getItemSpecsColumn(field: ResolvedMarketField, rules: ResolvedMarketRule[]) {
  const ruleMap = getFieldRuleMap(field, rules);
  const fromMetadata = [
    "item_specs_column",
    "listing_specs_column",
    "storage_column",
    "persist_column"
  ];

  for (const key of fromMetadata) {
    const fromRaw = toStringOrNull(field.raw[key]);
    if (fromRaw) {
      return fromRaw;
    }
    const fromRule = toStringOrNull(ruleMap.get(key));
    if (fromRule) {
      return fromRule;
    }
  }

  return null;
}

async function resolveSelectedOptionIds(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  resolvedMarket: ResolvedMarket;
  normalizedPayload: Record<string, string>;
  mappedPayload: Record<string, unknown>;
}) {
  const { supabase, resolvedMarket, normalizedPayload, mappedPayload } = params;
  const out = new Map<string, string>();

  for (const field of resolvedMarket.fields) {
    const fieldKey = field.key.toLowerCase();
    const normalizedValue = normalizedPayload[fieldKey];
    if (!normalizedValue) {
      continue;
    }

    const rawIncoming = toStringOrNull(mappedPayload[fieldKey]);
    if (rawIncoming && looksLikeUuid(rawIncoming)) {
      out.set(fieldKey, rawIncoming);
      continue;
    }

    const ruleMap = getFieldRuleMap(field, resolvedMarket.rules);
    const catalogOnly = toBoolean(ruleMap.get("catalog_only"), false);
    if (!catalogOnly) {
      continue;
    }

    const vocabulary = await loadFieldVocabulary({
      marketKey: resolvedMarket.market.key,
      fieldKey,
      selectedValues: normalizedPayload,
      resolvedMarket,
      supabase: supabase as any
    });
    const selectedOption = vocabulary.options.find(
      (option) => option.key.toLowerCase() === normalizedValue
    );
    if (selectedOption?.id) {
      out.set(fieldKey, selectedOption.id);
    }
  }

  return out;
}

export async function createMarketAwareSellListing(input: CreateMarketAwareSellListingInput) {
  const supabase = input.supabase ?? createSupabaseAnon({ accessToken: input.accessToken });
  const marketKey = input.marketKey.trim().toLowerCase();
  const resolvedMarket = await resolveMarketConfiguration(marketKey, {
    supabase: supabase as any
  });
  const priceNormalization = normalizePricePayload({
    payload: input.payload,
    resolvedMarket
  });
  if (priceNormalization.issues.length > 0) {
    throw new MarketListingCreationError(
      "invalid_request",
      "invalid_request",
      400,
      priceNormalization.issues
    );
  }
  const hasPrice =
    typeof priceNormalization.normalizedPriceValue === "number" &&
    Number.isFinite(priceNormalization.normalizedPriceValue) &&
    priceNormalization.priceType === "fixed";
  const priceRequired = await isMarketFieldRequiredForFlow({
    marketKey: resolvedMarket.market.key,
    fieldKey: "price",
    flow: "SELL",
    resolvedMarket,
    supabase: supabase as any
  });

  if (priceRequired && !hasPrice) {
    throw new MarketListingCreationError("invalid_request", "invalid_request", 400, [
      {
        path: "price",
        code: "required_field_missing",
        message: "Field \"price\" is required."
      }
    ]);
  }

  const nonCanonicalIssues = collectNonCanonicalFieldKeyIssues(input.payload, resolvedMarket);
  if (nonCanonicalIssues.length > 0) {
    throw new MarketListingCreationError(
      "invalid_request",
      "invalid_request",
      400,
      nonCanonicalIssues
    );
  }

  const canonicalPayload = extractCanonicalMarketPayload(input.payload, resolvedMarket);
  const mappedPayload = mapIncomingPayloadToMarketFields(canonicalPayload, resolvedMarket);
  await applyProfileDerivedValues({
    supabase,
    userId: input.userId,
    resolvedMarket,
    payload: mappedPayload
  });
  if (hasPrice) {
    mappedPayload.price = priceNormalization.normalizedPriceValue;
  } else {
    delete mappedPayload.price;
  }
  const legacyUuidIssues = buildLegacyUuidIssues(mappedPayload, resolvedMarket);
  if (legacyUuidIssues.length > 0) {
    throw new MarketListingCreationError(
      "invalid_request",
      "invalid_request",
      400,
      legacyUuidIssues
    );
  }
  const validation = await validateMarketPayload({
    marketKey: resolvedMarket.market.key,
    flow: "SELL",
    payload: mappedPayload,
    resolvedMarket,
    supabase: supabase as any
  });

  if (!validation.ok) {
    throw new MarketListingCreationError("invalid_request", "invalid_request", 400, [
      ...validation.errors.map((error) => ({
        path: error.fieldKey,
        message: error.message,
        code: error.code
      }))
    ]);
  }

  const signature = await buildIntentionSignature({
    marketKey: resolvedMarket.market.key,
    normalizedPayload: validation.normalizedPayload,
    resolvedMarket,
    supabase: supabase as any
  });
  assertEngineSignatureFormat(signature, resolvedMarket.market.key);

  const selectedOptionIds = await resolveSelectedOptionIds({
    supabase,
    resolvedMarket,
    normalizedPayload: validation.normalizedPayload,
    mappedPayload
  });

  const duplicateExists = await hasActiveDuplicateBySignature({
    supabase,
    sellerUserId: input.userId,
    signature,
    resolvedMarket
  });
  if (duplicateExists) {
    throw new MarketListingCreationError("duplicate_listing", "duplicate_listing", 409);
  }

  const isCertified = await hasActiveSellerMarketCertification({
    supabase,
    userId: input.userId,
    resolvedMarket
  });

  const listingId = randomUUID();
  let listingInserted = false;
  try {
    await insertListingWithMarketScope({
      supabase,
      resolvedMarket,
      basePayload: {
        id: listingId,
        listing_type: "sell",
        status: "active",
        seller_profile_id: input.userId,
        intention_signature: signature,
        is_certified: isCertified
      }
    });
    listingInserted = true;
    await ensureListingSignaturePersisted({
      supabase,
      listingId,
      sellerUserId: input.userId,
      signature
    });

    const itemSpecsPayload: Record<string, unknown> = {
      listing_id: listingId
    };
    for (const field of resolvedMarket.fields) {
      const fieldKey = field.key.toLowerCase();
      const selectedId = selectedOptionIds.get(fieldKey);
      if (!selectedId) {
        continue;
      }
      const column = getItemSpecsColumn(field, resolvedMarket.rules);
      if (!column) {
        continue;
      }
      itemSpecsPayload[column] = selectedId;
    }
    const { error: specsError } = await supabase.from("item_specs").insert(itemSpecsPayload);
    if (specsError) {
      if (isDuplicateListingError(specsError)) {
        throw new MarketListingCreationError("duplicate_listing", "duplicate_listing", 409);
      }
      throw new MarketListingCreationError("insert_item_specs_failed", specsError.message, 500);
    }

    if (hasPrice) {
      const { error: pricingError } = await supabase.from("pricing").insert({
        listing_id: listingId,
        price_amount: priceNormalization.normalizedPriceValue,
        price_type: priceNormalization.priceType,
        currency: "USD"
      });

      if (pricingError) {
        if (isDuplicateListingError(pricingError)) {
          throw new MarketListingCreationError("duplicate_listing", "duplicate_listing", 409);
        }
        throw new MarketListingCreationError("insert_pricing_failed", pricingError.message, 500);
      }
    }

    if (input.location) {
      const { error: locationError } = await supabase.from("listing_locations").insert({
        listing_id: listingId,
        department: input.location.department,
        municipality: input.location.municipality
      });

      if (locationError) {
        if (isDuplicateListingError(locationError)) {
          throw new MarketListingCreationError("duplicate_listing", "duplicate_listing", 409);
        }
        throw new MarketListingCreationError(
          "insert_listing_locations_failed",
          locationError.message,
          500
        );
      }
    }
  } catch (error) {
    let cleanupFailure: MarketListingCreationError | null = null;
    if (listingInserted) {
      try {
        await cleanupPartialListingInsert({
          supabase,
          listingId,
          sellerUserId: input.userId
        });
      } catch (cleanupError) {
        if (cleanupError instanceof MarketListingCreationError) {
          cleanupFailure = cleanupError;
        } else {
          cleanupFailure = new MarketListingCreationError(
            "partial_cleanup_failed",
            `Cleanup failed after listing error: ${String((cleanupError as any)?.message ?? cleanupError)}`,
            500
          );
        }
      }
    }

    if (cleanupFailure) {
      throw cleanupFailure;
    }

    throw error;
  }

  return {
    listingId,
    marketKey: resolvedMarket.market.key,
    signature,
    normalizedPayload: validation.normalizedPayload,
    isCertified
  };
}

export type ListingCreationContractData = {
  marketKey: string;
  entity: "listing";
  listingId: string;
  action: "created";
  signature: string;
  normalizedPayload: Record<string, string>;
  isCertified: boolean;
};

export async function createMarketAwareSellListingContract(
  input: CreateMarketAwareSellListingInput
): Promise<EngineContractResponse<ListingCreationContractData>> {
  try {
    const created = await createMarketAwareSellListing(input);
    return engineOk({
      marketKey: created.marketKey,
      entity: "listing",
      listingId: created.listingId,
      action: "created",
      signature: created.signature,
      normalizedPayload: created.normalizedPayload,
      isCertified: created.isCertified
    });
  } catch (error) {
    if (error instanceof MarketListingCreationError) {
      if (error.code === "invalid_request") {
        return engineValidationFailure(
          (error.issues ?? []).map((issue) => ({
            fieldKey: issue.path,
            code: issue.code,
            message: issue.message
          })),
          "Listing payload validation failed."
        );
      }
      return adaptEngineError(error, "Listing creation failed.");
    }

    return adaptEngineError(error, "Unexpected listing creation error.");
  }
}
