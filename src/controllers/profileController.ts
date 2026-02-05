import { Request, Response, NextFunction } from 'express';
import { requireUser } from '../lib/supabase/server';
import { updateProfileSchema } from '../validation/profileSchemas';
import { profileService } from '../services/profileService';

export const getProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user, response } = await requireUser(req, res);
    if (response) {
      return;
    }

    const profile = await profileService.getProfile(user.id);
    if (!profile) {
      res.status(404).json({ ok: false, error: 'profile_not_found' });
      return;
    }
    res.json({
      ok: true,
      data: {
        id: profile.id,
        role: profile.role,
        whatsappE164: profile.whatsapp_e164,
        contactUrl: profile.contact_url,
        isBlocked: profile.is_blocked
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user, response } = await requireUser(req, res);
    if (response) {
      return;
    }

    const payload = updateProfileSchema.parse(req.body ?? {});
    const profile = await profileService.upsertProfile(user.id, payload);
    res.json({
      ok: true,
      data: {
        id: profile.id,
        role: profile.role,
        whatsappE164: profile.whatsapp_e164,
        contactUrl: profile.contact_url,
        isBlocked: profile.is_blocked
      }
    });
  } catch (error) {
    next(error);
  }
};
