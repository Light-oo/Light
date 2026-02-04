import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Request, Response } from 'express';
import { parse, serialize } from 'cookie';

const getSupabaseConfig = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  console.log('SUPABASE_URL:', url);
  console.log('SUPABASE_ANON_KEY_PREFIX:', anonKey?.slice(0, 10));

  if (!url || !anonKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return { url, anonKey };
};

const getRequestCookies = (req: Request) => {
  const header = req.headers.cookie;
  if (!header) {
    return [];
  }

  const parsed = parse(header);
  return Object.entries(parsed).map(([name, value]) => ({ name, value }));
};

const setResponseCookies = (
  res: Response,
  cookies: Array<{ name: string; value: string; options?: CookieOptions }>
) => {
  cookies.forEach((cookie) => {
    const serialized = serialize(cookie.name, cookie.value, {
      path: '/',
      ...cookie.options
    });
    res.append('Set-Cookie', serialized);
  });
};

export const createServerSupabase = (req: Request, res: Response) => {
  const { url, anonKey } = getSupabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => getRequestCookies(req),
      setAll: (cookiesToSet: { name: string; value: string; options?: any }[]) =>
        setResponseCookies(res, cookiesToSet)    }
  });
};

export const requireUser = async (req: Request, res: Response) => {
  const supabase = createServerSupabase(req, res);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return {
      user: null,
      response: res.status(401).json({ ok: false, error: 'unauthorized' })
    };
  }

  return { user: data.user, response: null };
};
