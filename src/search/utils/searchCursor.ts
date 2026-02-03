import { badRequest } from '../../utils/errors';

export type CursorPayload = {
  publishedAt: string;
  id: string;
  priceAmount?: number | null;
  priceUnknownLast?: number;
  qualityScoreSort?: number | null;
};

export const encodeCursor = (payload: CursorPayload) =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

export const decodeCursor = (cursor?: string): CursorPayload | null => {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as CursorPayload;
    if (!parsed.publishedAt || !parsed.id) {
      throw new Error('Invalid cursor payload');
    }
    return parsed;
  } catch (error) {
    throw badRequest('Invalid cursor');
  }
};
