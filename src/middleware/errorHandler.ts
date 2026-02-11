import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "invalid_request",
      issues: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code
      }))
    });
  }

  if (typeof err === "object" && err !== null) {
    const status = (err as { status?: number }).status;
    const type = (err as { type?: string }).type;

    if (type === "entity.parse.failed" || (err instanceof SyntaxError && status === 400)) {
      return res.status(400).json({ ok: false, error: "invalid_request" });
    }

    if (status === 401) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }

  return res.status(500).json({ ok: false, error: "unexpected_error" });
}
