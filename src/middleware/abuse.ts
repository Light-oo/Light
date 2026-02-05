import { Request, Response, NextFunction } from 'express';

const DAILY_REVEAL_LIMIT = 20;

type RevealCounter = { dayKey: string; count: number };

const revealCounters = new Map<string, RevealCounter>();

const getDayKey = () => new Date().toISOString().slice(0, 10);

const buildKey = (req: Request) => {
  const userId = req.headers['x-user-id'];
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  return `${userId ?? 'anonymous'}:${ip}`;
};

export const revealRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const key = buildKey(req);
  const dayKey = getDayKey();
  const existing = revealCounters.get(key);

  if (!existing || existing.dayKey !== dayKey) {
    revealCounters.set(key, { dayKey, count: 1 });
    next();
    return;
  }

  if (existing.count >= DAILY_REVEAL_LIMIT) {
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return;
  }

  existing.count += 1;
  revealCounters.set(key, existing);
  next();
};
