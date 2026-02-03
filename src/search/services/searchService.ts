import { searchRepository } from '../repositories/searchRepository';
import { SearchQueryParams } from '../validation/searchSchemas';

export const searchService = {
  async searchListings(query: SearchQueryParams) {
    const result = await searchRepository.searchListings(query);

    const results = result.rows.map((row) => ({
      listingId: row.listing_id,
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
      quality_score: row.quality_score
    }));

    return {
      page: query.page,
      pageSize: query.pageSize,
      total: result.count ?? undefined,
      nextCursor: result.nextCursor,
      results
    };
  }
};
