import { Request, Response, NextFunction } from 'express';
import { updateListingStatusSchema } from '../validation/adminSchemas';
import { listingRepository } from '../db/listingRepository';
import { notFound } from '../utils/errors';

export const updateListingStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = updateListingStatusSchema.parse(req.body ?? {});
    const listing = await listingRepository.getListingById(req.params.id);
    if (!listing) {
      throw notFound('Listing not found');
    }

    const updated = await listingRepository.updateListing(req.params.id, {
      status: payload.status,
      updated_at: new Date().toISOString()
    });

    res.json({ ok: true, data: { listingId: updated.id, status: updated.status } });
  } catch (error) {
    next(error);
  }
};
