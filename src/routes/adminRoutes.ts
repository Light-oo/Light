import { Router } from 'express';
import { updateListingStatus } from '../controllers/adminController';
import { requireAdmin } from '../middleware/admin';

const router = Router();

router.patch('/listings/:id/status', requireAdmin, updateListingStatus);

export default router;
