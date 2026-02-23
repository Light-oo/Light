import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function AppLayout() {
  const { isGlobalLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isSellActive =
    location.pathname.startsWith("/publish") || location.pathname.startsWith("/sell-demands");
  const activeModeLabel = isSellActive ? "SELL" : "BUY";

  return (
    <div className="mobile-shell">
      <header className="topbar">
        <button type="button" className="logo-mark" onClick={() => navigate("/search")}>
          LIGHT
        </button>

        <button
          type="button"
          className="header-mode-toggle"
          onClick={() => navigate(isSellActive ? "/search" : "/publish")}
          title={isSellActive ? "Switch to BUY" : "Switch to SELL"}
        >
          <span className="active-word">{activeModeLabel}</span>
          <span className="mode-chevron" aria-hidden="true">SWITCH</span>
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
      {isGlobalLoading ? <div className="global-loading" aria-label="Loading" /> : null}

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

