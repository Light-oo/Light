import { config } from "./config";

export type MarketOptionRow = {
  listing_id: string;
  brand_id: string;
  brand_label_es: string;
  model_id: string;
  model_label_es: string;
  year_id: string;
  year: number;
  item_type_id: string;
  item_type_label_es: string;
  part_id: string;
  part_label_es: string;
};

type SupabaseHeadersOptions = {
  accessToken: string;
};

function supabaseHeaders(options: SupabaseHeadersOptions): Record<string, string> {
  return {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json"
  };
}

async function supabaseGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method: "GET",
    headers: supabaseHeaders({ accessToken })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((payload as any)?.message ?? `supabase_${response.status}`);
  }
  return payload as T;
}

async function supabasePatch<T>(path: string, body: unknown, accessToken: string): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders({ accessToken }),
      Prefer: "return=representation"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((payload as any)?.message ?? `supabase_${response.status}`);
  }
  return payload as T;
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    )
  );
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const next = readString(value);
    if (next) {
      return next;
    }
  }
  return null;
}

function firstYear(...values: unknown[]): number | string | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

async function fetchIdLabelMap(
  accessToken: string,
  table: string,
  idColumn: string,
  labelColumn: string,
  ids: string[]
): Promise<Record<string, string>> {
  if (ids.length === 0) {
    return {};
  }

  const filter = `${idColumn}=in.(${ids.join(",")})`;
  const rows = await supabaseGet<Array<Record<string, unknown>>>(
    `${table}?select=${encodeURIComponent(`${idColumn},${labelColumn}`)}&${filter}`,
    accessToken
  );

  return rows.reduce<Record<string, string>>((acc, row) => {
    const id = readString(row[idColumn]);
    const label = readString(row[labelColumn]);
    if (id && label) {
      acc[id] = label;
    }
    return acc;
  }, {});
}

async function fetchYearMap(accessToken: string, yearIds: string[]): Promise<Record<string, number | string>> {
  if (yearIds.length === 0) {
    return {};
  }

  const filter = `id=in.(${yearIds.join(",")})`;
  const rows = await supabaseGet<Array<Record<string, unknown>>>(
    `year_options?select=${encodeURIComponent("id,year")}&${filter}`,
    accessToken
  );

  return rows.reduce<Record<string, number | string>>((acc, row) => {
    const id = readString(row.id);
    const year = firstYear(row.year);
    if (id && year !== null) {
      acc[id] = year;
    }
    return acc;
  }, {});
}

async function fetchListingPriceMap(accessToken: string, listingIds: string[]): Promise<Record<string, number>> {
  if (listingIds.length === 0) {
    return {};
  }

  const chunks: string[][] = [];
  for (let i = 0; i < listingIds.length; i += 50) {
    chunks.push(listingIds.slice(i, i + 50));
  }

  const priceMap: Record<string, number> = {};

  const applyRows = (rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      const listingId = firstString(row.listing_id);
      const priceAmount = firstYear(row.price_amount);
      const numeric =
        typeof priceAmount === "number"
          ? priceAmount
          : typeof priceAmount === "string"
            ? Number(priceAmount)
            : NaN;
      if (!listingId || !Number.isFinite(numeric)) {
        continue;
      }
      if (priceMap[listingId] === undefined) {
        priceMap[listingId] = numeric;
      }
    }
  };

  for (const chunk of chunks) {
    const inClause = chunk.map((id) => `%22${encodeURIComponent(id)}%22`).join(",");
    const pricingRows = await supabaseGet<Array<Record<string, unknown>>>(
      `pricing?select=${encodeURIComponent("listing_id,price_amount,currency,price_type")}&listing_id=in.(${inClause})`,
      accessToken
    );
    applyRows(pricingRows);
  }

  const missingListingIds = listingIds.filter((id) => priceMap[id] === undefined);
  if (missingListingIds.length > 0) {
    const fallbackChunks: string[][] = [];
    for (let i = 0; i < missingListingIds.length; i += 50) {
      fallbackChunks.push(missingListingIds.slice(i, i + 50));
    }

    for (const chunk of fallbackChunks) {
      const inClause = chunk.map((id) => `%22${encodeURIComponent(id)}%22`).join(",");
      const fallbackRows = await supabaseGet<Array<Record<string, unknown>>>(
        `market_sell_cards_view?select=${encodeURIComponent("listing_id,price_amount")}&listing_id=in.(${inClause})`,
        accessToken
      );
      applyRows(fallbackRows);
    }
  }

  return priceMap;
}

export async function fetchMarketOptions(accessToken: string): Promise<MarketOptionRow[]> {
  const select = [
    "listing_id",
    "brand_id",
    "brand_label_es",
    "model_id",
    "model_label_es",
    "year_id",
    "year",
    "item_type_id",
    "item_type_label_es",
    "part_id",
    "part_label_es"
  ].join(",");

  return supabaseGet<MarketOptionRow[]>(
    `market_sell_cards_view?select=${encodeURIComponent(select)}&order=created_at.desc&limit=1000`,
    accessToken
  );
}

export type ProfileRow = {
  id: string;
  role: "buyer" | "seller" | string;
  tokens: number;
  whatsapp_e164: string | null;
};

export async function fetchProfile(accessToken: string, userId: string): Promise<ProfileRow | null> {
  const rows = await supabaseGet<ProfileRow[]>(
    `profiles?select=id,role,tokens,whatsapp_e164&id=eq.${userId}&limit=1`,
    accessToken
  );

  return rows[0] ?? null;
}

export type MyListingRow = {
  id: string;
  status: "active" | "inactive" | string;
  created_at: string;
  brand_label_es: string | null;
  model_label_es: string | null;
  part_label_es: string | null;
  year: number | string | null;
  price_amount?: number | string | null;
  listing_price?: number | string | null;
  price?: number | string | null;
  pricing:
    | {
      price_amount: number;
      price_type: string;
      currency: string;
    }
    | Array<{
      price_amount: number;
      price_type: string;
      currency: string;
    }>
    | null;
  item_specs: {
    brand_id: string;
    model_id: string;
    year_id: string;
    item_type_id: string;
    part_id: string;
    brand_label_es?: string | null;
    model_label_es?: string | null;
    part_label_es?: string | null;
    year?: number | string | null;
  } | null;
  listing_locations:
    | {
      department: string;
      municipality: string;
    }
    | Array<{
      department: string;
      municipality: string;
    }>
    | null;
};

function extractListingSpecs(row: Record<string, unknown>): Record<string, unknown> | null {
  const specs = row.item_specs;
  if (Array.isArray(specs)) {
    const first = specs[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  return specs && typeof specs === "object" ? (specs as Record<string, unknown>) : null;
}

function extractListingIds(row: Record<string, unknown>) {
  const specs = extractListingSpecs(row);
  return {
    brandId: firstString(specs?.brand_id, row.brand_id),
    modelId: firstString(specs?.model_id, row.model_id),
    yearId: firstString(specs?.year_id, row.year_id),
    partId: firstString(specs?.part_id, row.part_id)
  };
}

async function fetchCatalogMapsForIds(
  accessToken: string,
  ids: { brandIds: string[]; modelIds: string[]; yearIds: string[]; partIds: string[] }
) {
  const [brandMap, modelMap, partMap, yearMap] = await Promise.all([
    fetchIdLabelMap(accessToken, "brands", "id", "label_es", ids.brandIds),
    fetchIdLabelMap(accessToken, "models", "id", "label_es", ids.modelIds),
    fetchIdLabelMap(accessToken, "parts", "id", "label_es", ids.partIds),
    fetchYearMap(accessToken, ids.yearIds)
  ]);

  return { brandMap, modelMap, partMap, yearMap };
}

function normalizeListingRow(
  row: Record<string, unknown>,
  maps: {
    brandMap: Record<string, string>;
    modelMap: Record<string, string>;
    partMap: Record<string, string>;
    yearMap: Record<string, number | string>;
  },
  listingPriceMap: Record<string, number>
): MyListingRow {
  const specs = extractListingSpecs(row);
  const { brandId, modelId, yearId, partId } = extractListingIds(row);
  const listingId = firstString(row.id);

  const partLabel = firstString(
    row.part_label_es,
    (row.part as any)?.label_es,
    specs?.part_label_es,
    (specs?.part as any)?.label_es,
    partId ? maps.partMap[partId] : null
  );
  const brandLabel = firstString(
    row.brand_label_es,
    (row.brand as any)?.label_es,
    specs?.brand_label_es,
    (specs?.brand as any)?.label_es,
    brandId ? maps.brandMap[brandId] : null
  );
  const modelLabel = firstString(
    row.model_label_es,
    (row.model as any)?.label_es,
    specs?.model_label_es,
    (specs?.model as any)?.label_es,
    modelId ? maps.modelMap[modelId] : null
  );
  const year = firstYear(
    row.year,
    (row.year_option as any)?.year,
    specs?.year,
    (specs?.year_option as any)?.year,
    yearId ? maps.yearMap[yearId] : null
  );

  const nestedPrice = Array.isArray(row.pricing)
    ? (row.pricing[0] as any)?.price_amount
    : (row.pricing as any)?.price_amount;
  const directPrice = firstYear(row.price_amount, row.listing_price, row.price, nestedPrice);
  const mappedPrice = listingId ? listingPriceMap[listingId] : undefined;
  const normalizedPrice =
    typeof directPrice === "number"
      ? directPrice
      : typeof directPrice === "string" && directPrice.trim()
        ? Number(directPrice)
        : mappedPrice;

  return {
    ...(row as unknown as MyListingRow),
    item_specs: specs as any,
    brand_label_es: brandLabel,
    model_label_es: modelLabel,
    part_label_es: partLabel,
    year,
    price_amount: Number.isFinite(normalizedPrice as number) ? Number(normalizedPrice) : null
  };
}

export async function fetchMyListings(accessToken: string, userId: string): Promise<MyListingRow[]> {
  const select = "*,pricing(price_amount,price_type,currency),item_specs(*),listing_locations(department,municipality)";
  const rows = await supabaseGet<Array<Record<string, unknown>>>(
    `listings?select=${encodeURIComponent(select)}&seller_profile_id=eq.${userId}&listing_type=eq.sell&order=created_at.desc&limit=200`,
    accessToken
  );

  const ids = rows.reduce<{
    brandIds: Array<string | null>;
    modelIds: Array<string | null>;
    yearIds: Array<string | null>;
    partIds: Array<string | null>;
  }>(
    (acc, row) => {
      const extracted = extractListingIds(row);
      acc.brandIds.push(extracted.brandId);
      acc.modelIds.push(extracted.modelId);
      acc.yearIds.push(extracted.yearId);
      acc.partIds.push(extracted.partId);
      return acc;
    },
    {
      brandIds: [] as Array<string | null>,
      modelIds: [] as Array<string | null>,
      yearIds: [] as Array<string | null>,
      partIds: [] as Array<string | null>
    }
  );

  const maps = await fetchCatalogMapsForIds(accessToken, {
    brandIds: uniqueIds(ids.brandIds),
    modelIds: uniqueIds(ids.modelIds),
    yearIds: uniqueIds(ids.yearIds),
    partIds: uniqueIds(ids.partIds)
  });
  const listingPriceMap = await fetchListingPriceMap(
    accessToken,
    uniqueIds(rows.map((row) => firstString(row.id)))
  );

  return rows.map((row) => normalizeListingRow(row, maps, listingPriceMap));
}

export type MyDemandRow = {
  id: string;
  status: "open" | "inactive" | "closed" | "cancelled" | string;
  created_at: string;
  brand_label_es: string | null;
  model_label_es: string | null;
  part_label_es: string | null;
  year: number | string | null;
  brand_id: string;
  model_id: string;
  year_id: string;
  item_type_id: string;
  part_id: string;
};

function normalizeDemandRow(
  row: Record<string, unknown>,
  maps: {
    brandMap: Record<string, string>;
    modelMap: Record<string, string>;
    partMap: Record<string, string>;
    yearMap: Record<string, number | string>;
  }
): MyDemandRow {
  const brandId = firstString(row.brand_id);
  const modelId = firstString(row.model_id);
  const yearId = firstString(row.year_id);
  const partId = firstString(row.part_id);

  const partLabel = firstString(
    row.part_label_es,
    (row.part as any)?.label_es,
    partId ? maps.partMap[partId] : null
  );
  const brandLabel = firstString(
    row.brand_label_es,
    (row.brand as any)?.label_es,
    brandId ? maps.brandMap[brandId] : null
  );
  const modelLabel = firstString(
    row.model_label_es,
    (row.model as any)?.label_es,
    modelId ? maps.modelMap[modelId] : null
  );
  const year = firstYear(
    row.year,
    (row.year_option as any)?.year,
    yearId ? maps.yearMap[yearId] : null
  );

  return {
    ...(row as unknown as MyDemandRow),
    brand_label_es: brandLabel,
    model_label_es: modelLabel,
    part_label_es: partLabel,
    year,
    brand_id: brandId ?? "",
    model_id: modelId ?? "",
    year_id: yearId ?? "",
    part_id: partId ?? "",
    item_type_id: firstString(row.item_type_id) ?? ""
  };
}

export async function fetchMyDemands(accessToken: string, userId: string): Promise<MyDemandRow[]> {
  const select = "*";
  const rows = await supabaseGet<Array<Record<string, unknown>>>(
    `demands?select=${encodeURIComponent(select)}&requester_user_id=eq.${userId}&order=created_at.desc&limit=200`,
    accessToken
  );

  const maps = await fetchCatalogMapsForIds(accessToken, {
    brandIds: uniqueIds(rows.map((row) => firstString(row.brand_id))),
    modelIds: uniqueIds(rows.map((row) => firstString(row.model_id))),
    yearIds: uniqueIds(rows.map((row) => firstString(row.year_id))),
    partIds: uniqueIds(rows.map((row) => firstString(row.part_id)))
  });

  return rows.map((row) => normalizeDemandRow(row, maps));
}

export async function setMyDemandInactive(accessToken: string, userId: string, demandId: string): Promise<boolean> {
  for (const nextStatus of ["inactive", "closed", "cancelled"]) {
    try {
      const updatedRows = await supabasePatch<Array<{ id: string }>>(
        `demands?id=eq.${demandId}&requester_user_id=eq.${userId}&status=eq.open`,
        { status: nextStatus },
        accessToken
      );
      return Array.isArray(updatedRows) && updatedRows.length > 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("demands_status_check")) {
        continue;
      }
      throw err;
    }
  }

  throw new Error("demands_status_check");
}

export type ActiveListingPriceRow = {
  listing_id: string;
  price_amount: number;
  currency: string;
};

export async function fetchActiveListingPrices(accessToken: string): Promise<Record<string, ActiveListingPriceRow>> {
  const rows = await supabaseGet<ActiveListingPriceRow[]>(
    "market_sell_cards_view?select=listing_id,price_amount,currency&limit=1000",
    accessToken
  );

  return rows.reduce<Record<string, ActiveListingPriceRow>>((acc, row) => {
    acc[row.listing_id] = row;
    return acc;
  }, {});
}
