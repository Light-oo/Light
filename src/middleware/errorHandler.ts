import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ ok: false, error: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({ ok: false, error: 'unexpected_error' });
};
