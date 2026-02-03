import { badRequest } from './errors';

const EL_SALVADOR_COUNTRY_CODE = '+503';

export const normalizeElSalvadorPhone = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    throw badRequest('Whatsapp phone is required');
  }

  let normalized = digits;
  if (digits.startsWith('503')) {
    normalized = digits.slice(3);
  }

  if (normalized.length !== 8) {
    throw badRequest('Whatsapp must be an 8-digit El Salvador number');
  }

  return `${EL_SALVADOR_COUNTRY_CODE}${normalized}`;
};
