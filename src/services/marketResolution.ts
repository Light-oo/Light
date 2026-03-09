import { createSupabaseServiceRole } from "../lib/supabase";

type RawRecord = Record<string, unknown>;

export class MarketResolutionError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type ResolvedMarketField = {
  id: string | null;
  key: string;
  label: string;
  type: string | null;
  required: boolean;
  active: boolean;
  order: number;
  raw: RawRecord;
};

export type ResolvedMarketDependency = {
  id: string | null;
  fieldKey: string | null;
  dependsOnFieldKey: string | null;
  active: boolean;
  order: number;
  raw: RawRecord;
};

export type ResolvedMarketRule = {
  id: string | null;
  fieldKey: string | null;
  ruleKey: string;
  ruleValue: unknown;
  active: boolean;
  order: number;
  raw: RawRecord;
};

export type ResolvedMarket = {
  market: {
    id: string | null;
    key: string;
    label: string;
    active: boolean;
    raw: RawRecord;
  };
  fields: ResolvedMarketField[];
  dependencies: ResolvedMarketDependency[];
  rules: ResolvedMarketRule[];
};

type ResolveMarketOptions = {
  supabase?: ReturnType<typeof createSupabaseServiceRole>;
  skipCache?: boolean;
};

const ACTIVE_COLUMNS = ["active", "is_active", "enabled", "is_enabled", "status"] as const;
const MARKET_REF_COLUMNS = ["market_id", "marketId", "market_key", "marketKey", "market"] as const;
const DEPRECATED_FIELDS_BY_MARKET: Record<string, Set<string>> = {
  home_services: new Set(["travel_range"])
};

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

function toNumberOrDefault(value: unknown, defaultValue: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
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
  for (const column of ACTIVE_COLUMNS) {
    if (row[column] !== undefined) {
      return toBoolean(row[column], defaultValue);
    }
  }
  return defaultValue;
}

function parseRuleValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function hasMarketReferenceColumns(row: RawRecord): boolean {
  return MARKET_REF_COLUMNS.some((column) => row[column] !== undefined);
}

function rowBelongsToMarket(row: RawRecord, marketId: string | null, marketKey: string): boolean {
  const hasRef = hasMarketReferenceColumns(row);
  if (!hasRef) {
    return false;
  }

  const marketRefs = MARKET_REF_COLUMNS
    .map((column) => toStringOrNull(row[column]))
    .filter((value): value is string => value !== null)
    .map((value) => value.toLowerCase());

  const matchById = marketId ? marketRefs.includes(marketId.toLowerCase()) : false;
  const matchByKey = marketRefs.includes(marketKey.toLowerCase());
  return matchById || matchByKey;
}

function rowReferencesKnownField(
  row: RawRecord,
  knownFieldIds: Set<string>,
  knownFieldKeys: Set<string>
): boolean {
  const idCandidates = [
    "field_id",
    "fieldId",
    "market_field_id",
    "marketFieldId",
    "source_field_id",
    "target_field_id",
    "depends_on_field_id",
    "dependent_field_id"
  ];
  const keyCandidates = [
    "field_key",
    "fieldKey",
    "source_field_key",
    "target_field_key",
    "depends_on_field_key",
    "dependent_field_key"
  ];

  for (const key of idCandidates) {
    const value = toStringOrNull(row[key]);
    if (value && knownFieldIds.has(value.toLowerCase())) {
      return true;
    }
  }
  for (const key of keyCandidates) {
    const value = toStringOrNull(row[key]);
    if (value && knownFieldKeys.has(value.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function isPermissionDenied(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  const code = toStringOrNull(record.code);
  const message = toStringOrNull(record.message)?.toLowerCase() ?? "";
  return code === "42501" || message.includes("permission denied");
}

async function loadTableRows(
  primarySupabase: ReturnType<typeof createSupabaseServiceRole>,
  table: string,
  fallbackSupabase?: ReturnType<typeof createSupabaseServiceRole>
): Promise<RawRecord[]> {
  let { data, error } = await primarySupabase.from(table).select("*");
  if (
    error &&
    fallbackSupabase &&
    primarySupabase !== fallbackSupabase &&
    isPermissionDenied(error)
  ) {
    const retry = await fallbackSupabase.from(table).select("*");
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    throw new MarketResolutionError(
      "MARKET_METADATA_QUERY_FAILED",
      `Failed loading ${table}: ${error.message}`,
      500
    );
  }
  return (data ?? []) as RawRecord[];
}

function sortByOrderAndKey<T extends { order: number; key?: string; fieldKey?: string | null }>(
  rows: T[]
) {
  return rows.sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    const left = (a.key ?? a.fieldKey ?? "").toLowerCase();
    const right = (b.key ?? b.fieldKey ?? "").toLowerCase();
    return left.localeCompare(right);
  });
}

function isDeprecatedField(marketKey: string, fieldKey: string) {
  const deprecated = DEPRECATED_FIELDS_BY_MARKET[marketKey];
  if (!deprecated) {
    return false;
  }
  return deprecated.has(fieldKey.trim().toLowerCase());
}

const marketConfigCache = new Map<string, ResolvedMarket>();
const marketConfigInFlight = new Map<string, Promise<ResolvedMarket>>();

export function clearMarketResolutionCache() {
  marketConfigCache.clear();
  marketConfigInFlight.clear();
}

export async function resolveMarketConfiguration(
  marketKeyInput: string,
  options?: ResolveMarketOptions
): Promise<ResolvedMarket> {
  const marketKey = marketKeyInput.trim().toLowerCase();
  if (marketKey.length === 0) {
    throw new MarketResolutionError("INVALID_MARKET_KEY", "Market key is required.");
  }

  if (!options?.skipCache) {
    const cached = marketConfigCache.get(marketKey);
    if (cached) {
      return cached;
    }
    const inFlight = marketConfigInFlight.get(marketKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const resolvePromise = (async () => {
    const metadataSupabase = options?.supabase ?? createSupabaseServiceRole();

    const { data: marketRows, error: marketError } = await metadataSupabase
      .from("markets")
      .select("*")
      .eq("key", marketKey)
      .limit(1);

    if (marketError) {
      throw new MarketResolutionError(
        "MARKET_RESOLUTION_FAILED",
        `Failed resolving market ${marketKey}: ${marketError.message}`,
        500
      );
    }

    if (!marketRows || marketRows.length === 0) {
      throw new MarketResolutionError("MARKET_NOT_FOUND", `Unknown market: ${marketKey}`, 404);
    }

    const rawMarket = marketRows[0] as RawRecord;
    const marketActive = isRowActive(rawMarket, true);
    if (!marketActive) {
      throw new MarketResolutionError(
        "MARKET_INACTIVE",
        `Market is inactive: ${marketKey}`,
        409
      );
    }

    const marketId = toStringOrNull(pickFirst(rawMarket, ["id", "market_id"]));
    const marketLabel =
      toStringOrNull(pickFirst(rawMarket, ["label", "label_es", "name", "title"])) ?? marketKey;

    const fieldRows = await loadTableRows(metadataSupabase, "market_fields");
    const scopedFieldRows = fieldRows.filter((row) => rowBelongsToMarket(row, marketId, marketKey));

    const normalizedFields = scopedFieldRows
      .map((row) => {
        const key =
          toStringOrNull(pickFirst(row, ["key", "field_key", "name", "slug", "code"])) ?? "";
        if (key.length === 0) {
          return null;
        }
        const label =
          toStringOrNull(
            pickFirst(row, ["label", "label_es", "display_label", "title", "name"])
          ) ?? key;
        return {
          id: toStringOrNull(pickFirst(row, ["id", "field_id"])),
          key,
          label,
          type: toStringOrNull(
            pickFirst(row, ["value_type", "field_type", "type", "input_type", "data_type"])
          ),
          required: toBoolean(pickFirst(row, ["required", "is_required", "mandatory"]), false),
          active: isRowActive(row, true),
          order: toNumberOrDefault(
            pickFirst(row, ["sort_order", "order_index", "position", "display_order", "order"]),
            Number.MAX_SAFE_INTEGER
          ),
          raw: row
        } satisfies ResolvedMarketField;
      })
      .filter((row): row is ResolvedMarketField => row !== null)
      .filter((row) => row.active)
      .filter((row) => !isDeprecatedField(marketKey, row.key));

    if (normalizedFields.length === 0) {
      throw new MarketResolutionError(
        "MARKET_FIELDS_NOT_FOUND",
        `No active fields configured for market: ${marketKey}`,
        500
      );
    }

    sortByOrderAndKey(normalizedFields);

    const knownFieldIds = new Set(
      normalizedFields
        .map((field) => field.id?.toLowerCase())
        .filter((id): id is string => typeof id === "string")
    );
    const knownFieldKeys = new Set(normalizedFields.map((field) => field.key.toLowerCase()));

    const dependencyRows = await loadTableRows(metadataSupabase, "market_field_dependencies");
    const scopedDependencyRows = dependencyRows.filter((row) => {
      if (rowBelongsToMarket(row, marketId, marketKey)) {
        return true;
      }
      if (!hasMarketReferenceColumns(row)) {
        return rowReferencesKnownField(row, knownFieldIds, knownFieldKeys);
      }
      return false;
    });

    const normalizedDependencies = scopedDependencyRows
      .map((row) => ({
        id: toStringOrNull(pickFirst(row, ["id", "dependency_id"])),
        fieldKey: toStringOrNull(
          pickFirst(row, [
            "field_key",
            "fieldKey",
            "source_field_key",
            "dependent_field_key",
            "child_field_key"
          ])
        ),
        dependsOnFieldKey: toStringOrNull(
          pickFirst(row, [
            "depends_on_field_key",
            "dependsOnFieldKey",
            "parent_field_key",
            "target_field_key"
          ])
        ),
        active: isRowActive(row, true),
        order: toNumberOrDefault(
          pickFirst(row, ["sort_order", "order_index", "position", "display_order", "order"]),
          Number.MAX_SAFE_INTEGER
        ),
        raw: row
      }))
      .filter((row) => row.active)
      .filter((row) => {
        const fieldKey = (row.fieldKey ?? "").toLowerCase();
        const dependsOnFieldKey = (row.dependsOnFieldKey ?? "").toLowerCase();
        if (!fieldKey || !knownFieldKeys.has(fieldKey)) {
          return false;
        }
        if (!dependsOnFieldKey) {
          return true;
        }
        return knownFieldKeys.has(dependsOnFieldKey);
      });

    sortByOrderAndKey(normalizedDependencies);

    const ruleRows = await loadTableRows(metadataSupabase, "market_field_rules");
    const scopedRuleRows = ruleRows.filter((row) => {
      if (rowBelongsToMarket(row, marketId, marketKey)) {
        return true;
      }
      if (!hasMarketReferenceColumns(row)) {
        return rowReferencesKnownField(row, knownFieldIds, knownFieldKeys);
      }
      return false;
    });

    const normalizedRules = scopedRuleRows
      .map((row) => {
        const ruleKey =
          toStringOrNull(pickFirst(row, ["rule_key", "ruleKey", "type", "name", "key"])) ?? "";
        if (ruleKey.length === 0) {
          return null;
        }

        return {
          id: toStringOrNull(pickFirst(row, ["id", "rule_id"])),
          fieldKey: toStringOrNull(
            pickFirst(row, ["field_key", "fieldKey", "source_field_key", "target_field_key"])
          ),
          ruleKey,
          ruleValue: parseRuleValue(
            pickFirst(row, ["rule_value", "ruleValue", "value", "config", "params", "payload"])
          ),
          active: isRowActive(row, true),
          order: toNumberOrDefault(
            pickFirst(row, ["sort_order", "order_index", "position", "display_order", "order"]),
            Number.MAX_SAFE_INTEGER
          ),
          raw: row
        } satisfies ResolvedMarketRule;
      })
      .filter((row): row is ResolvedMarketRule => row !== null)
      .filter((row) => row.active)
      .filter((row) => {
        const fieldKey = (row.fieldKey ?? "").toLowerCase();
        if (!fieldKey) {
          return true;
        }
        return knownFieldKeys.has(fieldKey);
      });

    sortByOrderAndKey(normalizedRules);

    return {
      market: {
        id: marketId,
        key: marketKey,
        label: marketLabel,
        active: marketActive,
        raw: rawMarket
      },
      fields: normalizedFields,
      dependencies: normalizedDependencies,
      rules: normalizedRules
    };
  })();

  if (options?.skipCache) {
    return resolvePromise;
  }

  marketConfigInFlight.set(marketKey, resolvePromise);
  try {
    const resolved = await resolvePromise;
    marketConfigCache.set(marketKey, resolved);
    return resolved;
  } finally {
    marketConfigInFlight.delete(marketKey);
  }
}
