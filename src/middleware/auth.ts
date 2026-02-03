import { Request, Response, NextFunction } from 'express';

export const authPlaceholder = (_req: Request, _res: Response, next: NextFunction) => {
  next();
};
