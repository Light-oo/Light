import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PasswordField } from "../components/PasswordField";
import { toUiErrorMessage } from "../lib/errorMessages";
import {
  clearSupabaseSession,
  exchangeRecoveryCodeForSession,
  getRecoverySession,
  updatePassword
} from "../lib/supabaseAuth";

type ResetViewState = "loading" | "form" | "invalid" | "success";

const MIN_PASSWORD_LENGTH = 8;

function isRecoverySessionErrorMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("invalid") ||
    normalized.includes("expired") ||
    normalized.includes("session") ||
    normalized.includes("token")
  );
}

function hasRecoveryMarkers(url: URL) {
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(hash);
  return (
    url.searchParams.get("type") === "recovery" ||
    hashParams.get("type") === "recovery" ||
    hashParams.has("access_token") ||
    url.searchParams.has("code")
  );
}

function cleanRecoveryUrl() {
  const url = new URL(window.location.href);
  if (!url.hash && !url.searchParams.has("code") && !url.searchParams.has("type")) {
    return;
  }

  url.hash = "";
  url.searchParams.delete("code");
  url.searchParams.delete("type");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [viewState, setViewState] = useState<ResetViewState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function validateRecoverySession() {
      setViewState("loading");
      setError(null);

      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const recoveryMarked = hasRecoveryMarkers(url);

        if (code) {
          await exchangeRecoveryCodeForSession(code);
        }

        let session = await getRecoverySession();
        if (!session && recoveryMarked) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          session = await getRecoverySession();
        }

        if (cancelled) {
          return;
        }

        if (!recoveryMarked || !session) {
          setViewState("invalid");
          return;
        }

        cleanRecoveryUrl();
        setViewState("form");
      } catch {
        if (!cancelled) {
          setViewState("invalid");
        }
      }
    }

    void validateRecoverySession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (viewState !== "success") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      navigate("/login", { replace: true });
    }, 1600);

    return () => window.clearTimeout(timeoutId);
  }, [navigate, viewState]);

  const validationError = useMemo(() => {
    if (!password || !confirmPassword) {
      return null;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password !== confirmPassword) {
      return "Passwords do not match.";
    }
    return null;
  }, [confirmPassword, password]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }

    if (!password || !confirmPassword) {
      setError("Password cannot be empty.");
      return;
    }

    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await updatePassword(password);
      setSuccessMessage("Your password has been updated successfully.");
      setViewState("success");
      await clearSupabaseSession();
    } catch (err) {
      const message = toUiErrorMessage(err);
      if (isRecoverySessionErrorMessage(message)) {
        setViewState("invalid");
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen auth-screen">
      <div className="stack auth-form">
        <h2>Reset Password</h2>

        {viewState === "loading" ? <p>Loading reset link...</p> : null}

        {viewState === "invalid" ? (
          <div className="stack">
            <p>This reset link is invalid or expired.</p>
            <p>Please request a new password reset.</p>
          </div>
        ) : null}

        {viewState === "form" ? (
          <form onSubmit={onSubmit} className="stack">
            <PasswordField
              label="New password"
              value={password}
              onChange={setPassword}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              disabled={loading}
            />

            <PasswordField
              label="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              disabled={loading}
            />

            {error ? <p className="error">{error}</p> : null}

            <button type="submit" className="primary-action-button" disabled={loading}>
              {loading ? "Updating..." : "Save password"}
            </button>
          </form>
        ) : null}

        {viewState === "success" ? <p className="info">{successMessage}</p> : null}
      </div>
    </div>
  );
}
