import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import logoLoader from "../assets/logo-loader.svg";

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { api, token } = useAuth();
  const isSearchRoute = location.pathname.startsWith("/search");
  const isPublishRoute = location.pathname.startsWith("/publish");
  const isAccountRoute = location.pathname.startsWith("/account");
  const isSellActive =
    isPublishRoute || location.pathname.startsWith("/sell-demands");
  const activeModeLabel = isSellActive ? "Vendo" : "Busco";
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);

  function resolveHeaderModeTarget() {
    if (isSearchRoute) {
      return "/publish";
    }
    if (isPublishRoute || location.pathname.startsWith("/sell-demands")) {
      return "/search";
    }
    return "/search";
  }

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setTokenBalance(null);
      return;
    }

    api
      .get<{ ok: true; data: { tokens: number | null } }>(
        "/profile/status",
        undefined,
        { suppressGlobalLoader: true }
      )
      .then((response) => {
        if (!cancelled) {
          setTokenBalance(
            typeof response.data.tokens === "number" ? response.data.tokens : null
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokenBalance(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, token, location.pathname]);

  return (
    <div className="mobile-shell">
      <header className="topbar">
        <div className="header-left-cluster">
          <div className="header-token-balance" aria-label="Balance de tokens">
            <span className="header-token-icon" aria-hidden="true">
              <img src={logoLoader} alt="" className="header-token-coin-logo" />
            </span>
            <span className="header-token-value">{tokenBalance ?? "-"}</span>
          </div>
        </div>

        <div className="header-center-slot">
          <button
            type="button"
            className="header-mode-toggle"
            onClick={() => navigate(resolveHeaderModeTarget())}
            title={isSearchRoute ? "Ir a Vendo" : "Ir a Busco"}
          >
            <span className="active-word">{activeModeLabel}</span>
          </button>
        </div>

        <button
          type="button"
          className={isAccountRoute ? "account-icon is-menu" : "account-icon"}
          onClick={() => navigate(isAccountRoute ? "/my-listings" : "/account")}
          aria-label={isAccountRoute ? "Ir a Mis listas" : "Abrir cuenta"}
        >
          {isAccountRoute ? (
            <span className="header-menu-glyph" aria-hidden="true">
              ☰
            </span>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="7.5" r="3.5" />
              <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
            </svg>
          )}
        </button>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

