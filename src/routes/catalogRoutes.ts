import { Router } from 'express';
import {
  getMarkets,
  getItemTypes,
  getItemTypeRules,
  getBrands,
  getModels,
  getSides,
  getPositions,
  getYearOptions
} from '../controllers/catalogController';

const router = Router();

router.get('/markets', getMarkets);
router.get('/item-types', getItemTypes);
router.get('/item-type-rules', getItemTypeRules);
router.get('/brands', getBrands);
router.get('/models', getModels);
router.get('/sides', getSides);
router.get('/positions', getPositions);
router.get('/year-options', getYearOptions);

export default router;
