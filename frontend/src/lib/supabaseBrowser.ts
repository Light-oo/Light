import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

export const supabaseBrowser = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
