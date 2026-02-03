import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const header = req.header('x-request-id');
  const requestId = header && header.trim().length > 0 ? header : randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};
