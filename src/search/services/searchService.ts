import { listingRepository } from '../../db/listingRepository';
import { getSupabaseClient } from '../../db/client';
import { badRequest } from '../../utils/errors';
import { type SearchFilterParams } from '../repositories/searchRepository';
import { SearchQueryParams } from '../validation/searchSchemas';

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

const mapMarketRowToCard = (row: any, cardType: 'sell' | 'buy'): ListingCard | null => {
  const price =
    cardType === 'sell'
      ? row.price_amount ?? row.price ?? null
      : row.expected_price_amount ?? row.price_amount ?? null;
  const priceType =
    row.price_type ?? row.expected_price_type ?? (row.negotiable ? 'negotiable' : 'fixed');

  if (price == null) {
    return null;
  }

  return {
    cardType,
    what: {
      brand: row.brand ?? null,
      model: row.model ?? null,
      year: row.year ?? row.year_from ?? null,
      itemType: row.item_type_label_es ?? row.item_type_key ?? row.item_type ?? null,
      partText: row.part_text ?? row.part ?? row.detail ?? row.notes ?? null
    },
    price,
    price_type: priceType === 'negotiable' ? 'negotiable' : 'fixed',
    location: {
      department: row.department ?? null,
      municipality: row.municipality ?? null
    },
    audit: {
      created_at: row.created_at ?? row.published_at ?? row.updated_at ?? null
    }
  };
};


export const searchService = {
  async searchListings(query: SearchQueryParams, context?: { userId?: string | null }) {
    const { invalid, resolved } = await resolveOptionFilters(query);
    const mode = (query.mode ?? 'BUY').toString().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const supabase = getSupabaseClient();
    const sellView = 'market_cards_view';
    const buyView = 'market_mode_cards_view';

    if (invalid) {
      return { page: query.page, pageSize: query.pageSize, total: 0, nextCursor: null, results: [] };
    }

    const applyFilters = (builder: any) => {
      if (resolved.itemTypeId) builder = builder.eq('item_type_id', resolved.itemTypeId);
      if (resolved.brand) builder = builder.ilike('brand', resolved.brand.toLowerCase());
      if (resolved.model) builder = builder.ilike('model', resolved.model.toLowerCase());
      if (resolved.year) builder = builder.eq('year', resolved.year);
      if (resolved.side) builder = builder.eq('side', resolved.side);
      if (resolved.position) builder = builder.eq('position', resolved.position);
      if (resolved.q) {
        const q = `%${resolved.q.toLowerCase()}%`;
        builder = builder.or([`part_text.ilike.${q}`, `detail.ilike.${q}`, `notes.ilike.${q}`].join(','));
      }
      return builder;
    };

    const start = (query.page - 1) * query.pageSize;
    const end = start + query.pageSize - 1;

    let sellBuilder: any = supabase.from(sellView).select('*', { count: 'exact' });
    sellBuilder = sellBuilder.eq('listing_type', 'sell').eq('status', 'active');
    sellBuilder = applyFilters(sellBuilder);
    if (mode === 'SELL') {
      const min = resolved.priceMin ?? undefined;
      const max = resolved.priceMax ?? undefined;
      if (min !== undefined) sellBuilder = sellBuilder.gte('price_amount', min);
      if (max !== undefined) sellBuilder = sellBuilder.lte('price_amount', max);
    }
    sellBuilder = sellBuilder.range(start, end);

    let buyBuilder: any = supabase.from(buyView).select('*', { count: 'exact' });
    buyBuilder = buyBuilder.eq('listing_type', 'buy').eq('status', 'open');
    buyBuilder = applyFilters(buyBuilder);
    buyBuilder = buyBuilder.range(start, end);

    const [{ data: sellData, error: sellError, count: sellCount }, { data: buyData, error: buyError, count: buyCount }] =
      await Promise.all([sellBuilder, buyBuilder]);
    if (sellError) throw sellError;
    if (buyError) throw buyError;

    const sellCards = (sellData ?? [])
      .map((row: any) => mapMarketRowToCard(row, 'sell'))
      .filter(Boolean) as ListingCard[];
    const buyCards = (buyData ?? [])
      .map((row: any) => mapMarketRowToCard(row, 'buy'))
      .filter(Boolean) as ListingCard[];

    const cards = [...sellCards, ...buyCards];

    if (mode === 'BUY' && sellCards.length === 0) {
      const expectedPrice = query.expectedPrice;
      if (expectedPrice == null) {
        throw badRequest('expected_price_required');
      }

      const payload: Record<string, any> = {
        listing_type: 'buy',
        status: 'open',
        brand: resolved.brand ?? null,
        model: resolved.model ?? null,
        year: resolved.year ?? null,
        item_type_id: resolved.itemTypeId ?? null,
        part_text: resolved.q ?? null,
        expected_price_amount: expectedPrice
      };
      if (context?.userId) {
        payload.buyer_profile_id = context.userId;
      }

      const { error: insertError } = await supabase.from('demands').insert(payload);
      if (insertError) throw insertError;
    }

    return {
      page: query.page,
      pageSize: query.pageSize,
      total: (sellCount ?? 0) + (buyCount ?? 0),
      nextCursor: null,
      results: cards
    };
  }
};
