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

export const searchQuerySchema = z
  .object({
  mode: z.enum(['BUY', 'SELL', 'buy', 'sell']),
  marketId: toOptionalString(),
  itemTypeId: toOptionalString(),
  brand: toOptionalString(),
  model: toOptionalString(),
  year: toOptionalString(),
  yearFrom: toOptionalNumber(z.number().int().min(1900)),
  yearTo: toOptionalNumber(z.number().int().min(1900)),
  side: toOptionalString(),
  position: toOptionalString(),
  department: toOptionalString(),
  municipality: toOptionalString(),
  priceMin: toOptionalNumber(z.number().nonnegative()),
  priceMax: toOptionalNumber(z.number().nonnegative()),
  includeUnknownPrice: toOptionalBoolean().default(false),
  expectedPrice: toOptionalNumber(z.number().nonnegative()),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'quality', 'relevance']).default('newest'),
  page: toOptionalNumber(z.number().int().min(1)).default(1),
  pageSize: toOptionalNumber(z.number().int().min(1).max(50)).default(20),
  cursor: toOptionalString(),
  q: toOptionalString()
})
  .superRefine((value, ctx) => {
    const mode = value.mode.toString().toUpperCase();
    if (mode === 'BUY' && value.expectedPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expectedPrice is required for BUY',
        path: ['expectedPrice']
      });
    }
  });

export type SearchQueryParams = z.infer<typeof searchQuerySchema>;
