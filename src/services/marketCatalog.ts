import { createSupabaseAnon } from "../lib/supabase";
import {
  MarketResolutionError,
  resolveMarketConfiguration,
  type ResolvedMarket
} from "./marketResolution";
import { loadFieldVocabulary, loadMarketVocabulary } from "./marketVocabulary";
import {
  engineOk,
  type EngineContractResponse,
  type EngineMarketDescriptor
} from "./engineContracts";
import { adaptEngineError } from "./engineErrorAdapter";

type SupabaseLike = ReturnType<typeof createSupabaseAnon>;

type RawRecord = Record<string, unknown>;

type MarketCardTemplate = {
  titleTemplate: string;
  subtitleTemplate?: string;
  metaTemplate?: string;
};

type MarketCardTemplates = {
  buyDemand?: MarketCardTemplate;
  sellListing?: MarketCardTemplate;
};

const ACTIVE_COLUMNS = ["active", "is_active", "enabled", "is_enabled", "status"] as const;

function mapCardType(value: unknown) {
  const normalized = toStringOrNull(value)?.trim().toLowerCase();
  if (normalized === "buy_demand") {
    return "buyDemand" as const;
  }
  if (normalized === "sell_listing") {
    return "sellListing" as const;
  }
  return null;
}

async function loadMarketCardTemplates(params: {
  supabase: SupabaseLike;
  marketId: string | null;
}) {
  if (!params.marketId) {
    return undefined;
  }

  const scopedClient =
    typeof (params.supabase as any).schema === "function"
      ? (params.supabase as any).schema("public")
      : params.supabase;

  const { data, error } = await scopedClient
    .from("market_card_templates")
    .select("card_type,title_template,subtitle_template")
    .eq("market_id", params.marketId)
    .eq("active", true);

  if (error) {
    throw new MarketResolutionError(
      "MARKET_CARD_TEMPLATES_QUERY_FAILED",
      `Failed loading market card templates: ${error.message}`,
      500
    );
  }

  const templates: MarketCardTemplates = {};
  for (const row of (data ?? []) as RawRecord[]) {
    const mappedCardType = mapCardType(row.card_type);
    const titleTemplate = toStringOrNull(row.title_template);
    if (!mappedCardType || !titleTemplate) {
      continue;
    }

    templates[mappedCardType] = {
      titleTemplate,
      subtitleTemplate: toStringOrNull(row.subtitle_template) ?? undefined
    };
  }

  return Object.keys(templates).length > 0 ? templates : undefined;
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

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on", "enabled", "active"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off", "disabled", "inactive"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function isRowActive(row: RawRecord): boolean {
  for (const key of ACTIVE_COLUMNS) {
    if (row[key] !== undefined) {
      return toBoolean(row[key], true);
    }
  }
  return true;
}

function getFieldRuleMap(resolved: ResolvedMarket, fieldKey: string) {
  const map = new Map<string, unknown>();
  const normalizedFieldKey = fieldKey.trim().toLowerCase();

  const field = resolved.fields.find((candidate) => candidate.key.toLowerCase() === normalizedFieldKey);
  if (field) {
    for (const [key, value] of Object.entries(field.raw)) {
      map.set(key.toLowerCase(), value);
    }
  }

  for (const rule of resolved.rules) {
    if ((rule.fieldKey ?? "").toLowerCase() !== normalizedFieldKey) {
      continue;
    }
    map.set(rule.ruleKey.toLowerCase(), rule.ruleValue);
  }

  return map;
}

function normalizeFlowScope(value: unknown): "BUY" | "SELL" | "ALL" | null {
  const normalized = toStringOrNull(value)?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "buy") {
    return "BUY";
  }
  if (normalized === "sell") {
    return "SELL";
  }
  if (["all", "both", "any", "*"].includes(normalized)) {
    return "ALL";
  }
  return null;
}

function ruleAppliesToFlow(rule: ResolvedMarket["rules"][number], flow: "BUY" | "SELL") {
  const rawScope =
    (rule.raw as RawRecord | undefined)?.flow_scope ??
    (rule.raw as RawRecord | undefined)?.flowScope ??
    (rule.raw as RawRecord | undefined)?.scope;
  const scope = normalizeFlowScope(rawScope);
  if (!scope || scope === "ALL") {
    return true;
  }
  return scope === flow;
}

function readRuleBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as RawRecord;
    if (row.value !== undefined) {
      return toBoolean(row.value, fallback);
    }
    if (row.enabled !== undefined) {
      return toBoolean(row.enabled, fallback);
    }
    if (row.allow !== undefined) {
      return toBoolean(row.allow, fallback);
    }
  }

  return toBoolean(value, fallback);
}

function readRuleText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as RawRecord;
    if (row.value !== undefined) {
      return toStringOrNull(row.value)?.toLowerCase() ?? null;
    }
  }

  return toStringOrNull(value)?.toLowerCase() ?? null;
}

function isRequiredForFlow(
  explicitRequiredValue: unknown,
  requiredOnValue: unknown,
  flow: "BUY" | "SELL",
  fallback: boolean
) {
  const explicitRequired = readRuleBoolean(explicitRequiredValue, fallback);
  const requiredOn = readRuleText(requiredOnValue);
  if (!requiredOn) {
    return explicitRequired;
  }

  if (["none", "never", "false", "0"].includes(requiredOn)) {
    return false;
  }
  if (["both", "all", "any", "true", "1"].includes(requiredOn)) {
    return true;
  }
  if (requiredOn === "buy") {
    return flow === "BUY";
  }
  if (requiredOn === "sell") {
    return flow === "SELL";
  }

  return explicitRequired;
}

function resolveRequiredForFlow(
  resolved: ResolvedMarket,
  fieldKey: string,
  fallbackRequired: boolean,
  flow: "BUY" | "SELL",
  ruleMap: Map<string, unknown>
) {
  const normalizedFieldKey = fieldKey.trim().toLowerCase();
  const requiredRules = resolved.rules.filter(
    (rule) =>
      (rule.fieldKey ?? "").toLowerCase() === normalizedFieldKey &&
      rule.ruleKey.toLowerCase() === "required"
  );
  const matchingRequiredRules = requiredRules.filter((rule) => ruleAppliesToFlow(rule, flow));

  if (matchingRequiredRules.length > 0) {
    const selectedRule = matchingRequiredRules[matchingRequiredRules.length - 1];
    return toBoolean(selectedRule.ruleValue, false);
  }

  if (requiredRules.length > 0) {
    return false;
  }

  return isRequiredForFlow(
    ruleMap.get("required"),
    ruleMap.get("required_on"),
    flow,
    fallbackRequired
  );
}

function inferInputType(fieldKey: string, rawType: string | null) {
  const normalizedKey = fieldKey.trim().toLowerCase();
  if (["detail", "details", "details_text", "detalle"].includes(normalizedKey)) {
    return "text";
  }

  const normalizedType = (rawType ?? "").trim().toLowerCase();
  if (!normalizedType) {
    return "select";
  }
  if (
    [
      "text",
      "textarea",
      "string",
      "free_text",
      "free-text",
      "detail",
      "details"
    ].includes(normalizedType)
  ) {
    return "text";
  }
  if (["number", "numeric", "integer", "int", "decimal", "float"].includes(normalizedType)) {
    return "number";
  }
  return "select";
}

export async function getAvailableMarkets(params: { supabase: SupabaseLike }) {
  const { data, error } = await params.supabase
    .from("markets")
    .select("*")
    .order("key", { ascending: true });

  if (error) {
    throw new MarketResolutionError(
      "MARKETS_QUERY_FAILED",
      `Failed loading markets: ${error.message}`,
      500
    );
  }

  const markets: EngineMarketDescriptor[] = [];
  for (const row of (data ?? []) as RawRecord[]) {
    if (!isRowActive(row)) {
      continue;
    }
    const key = toStringOrNull(row.key)?.toLowerCase();
    if (!key) {
      continue;
    }

    const label =
      toStringOrNull(row.label) ??
      toStringOrNull(row.label_es) ??
      toStringOrNull(row.name) ??
      key;

    markets.push({
      id: toStringOrNull(row.id),
      key,
      label,
      active: true
    });
  }

  return { markets };
}

export type MarketsListContractData = {
  markets: EngineMarketDescriptor[];
};

export async function getAvailableMarketsContract(params: {
  supabase: SupabaseLike;
}): Promise<EngineContractResponse<MarketsListContractData>> {
  try {
    const data = await getAvailableMarkets(params);
    return engineOk(data);
  } catch (error) {
    return adaptEngineError(error, "Unexpected catalog error.");
  }
}

export async function getMarketDefinition(params: {
  marketKey: string;
  supabase: SupabaseLike;
}) {
  const resolved = await resolveMarketConfiguration(params.marketKey, {
    supabase: params.supabase as any
  });
  const cardTemplates = await loadMarketCardTemplates({
    supabase: params.supabase,
    marketId: resolved.market.id
  });

  return {
    market: {
      id: resolved.market.id,
      key: resolved.market.key,
      label: resolved.market.label,
      active: resolved.market.active
    },
    cardTemplates,
    fields: resolved.fields.map((field) => {
      const ruleMap = getFieldRuleMap(resolved, field.key);
      const inputType =
        toStringOrNull(ruleMap.get("input_type")) ??
        toStringOrNull(ruleMap.get("inputtype")) ??
        toStringOrNull(ruleMap.get("field_input_type")) ??
        toStringOrNull(field.raw.input_type) ??
        toStringOrNull(field.raw.inputType) ??
        inferInputType(field.key, field.type);

      const allowedInBuy = toBoolean(
        ruleMap.get("allowed_in_buy") ?? field.raw.allowed_in_buy ?? field.raw.allowedInBuy,
        true
      );
      const allowedInSell = toBoolean(
        ruleMap.get("allowed_in_sell") ?? field.raw.allowed_in_sell ?? field.raw.allowedInSell,
        true
      );
      const requiredInBuy = resolveRequiredForFlow(
        resolved,
        field.key,
        field.required,
        "BUY",
        ruleMap
      );
      const requiredInSell = resolveRequiredForFlow(
        resolved,
        field.key,
        field.required,
        "SELL",
        ruleMap
      );

      return {
        id: field.id,
        key: field.key,
        label: field.label,
        type: field.type,
        required: requiredInBuy || requiredInSell,
        requiredInBuy,
        required_in_buy: requiredInBuy,
        requiredInSell,
        required_in_sell: requiredInSell,
        order: field.order,
        inputType,
        input_type: inputType,
        allowedInBuy,
        allowed_in_buy: allowedInBuy,
        allowedInSell,
        allowed_in_sell: allowedInSell
      };
    }),
    dependencies: resolved.dependencies.map((dependency) => ({
      id: dependency.id,
      fieldKey: dependency.fieldKey,
      dependsOnFieldKey: dependency.dependsOnFieldKey,
      order: dependency.order
    }))
  };
}

export type MarketDefinitionContractData = {
  market: EngineMarketDescriptor;
  cardTemplates?: {
    buyDemand?: {
      titleTemplate: string;
      subtitleTemplate?: string;
      metaTemplate?: string;
    };
    sellListing?: {
      titleTemplate: string;
      subtitleTemplate?: string;
      metaTemplate?: string;
    };
  };
  fields: Array<{
    id: string | null;
    key: string;
    label: string;
    type: string | null;
    required: boolean;
    requiredInBuy: boolean;
    required_in_buy: boolean;
    requiredInSell: boolean;
    required_in_sell: boolean;
    order: number;
    inputType: string | null;
    input_type: string | null;
    allowedInBuy: boolean;
    allowed_in_buy: boolean;
    allowedInSell: boolean;
    allowed_in_sell: boolean;
  }>;
  dependencies: Array<{
    id: string | null;
    fieldKey: string | null;
    dependsOnFieldKey: string | null;
    order: number;
  }>;
};

export async function getMarketFieldOptions(params: {
  marketKey: string;
  fieldKey: string;
  selectedValues?: Record<string, unknown>;
  supabase: SupabaseLike;
  resolvedMarket?: ResolvedMarket;
}) {
  const resolved =
    params.resolvedMarket ??
    (await resolveMarketConfiguration(params.marketKey, {
      supabase: params.supabase as any
    }));

  const result = await loadFieldVocabulary({
    marketKey: resolved.market.key,
    fieldKey: params.fieldKey,
    selectedValues: params.selectedValues ?? {},
    resolvedMarket: resolved,
    supabase: params.supabase as any
  });

  return {
    marketKey: resolved.market.key,
    fieldKey: result.fieldKey,
    source: result.source,
    dependsOn: result.dependsOn,
    options: result.options.map((option) => ({
      id: option.id,
      key: option.key,
      label: option.label,
      label_es: option.label
    }))
  };
}

export type MarketFieldOptionsContractData = {
  market: EngineMarketDescriptor;
  field: {
    key: string;
    dependsOn: Record<string, unknown>;
    source: {
      type: string;
      ref: string;
    };
  };
  options: Array<{
    id: string | null;
    key: string;
    label: string;
    label_es: string;
  }>;
};

export async function getMarketVocabularySnapshot(params: {
  marketKey: string;
  selectedValues?: Record<string, unknown>;
  supabase: SupabaseLike;
}) {
  const resolved = await resolveMarketConfiguration(params.marketKey, {
    supabase: params.supabase as any
  });

  const vocabulary = await loadMarketVocabulary({
    marketKey: resolved.market.key,
    selectedValues: params.selectedValues ?? {},
    resolvedMarket: resolved,
    supabase: params.supabase as any
  });

  return {
    market: {
      id: vocabulary.market.id,
      key: vocabulary.market.key,
      label: vocabulary.market.label,
      active: vocabulary.market.active
    },
    fields: vocabulary.fields.map((field) => ({
      fieldKey: field.fieldKey,
      dependsOn: field.dependsOn,
      source: field.source,
      options: field.options.map((option) => ({
        id: option.id,
        key: option.key,
        label: option.label,
        label_es: option.label
      }))
    }))
  };
}

export type MarketVocabularySnapshotContractData = {
  market: EngineMarketDescriptor;
  fields: Array<{
    fieldKey: string;
    dependsOn: Record<string, unknown>;
    source: {
      type: string;
      ref: string;
    };
    options: Array<{
      id: string | null;
      key: string;
      label: string;
      label_es: string;
    }>;
  }>;
};

export async function getMarketDefinitionContract(params: {
  marketKey: string;
  supabase: SupabaseLike;
}): Promise<EngineContractResponse<MarketDefinitionContractData>> {
  try {
    const data = await getMarketDefinition(params);
    return engineOk(data);
  } catch (error) {
    return adaptEngineError(error, "Unexpected catalog error.");
  }
}

export async function getMarketFieldOptionsContract(params: {
  marketKey: string;
  fieldKey: string;
  selectedValues?: Record<string, unknown>;
  supabase: SupabaseLike;
}): Promise<EngineContractResponse<MarketFieldOptionsContractData>> {
  try {
    const resolved = await resolveMarketConfiguration(params.marketKey, {
      supabase: params.supabase as any,
      skipCache: false
    });
    const data = await getMarketFieldOptions({
      ...params,
      resolvedMarket: resolved
    });
    return engineOk({
      market: {
        id: resolved.market.id,
        key: resolved.market.key,
        label: resolved.market.label,
        active: resolved.market.active
      },
      field: {
        key: data.fieldKey,
        dependsOn: data.dependsOn,
        source: data.source
      },
      options: data.options
    });
  } catch (error) {
    return adaptEngineError(error, "Unexpected catalog error.");
  }
}

export async function getMarketVocabularySnapshotContract(params: {
  marketKey: string;
  selectedValues?: Record<string, unknown>;
  supabase: SupabaseLike;
}): Promise<EngineContractResponse<MarketVocabularySnapshotContractData>> {
  try {
    const data = await getMarketVocabularySnapshot(params);
    return engineOk(data);
  } catch (error) {
    return adaptEngineError(error, "Unexpected catalog error.");
  }
}

export function mapMarketResolutionErrorToHttp(error: unknown) {
  if (!(error instanceof MarketResolutionError)) {
    return null;
  }

  if (error.status === 404) {
    return {
      status: 404,
      body: { ok: false, error: "market_not_found" }
    };
  }

  if (error.status === 409) {
    return {
      status: 409,
      body: { ok: false, error: "market_inactive" }
    };
  }

  if (error.status === 400) {
    return {
      status: 400,
      body: { ok: false, error: "invalid_request" }
    };
  }

  return {
    status: 500,
    body: { ok: false, error: "unexpected_error" }
  };
}
