import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toUiErrorMessage } from "../lib/errorMessages";
import { requestPasswordReset } from "../lib/supabaseAuth";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      await requestPasswordReset(email.trim(), `${window.location.origin}/reset-password`);
      setMessage("Las instrucciones para restablecer tu contraseña han sido enviadas a tu correo electrónico.");
    } catch (err) {
      setError(toUiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen auth-screen">
      <div className="stack auth-form">
        <h2>¿Olvidaste tu contraseña?</h2>
        <p>Ingresa tu correo electrónico y te enviaremos instrucciones para restablecer tu contraseña.</p>

        <form onSubmit={onSubmit} className="stack">
          <label>
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              disabled={loading}
            />
          </label>

          {error ? <p className="error">{error}</p> : null}
          {message ? <p className="info">{message}</p> : null}

          <button
            type="submit"
            className="primary-action-button"
            disabled={loading || !email.trim()}
          >
            {loading ? "Enviando..." : "Enviar instrucciones de restablecimiento"}
          </button>

          <button type="button" className="ghost" onClick={() => navigate("/login")}>
            Volver al inicio de sesión
          </button>
        </form>
      </div>
    </div>
  );
}
