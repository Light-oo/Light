import { describe, it, expect } from 'vitest';
import { validatePublish } from '../services/publishValidator';
import { ListingBundle } from '../domain/types';

const baseBundle = (): ListingBundle => ({
  listing: {
    id: '1',
    status: 'draft',
    source: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_at: null,
    market_id: 'market-1',
    seller_id: 'seller-1',
    quality_score: null,
    what_fingerprint: null
  },
  itemSpec: {
    listing_id: '1',
    item_type_id: 'type-1',
    brand: 'Toyota',
    model: 'Corolla',
    year_from: 2010,
    year_to: 2012,
    side: 'left',
    position: 'front'
  },
  pricing: {
    listing_id: '1',
    price_type: 'fixed',
    price_amount: 100,
    currency: 'USD'
  },
  location: {
    listing_id: '1',
    department: 'San Salvador',
    municipality: 'San Salvador'
  },
  seller: {
    id: 'seller-1',
    name: 'Juan',
    seller_type: 'individual',
    whatsapp_e164: '+50371234567',
    is_verified: false
  },
  itemType: {
    id: 'type-1',
    market_id: 'market-1',
    key: 'bumper',
    label_es: 'Bumper',
    is_active: true,
    sort_order: 1
  },
  itemTypeRule: {
    item_type_id: 'type-1',
    requires_side: true,
    requires_position: true,
    allowed_sides: ['left', 'right'],
    allowed_positions: ['front', 'rear']
  }
});

describe('validatePublish', () => {
  it('accepts complete bundle', () => {
    const issues = validatePublish(baseBundle());
    expect(issues).toHaveLength(0);
  });

  it('requires side when rule demands it', () => {
    const bundle = baseBundle();
    bundle.itemSpec = { ...bundle.itemSpec!, side: null };
    const issues = validatePublish(bundle);
    expect(issues.some((issue) => issue.field === 'what.side')).toBe(true);
  });

  it('rejects invalid allowed positions', () => {
    const bundle = baseBundle();
    bundle.itemSpec = { ...bundle.itemSpec!, position: 'middle' };
    const issues = validatePublish(bundle);
    expect(issues.some((issue) => issue.field === 'what.position')).toBe(true);
  });
});
