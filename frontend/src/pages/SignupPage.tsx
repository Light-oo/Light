import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../lib/apiClient";
import { WhatsappSvInput } from "../components/WhatsappSvInput";
import { toUiErrorMessage } from "../lib/errorMessages";

export function SignupPage() {
  const { token, signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [whatsappLocal, setWhatsappLocal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleMessage, setGoogleMessage] = useState<string | null>(null);

  const whatsappInlineError =
    whatsappLocal.length === 0 || whatsappLocal.length === 8
      ? null
      : "Debe ingresar 8 digitos.";
  const canSubmit = !loading && whatsappLocal.length === 8;

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

    if (whatsappLocal.length !== 8) {
      setError("Numero de WhatsApp invalido. Debe estar en formato +503XXXXXXXX.");
      return;
    }

    setLoading(true);
    setError(null);
    setGoogleMessage(null);

    try {
      await signUp(email, password, confirmPassword, `+503${whatsappLocal}`);
      navigate("/search", { replace: true });
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

        <WhatsappSvInput
          label="WhatsApp"
          localNumber={whatsappLocal}
          onChangeLocalNumber={setWhatsappLocal}
          required
          errorText={whatsappInlineError}
        />

        {error ? <p className="error">{error}</p> : null}
        {googleMessage ? <p className="info">{googleMessage}</p> : null}

        <button type="submit" disabled={!canSubmit}>
          Create Account
        </button>
        <button type="button" className="ghost" onClick={() => navigate("/")}>
          Cancel
        </button>
        <button type="button" className="ghost" onClick={() => setGoogleMessage("After Pilot")}>
          Sign up with Google
        </button>
      </form>
    </div>
  );
}
