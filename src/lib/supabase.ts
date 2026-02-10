import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

export function createSupabaseAnon(options?: { accessToken?: string }) {
  const headers = options?.accessToken
    ? { Authorization: `Bearer ${options.accessToken}` }
    : undefined;
  return createClient(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    headers ? { global: { headers } } : undefined
  );
}

export function createSupabaseServiceRole() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
