import { Request, Response, NextFunction } from 'express';
import { searchQuerySchema } from '../validation/searchSchemas';
import { createServerSupabase } from '../../lib/supabase/server';
import { searchService } from '../services/searchService';

export const searchListings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.query as Record<string, unknown>;
    const normalized = { ...raw };
    if (normalized.minPrice !== undefined && normalized.priceMin === undefined) {
      normalized.priceMin = normalized.minPrice;
    }
    if (normalized.maxPrice !== undefined && normalized.priceMax === undefined) {
      normalized.priceMax = normalized.maxPrice;
    }
    const query = searchQuerySchema.parse(normalized);
    let userId: string | null = null;
    try {
      const supabase = createServerSupabase(req, res);
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id ?? null;
    } catch (_error) {
      userId = null;
    }
    const result = await searchService.searchListings(query, { userId });
    res.json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
};
