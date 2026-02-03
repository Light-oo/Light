import { describe, it, expect } from 'vitest';
import { rangeOverlaps, yearContains } from '../utils/searchFilters';

describe('searchFilters', () => {
  it('checks year containment', () => {
    expect(yearContains(2010, 2015, 2012)).toBe(true);
    expect(yearContains(2010, 2015, 2009)).toBe(false);
  });

  it('checks range overlap', () => {
    expect(rangeOverlaps(2010, 2015, 2012, 2018)).toBe(true);
    expect(rangeOverlaps(2010, 2015, 2016, 2018)).toBe(false);
  });
});
