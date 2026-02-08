import { Request, Response } from 'express';
import { createServerSupabase, requireUser } from '../lib/supabase/server';

export const getMySellListings = async (req: Request, res: Response) => {
  try {
    const { user, response } = await requireUser(req, res);
    if (response) return;

    const supabase = createServerSupabase(req, res);
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('seller_profile_id', user.id);

    if (error) {
      res.status(500).json({ ok: false, error: 'unexpected_error' });
      return;
    }

    res.json({ ok: true, data: data ?? [] });
  } catch (_error) {
    res.status(500).json({ ok: false, error: 'unexpected_error' });
  }
};

export const getMyBuyListings = async (req: Request, res: Response) => {
  try {
    const { user, response } = await requireUser(req, res);
    if (response) return;

    const supabase = createServerSupabase(req, res);
    const { data, error } = await supabase
      .from('demands')
      .select('*')
      .eq('buyer_profile_id', user.id);

    if (error) {
      res.status(500).json({ ok: false, error: 'unexpected_error' });
      return;
    }

    res.json({ ok: true, data: data ?? [] });
  } catch (_error) {
    res.status(500).json({ ok: false, error: 'unexpected_error' });
  }
};

export const deleteMySellListing = async (req: Request, res: Response) => {
  try {
    const { user, response } = await requireUser(req, res);
    if (response) return;

    const supabase = createServerSupabase(req, res);
    const { error } = await supabase
      .from('listings')
      .delete()
      .eq('id', req.params.id)
      .eq('seller_profile_id', user.id);

    if (error) {
      res.status(500).json({ ok: false, error: 'unexpected_error' });
      return;
    }

    res.json({ ok: true });
  } catch (_error) {
    res.status(500).json({ ok: false, error: 'unexpected_error' });
  }
};

export const deleteMyBuyListing = async (req: Request, res: Response) => {
  try {
    const { user, response } = await requireUser(req, res);
    if (response) return;

    const supabase = createServerSupabase(req, res);
    const { error } = await supabase
      .from('demands')
      .delete()
      .eq('id', req.params.id)
      .eq('buyer_profile_id', user.id);

    if (error) {
      res.status(500).json({ ok: false, error: 'unexpected_error' });
      return;
    }

    res.json({ ok: true });
  } catch (_error) {
    res.status(500).json({ ok: false, error: 'unexpected_error' });
  }
};
