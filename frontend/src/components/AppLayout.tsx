import { useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import logoLoader from "../assets/logo-loader.svg";
import { useProfileStatus } from "../context/ProfileStatusContext";

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profileStatus } = useProfileStatus();
  const isSearchRoute = location.pathname.startsWith("/search");
  const isPublishRoute = location.pathname.startsWith("/publish");
  const isAccountRoute = location.pathname.startsWith("/account");
  const isSellActive =
    isPublishRoute || location.pathname.startsWith("/sell-demands");
  const isBuyActive = !isSellActive;
  const tokenBalance = useMemo(
    () => (typeof profileStatus?.tokens === "number" ? profileStatus.tokens : null),
    [profileStatus?.tokens]
  );

  function resolveHeaderModeTarget() {
    if (isSearchRoute) {
      return "/publish";
    }
    if (isPublishRoute || location.pathname.startsWith("/sell-demands")) {
      return "/search";
    }
    return "/search";
  }

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
            <span className={isBuyActive ? "header-mode-option is-active" : "header-mode-option is-inactive"}>
              Busco
            </span>
            <span className={isSellActive ? "header-mode-option is-active" : "header-mode-option is-inactive"}>
              Vendo
            </span>
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

