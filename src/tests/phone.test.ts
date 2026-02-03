import { describe, it, expect } from 'vitest';
import { normalizeElSalvadorPhone } from '../utils/phone';

describe('normalizeElSalvadorPhone', () => {
  it('normalizes local number to E.164', () => {
    expect(normalizeElSalvadorPhone('7123-4567')).toBe('+50371234567');
  });

  it('accepts numbers with country code', () => {
    expect(normalizeElSalvadorPhone('+503 7123 4567')).toBe('+50371234567');
  });
});
