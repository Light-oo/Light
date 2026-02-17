function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return String(import.meta.env.VITE_API_BASE_URL);
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${window.location.hostname}:3000`;
  }

  return "http://localhost:3000";
}

const apiBaseUrl = resolveApiBaseUrl();
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

if ((!supabaseUrl || !supabaseAnonKey) && import.meta.env.DEV) {
  // Kept explicit so pilot setup fails fast during local onboarding.
  // Frontend cannot authenticate without these values.
  console.warn("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in frontend env.");
}

export const config = {
  apiBaseUrl,
  supabaseUrl,
  supabaseAnonKey
};
