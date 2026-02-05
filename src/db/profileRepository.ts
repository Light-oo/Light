import { getSupabaseClient } from './client';
import { Profile } from '../domain/types';

export const profileRepository = {
  async getProfileById(id: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as Profile | null;
  },
  async upsertProfile(profile: {
    id: string;
    role: Profile['role'];
    whatsapp_e164: string | null;
    contact_url: string | null;
  }) {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('profiles')
      .upsert(
        {
          id: profile.id,
          role: profile.role,
          whatsapp_e164: profile.whatsapp_e164,
          contact_url: profile.contact_url,
          updated_at: now
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single();
    if (error) throw error;
    return data as Profile;
  }
};
