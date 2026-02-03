import { Request, Response, NextFunction } from 'express';
import { catalogService } from '../services/catalogService';

export const getMarkets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const active = req.query.active === 'true';
    const markets = await catalogService.getMarkets(active);
    res.json({ data: markets });
  } catch (error) {
    next(error);
  }
};

export const getItemTypes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : null;
    const active = req.query.active === 'true';
    const itemTypes = await catalogService.getItemTypes(marketId, active);
    res.json({ data: itemTypes });
  } catch (error) {
    next(error);
  }
};

export const getItemTypeRules = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const itemTypeId = req.query.itemTypeId;
    if (typeof itemTypeId !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'itemTypeId required' } });
      return;
    }
    const rules = await catalogService.getItemTypeRules(itemTypeId);
    res.json({ data: rules });
  } catch (error) {
    next(error);
  }
};
