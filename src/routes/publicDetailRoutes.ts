import { Router } from "express";
import { z } from "zod";
import { logError, logInfo } from "../lib/logger";
import { createSupabaseAnon, createSupabaseServiceRole } from "../lib/supabase";
import { getMarketDefinition } from "../services/marketCatalog";
import { resolveMarketConfiguration } from "../services/marketResolution";
import { createDisplayIdentityCache, parseSignatureValues, resolveDisplayIdentityValues } from "../utils/marketIdentity";

const router = Router();
const service = createSupabaseServiceRole();
const idParamSchema = z.object({
  listingId: z.string().uuid().optional(),
  demandId: z.string().uuid().optional()
});

type RawRecord = Record<string, unknown>;
type StructuredField = {
  key: string;
  label: string;
  value: string;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeNullableText(value: unknown) {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

function normalizeNumber(value: unknown) {
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

function extractRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template
    .replace(/\{([^}]+)\}/g, (_match, fieldKey: string) => values[fieldKey.trim().toLowerCase()] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildGenericLine(values: Record<string, string>) {
  const entries = Object.values(values).map((value) => value.trim()).filter((value) => value.length > 0);
  if (entries.length === 0) {
    return null;
  }
  return entries.join(" / ");
}

function buildStructuredFields(
  fields: Array<{ key: string; label: string }>,
  values: Record<string, string>
): StructuredField[] {
  const ordered: StructuredField[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const value = normalizeText(values[field.key]);
    if (!value) {
      continue;
    }
    ordered.push({
      key: field.key,
      label: normalizeText(field.label) || field.key,
      value
    });
    seen.add(field.key);
  }

  for (const [key, rawValue] of Object.entries(values)) {
    if (seen.has(key)) {
      continue;
    }
    const value = normalizeText(rawValue);
    if (!value) {
      continue;
    }
    ordered.push({
      key,
      label: key,
      value
    });
  }

  return ordered;
}

async function logListingView(
  supabase: ReturnType<typeof createSupabaseAnon>,
  listingId: string,
  viewerId: string | null
) {
  const { error } = await supabase.from("listing_views").insert({
    listing_id: listingId,
    viewer_id: viewerId
  });
  if (error) {
    throw error;
  }
}

async function logDemandView(
  req: Parameters<typeof logInfo>[0],
  supabase: ReturnType<typeof createSupabaseAnon>,
  demandId: string,
  viewerId: string | null
) {
  const { error } = await supabase.from("demand_views").insert({
    demand_id: demandId,
    viewer_id: viewerId
  });
  if (error) {
    logError(req, "public_demand_view_insert_error", {
      error,
      code: error.code,
      message: error.message,
      details: (error as any)?.details ?? null,
      hint: (error as any)?.hint ?? null,
      stack: (error as any)?.stack ?? null
    });
    throw error;
  }
  logInfo(req, "public_demand_view_insert_ok", {
    demandId,
    viewerId
  });
}

async function buildCardText(params: {
  intent: "listing" | "demand";
  identityValues: Record<string, string>;
  template?: {
    titleTemplate: string;
    subtitleTemplate?: string;
  };
}) {
  const template = params.template;

  if (template?.titleTemplate) {
    return {
      title: renderTemplate(template.titleTemplate, params.identityValues),
      subtitle: template.subtitleTemplate
        ? renderTemplate(template.subtitleTemplate, params.identityValues) || null
        : null
    };
  }

  const fallback = buildGenericLine(params.identityValues);
  return {
    title: fallback ?? (params.intent === "listing" ? "Publicación" : "Búsqueda"),
    subtitle: null
  };
}

router.get("/listings/:listingId/public", async (req, res, next) => {
  let listingId: string;
  try {
    ({ listingId } = idParamSchema.parse(req.params) as { listingId: string });
  } catch (error) {
    return next(error);
  }
  const supabase = createSupabaseAnon();
  const viewerId = null;

  logInfo(req, "public_listing_detail_client_initialized", {
    listingId,
    requestAuthorizationHeaderPresent: Boolean(req.header("authorization")),
    supabaseAccessTokenForwarded: false
  });

  logInfo(req, "public_listing_detail_select_start", { listingId });
  const { data: row, error } = await supabase
    .from("listings")
    .select(
      "id,market_id,listing_type,status,created_at,intention_signature,is_certified,pricing(price_amount),listing_locations(department,municipality)"
    )
    .eq("id", listingId)
    .eq("listing_type", "sell")
    .maybeSingle();

  if (error) {
    logError(req, "public_listing_detail_query_error", {
      code: error.code,
      message: error.message,
      details: (error as any)?.details ?? null,
      hint: (error as any)?.hint ?? null,
      stack: (error as any)?.stack ?? null
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  logInfo(req, "public_listing_detail_select_ok", {
    listingId,
    found: Boolean(row)
  });

  if (!row) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  try {
    await logListingView(supabase, listingId, viewerId);

    const marketId = normalizeText((row as RawRecord).market_id);
    const { data: marketRow, error: marketError } = await supabase
      .from("markets")
      .select("id,key")
      .eq("id", marketId)
      .maybeSingle();

    if (marketError || !marketRow) {
      throw marketError ?? new Error("market_not_found");
    }

    const marketKey = normalizeText((marketRow as RawRecord).key);
    const signature = normalizeText((row as RawRecord).intention_signature);
    const identityValues = parseSignatureValues(signature);
    const resolvedMarket = await resolveMarketConfiguration(marketKey, { supabase: supabase as any });
    const marketDefinition = await getMarketDefinition({ marketKey, supabase: supabase as any });
    const displayIdentityValues = await resolveDisplayIdentityValues({
      supabase: supabase as any,
      resolvedMarket,
      identityValues,
      cache: createDisplayIdentityCache()
    });
    const cardText = await buildCardText({
      intent: "listing",
      identityValues: displayIdentityValues,
      template: marketDefinition.cardTemplates?.sellListing
    });
    const structuredFields = buildStructuredFields(
      marketDefinition.fields.map((field) => ({ key: field.key, label: field.label })),
      displayIdentityValues
    );
    const pricing = extractRecord((row as RawRecord).pricing);
    const location = extractRecord((row as RawRecord).listing_locations);
    return res.json({
      ok: true,
      data: {
        results: {
          id: normalizeText((row as RawRecord).id),
          title: cardText.title,
          subtitle: cardText.subtitle,
          status: normalizeText((row as RawRecord).status),
          market: marketKey,
          type: normalizeText((row as RawRecord).listing_type),
          price: normalizeNumber((pricing as RawRecord | null)?.price_amount),
          location: [normalizeNullableText((location as RawRecord | null)?.department), normalizeNullableText((location as RawRecord | null)?.municipality)]
            .filter((value): value is string => Boolean(value))
            .join(", ") || null,
          published_at: normalizeNullableText((row as RawRecord).created_at),
          is_certified: Boolean((row as RawRecord).is_certified),
          structured_fields: structuredFields
        }
      }
    });
  } catch (detailError: any) {
    logError(req, "public_listing_detail_build_error", {
      code: detailError?.code,
      message: detailError?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

router.get("/demands/:demandId/public", async (req, res, next) => {
  let demandId: string;
  try {
    ({ demandId } = idParamSchema.parse(req.params) as { demandId: string });
  } catch (error) {
    return next(error);
  }
  const supabase = createSupabaseAnon();
  const viewerId = null;

  logInfo(req, "public_demand_detail_client_initialized", {
    demandId,
    requestAuthorizationHeaderPresent: Boolean(req.header("authorization")),
    supabaseAccessTokenForwarded: false
  });

  logInfo(req, "public_demand_detail_select_start", { demandId });
  const { data: row, error } = await supabase
    .from("demands")
    .select("id,market_id,status,created_at,intention_signature,details_text,is_certified")
    .eq("id", demandId)
    .maybeSingle();

  if (error) {
    logError(req, "public_demand_detail_query_error", {
      error,
      code: error.code,
      message: error.message,
      details: (error as any)?.details ?? null,
      hint: (error as any)?.hint ?? null,
      stack: (error as any)?.stack ?? null
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }

  logInfo(req, "public_demand_detail_select_ok", {
    demandId,
    found: Boolean(row)
  });

  if (!row) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  try {
    logInfo(req, "public_demand_view_insert_start", {
      demandId,
      viewerId
    });
    await logDemandView(req, supabase, demandId, viewerId);

    const marketId = normalizeText((row as RawRecord).market_id);
    logInfo(req, "public_demand_market_lookup_start", { demandId, marketId });
    const { data: marketRow, error: marketError } = await supabase
      .from("markets")
      .select("id,key")
      .eq("id", marketId)
      .maybeSingle();

    if (marketError || !marketRow) {
      throw marketError ?? new Error("market_not_found");
    }
    logInfo(req, "public_demand_market_lookup_ok", {
      demandId,
      marketId,
      marketKey: normalizeText((marketRow as RawRecord).key)
    });

    const marketKey = normalizeText((marketRow as RawRecord).key);
    const signature = normalizeText((row as RawRecord).intention_signature);
    const identityValues = parseSignatureValues(signature);
    logInfo(req, "public_demand_market_resolution_start", { demandId, marketKey });
    const resolvedMarket = await resolveMarketConfiguration(marketKey, { supabase: supabase as any });
    logInfo(req, "public_demand_market_resolution_ok", { demandId, marketKey });
    logInfo(req, "public_demand_market_definition_start", { demandId, marketKey });
    const marketDefinition = await getMarketDefinition({ marketKey, supabase: supabase as any });
    logInfo(req, "public_demand_market_definition_ok", { demandId, marketKey });
    logInfo(req, "public_demand_identity_resolution_start", { demandId, marketKey });
    const displayIdentityValues = await resolveDisplayIdentityValues({
      supabase: supabase as any,
      resolvedMarket,
      identityValues,
      cache: createDisplayIdentityCache()
    });
    logInfo(req, "public_demand_identity_resolution_ok", {
      demandId,
      marketKey,
      identityKeys: Object.keys(displayIdentityValues)
    });
    const cardText = await buildCardText({
      intent: "demand",
      identityValues: displayIdentityValues,
      template: marketDefinition.cardTemplates?.buyDemand
    });
    const structuredFields = buildStructuredFields(
      marketDefinition.fields.map((field) => ({ key: field.key, label: field.label })),
      displayIdentityValues
    );
    return res.json({
      ok: true,
      data: {
        results: {
          id: normalizeText((row as RawRecord).id),
          title: cardText.title,
          subtitle: cardText.subtitle,
          status: normalizeText((row as RawRecord).status),
          market: marketKey,
          type: "buy",
          price: null,
          location: null,
          published_at: normalizeNullableText((row as RawRecord).created_at),
          is_certified: Boolean((row as RawRecord).is_certified),
          structured_fields: structuredFields
        }
      }
    });
  } catch (detailError: any) {
    logError(req, "public_demand_detail_build_error", {
      code: detailError?.code,
      message: detailError?.message
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

export default router;
