import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../db/client';

export const resolveProfileIdByUserId = async (
  userId: string,
  supabase?: SupabaseClient
): Promise<string> => {
  const client = supabase ?? getSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error('profile_not_found');
  }
  return data.id as string;
};
