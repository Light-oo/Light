import { listingRepository } from '../../db/listingRepository';
import { getSupabaseClient } from '../../db/client';
import { badRequest } from '../../utils/errors';
import { type SearchFilterParams } from '../repositories/searchRepository';
import { SearchQueryParams } from '../validation/searchSchemas';
import { resolveProfileIdByUserId } from '../../services/profileService';

type ListingCard = {
  cardType: 'sell' | 'buy';
  what: {
    brand: string | null;
    model: string | null;
    year: number | null;
    itemType: string | null;
    partText: string | null;
  };
  price: number;
  price_type: 'fixed' | 'negotiable';
  location: { department: string | null; municipality: string | null };
  audit: { created_at: string | null };
};

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const resolveOptionFilters = async (
  query: SearchQueryParams
): Promise<{ invalid: boolean; resolved: SearchFilterParams; resolvedLabels: Record<string, string | number | null> }> => {
  const resolved: SearchFilterParams = { ...query };
  const resolvedLabels: Record<string, string | number | null> = {
    brand: null,
    model: null,
    side: null,
    position: null,
    year: null
  };

  if (query.brand) {
    if (isUuid(query.brand)) {
      const brand = await listingRepository.getBrandById(query.brand);
      if (!brand) {
        throw badRequest('invalid_query_param:brand', { param: 'brand' });
      }
      resolved.brand = brand.label_es;
      resolvedLabels.brand = brand.label_es;
    } else {
      resolved.brand = query.brand;
      resolvedLabels.brand = query.brand;
    }
  }

  if (query.model) {
    if (isUuid(query.model)) {
      const model = await listingRepository.getModelById(query.model);
      if (!model) {
        throw badRequest('invalid_query_param:model', { param: 'model' });
      }
      resolved.model = model.label_es;
      resolvedLabels.model = model.label_es;
    } else {
      resolved.model = query.model;
      resolvedLabels.model = query.model;
    }
  }

  if (query.side) {
    if (isUuid(query.side)) {
      const side = await listingRepository.getSideById(query.side);
      if (!side) {
        throw badRequest('invalid_query_param:side', { param: 'side' });
      }
      const normalized = (side as { key?: string | null }).key || side.label_es.toLowerCase();
      resolved.side = normalized;
      resolvedLabels.side = side.label_es;
    } else {
      resolved.side = query.side.toLowerCase();
      resolvedLabels.side = query.side;
    }
  }

  if (query.position) {
    if (isUuid(query.position)) {
      const position = await listingRepository.getPositionById(query.position);
      if (!position) {
        throw badRequest('invalid_query_param:position', { param: 'position' });
      }
      const normalized = (position as { key?: string | null }).key || position.label_es.toLowerCase();
      resolved.position = normalized;
      resolvedLabels.position = position.label_es;
    } else {
      resolved.position = query.position.toLowerCase();
      resolvedLabels.position = query.position;
    }
  }

  if (query.year) {
    if (isUuid(query.year)) {
      const yearOption = await listingRepository.getYearOptionById(query.year);
      if (!yearOption) {
        throw badRequest('invalid_query_param:year', { param: 'year' });
      }
      const parsed = Number(yearOption.label_es);
      if (!Number.isFinite(parsed)) {
        throw badRequest('invalid_query_param:year', { param: 'year' });
      }
      resolved.year = parsed;
      resolvedLabels.year = parsed;
    } else {
      const parsed = Number(query.year);
      if (!Number.isFinite(parsed)) {
        throw badRequest('invalid_query_param:year', { param: 'year' });
      }
      resolved.year = parsed;
      resolvedLabels.year = parsed;
    }
  }

  return { invalid: false, resolved, resolvedLabels };
};

const requireField = <T>(value: T | null | undefined, field: string): T => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`missing_field:${field}`);
  }
  return value;
};

const requireDefined = <T>(value: T | undefined, field: string): T => {
  if (value === undefined) {
    throw new Error(`missing_field:${field}`);
  }
  return value;
};

const mapMarketRowToCard = (row: any, cardType: 'sell' | 'buy'): ListingCard => {
  const price =
    cardType === 'sell'
      ? requireField<number>(row.price_amount, 'price_amount')
      : requireField<number>(row.expected_price_amount, 'expected_price_amount');
  const priceTypeRaw =
    cardType === 'buy' ? row.expected_price_type ?? row.price_type : row.price_type;
  const priceType = requireField<string>(
    priceTypeRaw,
    cardType === 'buy' ? 'expected_price_type' : 'price_type'
  );
  if (priceType !== 'fixed' && priceType !== 'negotiable') {
    throw new Error(`invalid_price_type:${priceType}`);
  }

  const year = row.year ?? row.year_from ?? row.year_to;
  if (year === undefined || year === null) {
    throw new Error('missing_field:year');
  }

  const itemTypeRaw = row.item_type ?? row.item_type_label_es ?? row.item_type_key;
  const partTextRaw = row.part_text ?? row.detail ?? row.notes ?? row.part;

  return {
    cardType,
    what: {
      brand: requireField<string>(row.brand, 'brand'),
      model: requireField<string>(row.model, 'model'),
      year: Number(year),
      itemType: requireField<string>(itemTypeRaw, 'item_type'),
      partText: requireField<string>(partTextRaw, 'part_text')
    },
    price,
    price_type: priceType === 'negotiable' ? 'negotiable' : 'fixed',
    location: {
      department: requireDefined<string | null>(row.department ?? null, 'department'),
      municipality: requireDefined<string | null>(row.municipality ?? null, 'municipality')
    },
    audit: {
      created_at: requireField<string>(row.created_at ?? row.published_at ?? row.updated_at, 'created_at')
    }
  };
};


export const searchService = {
  async searchListings(query: SearchQueryParams, context?: { userId?: string | null }) {
    const { invalid, resolved } = await resolveOptionFilters(query);
    const mode = (query.mode ?? 'BUY').toString().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const supabase = getSupabaseClient();
    const viewName = mode === 'BUY' ? 'market_cards_view' : 'market_mode_cards_view';
    const cardType: 'sell' | 'buy' = mode === 'BUY' ? 'sell' : 'buy';
    const listingType = mode === 'BUY' ? 'sell' : 'buy';
    const statusValue = mode === 'BUY' ? 'active' : 'open';

    if (invalid) {
      return { page: query.page, pageSize: query.pageSize, total: 0, nextCursor: null, results: [] };
    }

    let builder: any = supabase.from(viewName).select('*', { count: 'exact' });
    if (mode === 'BUY') {
      builder = builder.eq('listing_type', listingType);
    }
    builder = builder.eq('status', statusValue);
    if (resolved.itemTypeId) builder = builder.eq('item_type_id', resolved.itemTypeId);
    if (resolved.brand) builder = builder.eq('brand', resolved.brand);
    if (resolved.model) builder = builder.eq('model', resolved.model);
    if (resolved.year) {
      if (mode === 'BUY') {
        builder = builder.lte('year_from', resolved.year).gte('year_to', resolved.year);
      } else {
        builder = builder.eq('year', resolved.year);
      }
    }
    if (resolved.q) builder = builder.ilike('part_text', `%${resolved.q}%`);

    const start = (query.page - 1) * query.pageSize;
    const end = start + query.pageSize - 1;
    builder = builder.range(start, end);

    const { data, error, count } = await builder;
    if (error) throw error;

    const rows = (data ?? []) as any[];
    const cards = rows.map((row) => mapMarketRowToCard(row, cardType));

    if (mode === 'BUY' && cards.length === 0) {
      const expectedPrice = query.expectedPrice;
      if (expectedPrice == null) {
        throw badRequest('expected_price_required');
      }

      let profileId: string | null = null;
      if (context?.userId) {
        profileId = await resolveProfileIdByUserId(context.userId);
      }

      const payload: Record<string, any> = {
        listing_type: 'buy',
        status: 'open',
        brand: resolved.brand ?? null,
        model: resolved.model ?? null,
        year: resolved.year ?? null,
        item_type_id: resolved.itemTypeId ?? null,
        part_text: resolved.q ?? null,
        expected_price_amount: expectedPrice,
        buyer_profile_id: profileId
      };
      const { error: insertError } = await supabase.from('demands').insert(payload);
      if (insertError) throw insertError;

      return {
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
        nextCursor: null,
        results: [],
        autoCreated: true
      };
    }

    return {
      page: query.page,
      pageSize: query.pageSize,
      total: count ?? undefined,
      nextCursor: null,
      results: cards,
      autoCreated: false
    };
  }
};
