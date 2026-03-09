import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../lib/apiClient";
import { toUiErrorMessage } from "../lib/errorMessages";

export function SignupPage() {
  const { token, signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !loading && tosAccepted;

  if (token) {
    return <Navigate to="/search" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Password and Confirm Password must match.");
      return;
    }
    if (!tosAccepted) {
      setError("Debe aceptar los Términos y Condiciones.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await signUp(email, password, confirmPassword, true);
      navigate("/verify-whatsapp", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.payload?.error === "email_already_in_use") {
        setError("Email is already in use.");
      } else {
        setError(toUiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen auth-screen">
      <h2>Create Account</h2>
      <form onSubmit={onSubmit} className="stack auth-form">
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>

        <label>
          Confirm Password
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>

        <div className="auth-checkbox-row">
          <input
            id="tosAccepted"
            type="checkbox"
            checked={tosAccepted}
            onChange={(event) => setTosAccepted(event.target.checked)}
            required
          />
          <span>
            ¿Acepta los{" "}
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="auth-checkbox-link"
            >
              Términos y Condiciones
            </a>
            ?
          </span>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <button type="submit" disabled={!canSubmit}>
          Create Account
        </button>
        <button type="button" className="ghost" onClick={() => navigate("/")}>
          Cancel
        </button>
      </form>
    </div>
  );
}
