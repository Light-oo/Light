import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = randomUUID();
  (req as Request & { id: string }).id = id;
  res.setHeader("x-request-id", id);
  next();
}
