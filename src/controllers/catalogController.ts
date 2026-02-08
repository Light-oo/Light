import { Request, Response, NextFunction } from 'express';
import { catalogService } from '../services/catalogService';

export const getMarkets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const active = req.query.active === 'true';
    const markets = await catalogService.getMarkets(active);
    res.json({ ok: true, data: markets });
  } catch (error) {
    next(error);
  }
};

export const getItemTypes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : null;
    const active = req.query.active === 'true';
    const itemTypes = await catalogService.getItemTypes(marketId, active);
    res.json({ ok: true, data: itemTypes });
  } catch (error) {
    next(error);
  }
};

export const getItemTypeRules = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const itemTypeId = req.query.itemTypeId;
    if (typeof itemTypeId !== 'string') {
      res.status(400).json({ ok: false, error: 'itemTypeId required' });
      return;
    }
    const rules = await catalogService.getItemTypeRules(itemTypeId);
    res.json({ ok: true, data: rules });
  } catch (error) {
    next(error);
  }
};

export const getBrands = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const active = req.query.active === 'true';
    const brands = await catalogService.getBrands(active);
    res.json({ ok: true, data: brands });
  } catch (error) {
    next(error);
  }
};

export const getModels = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brandId = typeof req.query.brandId === 'string' ? req.query.brandId : null;
    const active = req.query.active === 'true';
    const models = await catalogService.getModels(brandId, active);
    res.json({ ok: true, data: models });
  } catch (error) {
    next(error);
  }
};

export const getSides = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const active = req.query.active === 'true';
    const sides = await catalogService.getSides(active);
    res.json({ ok: true, data: sides });
  } catch (error) {
    next(error);
  }
};

export const getPositions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const active = req.query.active === 'true';
    const positions = await catalogService.getPositions(active);
    res.json({ ok: true, data: positions });
  } catch (error) {
    next(error);
  }
};

export const getYearOptions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const active = req.query.active === 'true';
    const years = await catalogService.getYearOptions(active);
    res.json({ ok: true, data: years });
  } catch (error) {
    next(error);
  }
};
