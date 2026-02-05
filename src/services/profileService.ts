import { profileRepository } from '../db/profileRepository';
import { UpdateProfileInput } from '../validation/profileSchemas';
import { normalizeElSalvadorPhone } from '../utils/phone';
import { UserRole } from '../domain/contracts';

export const profileService = {
  async getProfile(userId: string) {
    return profileRepository.getProfileById(userId);
  },
  async upsertProfile(userId: string, payload: UpdateProfileInput) {
    const role: UserRole = payload.role ?? 'buyer';
    const whatsapp = payload.whatsapp ? normalizeElSalvadorPhone(payload.whatsapp) : null;
    const contactUrl = payload.contactUrl ?? null;

    return profileRepository.upsertProfile({
      id: userId,
      role,
      whatsapp_e164: whatsapp,
      contact_url: contactUrl
    });
  }
};
