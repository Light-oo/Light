import type { MarketFieldDefinition } from "./marketForm";

export type BuyDemandAction = "created" | "updated" | "existing";
export type BuyDemandCertificationAction = "certified" | "already_certified";

export type NormalizedBuySearchResponse<TCard> = {
  results: TCard[];
  page: number;
  pageSize: number;
  total: number;
  reason?: string;
  demandAction?: BuyDemandAction;
  demandId?: string;
  isCertified?: boolean;
  certificationAction?: BuyDemandCertificationAction;
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

function toCertificationAction(value: unknown): BuyDemandCertificationAction | undefined {
  if (value === "certified" || value === "already_certified") {
    return value;
  }
  return undefined;
}

export function buildBuySearchQuery(params: {
  marketKey: string;
  fields: MarketFieldDefinition[];
  structuredValues: Record<string, string>;
  detailsText: string;
  certify?: boolean;
  page: number;
  pageSize: number;
}) {
  const query: Record<string, string | number | undefined> = {
    mode: "BUY",
    marketKey: params.marketKey,
    page: params.page,
    pageSize: params.pageSize,
    detailsText: params.detailsText || undefined,
    certify: params.certify ? "true" : undefined
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

  if (Array.isArray(row.data?.results)) {
    return {
      results: row.data.results as TCard[],
      page: toNumber(row.data?.page, 1),
      pageSize: toNumber(row.data?.pageSize, 20),
      total: toNumber(row.data?.total, (row.data.results as unknown[]).length),
      reason: typeof row.data?.reason === "string" ? row.data.reason : undefined,
      demandAction: toDemandAction(row.data?.demandAction),
      demandId: typeof row.data?.demandId === "string" ? row.data.demandId : undefined,
      isCertified: typeof row.data?.isCertified === "boolean" ? row.data.isCertified : undefined,
      certificationAction: toCertificationAction(row.data?.certificationAction)
    };
  }

  throw new Error("invalid_buy_search_response");
}
