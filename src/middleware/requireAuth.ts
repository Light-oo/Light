import type { Request, Response, NextFunction } from "express";
import { createSupabaseAnon } from "../lib/supabase";

const supabase = createSupabaseAnon();

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const auth = req.header("authorization") ?? "";
  const [scheme, token] = auth.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  let data: { user: { id: string } | null } | null = null;
  let error: unknown = null;
  try {
    ({ data, error } = await supabase.auth.getUser(token));
  } catch (err) {
    return next(err);
  }

  if (error) {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    return next(error);
  }

  if (!data?.user) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  (req as Request & { user: { id: string }; authToken: string }).user = {
    id: data.user.id
  };
  (req as Request & { user: { id: string }; authToken: string }).authToken =
    token;
  next();
}
