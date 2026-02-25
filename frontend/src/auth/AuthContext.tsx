import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "../lib/apiClient";
import { config } from "../lib/config";
import { signInWithPassword } from "../lib/supabaseAuth";
import { useLoading } from "../context/LoadingContext";

type AuthState = {
  ready: boolean;
  token: string | null;
  userId: string | null;
  email: string | null;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, confirmPassword: string, whatsapp: string) => Promise<void>;
  signOut: () => void;
  api: ReturnType<typeof createApiClient>;
  isGlobalLoading: boolean;
};

const STORAGE_KEY = "light_pilot_jwt";

const AuthContext = createContext<AuthContextValue | null>(null);

async function validateToken(apiBaseUrl: string, token: string): Promise<string | null> {
  const response = await fetch(`${apiBaseUrl}/auth/ping`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  return payload?.userId ?? null;
}

function parseEmailFromJwt(token: string): string | null {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) {
      return null;
    }
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { email?: string };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ ready: false, token: null, userId: null, email: null });
  const tokenRef = useRef<string | null>(null);
  const { isLoading, setLoading } = useLoading();

  const signOut = useCallback(() => {
    tokenRef.current = null;
    localStorage.removeItem(STORAGE_KEY);
    setState({ ready: true, token: null, userId: null, email: null });
  }, []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiBaseUrl,
        getToken: () => tokenRef.current,
        onUnauthorized: signOut,
        onRequestStart: () => setLoading(true),
        onRequestEnd: () => setLoading(false)
      }),
    [setLoading, signOut]
  );

  const establishSession = useCallback(async (token: string, emailHint?: string) => {
    setLoading(true);
    try {
      const userId = await validateToken(config.apiBaseUrl, token);
      if (!userId) {
        signOut();
        throw new Error("unauthorized");
      }

      tokenRef.current = token;
      localStorage.setItem(STORAGE_KEY, token);
      setState({
        ready: true,
        token,
        userId,
        email: emailHint ?? parseEmailFromJwt(token)
      });
    } finally {
      setLoading(false);
    }
  }, [setLoading, signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const token = await signInWithPassword(email, password);
      await establishSession(token, email.trim());
    } finally {
      setLoading(false);
    }
  }, [establishSession, setLoading]);

  const signUp = useCallback(async (email: string, password: string, confirmPassword: string, whatsapp: string) => {
    setLoading(true);
    try {
      const response = await api.post<{ ok: true; data: { access_token: string } }>("/auth/signup", {
        email: email.trim(),
        password,
        confirm_password: confirmPassword,
        whatsapp
      });

      await establishSession(response.data.access_token, email.trim());
    } finally {
      setLoading(false);
    }
  }, [api, establishSession]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setState({ ready: true, token: null, userId: null, email: null });
      return;
    }

    establishSession(stored).catch(() => {
      signOut();
    });
  }, [establishSession, signOut]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    signIn,
    signUp,
    signOut,
    api,
    isGlobalLoading: isLoading
  }), [state, signIn, signUp, signOut, api, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
