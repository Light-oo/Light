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

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  (req as Request & { user: { id: string }; authToken: string }).user = {
    id: data.user.id
  };
  (req as Request & { user: { id: string }; authToken: string }).authToken =
    token;
  next();
}
