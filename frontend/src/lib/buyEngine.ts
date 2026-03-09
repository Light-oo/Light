import type { MarketFieldDefinition } from "./marketForm";

export type BuyDemandAction = "created" | "updated" | "existing";

export type NormalizedBuySearchResponse<TCard> = {
  results: TCard[];
  page: number;
  pageSize: number;
  total: number;
  reason?: string;
  demandAction?: BuyDemandAction;
};

function toNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toDemandAction(value: unknown): BuyDemandAction | undefined {
  if (value === "created" || value === "updated" || value === "existing") {
    return value;
  }
  return undefined;
}

export function buildBuySearchQuery(params: {
  marketKey: string;
  fields: MarketFieldDefinition[];
  structuredValues: Record<string, string>;
  detailsText: string;
  page: number;
  pageSize: number;
}) {
  const query: Record<string, string | number | undefined> = {
    mode: "BUY",
    marketKey: params.marketKey,
    page: params.page,
    pageSize: params.pageSize,
    detailsText: params.detailsText || undefined
  };

  for (const field of params.fields) {
    const value = params.structuredValues[field.key];
    if (!value) {
      continue;
    }
    query[field.key] = value;
  }

  return query;
}

export function normalizeBuySearchResponse<TCard>(
  payload: unknown
): NormalizedBuySearchResponse<TCard> {
  const row = payload as any;

  if (row?.ok !== true) {
    throw new Error("invalid_buy_search_response");
  }

  if (Array.isArray(row.results)) {
    return {
      results: row.results as TCard[],
      page: toNumber(row.page, 1),
      pageSize: toNumber(row.pageSize, 20),
      total: toNumber(row.total, (row.results as unknown[]).length),
      reason: typeof row.data?.reason === "string" ? row.data.reason : undefined,
      demandAction: toDemandAction(row.data?.demandAction)
    };
  }

  if (Array.isArray(row.data?.results)) {
    return {
      results: row.data.results as TCard[],
      page: toNumber(row.meta?.page ?? row.data?.page, 1),
      pageSize: toNumber(row.meta?.pageSize ?? row.data?.pageSize, 20),
      total: toNumber(
        row.meta?.total ?? row.data?.total,
        (row.data.results as unknown[]).length
      ),
      reason:
        typeof row.data?.reason === "string"
          ? row.data.reason
          : typeof row.data?.context?.reason === "string"
            ? row.data.context.reason
            : undefined,
      demandAction: toDemandAction(row.data?.demandAction ?? row.data?.context?.demandAction)
    };
  }

  throw new Error("invalid_buy_search_response");
}
