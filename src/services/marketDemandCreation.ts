import { createSupabaseAnon } from "../lib/supabase";
import type { ResolvedMarket, ResolvedMarketField, ResolvedMarketRule } from "./marketResolution";
import { resolveMarketConfiguration } from "./marketResolution";
import { validateMarketPayload } from "./dynamicValidation";
import { buildIntentionSignature } from "./signatureBuilder";
import { loadFieldVocabulary } from "./marketVocabulary";
import { engineOk, type EngineContractResponse } from "./engineContracts";
import { adaptEngineError, engineValidationFailure } from "./engineErrorAdapter";

type CreateOrReuseOpenMarketDemandInput = {
  accessToken: string;
  userId: string;
  marketKey: string;
  payload: Record<string, unknown>;
  detailsText?: string | null;
  supabase?: ReturnType<typeof createSupabaseAnon>;
};

export type CreateOrReuseOpenMarketDemandResult = {
  demandId: string;
  marketKey: string;
  signature: string;
  normalizedPayload: Record<string, string>;
  action: "created" | "existing" | "updated";
};

export class MarketDemandCreationError extends Error {
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

const DETAILS_MAX_LENGTH = 200;
const DETAILS_CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const DETAILS_ALLOWED_CHARS_PATTERN = /^[A-Za-z0-9À-ÖØ-öø-ÿ\s.,;:!?'"()\-\/+#&]*$/;

type DetailsNormalizationResult = {
  value: string | null;
  issue?: { path: string; message: string; code: string };
};

function normalizeDetailsText(input?: string | null) {
  if (input == null) {
    return { value: null } as DetailsNormalizationResult;
  }

  const raw = String(input);
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return {
      value: null,
      issue: {
        path: "detailsText",
        message: "Field \"detailsText\" cannot be empty or whitespace-only.",
        code: "invalid_details_text"
      }
    } as DetailsNormalizationResult;
  }

  if (collapsed.length > DETAILS_MAX_LENGTH) {
    return {
      value: null,
      issue: {
        path: "detailsText",
        message: `Field "detailsText" must be at most ${DETAILS_MAX_LENGTH} characters.`,
        code: "details_text_too_long"
      }
    } as DetailsNormalizationResult;
  }

  if (
    DETAILS_CONTROL_CHAR_PATTERN.test(collapsed) ||
    !DETAILS_ALLOWED_CHARS_PATTERN.test(collapsed)
  ) {
    return {
      value: null,
      issue: {
        path: "detailsText",
        message: "Field \"detailsText\" contains unsupported characters.",
        code: "invalid_details_text_characters"
      }
    } as DetailsNormalizationResult;
  }

  return { value: collapsed } as DetailsNormalizationResult;
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

function isMissingSpecificColumn(error: any, column: string) {
  if (!isMissingColumnError(error)) {
    return false;
  }
  const normalized = column.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const message = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`.toLowerCase();
  return message.includes(normalized);
}

function isOpenDemandDuplicateError(error: any) {
  const code = String(error?.code ?? "");
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""} ${
    error?.constraint ?? ""
  }`.toLowerCase();
  if (code === "23505") {
    return true;
  }
  return text.includes("demands_open_unique_signature");
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
    throw new MarketDemandCreationError(
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
  const allowedTopLevelKeys = new Set(["marketkey", "detailstext"]);
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

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getDemandColumn(field: ResolvedMarketField, rules: ResolvedMarketRule[]) {
  const ruleMap = getFieldRuleMap(field, rules);
  for (const key of ["demand_column", "demand_storage_column", "storage_column", "persist_column"]) {
    const fromRaw = toStringOrNull(field.raw[key]);
    if (fromRaw) {
      return fromRaw;
    }
    const fromRule = toStringOrNull(ruleMap.get(key));
    if (fromRule) {
      return fromRule;
    }
  }

  const sourceRefRaw =
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
  const sourceRef = (sourceRefRaw ?? "").trim().toLowerCase();
  const sourceToken = sourceRef.includes(".") ? sourceRef.split(".").pop() ?? sourceRef : sourceRef;
  if (sourceToken === "brands" || sourceToken === "brand") {
    return "brand_id";
  }
  if (sourceToken === "models" || sourceToken === "model") {
    return "model_id";
  }
  if (sourceToken === "year_options" || sourceToken === "years" || sourceToken === "year") {
    return "year_id";
  }
  if (sourceToken === "item_types" || sourceToken === "item_type") {
    return "item_type_id";
  }
  if (sourceToken === "parts" || sourceToken === "part") {
    return "part_id";
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

async function findExistingOpenDemandBySignature(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  userId: string;
  signature: string;
  resolvedMarket: ResolvedMarket;
}) {
  const { supabase, userId, signature, resolvedMarket } = params;
  const scopeCandidates = getMarketScopeCandidates(resolvedMarket);
  let missingScopeColumnCount = 0;

  for (const scope of scopeCandidates) {
    const { data, error } = await supabase
      .from("demands")
      .select("id,details_text")
      .eq("requester_user_id", userId)
      .eq("status", "open")
      .eq("intention_signature", signature)
      .eq(scope.column, scope.value)
      .limit(1)
      .maybeSingle();

    if (!error) {
      return data as { id: string; details_text: string | null } | null;
    }
    if (isMissingColumnError(error)) {
      missingScopeColumnCount += 1;
      continue;
    }
    throw new MarketDemandCreationError(
      "demand_duplicate_check_failed",
      `Demand duplicate check failed: ${error.message}`,
      500
    );
  }

  if (scopeCandidates.length > 0 && missingScopeColumnCount === scopeCandidates.length) {
    throw new MarketDemandCreationError(
      "market_scope_not_persisted",
      "Demands table does not expose market scope columns required for duplicate detection.",
      500
    );
  }

  return null;
}

async function insertDemandWithMarketScope(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  resolvedMarket: ResolvedMarket;
  payload: Record<string, unknown>;
}) {
  const { supabase, resolvedMarket, payload } = params;
  const scopeCandidates = getMarketScopeCandidates(resolvedMarket);
  let missingScopeColumnCount = 0;

  for (const scope of scopeCandidates) {
    const { error } = await supabase.from("demands").insert({
      ...payload,
      [scope.column]: scope.value
    });
    if (!error) {
      return;
    }
    if (isOpenDemandDuplicateError(error)) {
      throw new MarketDemandCreationError("open_demand_duplicate", "open_demand_duplicate", 409);
    }
    if (isMissingColumnError(error)) {
      if (!isMissingSpecificColumn(error, scope.column)) {
        throw new MarketDemandCreationError("insert_demand_failed", error.message, 500);
      }
      missingScopeColumnCount += 1;
      continue;
    }
    throw new MarketDemandCreationError("insert_demand_failed", error.message, 500);
  }

  if (scopeCandidates.length > 0 && missingScopeColumnCount === scopeCandidates.length) {
    throw new MarketDemandCreationError(
      "market_scope_not_persisted",
      "Demands table does not expose market scope columns.",
      500
    );
  }

  const { error } = await supabase.from("demands").insert(payload);
  if (error) {
    if (isOpenDemandDuplicateError(error)) {
      throw new MarketDemandCreationError("open_demand_duplicate", "open_demand_duplicate", 409);
    }
    throw new MarketDemandCreationError("insert_demand_failed", error.message, 500);
  }
}

async function updateDetailsIfNeeded(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  demandId: string;
  userId: string;
  detailsText: string | null;
}) {
  const { supabase, demandId, userId, detailsText } = params;
  if (!detailsText) {
    return false;
  }

  const { error } = await supabase
    .from("demands")
    .update({
      details_text: detailsText,
      updated_at: new Date().toISOString()
    })
    .eq("id", demandId)
    .eq("requester_user_id", userId)
    .eq("status", "open");

  if (error) {
    throw new MarketDemandCreationError("update_demand_details_failed", error.message, 500);
  }
  return true;
}

export async function createOrReuseOpenMarketDemand(
  input: CreateOrReuseOpenMarketDemandInput
): Promise<CreateOrReuseOpenMarketDemandResult> {
  const supabase = input.supabase ?? createSupabaseAnon({ accessToken: input.accessToken });
  const marketKey = input.marketKey.trim().toLowerCase();
  const resolvedMarket = await resolveMarketConfiguration(marketKey, {
    supabase: supabase as any
  });

  const nonCanonicalIssues = collectNonCanonicalFieldKeyIssues(input.payload, resolvedMarket);
  if (nonCanonicalIssues.length > 0) {
    throw new MarketDemandCreationError(
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
  const validation = await validateMarketPayload({
    marketKey: resolvedMarket.market.key,
    flow: "BUY",
    payload: mappedPayload,
    resolvedMarket,
    supabase: supabase as any
  });

  if (!validation.ok) {
    throw new MarketDemandCreationError("invalid_request", "invalid_request", 400, [
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

  const normalizedDetails = normalizeDetailsText(input.detailsText);
  if (normalizedDetails.issue) {
    throw new MarketDemandCreationError("invalid_request", "invalid_request", 400, [
      normalizedDetails.issue
    ]);
  }

  const detailsText = normalizedDetails.value;
  const existingBeforeInsert = await findExistingOpenDemandBySignature({
    supabase,
    userId: input.userId,
    signature,
    resolvedMarket
  });

  if (existingBeforeInsert) {
    const didUpdate = await updateDetailsIfNeeded({
      supabase,
      demandId: existingBeforeInsert.id,
      userId: input.userId,
      detailsText
    });

    return {
      demandId: existingBeforeInsert.id,
      marketKey: resolvedMarket.market.key,
      signature,
      normalizedPayload: validation.normalizedPayload,
      action: didUpdate ? "updated" : "existing"
    };
  }

  const selectedOptionIds = await resolveSelectedOptionIds({
    supabase,
    resolvedMarket,
    normalizedPayload: validation.normalizedPayload,
    mappedPayload
  });

  const demandPayload: Record<string, unknown> = {
    requester_user_id: input.userId,
    status: "open",
    intention_signature: signature,
    details_text: detailsText
  };

  for (const field of resolvedMarket.fields) {
    const fieldKey = field.key.toLowerCase();
    const selectedId = selectedOptionIds.get(fieldKey);
    if (!selectedId) {
      continue;
    }
    const column = getDemandColumn(field, resolvedMarket.rules);
    if (!column) {
      continue;
    }
    demandPayload[column] = selectedId;
  }

  try {
    await insertDemandWithMarketScope({
      supabase,
      resolvedMarket,
      payload: demandPayload
    });
  } catch (error) {
    if (
      error instanceof MarketDemandCreationError &&
      error.code === "open_demand_duplicate"
    ) {
      const existingAfterDuplicate = await findExistingOpenDemandBySignature({
        supabase,
        userId: input.userId,
        signature,
        resolvedMarket
      });
      if (!existingAfterDuplicate) {
        throw new MarketDemandCreationError(
          "demand_duplicate_resolve_failed",
          "Duplicate demand detected but existing demand could not be loaded.",
          500
        );
      }

      const didUpdate = await updateDetailsIfNeeded({
        supabase,
        demandId: existingAfterDuplicate.id,
        userId: input.userId,
        detailsText
      });

      return {
        demandId: existingAfterDuplicate.id,
        marketKey: resolvedMarket.market.key,
        signature,
        normalizedPayload: validation.normalizedPayload,
        action: didUpdate ? "updated" : "existing"
      };
    }
    throw error;
  }

  const createdDemand = await findExistingOpenDemandBySignature({
    supabase,
    userId: input.userId,
    signature,
    resolvedMarket
  });

  if (!createdDemand) {
    throw new MarketDemandCreationError(
      "demand_insert_verification_failed",
      "Demand created but could not be read back.",
      500
    );
  }

  return {
    demandId: createdDemand.id,
    marketKey: resolvedMarket.market.key,
    signature,
    normalizedPayload: validation.normalizedPayload,
    action: "created"
  };
}

export type DemandCreationContractData = {
  marketKey: string;
  entity: "demand";
  demandId: string;
  action: "created" | "existing" | "updated";
  signature: string;
  normalizedPayload: Record<string, string>;
};

export async function createOrReuseOpenMarketDemandContract(
  input: CreateOrReuseOpenMarketDemandInput
): Promise<EngineContractResponse<DemandCreationContractData>> {
  try {
    const result = await createOrReuseOpenMarketDemand(input);
    return engineOk({
      marketKey: result.marketKey,
      entity: "demand",
      demandId: result.demandId,
      action: result.action,
      signature: result.signature,
      normalizedPayload: result.normalizedPayload
    });
  } catch (error) {
    if (error instanceof MarketDemandCreationError) {
      if (error.code === "invalid_request") {
        return engineValidationFailure(
          (error.issues ?? []).map((issue) => ({
            fieldKey: issue.path,
            code: issue.code,
            message: issue.message
          })),
          "Demand payload validation failed."
        );
      }
      return adaptEngineError(error, "Demand creation failed.");
    }

    return adaptEngineError(error, "Unexpected demand creation error.");
  }
}
