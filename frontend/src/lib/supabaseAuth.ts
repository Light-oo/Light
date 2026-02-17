import { config } from "./config";

export async function signInWithPassword(email: string, password: string): Promise<string> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.msg || payload?.error_description || "invalid_credentials");
  }

  return payload.access_token as string;
}
