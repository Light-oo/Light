import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { GlobalLoader } from "../components/GlobalLoader";

export function RequireAuth() {
  const { ready, token } = useAuth();
  const location = useLocation();

  if (!ready) {
    return <GlobalLoader visible mode="overlay" />;
  }

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
