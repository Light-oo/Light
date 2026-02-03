import { Request, Response } from 'express';
import { z } from 'zod';
import { createServerSupabase, requireUser } from '../lib/supabase/server';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const parseCredentials = (req: Request, res: Response) => {
  const parsed = credentialsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return null;
  }
  return parsed.data;
};

export const signUp = async (req: Request, res: Response) => {
  try {
    const credentials = parseCredentials(req, res);
    if (!credentials) {
      return;
    }

    const supabase = createServerSupabase(req, res);
    const { error } = await supabase.auth.signUp(credentials);

    if (error) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'unexpected_error' });
  }
};

export const signIn = async (req: Request, res: Response) => {
  try {
    const credentials = parseCredentials(req, res);
    if (!credentials) {
      return;
    }

    const supabase = createServerSupabase(req, res);
    const { error } = await supabase.auth.signInWithPassword(credentials);

    if (error) {
      res.status(400).json({ ok: false, error: error.message });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'unexpected_error' });
  }
};

export const signOut = async (req: Request, res: Response) => {
  try {
    const supabase = createServerSupabase(req, res);
    const { error } = await supabase.auth.signOut();

    if (error) {
      res.status(500).json({ ok: false, error: 'unexpected_error' });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'unexpected_error' });
  }
};

export const getMe = async (req: Request, res: Response) => {
  try {
    const { user, response } = await requireUser(req, res);
    if (response) {
      return;
    }

    res.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'unexpected_error' });
  }
};
