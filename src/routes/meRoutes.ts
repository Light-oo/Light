import { Router } from 'express';
import { getMe } from '../controllers/authController';
import {
  deleteMyBuyListing,
  deleteMySellListing,
  getMyBuyListings,
  getMySellListings
} from '../controllers/accountController';

const router = Router();

router.get('/me', getMe);
router.get('/me/sell-listings', getMySellListings);
router.get('/me/buy-listings', getMyBuyListings);
router.delete('/me/sell-listings/:id', deleteMySellListing);
router.delete('/me/buy-listings/:id', deleteMyBuyListing);

export default router;
