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
  ContactAccess,
  Brand,
  Model,
  Side,
  Position,
  YearOption
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
  async getPricingByListingIds(listingIds: string[]) {
    if (!listingIds.length) return [];
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('pricing')
      .select('listing_id, price_type, price_amount, currency, hide_price')
      .in('listing_id', listingIds);
    if (error) throw error;
    return (data ?? []) as Pricing[];
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
  async getBrands(activeOnly: boolean) {
    const supabase = getSupabaseClient();
    let query = supabase.from('brands').select('*').order('sort_order');
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Brand[];
  },
  async getModels(brandId: string | null, activeOnly: boolean) {
    const supabase = getSupabaseClient();
    let query = supabase.from('models').select('*').order('sort_order');
    if (brandId) query = query.eq('brand_id', brandId);
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Model[];
  },
  async getSides(activeOnly: boolean) {
    const supabase = getSupabaseClient();
    let query = supabase.from('sides').select('*').order('sort_order');
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Side[];
  },
  async getPositions(activeOnly: boolean) {
    const supabase = getSupabaseClient();
    let query = supabase.from('positions').select('*').order('sort_order');
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Position[];
  },
  async getYearOptions(activeOnly: boolean) {
    const supabase = getSupabaseClient();
    let query = supabase.from('year_options').select('*').order('sort_order');
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as YearOption[];
  },
  async getBrandById(id: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as Brand | null;
  },
  async getModelById(id: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('models')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as Model | null;
  },
  async getSideById(id: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('sides')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as Side | null;
  },
  async getPositionById(id: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as Position | null;
  },
  async getYearOptionById(id: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('year_options')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as YearOption | null;
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
  },
  async getContactAccess(listingId: string, requesterUserId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('contact_access')
      .select('*')
      .eq('listing_id', listingId)
      .eq('requester_user_id', requesterUserId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as ContactAccess | null;
  },
  async getHiddenQueueItems(bucketKey: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('hidden_price_queue_items')
      .select('bucket_key, listing_id, queue_rank, last_served_at')
      .eq('bucket_key', bucketKey)
      .order('queue_rank', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{
      bucket_key: string;
      listing_id: string;
      queue_rank: number;
      last_served_at: string | null;
    }>;
  },
  async getHiddenBucketFront(bucketKey: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('hidden_bucket_front', { bucket_key: bucketKey });
    if (error) throw error;
    if (Array.isArray(data)) {
      return data[0] ?? null;
    }
    return data ?? null;
  },
  async rotateHiddenBucketAfterReveal(bucketKey: string, listingId: string) {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('hidden_bucket_rotate_after_reveal', {
      bucket_key: bucketKey,
      served_listing_id: listingId
    });
    if (error) throw error;
  },
  async getHiddenBucketKeyByListingId(listingId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('hidden_price_queue_items')
      .select('bucket_key')
      .eq('listing_id', listingId)
      .maybeSingle();
    if (error) throw error;
    return (data?.bucket_key ?? null) as string | null;
  }
};
