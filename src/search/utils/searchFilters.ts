export const normalizeMatch = (value?: string) => value?.trim().toLowerCase();

export const rangeOverlaps = (
  listingFrom?: number | null,
  listingTo?: number | null,
  queryFrom?: number | null,
  queryTo?: number | null
) => {
  if (!listingFrom || !listingTo || !queryFrom || !queryTo) return false;
  return !(listingTo < queryFrom || listingFrom > queryTo);
};

export const yearContains = (
  listingFrom?: number | null,
  listingTo?: number | null,
  year?: number | null
) => {
  if (!listingFrom || !listingTo || !year) return false;
  return listingFrom <= year && listingTo >= year;
};
