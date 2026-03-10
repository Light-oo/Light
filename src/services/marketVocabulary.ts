import { createSupabaseServiceRole } from "../lib/supabase";
import {
  MarketResolutionError,
  type ResolvedMarket,
  type ResolvedMarketField,
  type ResolvedMarketRule,
  resolveMarketConfiguration
} from "./marketResolution";

type RawRecord = Record<string, unknown>;

export type VocabularyOption = {
  id: string | null;
  key: string;
  label: string;
  raw: RawRecord;
};

export type ResolvedFieldVocabulary = {
  fieldKey: string;
  source: {
    type: string;
    ref: string;
  };
  dependsOn: Record<string, unknown>;
  options: VocabularyOption[];
};

type SelectedValues = Record<string, unknown>;
type OptionSourceFilter = { column: string; value: string };
type OptionSourceScope = { column: string; value: string };

type LoadVocabularyOptions = {
  marketKey: string;
  fieldKey?: string;
  selectedValues?: SelectedValues;
  resolvedMarket?: ResolvedMarket;
  supabase?: ReturnType<typeof createSupabaseServiceRole>;
};

const ACTIVE_COLUMNS = ["active", "is_active", "enabled", "is_enabled", "status"] as const;
const dependencyColumnCache = new Map<string, string | null>();
const dependencyValueCache = new Map<string, string | null>();
const dependencyColumnUuidCache = new Map<string, boolean>();
const sourceMarketScopeColumnCache = new Map<string, string>();

function shouldTraceVocabulary() {
  const value = String(process.env.ENGINE_TRACE_OPTIONS ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function traceVocabulary(event: string, payload: Record<string, unknown>) {
  if (!shouldTraceVocabulary()) {
    return;
  }
  console.info(`[engine:vocabulary] ${event}`, payload);
}

function pickFirst(row: RawRecord, keys: readonly string[]) {
  for (const key of keys) {
    if (row[key] !== undefined) {
      return row[key];
    }
  }
  return undefined;
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

function toCanonicalOptionKey(value: unknown): string | null {
  const asText = toStringOrNull(value);
  if (!asText) {
    return null;
  }
  return asText.toLowerCase();
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

function isRowActive(row: RawRecord, defaultValue = true): boolean {
  for (const key of ACTIVE_COLUMNS) {
    if (row[key] !== undefined) {
      return toBoolean(row[key], defaultValue);
    }
  }
  return defaultValue;
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

function normalizeFieldRuleMap(rules: ResolvedMarketRule[], fieldKey: string) {
  const out: Record<string, unknown> = {};
  for (const rule of rules) {
    if ((rule.fieldKey ?? "").toLowerCase() !== fieldKey.toLowerCase()) {
      continue;
    }
    out[rule.ruleKey.toLowerCase()] = rule.ruleValue;
  }
  return out;
}

function getSourceDefinition(field: ResolvedMarketField, ruleMap: Record<string, unknown>) {
  const raw = field.raw;
  const sourceType =
    toStringOrNull(
      pickFirst(raw, [
        "option_source_type",
        "options_source_type",
        "source_type",
        "catalog_source_type"
      ])
    ) ??
    toStringOrNull(
      pickFirst(ruleMap, [
        "option_source_type",
        "options_source_type",
        "source_type",
        "catalog_source_type"
      ])
    ) ??
    "table";

  const sourceRef =
    toStringOrNull(
      pickFirst(raw, [
        "option_source_ref",
        "options_source_ref",
        "source_ref",
        "catalog_source_ref",
        "catalog_table"
      ])
    ) ??
    toStringOrNull(
      pickFirst(ruleMap, [
        "option_source_ref",
        "options_source_ref",
        "source_ref",
        "catalog_source_ref",
        "catalog_table"
      ])
    );

  return {
    sourceType: sourceType.toLowerCase(),
    sourceRef
  };
}

function resolveFieldInputType(field: ResolvedMarketField, ruleMap: Record<string, unknown>) {
  const fromRules = toStringOrNull(
    pickFirst(ruleMap, ["input_type", "inputtype", "field_input_type", "type"])
  );
  const fromField = toStringOrNull(
    pickFirst(field.raw, ["input_type", "inputType", "field_input_type", "type", "value_type"])
  );
  const normalized = (fromRules ?? fromField ?? "").trim().toLowerCase();
  if (normalized.length > 0) {
    return normalized;
  }

  const fieldKey = field.key.trim().toLowerCase();
  if (["detail", "details", "details_text", "detalle"].includes(fieldKey)) {
    return "text";
  }
  return null;
}

function fieldRequiresOptionSource(field: ResolvedMarketField, ruleMap: Record<string, unknown>) {
  const inputType = resolveFieldInputType(field, ruleMap);
  if (!inputType) {
    return true;
  }

  if (
    [
      "text",
      "textarea",
      "string",
      "free_text",
      "free-text",
      "detail",
      "details",
      "number",
      "numeric",
      "integer",
      "int",
      "decimal",
      "float",
      "boolean",
      "checkbox"
    ].includes(inputType)
  ) {
    return false;
  }

  return true;
}

function getColumnOverride(
  field: ResolvedMarketField,
  ruleMap: Record<string, unknown>,
  candidates: string[]
) {
  return (
    toStringOrNull(pickFirst(field.raw, candidates)) ??
    toStringOrNull(pickFirst(ruleMap, candidates.map((c) => c.toLowerCase())))
  );
}

function normalizeSourceRefToken(sourceRef: string) {
  const raw = sourceRef.trim().toLowerCase();
  const unqualified = raw.includes(".") ? raw.split(".").pop() ?? raw : raw;
  return unqualified.replace(/[^a-z0-9_]/g, "");
}

function toSingular(value: string) {
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("ses")) {
    return value.slice(0, -2);
  }
  if (value.endsWith("s")) {
    return value.slice(0, -1);
  }
  return value;
}

async function loadOptionRows(
  supabase: ReturnType<typeof createSupabaseServiceRole>,
  sourceType: string,
  sourceRef: string,
  filters?: OptionSourceFilter[],
  resolvedMarket?: ResolvedMarket,
  explicitScope?: OptionSourceScope | null,
  enforceMarketScope = false
) {
  const allowedSourceTypes = [
    "catalog",
    "table",
    "view",
    "catalog_table",
    "catalog_view",
    "supabase_table"
  ];
  if (!allowedSourceTypes.includes(sourceType)) {
    throw new MarketResolutionError(
      "FIELD_OPTION_SOURCE_UNSUPPORTED",
      `Unsupported option source type "${sourceType}" for source "${sourceRef}".`,
      500
    );
  }

  const runQuery = async (scope?: { column: string; value: string }) => {
    let query = supabase.from(sourceRef).select("*");
    for (const filter of filters ?? []) {
      query = query.eq(filter.column, filter.value);
    }
    if (scope) {
      query = query.eq(scope.column, scope.value);
    }
    const queryInfo = {
      sourceRef,
      sourceType,
      filters: (filters ?? []).map((filter) => `${filter.column}=${filter.value}`),
      scope: scope ? `${scope.column}=${scope.value}` : null
    };
    traceVocabulary("query.start", queryInfo);
    const response = await query;
    traceVocabulary("query.end", {
      ...queryInfo,
      rowCount: Array.isArray(response.data) ? response.data.length : 0,
      error: response.error ? { code: response.error.code, message: response.error.message } : null
    });
    return response;
  };

  if (resolvedMarket) {
    const sourceScopeCacheKey = sourceRef.trim().toLowerCase();
    const scopeCandidates: Array<OptionSourceScope> = [];
    if (explicitScope?.column && explicitScope?.value) {
      scopeCandidates.push(explicitScope);
    }
    const marketKey = toStringOrNull(resolvedMarket.market.key);
    const marketId = toStringOrNull(resolvedMarket.market.id);
    if (marketKey) {
      scopeCandidates.push({ column: "market_key", value: marketKey });
      scopeCandidates.push({ column: "market", value: marketKey });
      scopeCandidates.push({ column: "market_slug", value: marketKey });
      scopeCandidates.push({ column: "market_code", value: marketKey });
    }
    if (marketId) {
      scopeCandidates.push({ column: "market_id", value: marketId });
      scopeCandidates.push({ column: "market_ref", value: marketId });
    }

    const cachedScopeColumn = sourceMarketScopeColumnCache.get(sourceScopeCacheKey);
    if (cachedScopeColumn) {
      const cachedScope = scopeCandidates.find(
        (candidate) => candidate.column.toLowerCase() === cachedScopeColumn.toLowerCase()
      );
      if (cachedScope) {
        const cachedResponse = await runQuery(cachedScope);
        if (!cachedResponse.error) {
          return (cachedResponse.data ?? []) as RawRecord[];
        }
        if (isMissingColumnError(cachedResponse.error)) {
          sourceMarketScopeColumnCache.delete(sourceScopeCacheKey);
        } else {
          throw new MarketResolutionError(
            "FIELD_OPTION_QUERY_FAILED",
            `Failed loading options from "${sourceRef}": ${cachedResponse.error.message}`,
            500
          );
        }
      } else {
        sourceMarketScopeColumnCache.delete(sourceScopeCacheKey);
      }
    }

    let missingColumnCount = 0;
    for (const scope of scopeCandidates) {
      const { data, error } = await runQuery(scope);
      if (!error) {
        sourceMarketScopeColumnCache.set(sourceScopeCacheKey, scope.column);
        return (data ?? []) as RawRecord[];
      }
      if (isMissingColumnError(error)) {
        missingColumnCount += 1;
        continue;
      }
      throw new MarketResolutionError(
        "FIELD_OPTION_QUERY_FAILED",
        `Failed loading options from "${sourceRef}": ${error.message}`,
        500
      );
    }

    if (scopeCandidates.length > 0 && missingColumnCount !== scopeCandidates.length) {
      throw new MarketResolutionError(
        "FIELD_OPTION_QUERY_FAILED",
        `Failed loading options from "${sourceRef}" with market scope.`,
        500
      );
    }

    if (scopeCandidates.length > 0 && missingColumnCount === scopeCandidates.length && enforceMarketScope) {
      throw new MarketResolutionError(
        "FIELD_OPTION_MARKET_SCOPE_REQUIRED",
        `Field option source "${sourceRef}" does not expose market scope columns for market "${resolvedMarket.market.key}".`,
        500
      );
    }
  }

  const { data, error } = await runQuery();
  if (error) {
    throw new MarketResolutionError(
      "FIELD_OPTION_QUERY_FAILED",
      `Failed loading options from "${sourceRef}": ${error.message}`,
      500
    );
  }
  return (data ?? []) as RawRecord[];
}

async function loadCatalogFieldRows(params: {
  supabase: ReturnType<typeof createSupabaseServiceRole>;
  resolvedMarket: ResolvedMarket;
  fieldKey: string;
}) {
  const { supabase, resolvedMarket, fieldKey } = params;
  const marketId = toStringOrNull(resolvedMarket.market.id);
  const marketKey = toStringOrNull(resolvedMarket.market.key);

  const runQuery = async (scope?: { column: string; value: string }) => {
    let query = supabase
      .from("catalog_options")
      .select("*")
      .eq("field_key", fieldKey)
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (scope) {
      query = query.eq(scope.column, scope.value);
    }
    return query;
  };

  const scopes: Array<{ column: string; value: string }> = [];
  if (marketId) {
    scopes.push({ column: "market_id", value: marketId });
  }
  if (marketKey) {
    scopes.push({ column: "market_key", value: marketKey });
  }

  let missingColumnCount = 0;
  for (const scope of scopes) {
    const { data, error } = await runQuery(scope);
    if (!error) {
      return (data ?? []) as RawRecord[];
    }
    if (isMissingColumnError(error)) {
      missingColumnCount += 1;
      continue;
    }
    throw new MarketResolutionError(
      "FIELD_OPTION_QUERY_FAILED",
      `Failed loading catalog field options for "${fieldKey}": ${error.message}`,
      500
    );
  }

  if (scopes.length > 0 && missingColumnCount === scopes.length) {
    throw new MarketResolutionError(
      "FIELD_OPTION_MARKET_SCOPE_REQUIRED",
      `catalog_options does not expose market scope columns for market "${resolvedMarket.market.key}".`,
      500
    );
  }

  if (scopes.length === 0) {
    throw new MarketResolutionError(
      "FIELD_OPTION_MARKET_SCOPE_REQUIRED",
      `Missing market scope metadata for market "${resolvedMarket.market.key}".`,
      500
    );
  }

  const { data, error } = await runQuery();
  if (error) {
    throw new MarketResolutionError(
      "FIELD_OPTION_QUERY_FAILED",
      `Failed loading catalog field options for "${fieldKey}": ${error.message}`,
      500
    );
  }

  return (data ?? []) as RawRecord[];
}

function normalizeCatalogFieldOptions(rows: RawRecord[]): VocabularyOption[] {
  const deduped = new Map<string, VocabularyOption>();
  for (const row of rows) {
    const key = toCanonicalOptionKey(row.option_key);
    const label =
      toStringOrNull(row.label) ??
      toStringOrNull(row.label_es) ??
      toStringOrNull(row.option_key);
    if (!key || !label) {
      continue;
    }
    if (!deduped.has(key)) {
      deduped.set(key, {
        id: toStringOrNull(row.id) ?? key,
        key,
        label,
        raw: row
      });
    }
  }

  const options = [...deduped.values()];
  options.sort((left, right) => {
    const leftSort = Number(left.raw.sort_order ?? Number.MAX_SAFE_INTEGER);
    const rightSort = Number(right.raw.sort_order ?? Number.MAX_SAFE_INTEGER);
    if (Number.isFinite(leftSort) && Number.isFinite(rightSort) && leftSort !== rightSort) {
      return leftSort - rightSort;
    }
    return left.label.localeCompare(right.label);
  });
  return options;
}

async function loadProfileFieldOptions(params: {
  supabase: ReturnType<typeof createSupabaseServiceRole>;
  sourceRef: string;
}): Promise<VocabularyOption[]> {
  const { supabase, sourceRef } = params;
  const normalized = sourceRef.trim().toLowerCase();

  if (normalized === "department_id" || normalized === "department" || normalized === "profiles.department_id") {
    const { data, error } = await supabase
      .from("departments")
      .select("id,name,sort_order")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      throw new MarketResolutionError(
        "FIELD_OPTION_QUERY_FAILED",
        `Failed loading profile field options for "${sourceRef}": ${error.message}`,
        500
      );
    }

    return (data ?? [])
      .map((row) => {
        const id = toStringOrNull((row as RawRecord).id);
        const label = toStringOrNull((row as RawRecord).name);
        if (!id || !label) {
          return null;
        }
        return {
          id,
          key: id,
          label,
          raw: row as RawRecord
        } satisfies VocabularyOption;
      })
      .filter((option) => option !== null) as VocabularyOption[];
  }

  throw new MarketResolutionError(
    "FIELD_OPTION_SOURCE_UNSUPPORTED",
    `Unsupported profile field option source "${sourceRef}".`,
    500
  );
}

function toComparableValues(value: unknown): string[] {
  const values: string[] = [];
  const push = (input: unknown) => {
    const asText = toStringOrNull(input);
    if (!asText) {
      return;
    }
    const lowered = asText.toLowerCase();
    if (!values.includes(lowered)) {
      values.push(lowered);
    }
  };

  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    push(row.id);
    push(row.key);
    push(row.value);
    push(row.code);
    push(row.slug);
  }

  push(value);
  return values;
}

function toFilterValue(value: unknown): string | null {
  const comparable = toComparableValues(value);
  if (comparable.length > 0) {
    return comparable[0];
  }
  return null;
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isLikelyIdColumn(column: string) {
  const normalized = column.trim().toLowerCase();
  return normalized === "id" || normalized.endsWith("_id") || normalized.endsWith("id");
}

function chooseExistingColumn(rows: RawRecord[], candidates: string[]) {
  for (const candidate of candidates) {
    if (rows.some((row) => row[candidate] !== undefined)) {
      return candidate;
    }
  }
  return null;
}

function getDependencyColumnCandidates(parentKey: string, override?: string | null) {
  if (override && override.trim().length > 0) {
    return [override.trim()];
  }

  return [
    `${parentKey}_key`,
    `${parentKey}Key`,
    `${parentKey}_id`,
    `${parentKey}Id`,
    parentKey
  ];
}

async function resolveDependencyColumn(params: {
  supabase: ReturnType<typeof createSupabaseServiceRole>;
  sourceRef: string;
  fieldKey: string;
  parentKey: string;
  marketKey: string;
  parentSourceRef?: string | null;
  override?: string | null;
}) {
  const { supabase, sourceRef, fieldKey, parentKey, marketKey, parentSourceRef, override } = params;
  const cacheKey = `${marketKey}::${sourceRef}::${fieldKey}::${parentKey}`;
  const cached = dependencyColumnCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const candidates = getDependencyColumnCandidates(parentKey, override);
  const sourceCandidates: string[] = [];
  if (!override && parentSourceRef) {
    const token = normalizeSourceRefToken(parentSourceRef);
    if (token) {
      const singular = toSingular(token);
      sourceCandidates.push(
        `${token}_id`,
        `${singular}_id`,
        `${token}_key`,
        `${singular}_key`,
        token,
        singular
      );
    }
  }
  const allCandidates = [...new Set([...candidates, ...sourceCandidates])];
  if (override) {
    dependencyColumnCache.set(cacheKey, allCandidates[0] ?? null);
    return allCandidates[0] ?? null;
  }

  const { data, error } = await supabase.from(sourceRef).select("*").limit(1);
  if (error) {
    dependencyColumnCache.set(cacheKey, null);
    return null;
  }

  const rows = (data ?? []) as unknown as RawRecord[];
  const selected = chooseExistingColumn(rows, allCandidates);
  traceVocabulary("dependency.column.resolve", {
    sourceRef,
    fieldKey,
    parentKey,
    parentSourceRef: parentSourceRef ?? null,
    candidates: allCandidates,
    selected
  });
  dependencyColumnCache.set(cacheKey, selected);
  return selected;
}

async function dependencyColumnLooksUuid(params: {
  supabase: ReturnType<typeof createSupabaseServiceRole>;
  sourceRef: string;
  column: string;
}) {
  const { supabase, sourceRef, column } = params;
  const cacheKey = `${sourceRef}::${column}`;
  const cached = dependencyColumnUuidCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const { data, error } = await supabase.from(sourceRef).select(column).limit(5);
  if (error) {
    dependencyColumnUuidCache.set(cacheKey, false);
    return false;
  }

  const rows = (data ?? []) as unknown as RawRecord[];
  for (const row of rows) {
    const value = toStringOrNull(row[column]);
    if (!value) {
      continue;
    }
    const looksUuid = looksLikeUuid(value);
    dependencyColumnUuidCache.set(cacheKey, looksUuid);
    return looksUuid;
  }

  dependencyColumnUuidCache.set(cacheKey, false);
  return false;
}

async function buildDependencyFilters(
  field: ResolvedMarketField,
  resolvedMarket: ResolvedMarket,
  selectedValues: SelectedValues,
  supabase: ReturnType<typeof createSupabaseServiceRole>,
  sourceRef: string
) {
  const dependencies = resolvedMarket.dependencies.filter(
    (dependency) =>
      (dependency.fieldKey ?? "").toLowerCase() === field.key.toLowerCase() &&
      dependency.active
  );

  if (dependencies.length === 0) {
    return { filters: [] as OptionSourceFilter[], dependsOn: {} as Record<string, unknown> };
  }

  const filters: OptionSourceFilter[] = [];
  const dependsOn: Record<string, unknown> = {};

  for (const dependency of dependencies) {
    const parentKey = dependency.dependsOnFieldKey;
    if (!parentKey) {
      continue;
    }

    const selectedParent = selectedValues[parentKey];
    if (selectedParent === undefined || selectedParent === null || selectedParent === "") {
      return {
        filters: [],
        dependsOn
      };
    }

    dependsOn[parentKey] = selectedParent;

    const dependencyColumnOverride = toStringOrNull(
      pickFirst(dependency.raw, [
        "source_column",
        "option_source_column",
        "depends_on_source_column",
        "parent_source_column",
        "parent_column",
        "dependent_source_column",
        "child_column",
        "filter_column"
      ])
    );

    const parentField = resolvedMarket.fields.find(
      (candidate) => candidate.key.toLowerCase() === parentKey.toLowerCase()
    );
    const parentRuleMap = parentField
      ? normalizeFieldRuleMap(resolvedMarket.rules, parentField.key)
      : {};
    const parentSourceRef = parentField
      ? getSourceDefinition(parentField, parentRuleMap).sourceRef
      : null;

    const dependencyColumn = await resolveDependencyColumn({
      supabase,
      sourceRef,
      fieldKey: field.key,
      parentKey,
      marketKey: resolvedMarket.market.key,
      parentSourceRef,
      override: dependencyColumnOverride
    });
    if (!dependencyColumn) {
      return {
        filters: [],
        dependsOn,
        unresolvedDependencyColumn: true as const
      };
    }

    let targetValue = toFilterValue(selectedParent);
    if (!targetValue) {
      return { filters: [], dependsOn, missingParentValue: true as const };
    }

    const dependencyIsUuidColumn =
      isLikelyIdColumn(dependencyColumn) ||
      (await dependencyColumnLooksUuid({
        supabase,
        sourceRef,
        column: dependencyColumn
      }));

    if (dependencyIsUuidColumn && !looksLikeUuid(targetValue)) {
      if (!parentField) {
        return {
          filters: [],
          dependsOn,
          unresolvedDependencyColumn: true as const
        };
      }

      const canonicalParentValue = targetValue;
      const cacheKey = `${resolvedMarket.market.key}::${parentField.key.toLowerCase()}::${canonicalParentValue.toLowerCase()}`;
      const cachedResolvedId = dependencyValueCache.get(cacheKey);
      if (cachedResolvedId !== undefined) {
        if (!cachedResolvedId) {
          return { filters: [], dependsOn, missingParentValue: true as const };
        }
        targetValue = cachedResolvedId;
      } else {
        const parentVocabulary = await loadFieldVocabulary({
          marketKey: resolvedMarket.market.key,
          fieldKey: parentField.key,
          selectedValues,
          resolvedMarket,
          supabase
        });

        const matchedOption = parentVocabulary.options.find(
          (option) => option.key.toLowerCase() === canonicalParentValue.toLowerCase()
        );
        const resolvedId = toStringOrNull(matchedOption?.id);
        dependencyValueCache.set(cacheKey, resolvedId);
        if (!resolvedId) {
          return { filters: [], dependsOn, missingParentValue: true as const };
        }
        targetValue = resolvedId;
      }
    }

    filters.push({ column: dependencyColumn, value: targetValue });
  }

  traceVocabulary("dependency.filters", {
    marketKey: resolvedMarket.market.key,
    fieldKey: field.key,
    dependsOn,
    filters
  });

  return { filters, dependsOn };
}

function normalizeOptions(
  rows: RawRecord[],
  field: ResolvedMarketField,
  rules: ResolvedMarketRule[]
): VocabularyOption[] {
  const ruleMap = normalizeFieldRuleMap(rules, field.key);

  const explicitKeyColumn = getColumnOverride(field, ruleMap, [
    "option_key_column",
    "options_key_column",
    "source_key_column"
  ]);
  const inferredKeyColumn =
    chooseExistingColumn(rows, [
      "key",
      "code",
      "slug",
      "value",
      "year",
      "label_key",
      "label_es",
      "label",
      "name",
      "title"
    ]) ??
    chooseExistingColumn(rows, ["id", "uuid"]);
  const keyColumn = explicitKeyColumn ?? inferredKeyColumn ?? "id";

  const labelColumn =
    getColumnOverride(field, ruleMap, [
      "option_label_column",
      "options_label_column",
      "source_label_column"
    ]) ??
    chooseExistingColumn(rows, ["label_es", "label", "name", "title", "year", "key", "code"]) ??
    keyColumn;

  const idColumn =
    getColumnOverride(field, ruleMap, [
      "option_id_column",
      "options_id_column",
      "source_id_column"
    ]) ?? chooseExistingColumn(rows, ["id", "uuid"]);

  const activeColumn =
    getColumnOverride(field, ruleMap, [
      "option_active_column",
      "options_active_column",
      "source_active_column"
    ]) ?? chooseExistingColumn(rows, ["active", "is_active", "enabled", "is_enabled", "status"]);

  const sortColumn =
    getColumnOverride(field, ruleMap, [
      "option_sort_column",
      "options_sort_column",
      "source_sort_column"
    ]) ?? chooseExistingColumn(rows, ["sort_order", "display_order", "position", "order"]);

  const activeRows = rows.filter((row) => {
    if (!activeColumn) {
      return isRowActive(row, true);
    }
    return toBoolean(row[activeColumn], true);
  });

  const mapped = activeRows
    .map((row) => {
      let key =
        toCanonicalOptionKey(row[keyColumn]) ??
        (idColumn && keyColumn !== idColumn ? toCanonicalOptionKey(row[idColumn]) : null);

      if (!key) {
        return null;
      }

      if (keyColumn === "id" && looksLikeUuid(key) && !explicitKeyColumn) {
        const fallbackKey = toCanonicalOptionKey(
          pickFirst(row, ["key", "code", "slug", "value", "year", "label_key", "label_es", "label", "name", "title"])
        );
        if (fallbackKey) {
          key = fallbackKey;
        }
      }

      const label = toStringOrNull(row[labelColumn]);
      if (!key || !label) {
        return null;
      }
      return {
        id: idColumn ? toStringOrNull(row[idColumn]) : null,
        key,
        label,
        raw: row
      } satisfies VocabularyOption;
    })
    .filter((row): row is VocabularyOption => row !== null);

  const deduped = new Map<string, VocabularyOption>();
  for (const option of mapped) {
    const normalizedKey = option.key.toLowerCase();
    if (!deduped.has(normalizedKey)) {
      deduped.set(normalizedKey, option);
    }
  }

  const options = [...deduped.values()];
  options.sort((left, right) => {
    if (sortColumn) {
      const a = left.raw[sortColumn];
      const b = right.raw[sortColumn];
      if (typeof a === "number" && typeof b === "number" && a !== b) {
        return a - b;
      }
      const aText = toStringOrNull(a);
      const bText = toStringOrNull(b);
      if (aText && bText && aText !== bText) {
        const aNum = Number(aText);
        const bNum = Number(bText);
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
          return aNum - bNum;
        }
        return aText.localeCompare(bText);
      }
    }
    return left.label.localeCompare(right.label);
  });

  return options;
}

function requiresStrictMarketScope(
  sourceRef: string,
  field: ResolvedMarketField,
  ruleMap: Record<string, unknown>
) {
  const explicitRequired =
    toStringOrNull(
      pickFirst(field.raw, [
        "market_scope_required",
        "option_source_market_scope_required",
        "source_market_scope_required"
      ])
    ) ??
    toStringOrNull(
      pickFirst(ruleMap, [
        "market_scope_required",
        "option_source_market_scope_required",
        "source_market_scope_required"
      ])
    );

  if (explicitRequired !== null) {
    return toBoolean(explicitRequired, true);
  }

  const sourceToken = normalizeSourceRefToken(sourceRef);
  return sourceToken === "item_types" || sourceToken === "parts";
}

async function resolveVocabularyForField(
  resolvedMarket: ResolvedMarket,
  field: ResolvedMarketField,
  selectedValues: SelectedValues,
  supabase: ReturnType<typeof createSupabaseServiceRole>
): Promise<ResolvedFieldVocabulary> {
  const ruleMap = normalizeFieldRuleMap(resolvedMarket.rules, field.key);
  const { sourceType, sourceRef } = getSourceDefinition(field, ruleMap);
  const requiresOptionSource = fieldRequiresOptionSource(field, ruleMap);

  if (!sourceRef) {
    if (!requiresOptionSource) {
      return {
        fieldKey: field.key,
        source: {
          type: "none",
          ref: ""
        },
        dependsOn: {},
        options: []
      };
    }
    throw new MarketResolutionError(
      "FIELD_OPTION_SOURCE_MISSING",
      `Missing option source metadata for field "${field.key}" in market "${resolvedMarket.market.key}".`,
      500
    );
  }

  const dependencyFilters = await buildDependencyFilters(
    field,
    resolvedMarket,
    selectedValues,
    supabase,
    sourceRef
  );

  if ((dependencyFilters as any).missingParentValue || (dependencyFilters as any).unresolvedDependencyColumn) {
    return {
      fieldKey: field.key,
      source: {
        type: sourceType,
        ref: sourceRef
      },
      dependsOn: dependencyFilters.dependsOn,
      options: []
    };
  }

  if (sourceType === "catalog_field") {
    const rows = await loadCatalogFieldRows({
      supabase,
      resolvedMarket,
      fieldKey: field.key
    });
    const options = normalizeCatalogFieldOptions(rows);
    return {
      fieldKey: field.key,
      source: {
        type: sourceType,
        ref: sourceRef
      },
      dependsOn: dependencyFilters.dependsOn,
      options
    };
  }

  if (sourceType === "profile_field") {
    const options = await loadProfileFieldOptions({
      supabase,
      sourceRef
    });
    return {
      fieldKey: field.key,
      source: {
        type: sourceType,
        ref: sourceRef
      },
      dependsOn: dependencyFilters.dependsOn,
      options
    };
  }

  const scopeColumn =
    toStringOrNull(
      pickFirst(field.raw, ["source_market_column", "option_source_market_column", "market_scope_column"])
    ) ??
    toStringOrNull(
      pickFirst(ruleMap, ["source_market_column", "option_source_market_column", "market_scope_column"])
    );
  const scopeValue =
    toStringOrNull(
      pickFirst(field.raw, ["source_market_value", "option_source_market_value", "market_scope_value"])
    ) ??
    toStringOrNull(
      pickFirst(ruleMap, ["source_market_value", "option_source_market_value", "market_scope_value"])
    ) ??
    toStringOrNull(resolvedMarket.market.key);

  const rows = await loadOptionRows(
    supabase,
    sourceType,
    sourceRef,
    dependencyFilters.filters,
    resolvedMarket,
    scopeColumn && scopeValue ? { column: scopeColumn, value: scopeValue } : null,
    requiresStrictMarketScope(sourceRef, field, ruleMap)
  );
  const options = normalizeOptions(rows, field, resolvedMarket.rules);

  return {
    fieldKey: field.key,
    source: {
      type: sourceType,
      ref: sourceRef
    },
    dependsOn: dependencyFilters.dependsOn,
    options
  };
}

export async function loadFieldVocabulary(
  options: LoadVocabularyOptions
): Promise<ResolvedFieldVocabulary> {
  const selectedValues = options.selectedValues ?? {};
  const supabase = options.supabase ?? createSupabaseServiceRole();
  let resolvedMarket =
    options.resolvedMarket ??
    (await resolveMarketConfiguration(options.marketKey, { supabase }));

  const targetFieldKey = options.fieldKey?.trim().toLowerCase();
  if (!targetFieldKey) {
    throw new MarketResolutionError("INVALID_FIELD_KEY", "Field key is required.");
  }

  const targetField = resolvedMarket.fields.find(
    (field) => field.key.toLowerCase() === targetFieldKey
  );
  let effectiveTargetField = targetField;
  if (!effectiveTargetField && options.resolvedMarket) {
    resolvedMarket = await resolveMarketConfiguration(options.marketKey, {
      supabase,
      skipCache: true
    });
    effectiveTargetField = resolvedMarket.fields.find(
      (field) => field.key.toLowerCase() === targetFieldKey
    );
  }

  if (!effectiveTargetField) {
    throw new MarketResolutionError(
      "FIELD_NOT_FOUND",
      `Field "${targetFieldKey}" is not configured for market "${resolvedMarket.market.key}".`,
      404
    );
  }

  return resolveVocabularyForField(resolvedMarket, effectiveTargetField, selectedValues, supabase);
}

export async function loadMarketVocabulary(options: LoadVocabularyOptions) {
  const selectedValues = options.selectedValues ?? {};
  const supabase = options.supabase ?? createSupabaseServiceRole();
  const resolvedMarket =
    options.resolvedMarket ??
    (await resolveMarketConfiguration(options.marketKey, { supabase }));

  const fields = await Promise.all(
    resolvedMarket.fields.map((field) =>
      resolveVocabularyForField(resolvedMarket, field, selectedValues, supabase)
    )
  );

  return {
    market: resolvedMarket.market,
    fields
  };
}
