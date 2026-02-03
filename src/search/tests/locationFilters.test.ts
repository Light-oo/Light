import { describe, it, expect } from 'vitest';

const matchesLocation = (
  row: { department: string; municipality: string },
  department: string,
  municipality?: string
) => {
  const deptMatch = row.department.toLowerCase() === department.toLowerCase();
  const muniMatch = municipality
    ? row.municipality.toLowerCase() === municipality.toLowerCase()
    : true;
  return deptMatch && muniMatch;
};

describe('location filters', () => {
  it('matches department and municipality case-insensitively', () => {
    const row = { department: 'San Salvador', municipality: 'San Salvador' };
    expect(matchesLocation(row, 'san salvador', 'SAN SALVADOR')).toBe(true);
  });
});
