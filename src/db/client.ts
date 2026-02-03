import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient => {
  if (client) {
    return client;
  }
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase environment variables');
  }
  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
};
