import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PasswordField } from "../components/PasswordField";
import { toUiErrorMessage } from "../lib/errorMessages";

export function LoginPage() {
  const { token, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (token) {
    return <Navigate to="/search" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await signIn(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from ?? "/search";
      navigate(from, { replace: true });
    } catch (err) {
      setError(toUiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen auth-screen">
      <h2>Sign In</h2>
      <form onSubmit={onSubmit} className="stack">
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

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          required
          autoComplete="current-password"
        />

        <button
          type="button"
          className="auth-link-button"
          onClick={() => navigate("/forgot-password")}
        >
          Forgot password?
        </button>

        {error ? <p className="error">{error}</p> : null}

        <button type="submit" disabled={loading}>
          Sign in
        </button>
        <button type="button" className="ghost" onClick={() => navigate("/signup")}>
          New User? Create an Account.
        </button>
      </form>
    </div>
  );
}
