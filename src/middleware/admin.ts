import { Request, Response, NextFunction } from 'express';
import { requireUser } from '../lib/supabase/server';
import { profileRepository } from '../db/profileRepository';

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user, response } = await requireUser(req, res);
    if (response) {
      return;
    }

    const profile = await profileRepository.getProfileById(user.id);
    if (!profile || profile.role !== 'admin') {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
};
