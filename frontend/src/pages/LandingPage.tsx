import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import logoLoader from "../assets/logo-loader.svg";

export function LandingPage() {
  const navigate = useNavigate();
  const { token } = useAuth();

  return (
    <div className="register-landing landing-activity-shell">
      <header className="landing-topbar landing-topbar-minimal">
        <button
          type="button"
          className="logo-mark landing-logo-mark"
          onClick={() => navigate("/search")}
          aria-label="Inicio"
        >
          <img src={logoLoader} alt="Light" className="header-logo-icon landing-logo-icon" />
        </button>

        <button
          type="button"
          className="account-icon"
          onClick={() => navigate(token ? "/account" : "/login")}
          aria-label="Cuenta"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="7.5" r="3.5" />
            <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
          </svg>
        </button>
      </header>

      <main className="landing-message-only">
        <p className="landing-intro-subtitle">Conectamos personas a través de información.</p>
        <h1 className="landing-intro-title">Somos el primer Information Broker de la región.</h1>
      </main>

      <footer className="landing-footer">
        <p>© Qu-e.ai</p>
        <button type="button" className="landing-footer-link" onClick={() => navigate("/terms")}>
          Términos y Condiciones
        </button>
      </footer>
    </div>
  );
}
