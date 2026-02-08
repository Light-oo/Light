import { listingRepository } from '../../db/listingRepository';
import { badRequest } from '../../utils/errors';
import { searchRepository, type SearchFilterParams, type SearchResultRow } from '../repositories/searchRepository';
import { SearchQueryParams } from '../validation/searchSchemas';

type ListingCard = {
  listingId: string;
  cardType: 'listing';
  marketId: string | null;
  itemType: { id: string; key?: string; label_es?: string } | null;
  what: {
    brand?: string | null;
    model?: string | null;
    year_from?: number | null;
    year_to?: number | null;
    side?: string | null;
    position?: string | null;
    detail?: string | null;
  };
  how_much?: {
    price_type: string | null;
    price_amount: number | null;
    currency: string | null;
  } | null;
  location?: { department: string | null; municipality: string | null } | null;
  audit: { published_at: string | null; updated_at?: string | null };
  quality_score: number | null;
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

const mapRowToCard = (row: SearchResultRow, overrides?: Partial<ListingCard>): ListingCard => ({
  listingId: row.listing_id,
  cardType: 'listing',
  marketId: row.market_id,
  itemType: {
    id: row.item_type_id,
    key: row.item_type_key,
    label_es: row.item_type_label_es
  },
  what: {
    brand: row.brand,
    model: row.model,
    year_from: row.year_from,
    year_to: row.year_to,
    side: row.side,
    position: row.position
  },
  how_much: {
    price_type: row.price_type,
    price_amount: row.price_amount,
    currency: row.currency
  },
  location: {
    department: row.department,
    municipality: row.municipality
  },
  audit: {
    published_at: row.published_at,
    updated_at: row.updated_at
  },
  quality_score: row.quality_score,
  ...overrides
});


export const searchService = {
  async searchListings(query: SearchQueryParams) {
    const { invalid, resolved } = await resolveOptionFilters(query);
    const result = invalid ? { rows: [], count: 0, nextCursor: null } : await searchRepository.searchListings(resolved);
    const cards: ListingCard[] = [];

    const visibleCards = result.rows.map((row) =>
      mapRowToCard(row, {
        cardType: 'listing'
      })
    );

    cards.push(...visibleCards);

    return {
      page: query.page,
      pageSize: query.pageSize,
      total: result.count ?? undefined,
      nextCursor: result.nextCursor,
      results: cards
    };
  }
};
