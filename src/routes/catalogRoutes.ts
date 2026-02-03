import { Router } from 'express';
import { getMarkets, getItemTypes, getItemTypeRules } from '../controllers/catalogController';

const router = Router();

router.get('/markets', getMarkets);
router.get('/item-types', getItemTypes);
router.get('/item-type-rules', getItemTypeRules);

export default router;
