import { getSupabaseClient } from './client';
import {
  ItemSpec,
  Listing,
  ListingLocation,
  Pricing,
  Seller,
  ItemType,
  ItemTypeRule,
  Market,
  ContactAccess
} from '../domain/types';

export const listingRepository = {
  async createDraftListing(payload: { market_id?: string | null; source?: string | null }) {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('listings')
      .insert({
        status: 'draft',
        market_id: payload.market_id ?? null,
        source: payload.source ?? null,
        created_at: now,
        updated_at: now
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as Listing;
  },
  async getListingById(id: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('listings').select('*').eq('id', id).single();
    if (error) throw error;
    return data as Listing;
  },
  async updateListing(id: string, updates: Partial<Listing>) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('listings')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data as Listing;
  },
  async upsertItemSpec(spec: ItemSpec) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('item_specs')
      .upsert(spec, { onConflict: 'listing_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data as ItemSpec;
  },
  async upsertPricing(pricing: Pricing) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('pricing')
      .upsert(pricing, { onConflict: 'listing_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data as Pricing;
  },
  async upsertLocation(location: ListingLocation) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('listing_locations')
      .upsert(location, { onConflict: 'listing_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data as ListingLocation;
  },
  async upsertSellerByWhatsapp(payload: {
    whatsapp_e164: string;
    name?: string | null;
    seller_type?: string | null;
  }) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('sellers')
      .upsert(
        {
          whatsapp_e164: payload.whatsapp_e164,
          name: payload.name ?? null,
          seller_type: payload.seller_type ?? null
        },
        { onConflict: 'whatsapp_e164' }
      )
      .select('*')
      .single();
    if (error) throw error;
    return data as Seller;
  },
  async getItemSpec(listingId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('item_specs')
      .select('*')
      .eq('listing_id', listingId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as ItemSpec | null;
  },
  async getPricing(listingId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('pricing')
      .select('*')
      .eq('listing_id', listingId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as Pricing | null;
  },
  async getLocation(listingId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('listing_locations')
      .select('*')
      .eq('listing_id', listingId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as ListingLocation | null;
  },
  async getSellerById(id: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('sellers').select('*').eq('id', id).single();
    if (error) throw error;
    return data as Seller;
  },
  async getItemType(itemTypeId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('item_types')
      .select('*')
      .eq('id', itemTypeId)
      .single();
    if (error) throw error;
    return data as ItemType;
  },
  async getItemTypeRule(itemTypeId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('item_type_rules')
      .select('*')
      .eq('item_type_id', itemTypeId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as ItemTypeRule | null;
  },
  async getMarkets(activeOnly: boolean) {
    const supabase = getSupabaseClient();
    let query = supabase.from('markets').select('*').order('sort_order');
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Market[];
  },
  async getItemTypes(marketId: string | null, activeOnly: boolean) {
    const supabase = getSupabaseClient();
    let query = supabase.from('item_types').select('*').order('sort_order');
    if (marketId) query = query.eq('market_id', marketId);
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as ItemType[];
  },
  async getItemTypeRules(itemTypeId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('item_type_rules')
      .select('*')
      .eq('item_type_id', itemTypeId)
      .single();
    if (error) throw error;
    return data as ItemTypeRule;
  },
  async createContactAccess(payload: {
    listing_id: string;
    requester_user_id: string;
    token_cost: number;
    paid_at: string;
    revealed_at: string;
    channel?: string | null;
  }) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('contact_access')
      .insert({
        listing_id: payload.listing_id,
        requester_user_id: payload.requester_user_id,
        token_cost: payload.token_cost,
        paid_at: payload.paid_at,
        revealed_at: payload.revealed_at,
        channel: payload.channel ?? null
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as ContactAccess;
  }
};
