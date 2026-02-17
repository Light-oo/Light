import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function RequireAuth() {
  const { ready, token } = useAuth();
  const location = useLocation();

  if (!ready) {
    return <div className="screen"><p>Loading session...</p></div>;
  }

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
