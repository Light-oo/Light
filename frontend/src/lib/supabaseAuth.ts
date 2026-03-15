import { config } from "./config";
import { supabaseBrowser } from "./supabaseBrowser";

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

export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    throw error;
  }
}

export async function exchangeRecoveryCodeForSession(code: string): Promise<void> {
  const { error } = await supabaseBrowser.auth.exchangeCodeForSession(code);
  if (error) {
    throw error;
  }
}

export async function getRecoverySession() {
  const { data, error } = await supabaseBrowser.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabaseBrowser.auth.updateUser({
    password: newPassword
  });
  if (error) {
    throw error;
  }
}

export async function clearSupabaseSession(): Promise<void> {
  await supabaseBrowser.auth.signOut();
}
