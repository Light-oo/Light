import { createSupabaseAnon } from "../lib/supabase";
import {
  type ResolvedMarket,
  type ResolvedMarketField,
  type ResolvedMarketRule,
  resolveMarketConfiguration
} from "./marketResolution";
import {
  validateMarketPayload,
  type ValidationErrorItem,
  type ValidationResult
} from "./dynamicValidation";
import { buildIntentionSignature, SignatureBuilderError } from "./signatureBuilder";
import {
  executeMarketScopedQueryWithCount,
  findMatchingOpenDemandsBySignature,
  findMatchingSellListingsBySignature
} from "./marketMatching";
import {
  engineOk,
  type EngineContractResponse,
  type EnginePaginationMeta
} from "./engineContracts";
import { engineValidationFailure } from "./engineErrorAdapter";

type RawRecord = Record<string, unknown>;

type BuyMarketSearchInput = {
  marketKey: string;
  payload: Record<string, unknown>;
  requesterUserId: string;
  page?: number;
  pageSize?: number;
  accessToken?: string;
  resolvedMarket?: ResolvedMarket;
  supabase?: ReturnType<typeof createSupabaseAnon>;
};

type SellDemandSearchInput = {
  marketKey: string;
  payload: Record<string, unknown>;
  page?: number;
  pageSize?: number;
  accessToken?: string;
  resolvedMarket?: ResolvedMarket;
  supabase?: ReturnType<typeof createSupabaseAnon>;
};

type EngineFailure = {
  ok: false;
  errors: ValidationErrorItem[];
};

type BuyMarketSearchSuccess = {
  ok: true;
  normalizedPayload: Record<string, string>;
  signature: string;
  results: RawRecord[];
  page: number;
  pageSize: number;
  total: number;
};

type SellDemandSearchSuccess = {
  ok: true;
  normalizedPayload: Record<string, string>;
  results: RawRecord[];
  page: number;
  pageSize: number;
  total: number;
};

export type BuyMarketSearchResult = BuyMarketSearchSuccess | EngineFailure;
export type SellDemandSearchResult = SellDemandSearchSuccess | EngineFailure;

export type BuySearchContractData = {
  marketKey: string;
  mode: "BUY";
  signature: string;
  normalizedPayload: Record<string, string>;
  results: RawRecord[];
};

export type SellDemandSearchContractData = {
  marketKey: string;
  mode: "SELL";
  normalizedPayload: Record<string, string>;
  exactSignature: string | null;
  results: RawRecord[];
};

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function getRuleMap(field: ResolvedMarketField, rules: ResolvedMarketRule[]) {
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

function normalizeValidationFailure(validation: ValidationResult): EngineFailure {
  return {
    ok: false,
    errors: validation.ok ? [] : validation.errors
  };
}

function getDemandFilterColumn(
  field: ResolvedMarketField,
  rules: ResolvedMarketRule[]
): string | null {
  const ruleMap = getRuleMap(field, rules);
  const candidates = [
    "demand_filter_column",
    "sell_search_column",
    "search_column",
    "query_column",
    "column"
  ];

  for (const key of candidates) {
    const value = toStringOrNull(ruleMap.get(key));
    if (value) {
      return value;
    }
  }
  return null;
}

export async function searchBuyListingsByMarket(
  input: BuyMarketSearchInput
): Promise<BuyMarketSearchResult> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  const supabase = input.supabase ?? createSupabaseAnon({ accessToken: input.accessToken });
  const resolvedMarket =
    input.resolvedMarket ??
    (await resolveMarketConfiguration(input.marketKey, { supabase: supabase as any }));

  const validation = await validateMarketPayload({
    marketKey: resolvedMarket.market.key,
    flow: "BUY",
    payload: input.payload,
    allowPartial: false,
    resolvedMarket,
    supabase: supabase as any
  });

  if (!validation.ok) {
    return normalizeValidationFailure(validation);
  }

  const signature = await buildIntentionSignature({
    marketKey: resolvedMarket.market.key,
    normalizedPayload: validation.normalizedPayload,
    resolvedMarket,
    supabase: supabase as any
  });

  const { data, count } = await findMatchingSellListingsBySignature({
    supabase,
    resolvedMarket,
    signature,
    page,
    pageSize
  });

  const visibleResults = data.filter(
    (row) => toStringOrNull(row.seller_profile_id) !== input.requesterUserId
  );

  return {
    ok: true,
    normalizedPayload: validation.normalizedPayload,
    signature,
    results: visibleResults,
    page,
    pageSize,
    total: Math.max(0, count - (data.length - visibleResults.length))
  };
}

export async function searchSellDemandsByMarket(
  input: SellDemandSearchInput
): Promise<SellDemandSearchResult> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const supabase = input.supabase ?? createSupabaseAnon({ accessToken: input.accessToken });
  const resolvedMarket =
    input.resolvedMarket ??
    (await resolveMarketConfiguration(input.marketKey, { supabase: supabase as any }));

  const validation = await validateMarketPayload({
    marketKey: resolvedMarket.market.key,
    flow: "SELL",
    payload: input.payload,
    allowPartial: true,
    buildSignature: false,
    resolvedMarket,
    supabase: supabase as any
  });

  if (!validation.ok) {
    return normalizeValidationFailure(validation);
  }

  let exactSignature: string | null = null;
  try {
    exactSignature = await buildIntentionSignature({
      marketKey: resolvedMarket.market.key,
      normalizedPayload: validation.normalizedPayload,
      resolvedMarket,
      supabase: supabase as any
    });
  } catch (error) {
    if (!(error instanceof SignatureBuilderError)) {
      throw error;
    }
  }

  if (exactSignature) {
    const exactMatchResult = await findMatchingOpenDemandsBySignature({
      supabase,
      resolvedMarket,
      signature: exactSignature,
      page,
      pageSize
    });

    return {
      ok: true,
      normalizedPayload: validation.normalizedPayload,
      results: exactMatchResult.data,
      page,
      pageSize,
      total: exactMatchResult.count
    };
  }

  const fieldByKey = new Map(
    resolvedMarket.fields.map((field) => [field.key.toLowerCase(), field] as const)
  );

  const { data, count } = await executeMarketScopedQueryWithCount({
    supabase,
    table: "demands",
    market: resolvedMarket.market,
    selectClause: "id,requester_user_id,status,created_at,details_text",
    apply: (query) => {
      let scoped = query.eq("status", "open");

      for (const [fieldKey, value] of Object.entries(validation.normalizedPayload)) {
        const field = fieldByKey.get(fieldKey.toLowerCase());
        if (!field) {
          continue;
        }
        const column = getDemandFilterColumn(field, resolvedMarket.rules);
        if (!column) {
          continue;
        }
        scoped = scoped.eq(column, value);
      }

      return scoped.order("created_at", { ascending: false }).range(from, to);
    }
  });

  return {
    ok: true,
    normalizedPayload: validation.normalizedPayload,
    results: data,
    page,
    pageSize,
    total: count
  };
}

export async function searchBuyListingsByMarketContract(
  input: BuyMarketSearchInput
): Promise<EngineContractResponse<BuySearchContractData, EnginePaginationMeta>> {
  const result = await searchBuyListingsByMarket(input);
  if (!result.ok) {
    return engineValidationFailure(result.errors, "BUY search validation failed.");
  }

  return engineOk(
    {
      marketKey: input.marketKey.trim().toLowerCase(),
      mode: "BUY",
      signature: result.signature,
      normalizedPayload: result.normalizedPayload,
      results: result.results
    },
    {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total
    }
  );
}

export async function searchSellDemandsByMarketContract(
  input: SellDemandSearchInput
): Promise<EngineContractResponse<SellDemandSearchContractData, EnginePaginationMeta>> {
  const result = await searchSellDemandsByMarket(input);
  if (!result.ok) {
    return engineValidationFailure(result.errors, "SELL demand search validation failed.");
  }

  let exactSignature: string | null = null;
  try {
    const supabase = input.supabase ?? createSupabaseAnon({ accessToken: input.accessToken });
    const resolvedMarket =
      input.resolvedMarket ??
      (await resolveMarketConfiguration(input.marketKey, { supabase: supabase as any }));
    exactSignature = await buildIntentionSignature({
      marketKey: resolvedMarket.market.key,
      normalizedPayload: result.normalizedPayload,
      resolvedMarket,
      supabase: supabase as any
    });
  } catch (_error) {
    exactSignature = null;
  }

  return engineOk(
    {
      marketKey: input.marketKey.trim().toLowerCase(),
      mode: "SELL",
      normalizedPayload: result.normalizedPayload,
      exactSignature,
      results: result.results
    },
    {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total
    }
  );
}
