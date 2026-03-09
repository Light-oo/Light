import { Navigate, Outlet, useLocation } from "react-router-dom";
import { GlobalLoader } from "./GlobalLoader";
import { useMarket } from "../context/MarketContext";

export function RequireMarket() {
  const location = useLocation();
  const { ready, marketKey } = useMarket();

  if (!ready) {
    return <GlobalLoader visible mode="overlay" />;
  }

  if (!marketKey) {
    return (
      <Navigate
        to="/market-select"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return <Outlet />;
}
