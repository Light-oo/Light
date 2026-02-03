import { Request, Response, NextFunction } from 'express';
import { listingService } from '../services/listingService';
import { createDraftSchema, updateDraftSchema, revealContactSchema } from '../validation/schemas';

export const createDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createDraftSchema.parse(req.body ?? {});
    const listing = await listingService.createDraft(body);
    res.status(201).json({ data: { listingId: listing.id } });
  } catch (error) {
    next(error);
  }
};

export const updateDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateDraftSchema.parse(req.body ?? {});
    const listing = await listingService.updateDraft(req.params.id, body);
    res.json({ data: listing });
  } catch (error) {
    next(error);
  }
};

export const publishListing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await listingService.publish(req.params.id);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
};

export const revealContact = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = revealContactSchema.parse(req.body ?? {});
    const result = await listingService.revealContact(req.params.id, {
      requesterUserId: body.requesterUserId,
      tokenCost: body.tokenCost
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
};
