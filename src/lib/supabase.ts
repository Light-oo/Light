import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

export function createSupabaseAnon() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

export function createSupabaseServiceRole() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
