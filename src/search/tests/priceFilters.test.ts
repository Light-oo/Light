import { describe, it, expect } from 'vitest';

const applyPriceFilter = (
  rows: { price_type: string; price_amount: number | null }[],
  priceMin: number,
  priceMax: number,
  includeUnknownPrice: boolean
) => {
  return rows.filter((row) => {
    if (row.price_type === 'unknown') {
      return includeUnknownPrice;
    }
    return row.price_amount !== null && row.price_amount >= priceMin && row.price_amount <= priceMax;
  });
};

describe('price filters', () => {
  it('excludes unknown prices by default', () => {
    const rows = [
      { price_type: 'unknown', price_amount: null },
      { price_type: 'fixed', price_amount: 100 }
    ];
    const filtered = applyPriceFilter(rows, 0, 200, false);
    expect(filtered).toHaveLength(1);
  });

  it('includes unknown prices when requested', () => {
    const rows = [
      { price_type: 'unknown', price_amount: null },
      { price_type: 'fixed', price_amount: 100 }
    ];
    const filtered = applyPriceFilter(rows, 0, 200, true);
    expect(filtered).toHaveLength(2);
  });
});
