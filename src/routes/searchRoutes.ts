import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { logError, logWarn } from "../lib/logger";
import { createSupabaseAnon, createSupabaseServiceRole } from "../lib/supabase";
import { requireWhatsappNumber } from "../services/profileStatus";
import { resolveMarketConfiguration, type ResolvedMarket } from "../services/marketResolution";
import {
  searchBuyListingsByMarket,
  searchSellDemandsByMarket
} from "../services/marketSearchEngine";
import {
  createOrReuseOpenMarketDemand,
  MarketDemandCreationError
} from "../services/marketDemandCreation";
import {
  createDisplayIdentityCache,
  buildIdentityValuesFromRow,
  parseSignatureValues,
  resolveDisplayIdentityValues
} from "../utils/marketIdentity";

const router = Router();

const paginationQuerySchema = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional()
};

const listingsQuerySchema = z
  .object({
    mode: z.union([z.literal("BUY"), z.literal("SELL")]),
    marketKey: z.string().trim().min(1),
    detailsText: z.string().max(200).optional(),
    certify: z
      .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
      .optional(),
    ...paginationQuerySchema
  })
  .passthrough();

const demandsQuerySchema = z
  .object({
    marketKey: z.string().trim().min(1),
    ...paginationQuerySchema
  })
  .passthrough();

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    )
  );
}

async function fetchDepartmentNameByProfileId(
  supabase: ReturnType<typeof createSupabaseAnon>,
  profileIds: string[]
) {
  const uniqueIds = uniqueNonEmpty(profileIds);
  if (uniqueIds.length === 0) {
    return {} as Record<string, string>;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,department_id")
    .in("id", uniqueIds);

  if (error) {
    throw error;
  }

  const profileDepartmentMap = new Map<string, number>();
  const departmentIds = new Set<number>();
  for (const row of data ?? []) {
    const profileId = normalizeText((row as any)?.id);
    const rawDepartmentId = (row as any)?.department_id;
    const departmentId =
      typeof rawDepartmentId === "number"
        ? rawDepartmentId
        : typeof rawDepartmentId === "string" && rawDepartmentId.trim().length > 0
          ? Number(rawDepartmentId)
          : NaN;

    if (!profileId || !Number.isFinite(departmentId)) {
      continue;
    }

    profileDepartmentMap.set(profileId, departmentId);
    departmentIds.add(departmentId);
  }

  const departmentNameById = new Map<number, string>();
  if (departmentIds.size > 0) {
    const service = createSupabaseServiceRole();
    const { data: departmentRows, error: departmentError } = await service
      .from("departments")
      .select("id,name")
      .in("id", [...departmentIds]);

    if (!departmentError) {
      for (const row of departmentRows ?? []) {
        const id = (row as any)?.id;
        const name = normalizeText((row as any)?.name);
        if (typeof id === "number" && name) {
          departmentNameById.set(id, name);
        }
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [profileId, departmentId] of profileDepartmentMap.entries()) {
    const departmentName = departmentNameById.get(departmentId);
    if (departmentName) {
      out[profileId] = departmentName;
    }
  }

  return out;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeQueryValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeQueryValue(item);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function extractMarketPayloadFromQuery(
  query: Record<string, unknown>,
  resolvedMarket: ResolvedMarket
) {
  const reservedKeys = new Set(["mode", "marketkey", "detailstext", "page", "pagesize", "certify"]);
  const fieldKeys = new Set(resolvedMarket.fields.map((field) => field.key.toLowerCase()));
  const payload: Record<string, string> = {};
  const issues: Array<{ path: string; code: string; message: string }> = [];

  for (const [rawKey, rawValue] of Object.entries(query)) {
    const normalizedKey = rawKey.trim().toLowerCase();
    if (!normalizedKey || reservedKeys.has(normalizedKey)) {
      continue;
    }
    if (!fieldKeys.has(normalizedKey)) {
      issues.push({
        path: rawKey,
        code: "unknown_field",
        message: `Field "${rawKey}" is not defined for market "${resolvedMarket.market.key}". Use canonical field keys from market metadata.`
      });
      continue;
    }

    const normalizedValue = normalizeQueryValue(rawValue);
    if (!normalizedValue) {
      continue;
    }
    payload[normalizedKey] = normalizedValue;
  }

  return { payload, issues };
}

function sendErrorResponse(params: {
  res: any;
  status: number;
  error: string;
  message: string;
  marketKey?: string;
  issues?: Array<{ path: string; code: string; message: string }>;
}) {
  const payload: Record<string, unknown> = {
    ok: false,
    error: params.error,
    message: params.message
  };
  if (params.marketKey) {
    payload.marketKey = params.marketKey;
  }
  if (params.issues && params.issues.length > 0) {
    payload.issues = params.issues;
  }
  return params.res.status(params.status).json(payload);
}

router.get("/search/demands", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof demandsQuerySchema>;
  try {
    parsed = demandsQuerySchema.parse(req.query);
  } catch (err) {
    return next(err);
  }

  const authToken = (req as unknown as { authToken: string }).authToken;
  const requesterUserId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });
  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 20;
  const marketKey = parsed.marketKey.trim().toLowerCase();

  let resolvedMarket: ResolvedMarket;
  try {
    resolvedMarket = await resolveMarketConfiguration(marketKey, { supabase: supabase as any });
  } catch (error: any) {
    const status = Number(error?.status ?? 500);
    if (status === 404) {
      return sendErrorResponse({
        res,
        status: 404,
        error: "market_not_found",
        message: "Market not found.",
        marketKey
      });
    }
    if (status === 409) {
      return sendErrorResponse({
        res,
        status: 409,
        error: "market_inactive",
        message: "Market is inactive.",
        marketKey
      });
    }
    logError(req, "search_demands_market_resolution_error", {
      marketKey,
      code: error?.code,
      message: error?.message
    });
    return sendErrorResponse({
      res,
      status: 500,
      error: "unexpected_error",
      message: "Unexpected search error.",
      marketKey
    });
  }

  const { payload: marketPayload, issues: payloadIssues } = extractMarketPayloadFromQuery(
    req.query as Record<string, unknown>,
    resolvedMarket
  );
  if (payloadIssues.length > 0) {
    return sendErrorResponse({
      res,
      status: 400,
      error: "invalid_request",
      message: "Payload validation failed.",
      marketKey: resolvedMarket.market.key,
      issues: payloadIssues
    });
  }

  const sellSearch = await searchSellDemandsByMarket({
    marketKey: resolvedMarket.market.key,
    payload: marketPayload,
    page,
    pageSize,
    accessToken: authToken,
    supabase
  });

  if (!sellSearch.ok) {
    return sendErrorResponse({
      res,
      status: 400,
      error: "invalid_request",
      message: "Payload validation failed.",
      marketKey: resolvedMarket.market.key,
      issues: sellSearch.errors.map((issue) => ({
        path: issue.fieldKey,
        code: issue.code,
        message: issue.message
      }))
    });
  }

  const demandIds = uniqueNonEmpty(
    sellSearch.results.map((row) => normalizeText((row as any)?.id))
  );

  const { data: demandRows, error: demandRowsError } =
    demandIds.length > 0
      ? await supabase
          .from("demands")
          .select("*")
          .in("id", demandIds)
      : { data: [], error: null };

  if (demandRowsError) {
    logError(req, "search_demands_rows_lookup_error", {
      requesterUserId,
      code: demandRowsError.code,
      message: demandRowsError.message,
      details: (demandRowsError as any)?.details,
      hint: (demandRowsError as any)?.hint
    });
    return sendErrorResponse({
      res,
      status: 500,
      error: "unexpected_error",
      message: "Unexpected search error.",
      marketKey: resolvedMarket.market.key
    });
  }

  const demandRowById = new Map<string, Record<string, unknown>>();
  for (const row of (demandRows ?? []) as Record<string, unknown>[]) {
    const demandId = normalizeText(row.id);
    if (demandId) {
      demandRowById.set(demandId, row);
    }
  }

  let departmentByProfileId: Record<string, string> = {};
  try {
    departmentByProfileId = await fetchDepartmentNameByProfileId(
      supabase,
      uniqueNonEmpty(
        sellSearch.results.map((row) => normalizeText((row as any)?.requester_user_id))
      )
    );
  } catch (departmentError: any) {
    logWarn(req, "search_demands_department_lookup_error", {
      code: departmentError?.code,
      message: departmentError?.message
    });
  }

  const displayIdentityCache = createDisplayIdentityCache();
  const results = await Promise.all(sellSearch.results.map(async (resultRow) => {
    const demandId = normalizeText((resultRow as any)?.id);
    const mappedRow = demandId ? demandRowById.get(demandId) : undefined;
    const fullRow = mappedRow ?? (resultRow as any);
    const signatureValues = parseSignatureValues((fullRow as any)?.intention_signature);
    const requesterUserIdRaw = normalizeText((fullRow as any)?.requester_user_id);
    const sourceLabel = mappedRow ? "demand_row" : "search_result_row";
    const sourcePart = normalizeText((fullRow as any)?.part);
    const sourceSystem = normalizeText((fullRow as any)?.system);
    const sourceItemType = normalizeText((fullRow as any)?.item_type);
    logWarn(req, "search_sell_mode_enrichment_source_debug", {
      demandId,
      source: sourceLabel,
      demandRowHit: Boolean(mappedRow),
      isOwnDemand: requesterUserIdRaw === requesterUserId,
      requesterUserId: requesterUserIdRaw || null,
      rawPart: sourcePart || null,
      rawSystem: sourceSystem || null,
      rawItemType: sourceItemType || null
    });
    const rawIdentityValues = buildIdentityValuesFromRow(
      fullRow as Record<string, unknown>,
      resolvedMarket,
      signatureValues
    );
    const identityValues = await resolveDisplayIdentityValues({
      supabase: supabase as any,
      resolvedMarket,
      identityValues: rawIdentityValues,
      cache: displayIdentityCache
    });

    return {
      id: demandId,
      marketKey: resolvedMarket.market.key,
      identityValues,
      signature: normalizeText((fullRow as any)?.intention_signature),
      isCertified: Boolean((fullRow as any)?.is_certified),
      status: normalizeText((fullRow as any)?.status),
      created_at: (fullRow as any)?.created_at,
      type: "buy",
      request: {
        detailsText: (fullRow as any)?.details_text ?? null
      },
      location: {
        department: requesterUserIdRaw ? departmentByProfileId[requesterUserIdRaw] ?? null : null
      },
      audit: {
        requesterUserId: requesterUserIdRaw,
        createdAt: (fullRow as any)?.created_at
      }
    };
  }));

  return res.json({
    ok: true,
    data: {
      marketKey: resolvedMarket.market.key,
      results,
      page,
      pageSize,
      total: sellSearch.total
    }
  });
});

router.get("/search/listings", requireAuth, async (req, res, next) => {
  let parsed: z.infer<typeof listingsQuerySchema>;
  try {
    parsed = listingsQuerySchema.parse(req.query);
  } catch (err) {
    return next(err);
  }

  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 20;
  const marketKey = parsed.marketKey.trim().toLowerCase();

  const authToken = (req as unknown as { authToken: string }).authToken;
  const requesterUserId = (req as unknown as { user: { id: string } }).user.id;
  const supabase = createSupabaseAnon({ accessToken: authToken });

  let resolvedMarket: ResolvedMarket;
  try {
    resolvedMarket = await resolveMarketConfiguration(marketKey, { supabase: supabase as any });
  } catch (error: any) {
    const status = Number(error?.status ?? 500);
    if (status === 404) {
      return sendErrorResponse({
        res,
        status: 404,
        error: "market_not_found",
        message: "Market not found.",
        marketKey
      });
    }
    if (status === 409) {
      return sendErrorResponse({
        res,
        status: 409,
        error: "market_inactive",
        message: "Market is inactive.",
        marketKey
      });
    }
    logError(req, "search_market_resolution_error", {
      marketKey,
      code: error?.code,
      message: error?.message
    });
    return sendErrorResponse({
      res,
      status: 500,
      error: "unexpected_error",
      message: "Unexpected search error.",
      marketKey
    });
  }

  const { payload: marketPayload, issues: payloadIssues } = extractMarketPayloadFromQuery(
    req.query as Record<string, unknown>,
    resolvedMarket
  );
  if (payloadIssues.length > 0) {
    return sendErrorResponse({
      res,
      status: 400,
      error: "invalid_request",
      message: "Payload validation failed.",
      marketKey: resolvedMarket.market.key,
      issues: payloadIssues
    });
  }

  if (parsed.mode === "SELL") {
    const sellSearch = await searchSellDemandsByMarket({
      marketKey: resolvedMarket.market.key,
      payload: marketPayload,
      page,
      pageSize,
      accessToken: authToken,
      supabase
    });

    if (!sellSearch.ok) {
      return sendErrorResponse({
        res,
        status: 400,
        error: "invalid_request",
        message: "Payload validation failed.",
        marketKey: resolvedMarket.market.key,
        issues: sellSearch.errors.map((issue) => ({
          path: issue.fieldKey,
          code: issue.code,
          message: issue.message
        }))
      });
    }

    const demandIds = uniqueNonEmpty(
      sellSearch.results.map((row) => normalizeText((row as any)?.id))
    );

    const { data: demandRows, error: demandRowsError } =
      demandIds.length > 0
        ? await supabase
            .from("demands")
            .select("*")
            .in("id", demandIds)
        : { data: [], error: null };

    if (demandRowsError) {
      logError(req, "search_sell_demands_lookup_error", {
        code: demandRowsError.code,
        message: demandRowsError.message
      });
      return sendErrorResponse({
        res,
        status: 500,
        error: "unexpected_error",
        message: "Unexpected search error.",
        marketKey: resolvedMarket.market.key
      });
    }

    const demandRowById = new Map<string, Record<string, unknown>>();
    for (const row of (demandRows ?? []) as Record<string, unknown>[]) {
      const demandId = normalizeText(row.id);
      if (demandId) {
        demandRowById.set(demandId, row);
      }
    }

    let departmentByProfileId: Record<string, string> = {};
    try {
      departmentByProfileId = await fetchDepartmentNameByProfileId(
        supabase,
        uniqueNonEmpty(
          sellSearch.results.map((row) => normalizeText((row as any)?.requester_user_id))
        )
      );
    } catch (departmentError: any) {
      logWarn(req, "search_sell_mode_department_lookup_error", {
        code: departmentError?.code,
        message: departmentError?.message
      });
    }

    const results = sellSearch.results.map((resultRow) => {
      const demandId = normalizeText((resultRow as any)?.id);
      const fullRow = demandId ? demandRowById.get(demandId) ?? (resultRow as any) : (resultRow as any);
      const signatureValues = parseSignatureValues((fullRow as any)?.intention_signature);
      const requesterUserIdRaw = normalizeText((fullRow as any)?.requester_user_id);
      const identityValues = buildIdentityValuesFromRow(
        fullRow as Record<string, unknown>,
        resolvedMarket,
        signatureValues
      );

      return {
        id: demandId,
        marketKey: resolvedMarket.market.key,
        identityValues,
        signature: normalizeText((fullRow as any)?.intention_signature),
        isCertified: Boolean((fullRow as any)?.is_certified),
        status: normalizeText((fullRow as any)?.status),
        created_at: (fullRow as any)?.created_at,
        type: "buy",
        request: {
          detailsText: (fullRow as any)?.details_text ?? null
        },
        location: {
          department: requesterUserIdRaw ? departmentByProfileId[requesterUserIdRaw] ?? null : null
        },
        audit: {
          createdAt: (fullRow as any)?.created_at,
          requesterUserId: requesterUserIdRaw
        }
      };
    });

    return res.json({
      ok: true,
      data: {
        marketKey: resolvedMarket.market.key,
        results,
        page,
        pageSize,
        total: sellSearch.total
      }
    });
  }

  const buySearch = await searchBuyListingsByMarket({
    marketKey: resolvedMarket.market.key,
    payload: marketPayload,
    requesterUserId,
    page,
    pageSize,
    accessToken: authToken,
    supabase
  });

  if (!buySearch.ok) {
    return sendErrorResponse({
      res,
      status: 400,
      error: "invalid_request",
      message: "Payload validation failed.",
      marketKey: resolvedMarket.market.key,
      issues: buySearch.errors.map((issue) => ({
        path: issue.fieldKey,
        code: issue.code,
        message: issue.message
      }))
    });
  }

  const listingIds = uniqueNonEmpty(
    buySearch.results.map((row) => normalizeText((row as any)?.id))
  );

  const { data: buyRowsData, error: buyRowsError } =
    listingIds.length > 0
      ? await supabase
          .from("listing_card_fields")
          .select("*")
          .in("listing_id", listingIds)
      : { data: [], error: null };

  if (buyRowsError) {
    logError(req, "search_buy_cards_lookup_error", {
      code: buyRowsError.code,
      message: buyRowsError.message
    });
    return sendErrorResponse({
      res,
      status: 500,
      error: "unexpected_error",
      message: "Unexpected search error.",
      marketKey: resolvedMarket.market.key
    });
  }

  const buyRowByListingId = new Map<string, Record<string, unknown>>();
  for (const row of (buyRowsData ?? []) as Record<string, unknown>[]) {
    const listingId = normalizeText(row.listing_id);
    if (listingId) {
      buyRowByListingId.set(listingId, row);
    }
  }

  const listingOwnerByListingId: Record<string, string> = {};
  for (const row of buySearch.results) {
    const listingId = normalizeText((row as any)?.id);
    const ownerId = normalizeText((row as any)?.seller_profile_id);
    if (listingId && ownerId) {
      listingOwnerByListingId[listingId] = ownerId;
    }
  }

  let departmentBySellerProfileId: Record<string, string> = {};
  try {
    departmentBySellerProfileId = await fetchDepartmentNameByProfileId(
      supabase,
      uniqueNonEmpty(Object.values(listingOwnerByListingId))
    );
  } catch (departmentError: any) {
    logWarn(req, "search_buy_mode_department_lookup_error", {
      code: departmentError?.code,
      message: departmentError?.message
    });
  }

  const results = buySearch.results.map((resultRow) => {
    const listingId = normalizeText((resultRow as any)?.id);
    const cardRow = listingId ? buyRowByListingId.get(listingId) : undefined;
    const signatureValues = parseSignatureValues(
      (cardRow as any)?.intention_signature ?? (resultRow as any)?.intention_signature
    );
    const rowForIdentity = {
      ...(resultRow as Record<string, unknown>),
      ...(cardRow as Record<string, unknown>),
      identity: signatureValues
    };
    const identityValues = buildIdentityValuesFromRow(
      rowForIdentity,
      resolvedMarket,
      signatureValues
    );
    const ownerId = listingId ? listingOwnerByListingId[listingId] ?? "" : "";

    return {
      id: listingId,
      marketKey: resolvedMarket.market.key,
      identityValues,
      signature: normalizeText((cardRow as any)?.intention_signature ?? (resultRow as any)?.intention_signature),
      isCertified: Boolean((cardRow as any)?.is_certified ?? (resultRow as any)?.is_certified),
      status: normalizeText((cardRow as any)?.status ?? (resultRow as any)?.status),
      created_at:
        normalizeText((cardRow as any)?.created_at) ||
        normalizeText((resultRow as any)?.created_at),
      type: "sell",
      price: {
        amount: Number((cardRow as any)?.price_amount ?? 0),
        type: normalizeText((cardRow as any)?.price_type) || "fixed",
        currency: normalizeText((cardRow as any)?.currency) || "USD"
      },
      location: {
        department: (ownerId && departmentBySellerProfileId[ownerId]) || normalizeText((cardRow as any)?.department) || null,
        municipality: normalizeText((cardRow as any)?.municipality) || null
      },
      audit: {
        createdAt:
          normalizeText((cardRow as any)?.created_at) ||
          normalizeText((resultRow as any)?.created_at),
        ownerUserId: ownerId || null
      }
    };
  });

  let zeroResultsData: Record<string, unknown> | undefined;

  if (results.length === 0) {
    let ownListingExists = false;
    if (resolvedMarket.market.id) {
      const ownQueryByMarketId = await supabase
        .from("listings")
        .select("id")
        .eq("listing_type", "sell")
        .eq("status", "active")
        .eq("seller_profile_id", requesterUserId)
        .eq("intention_signature", buySearch.signature)
        .eq("market_id", resolvedMarket.market.id)
        .limit(1)
        .maybeSingle();
      ownListingExists = !ownQueryByMarketId.error && Boolean(ownQueryByMarketId.data);
    }

    if (ownListingExists) {
      return res.json({
        ok: true,
        data: {
          marketKey: resolvedMarket.market.key,
          results,
          page,
          pageSize,
          total: 0,
          reason: "ONLY_OWN_LISTINGS"
        }
      });
    }

    try {
      await requireWhatsappNumber(authToken, requesterUserId);
    } catch (whatsappGuardError: any) {
      if (String(whatsappGuardError?.code ?? "") === "WHATSAPP_REQUIRED") {
        return res.json({
          ok: true,
          data: {
            marketKey: resolvedMarket.market.key,
            results,
            page,
            pageSize,
            total: 0,
            reason: "WHATSAPP_REQUIRED"
          }
        });
      }
      logError(req, "search_whatsapp_guard_error", {
        code: whatsappGuardError?.code,
        message: whatsappGuardError?.message
      });
      return sendErrorResponse({
        res,
        status: 500,
        error: "unexpected_error",
        message: "Unexpected search error.",
        marketKey: resolvedMarket.market.key
      });
    }

    try {
      const demandResult = await createOrReuseOpenMarketDemand({
        accessToken: authToken,
        userId: requesterUserId,
        marketKey: resolvedMarket.market.key,
        payload: buySearch.normalizedPayload,
        detailsText: parsed.detailsText,
        certify: parsed.certify === "true" || parsed.certify === "1",
        supabase
      });

      zeroResultsData = {
        ...(zeroResultsData ?? {}),
        demandAction: demandResult.action,
        demandId: demandResult.demandId,
        isCertified: demandResult.isCertified,
        certificationAction: demandResult.certificationAction
      };
    } catch (error) {
      if (error instanceof MarketDemandCreationError) {
        if (error.status === 402 && error.code === "insufficient_tokens") {
          return sendErrorResponse({
            res,
            status: 402,
            error: "insufficient_tokens",
            message: "Insufficient tokens.",
            marketKey: resolvedMarket.market.key
          });
        }
        if (error.status === 400) {
          return sendErrorResponse({
            res,
            status: 400,
            error: "invalid_request",
            message: "Payload validation failed.",
            marketKey: resolvedMarket.market.key,
            issues: error.issues ?? []
          });
        }
        logError(req, "search_demand_creation_error", {
          code: error.code,
          message: error.message
        });
        return sendErrorResponse({
          res,
          status: 500,
          error: "unexpected_error",
          message: "Unexpected search error.",
          marketKey: resolvedMarket.market.key
        });
      }

      logError(req, "search_unexpected_error", {
        code: (error as any)?.code,
        message: (error as any)?.message
      });
      return sendErrorResponse({
        res,
        status: 500,
        error: "unexpected_error",
        message: "Unexpected search error.",
        marketKey: resolvedMarket.market.key
      });
    }
  }

  return res.json({
    ok: true,
    data: {
      marketKey: resolvedMarket.market.key,
      results,
      page,
      pageSize,
      total: buySearch.total,
      ...(zeroResultsData ?? {})
    }
  });
});

export default router;
