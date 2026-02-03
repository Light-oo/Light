import { getSupabaseClient } from '../../db/client';
import { SearchQueryParams } from '../validation/searchSchemas';
import { decodeCursor, encodeCursor } from '../utils/searchCursor';

export type SearchResultRow = {
  listing_id: string;
  market_id: string;
  published_at: string;
  updated_at: string;
  quality_score: number | null;
  item_type_id: string;
  item_type_key: string;
  item_type_label_es: string;
  brand: string | null;
  model: string | null;
  year_from: number | null;
  year_to: number | null;
  side: string | null;
  position: string | null;
  price_type: string | null;
  price_amount: number | null;
  currency: string | null;
  department: string | null;
  municipality: string | null;
  price_unknown_last?: number | null;
  quality_score_sort?: number | null;
};

const VIEW_NAME = 'listing_search_view';

export const searchRepository = {
  async searchListings(query: SearchQueryParams) {
    const supabase = getSupabaseClient();
    const cursor = decodeCursor(query.cursor);

    const includeTotal = !cursor;
    const selectOptions = includeTotal ? { count: 'exact' as const } : undefined;

    let builder = supabase.from(VIEW_NAME).select('*', selectOptions);

    builder = builder.eq('status', 'active');

    if (query.marketId) builder = builder.eq('market_id', query.marketId);
    if (query.itemTypeId) builder = builder.eq('item_type_id', query.itemTypeId);

    if (query.brand) builder = builder.ilike('brand', query.brand.toLowerCase());
    if (query.model) builder = builder.ilike('model', query.model.toLowerCase());

    if (query.q) {
      const q = `%${query.q.toLowerCase()}%`;
      builder = builder.or(
        [
          `brand.ilike.${q}`,
          `model.ilike.${q}`,
          `item_type_label_es.ilike.${q}`,
          `item_type_key.ilike.${q}`
        ].join(',')
      );
    }

    if (query.year) {
      builder = builder.lte('year_from', query.year).gte('year_to', query.year);
    }

    if (query.yearFrom && query.yearTo) {
      builder = builder.gte('year_to', query.yearFrom).lte('year_from', query.yearTo);
    }

    if (query.side) builder = builder.eq('side', query.side);
    if (query.position) builder = builder.eq('position', query.position);

    if (query.department) builder = builder.ilike('department', query.department.toLowerCase());
    if (query.municipality)
      builder = builder.ilike('municipality', query.municipality.toLowerCase());

    builder = applyPriceFilters(builder, query);

    builder = applySorting(builder, query);

    if (cursor) {
      builder = applyCursor(builder, query, cursor);
    } else {
      const start = (query.page - 1) * query.pageSize;
      const end = start + query.pageSize - 1;
      builder = builder.range(start, end);
    }

    const { data, error, count } = await builder;
    if (error) throw error;

    const rows = (data ?? []) as SearchResultRow[];
    const nextCursor = rows.length === query.pageSize ? buildNextCursor(rows, query) : null;

    return { rows, count: count ?? null, nextCursor };
  }
};

const applyPriceFilters = (builder: any, query: SearchQueryParams) => {
  const hasPriceRange = query.priceMin !== undefined || query.priceMax !== undefined;
  if (!hasPriceRange) {
    if (!query.includeUnknownPrice) {
      builder = builder.neq('price_type', 'unknown');
    }
    return builder;
  }

  const min = query.priceMin ?? 0;
  const max = query.priceMax ?? Number.MAX_SAFE_INTEGER;

  if (query.includeUnknownPrice) {
    builder = builder.or(
      `price_type.eq.unknown,and(price_amount.gte.${min},price_amount.lte.${max})`
    );
  } else {
    builder = builder.neq('price_type', 'unknown').gte('price_amount', min).lte('price_amount', max);
  }

  return builder;
};

const applySorting = (builder: any, query: SearchQueryParams) => {
  switch (query.sort) {
    case 'price_asc':
      builder = builder.order('price_unknown_last', { ascending: true });
      builder = builder.order('price_amount', { ascending: true });
      builder = builder.order('published_at', { ascending: false });
      builder = builder.order('listing_id', { ascending: false });
      break;
    case 'price_desc':
      builder = builder.order('price_unknown_last', { ascending: true });
      builder = builder.order('price_amount', { ascending: false });
      builder = builder.order('published_at', { ascending: false });
      builder = builder.order('listing_id', { ascending: false });
      break;
    case 'quality':
      builder = builder.order('quality_score_sort', { ascending: false });
      builder = builder.order('published_at', { ascending: false });
      builder = builder.order('listing_id', { ascending: false });
      break;
    case 'relevance':
      builder = builder.order('published_at', { ascending: false });
      builder = builder.order('quality_score_sort', { ascending: false });
      builder = builder.order('listing_id', { ascending: false });
      break;
    case 'newest':
    default:
      builder = builder.order('published_at', { ascending: false });
      builder = builder.order('listing_id', { ascending: false });
      break;
  }
  return builder;
};

const applyCursor = (builder: any, query: SearchQueryParams, cursor: any) => {
  if (query.sort === 'price_asc' || query.sort === 'price_desc') {
    const comparator = query.sort === 'price_asc' ? 'gt' : 'lt';
    const priceAmount = cursor.priceAmount ?? 0;
    const priceUnknownLast = cursor.priceUnknownLast ?? 0;

    builder = builder.or(
      [
        `price_unknown_last.${comparator}.${priceUnknownLast}`,
        `and(price_unknown_last.eq.${priceUnknownLast},price_amount.${comparator}.${priceAmount})`,
        `and(price_unknown_last.eq.${priceUnknownLast},price_amount.eq.${priceAmount},published_at.lt.${cursor.publishedAt})`,
        `and(price_unknown_last.eq.${priceUnknownLast},price_amount.eq.${priceAmount},published_at.eq.${cursor.publishedAt},listing_id.lt.${cursor.id})`
      ].join(',')
    );

    return builder.limit(query.pageSize);
  }

  if (query.sort === 'quality') {
    const qualityScore = cursor.qualityScoreSort ?? -1;
    builder = builder.or(
      [
        `quality_score_sort.lt.${qualityScore}`,
        `and(quality_score_sort.eq.${qualityScore},published_at.lt.${cursor.publishedAt})`,
        `and(quality_score_sort.eq.${qualityScore},published_at.eq.${cursor.publishedAt},listing_id.lt.${cursor.id})`
      ].join(',')
    );
    return builder.limit(query.pageSize);
  }

  builder = builder.or(
    [
      `published_at.lt.${cursor.publishedAt}`,
      `and(published_at.eq.${cursor.publishedAt},listing_id.lt.${cursor.id})`
    ].join(',')
  );

  return builder.limit(query.pageSize);
};

const buildNextCursor = (rows: SearchResultRow[], query: SearchQueryParams) => {
  const last = rows[rows.length - 1];
  if (!last) return null;

  return encodeCursor({
    publishedAt: last.published_at,
    id: last.listing_id,
    priceAmount: last.price_amount ?? undefined,
    priceUnknownLast: last.price_unknown_last ?? undefined,
    qualityScoreSort: last.quality_score_sort ?? last.quality_score ?? undefined
  });
};
