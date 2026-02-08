import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const safeError = {
    name: err?.name,
    message: err?.message,
    stack: err?.stack,
    type: typeof err
  };

  if (err instanceof ZodError || err?.name === 'ZodError') {
    console.error('invalid_request', safeError);
    res.status(400).json({ ok: false, error: 'invalid_request', issues: err.issues });
    return;
  }

  if (err instanceof AppError) {
    console.error('app_error', safeError);
    res.status(err.status).json({ ok: false, error: err.message });
    return;
  }

  console.error('unexpected_error', safeError);
  res.status(500).json({ ok: false, error: 'unexpected_error' });
};
