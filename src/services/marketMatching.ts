import { createSupabaseAnon } from "../lib/supabase";
import { MarketResolutionError, type ResolvedMarket } from "./marketResolution";

type RawRecord = Record<string, unknown>;

type QueryWithCountResult = {
  data: RawRecord[];
  count: number;
};

type MatchingQueryInput = {
  supabase: ReturnType<typeof createSupabaseAnon>;
  resolvedMarket: ResolvedMarket;
  signature: string;
  page: number;
  pageSize: number;
};

export type MarketExactMatchRule = {
  marketKey: string;
  signature: string;
  listingState: "active";
  demandState: "open";
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

function isMissingColumnError(error: any) {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "pgrst204" ||
    message.includes("column") ||
    details.includes("column")
  );
}

export function getMarketScopeCandidates(market: ResolvedMarket["market"]) {
  const candidates: { column: string; value: string }[] = [];
  const key = toStringOrNull(market.key);
  const id = toStringOrNull(market.id);

  if (key) {
    candidates.push({ column: "market_key", value: key });
  }
  if (id) {
    candidates.push({ column: "market_id", value: id });
  }

  if (candidates.length === 0) {
    throw new MarketResolutionError(
      "MARKET_SCOPE_UNAVAILABLE",
      `Market scope columns cannot be resolved for market "${market.key}".`,
      500
    );
  }

  return candidates;
}

export async function executeMarketScopedQueryWithCount(params: {
  supabase: ReturnType<typeof createSupabaseAnon>;
  table: string;
  market: ResolvedMarket["market"];
  selectClause: string;
  apply: (query: any) => any;
}): Promise<QueryWithCountResult> {
  const scopeCandidates = getMarketScopeCandidates(params.market);
  let lastError: any = null;

  for (const scope of scopeCandidates) {
    let query = params.supabase.from(params.table).select(params.selectClause, { count: "exact" });
    query = query.eq(scope.column, scope.value);
    query = params.apply(query);
    const { data, error, count } = await query;

    if (!error) {
      return {
        data: (data ?? []) as unknown as RawRecord[],
        count: count ?? 0
      };
    }

    if (isMissingColumnError(error)) {
      lastError = error;
      continue;
    }

    throw new MarketResolutionError(
      "MARKET_MATCH_QUERY_FAILED",
      `Query failed on ${params.table}: ${error.message}`,
      500
    );
  }

  throw new MarketResolutionError(
    "MARKET_SCOPE_COLUMN_NOT_FOUND",
    `Could not apply market scope on table "${params.table}". Last error: ${String(
      lastError?.message ?? "unknown"
    )}`,
    500
  );
}

export function buildMarketExactMatchRule(
  resolvedMarket: ResolvedMarket,
  signature: string
): MarketExactMatchRule {
  return {
    marketKey: resolvedMarket.market.key.toLowerCase(),
    signature: signature.trim().toLowerCase(),
    listingState: "active",
    demandState: "open"
  };
}

export async function findMatchingSellListingsBySignature(
  input: MatchingQueryInput
): Promise<QueryWithCountResult> {
  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;
  const rule = buildMarketExactMatchRule(input.resolvedMarket, input.signature);

  return executeMarketScopedQueryWithCount({
    supabase: input.supabase,
    table: "listings",
    market: input.resolvedMarket.market,
    selectClause: "id,seller_profile_id,intention_signature,listing_type,status,created_at",
    apply: (query) =>
      query
        .eq("listing_type", "sell")
        .eq("status", rule.listingState)
        .eq("intention_signature", rule.signature)
        .order("created_at", { ascending: false })
        .range(from, to)
  });
}

export async function findMatchingOpenDemandsBySignature(
  input: MatchingQueryInput
): Promise<QueryWithCountResult> {
  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;
  const rule = buildMarketExactMatchRule(input.resolvedMarket, input.signature);

  return executeMarketScopedQueryWithCount({
    supabase: input.supabase,
    table: "demands",
    market: input.resolvedMarket.market,
    selectClause: "id,requester_user_id,status,intention_signature,created_at,details_text",
    apply: (query) =>
      query
        .eq("status", rule.demandState)
        .eq("intention_signature", rule.signature)
        .order("created_at", { ascending: false })
        .range(from, to)
  });
}

export function isExactMarketSignatureMatch(params: {
  marketKeyA: string;
  marketKeyB: string;
  signatureA: string;
  signatureB: string;
}) {
  return (
    params.marketKeyA.trim().toLowerCase() === params.marketKeyB.trim().toLowerCase() &&
    params.signatureA.trim().toLowerCase() === params.signatureB.trim().toLowerCase()
  );
}
