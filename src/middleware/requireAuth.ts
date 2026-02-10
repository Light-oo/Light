import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") ?? "";
  const [scheme, token] = auth.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  (req as Request & { user: { id: string } }).user = { id: "stub-user-id" };
  next();
}
