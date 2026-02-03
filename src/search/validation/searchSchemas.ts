import { z } from 'zod';

const toOptionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim().length > 0) return Number(value);
    return undefined;
  }, schema.optional());

const toOptionalString = () =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'string') return value.trim();
    return undefined;
  }, z.string().min(1).optional());

const toOptionalBoolean = () =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return undefined;
  }, z.boolean().optional());

export const searchQuerySchema = z.object({
  marketId: toOptionalString(),
  itemTypeId: toOptionalString(),
  brand: toOptionalString(),
  model: toOptionalString(),
  year: toOptionalNumber(z.number().int().min(1900)),
  yearFrom: toOptionalNumber(z.number().int().min(1900)),
  yearTo: toOptionalNumber(z.number().int().min(1900)),
  side: z.enum(['left', 'right', 'none']).optional(),
  position: z.enum(['front', 'rear', 'none']).optional(),
  department: toOptionalString(),
  municipality: toOptionalString(),
  priceMin: toOptionalNumber(z.number().nonnegative()),
  priceMax: toOptionalNumber(z.number().nonnegative()),
  includeUnknownPrice: toOptionalBoolean().default(false),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'quality', 'relevance']).default('newest'),
  page: toOptionalNumber(z.number().int().min(1)).default(1),
  pageSize: toOptionalNumber(z.number().int().min(1).max(50)).default(20),
  cursor: toOptionalString(),
  q: toOptionalString()
});

export type SearchQueryParams = z.infer<typeof searchQuerySchema>;
