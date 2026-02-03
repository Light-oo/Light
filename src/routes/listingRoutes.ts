import { Router } from 'express';
import {
  createDraft,
  updateDraft,
  publishListing,
  revealContact
} from '../controllers/listingController';

const router = Router();

router.post('/listings/draft', createDraft);
router.patch('/listings/:id/draft', updateDraft);
router.post('/listings/:id/publish', publishListing);
router.post('/listings/:id/reveal-contact', revealContact);

export default router;
