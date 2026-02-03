import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../utils/searchCursor';

const buildRow = (index: number) => ({
  published_at: `2024-01-${String(20 - index).padStart(2, '0')}T00:00:00Z`,
  listing_id: `id-${index}`,
  price_amount: 100 + index,
  price_unknown_last: 0,
  quality_score: 50 + index
});

describe('searchCursor', () => {
  it('round-trips cursor payload', () => {
    const payload = {
      publishedAt: '2024-01-01T00:00:00Z',
      id: 'listing-1',
      priceAmount: 120,
      priceUnknownLast: 0,
      qualityScoreSort: 80
    };
    const cursor = encodeCursor(payload);
    const decoded = decodeCursor(cursor);
    expect(decoded).toEqual(payload);
  });
});

describe('pagination stability helper', () => {
  it('produces deterministic ordering by published_at then id', () => {
    const rows = [buildRow(1), buildRow(2), buildRow(3)];
    const sorted = rows.sort((a, b) =>
      a.published_at === b.published_at
        ? a.listing_id.localeCompare(b.listing_id)
        : b.published_at.localeCompare(a.published_at)
    );
    expect(sorted[0].listing_id).toBe('id-1');
  });
});
