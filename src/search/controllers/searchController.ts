import { Request, Response, NextFunction } from 'express';
import { searchQuerySchema } from '../validation/searchSchemas';
import { searchService } from '../services/searchService';

export const searchListings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = searchQuerySchema.parse(req.query);
    const result = await searchService.searchListings(query);
    res.json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
};
