import { getSupabaseClient } from '../../db/client';
import { listingRepository } from '../../db/listingRepository';
import { searchRepository, type SearchFilterParams, type SearchResultRow } from '../repositories/searchRepository';
import { SearchQueryParams } from '../validation/searchSchemas';

type ListingCard = {
  listingId: string;
  cardType: 'listing' | 'hidden_price' | 'actionable';
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

const buildBucketKey = (query: SearchQueryParams) => {
  const pairs: Array<[string, string]> = [];
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    const str = String(value).trim();
    if (!str) return;
    pairs.push([key, str]);
  };

  add('marketId', query.marketId);
  add('itemTypeId', query.itemTypeId);
  add('brand', query.brand);
  add('model', query.model);
  add('year', query.year);
  add('side', query.side);
  add('position', query.position);
  add('department', query.department);
  add('municipality', query.municipality);
  add('q', query.q);

  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('|');
};

const hashString = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
};

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
    const brand = await listingRepository.getBrandById(query.brand);
    if (!brand) return { invalid: true, resolved, resolvedLabels };
    resolved.brand = brand.label_es;
    resolvedLabels.brand = brand.label_es;
  }

  if (query.model) {
    const model = await listingRepository.getModelById(query.model);
    if (!model) return { invalid: true, resolved, resolvedLabels };
    resolved.model = model.label_es;
    resolvedLabels.model = model.label_es;
  }

  if (query.side) {
    const side = await listingRepository.getSideById(query.side);
    if (!side) return { invalid: true, resolved, resolvedLabels };
    resolved.side = side.id;
    resolvedLabels.side = side.label_es;
  }

  if (query.position) {
    const position = await listingRepository.getPositionById(query.position);
    if (!position) return { invalid: true, resolved, resolvedLabels };
    resolved.position = position.id;
    resolvedLabels.position = position.label_es;
  }

  if (query.year) {
    const yearOption = await listingRepository.getYearOptionById(query.year);
    if (!yearOption) return { invalid: true, resolved, resolvedLabels };
    const parsed = Number(yearOption.label_es);
    if (!Number.isFinite(parsed)) return { invalid: true, resolved, resolvedLabels };
    resolved.year = parsed;
    resolvedLabels.year = parsed;
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

const fetchDemandTimestamp = async (query: SearchQueryParams) => {
  try {
    const db = getSupabaseClient();
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const applyFilters = (builder: any) => {
      if (query.marketId) builder = builder.eq('market_id', query.marketId);
      if (query.itemTypeId) builder = builder.eq('item_type_id', query.itemTypeId);
      if (query.brand) builder = builder.eq('brand', query.brand);
      if (query.model) builder = builder.eq('model', query.model);
      if (query.year) builder = builder.eq('year', query.year);
      if (query.side) builder = builder.eq('side', query.side);
      if (query.position) builder = builder.eq('position', query.position);
      if (query.department) builder = builder.eq('department', query.department);
      if (query.municipality) builder = builder.eq('municipality', query.municipality);
      return builder;
    };

    let active = db.from('demands').select('created_at').gt('created_at', cutoff).order('created_at', { ascending: false }).limit(1);
    active = applyFilters(active);
    const { data: activeData, error: activeError } = await active;
    if (activeError) throw activeError;
    if (activeData && activeData.length > 0) {
      return activeData[0].created_at ?? null;
    }

    let fifo = db.from('demands').select('created_at').lte('created_at', cutoff).order('created_at', { ascending: true }).limit(1);
    fifo = applyFilters(fifo);
    const { data: fifoData, error: fifoError } = await fifo;
    if (fifoError) throw fifoError;
    if (fifoData && fifoData.length > 0) {
      return fifoData[0].created_at ?? null;
    }
  } catch {
    return null;
  }

  return null;
};

const buildActionableCard = async (query: SearchQueryParams, labels: Record<string, string | number | null>) => {
  const bucketKey = buildBucketKey(query);
  const stamp = await fetchDemandTimestamp(query);
  const listingId = `actionable:${hashString(bucketKey)}`;
  const itemType = query.itemTypeId ? await listingRepository.getItemType(query.itemTypeId) : null;

  return {
    listingId,
    cardType: 'actionable',
    marketId: query.marketId ?? null,
    itemType: itemType
      ? { id: itemType.id, key: itemType.key, label_es: itemType.label_es }
      : null,
    what: {
      brand: (labels.brand as string | null) ?? null,
      model: (labels.model as string | null) ?? null,
      year_from: typeof labels.year === 'number' ? labels.year : null,
      year_to: typeof labels.year === 'number' ? labels.year : null,
      side: (labels.side as string | null) ?? null,
      position: (labels.position as string | null) ?? null,
      detail: null
    },
    how_much: null,
    location: null,
    audit: {
      published_at: stamp ?? new Date().toISOString()
    },
    quality_score: 0
  } as ListingCard;
};

export const searchService = {
  async searchListings(query: SearchQueryParams) {
    const bucketKey = buildBucketKey(query);
    const { invalid, resolved, resolvedLabels } = await resolveOptionFilters(query);

    const result = invalid ? { rows: [], count: 0, nextCursor: null } : await searchRepository.searchListings(resolved);
    const hiddenQueueItems = bucketKey ? await listingRepository.getHiddenQueueItems(bucketKey) : [];
    const hiddenListingIds = new Set(hiddenQueueItems.map((item) => item.listing_id));
    const pricingRows = await listingRepository.getPricingByListingIds(result.rows.map((row) => row.listing_id));
    const hidePriceMap = new Map(pricingRows.map((row) => [row.listing_id, Boolean(row.hide_price)]));

    const hasHiddenQueue = hiddenQueueItems.length >= 2;
    const visibleRows = result.rows.filter((row) => !hasHiddenQueue || !hiddenListingIds.has(row.listing_id));

    const cards: ListingCard[] = [];
    const weakResults = visibleRows.length === 0;

    if (weakResults) {
      cards.push(await buildActionableCard(query, resolvedLabels));
    }

    if (hasHiddenQueue && bucketKey) {
      try {
        const front = await listingRepository.getHiddenBucketFront(bucketKey);
        const listingId = front?.listing_id ?? front?.listingId ?? null;
        if (listingId) {
          const row = await searchRepository.getListingById(listingId);
          if (row) {
            cards.push(
              mapRowToCard(row, {
                cardType: 'hidden_price',
                how_much: null
              })
            );
          }
        }
      } catch {
        // ignore hidden card if queue lookup fails
      }
    }

    const visibleCards = visibleRows.map((row) => {
      const isHiddenSingle = hiddenListingIds.has(row.listing_id) && !hasHiddenQueue;
      const shouldHide = isHiddenSingle || hidePriceMap.get(row.listing_id) === true;
      const overrides = shouldHide ? { how_much: null } : {};
      return mapRowToCard(row, {
        cardType: 'listing',
        ...overrides
      });
    });

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
