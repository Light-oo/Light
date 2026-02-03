import { Request, Response, NextFunction } from 'express';
import { listingService } from '../services/listingService';
import { createDraftSchema, updateDraftSchema, revealContactSchema } from '../validation/schemas';
import { requireUser } from '../lib/supabase/server';

export const createDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { response } = await requireUser(req, res);
    if (response) {
      return;
    }
    const body = createDraftSchema.parse(req.body ?? {});
    const listing = await listingService.createDraft(body);
    res.status(201).json({ ok: true, data: { listingId: listing.id } });
  } catch (error) {
    next(error);
  }
};

export const updateDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { response } = await requireUser(req, res);
    if (response) {
      return;
    }
    const body = updateDraftSchema.parse(req.body ?? {});
    const listing = await listingService.updateDraft(req.params.id, body);
    res.json({ ok: true, data: listing });
  } catch (error) {
    next(error);
  }
};

export const publishListing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { response } = await requireUser(req, res);
    if (response) {
      return;
    }
    const result = await listingService.publish(req.params.id);
    res.json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const revealContact = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user, response } = await requireUser(req, res);
    if (response) {
      return;
    }
    const body = revealContactSchema.parse(req.body ?? {});
    const result = await listingService.revealContact(req.params.id, {
      requesterUserId: user.id,
      tokenCost: body.tokenCost
    });
    res.json({ ok: true, data: result });
  } catch (error) {
    next(error);
  }
};
