import { Router } from 'express';
import { searchListings } from '../controllers/searchController';

const router = Router();

router.get('/listings', searchListings);

export default router;
