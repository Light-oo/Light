import { Router } from "express";
import { logSystemError } from "../lib/logger";
import { createSupabaseServiceRole } from "../lib/supabase";
import { resolveMarketConfiguration, type ResolvedMarket } from "../services/marketResolution";
import { parseSignatureValues, resolveDisplayIdentityValues } from "../utils/marketIdentity";

const router = Router();

type RawRecord = Record<string, unknown>;

type LandingDemandRow = {
  id: string;
  market_id: string | null;
  is_certified: boolean | null;
  status: string | null;
  created_at: string | null;
  intention_signature: string | null;
  details_text: string | null;
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

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    )
  );
}

async function buildResolvedMarketMap(marketKeys: string[]) {
  const uniqueMarketKeys = uniqueNonEmpty(marketKeys);
  const entries = await Promise.all(
    uniqueMarketKeys.map(async (marketKey) => {
      const resolved = await resolveMarketConfiguration(marketKey);
      return [marketKey, resolved] as const;
    })
  );
  return new Map<string, ResolvedMarket>(entries);
}

async function buildMarketKeyByIdMap(
  supabase: ReturnType<typeof createSupabaseServiceRole>,
  marketIds: Array<string | null | undefined>
) {
  const uniqueMarketIds = uniqueNonEmpty(marketIds);
  if (uniqueMarketIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await supabase
    .from("markets")
    .select("id,key")
    .in("id", uniqueMarketIds);

  if (error) {
    throw error;
  }

  const out = new Map<string, string>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const id = normalizeText((row as any).id);
    const key = normalizeText((row as any).key);
    if (id && key) {
      out.set(id, key);
    }
  }
  return out;
}

router.get("/landing/latest-demands", async (_req, res) => {
  try {
    const supabase = createSupabaseServiceRole();
    const { data, error } = await supabase
      .from("demands")
      .select("id,market_id,is_certified,status,created_at,intention_signature,details_text")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) {
      logSystemError("landing_latest_demands_query_error", {
        code: error.code,
        message: error.message,
        details: (error as any)?.details,
        hint: (error as any)?.hint
      });
      return res.status(500).json({ ok: false, error: "unexpected_error" });
    }

    const rows = (data ?? []) as LandingDemandRow[];
    const marketKeyById = await buildMarketKeyByIdMap(
      supabase,
      rows.map((row) => normalizeText(row.market_id))
    );
    const resolvedMarketByKey = await buildResolvedMarketMap(
      rows.map((row) => marketKeyById.get(normalizeText(row.market_id)) ?? "")
    );

    const payload = await Promise.all(
      rows.map(async (row) => {
        const marketKey = marketKeyById.get(normalizeText(row.market_id)) ?? "";
        const signature = normalizeText(row.intention_signature);
        const identityValues = parseSignatureValues(signature);
        const resolvedMarket = resolvedMarketByKey.get(marketKey);
        const displayIdentityValues = resolvedMarket
          ? await resolveDisplayIdentityValues({ supabase: supabase as any, resolvedMarket, identityValues })
          : identityValues;

        return {
          id: normalizeText(row.id),
          marketKey,
          identityValues: displayIdentityValues,
          signature,
          isCertified: Boolean(row.is_certified),
          status: normalizeNullableText(row.status),
          created_at: normalizeNullableText(row.created_at),
          request: {
            detailsText: normalizeNullableText(row.details_text)
          }
        };
      })
    );

    return res.json({
      ok: true,
      data: {
        results: payload
      }
    });
  } catch (error: any) {
    logSystemError("landing_latest_demands_error", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      stack: error?.stack
    });
    return res.status(500).json({ ok: false, error: "unexpected_error" });
  }
});

export default router;
