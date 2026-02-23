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

export async function fetchMyListings(accessToken: string, userId: string): Promise<MyListingRow[]> {
  const select = "id,status,created_at,pricing(price_amount,price_type,currency),item_specs(brand_id,model_id,year_id,item_type_id,part_id),listing_locations(department,municipality)";
  return supabaseGet<MyListingRow[]>(
    `listings?select=${encodeURIComponent(select)}&seller_profile_id=eq.${userId}&listing_type=eq.sell&order=created_at.desc&limit=200`,
    accessToken
  );
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
