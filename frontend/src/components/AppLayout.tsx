import { Outlet, useLocation, useNavigate } from "react-router-dom";
import logoLoader from "../assets/logo-loader.svg";

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isSellActive =
    location.pathname.startsWith("/publish") || location.pathname.startsWith("/sell-demands");
  const isAccountScreen = location.pathname.startsWith("/account");
  const activeModeLabel = isSellActive ? "Vendo" : "Busco";

  return (
    <div className="mobile-shell">
      <header className="topbar">
        {isAccountScreen ? (
          <div className="header-mode-placeholder" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="header-mode-toggle"
            onClick={() => navigate(isSellActive ? "/search" : "/publish")}
            title={isSellActive ? "Ir a Busco" : "Ir a Vendo"}
          >
            <span className="active-word">{activeModeLabel}</span>
          </button>
        )}

        <button type="button" className="logo-mark" onClick={() => navigate("/search")} aria-label="Ir a inicio">
          <img src={logoLoader} alt="Light" className="header-logo-icon" />
        </button>

        <button
          type="button"
          className="account-icon"
          onClick={() => navigate("/account")}
          aria-label="Open account"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="7.5" r="3.5" />
            <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
          </svg>
        </button>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

