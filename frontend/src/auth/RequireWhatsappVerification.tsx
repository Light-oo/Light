import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { GlobalLoader } from "../components/GlobalLoader";
import { useProfileStatus } from "../context/ProfileStatusContext";

export function RequireWhatsappVerification() {
  const location = useLocation();
  const { token } = useAuth();
  const { profileStatus, loading, resolved } = useProfileStatus();

  if (loading || (token && !resolved)) {
    return <GlobalLoader visible mode="overlay" />;
  }

  if (token && profileStatus?.whatsappVerificationStatus !== "verified") {
    return <Navigate to="/verify-whatsapp" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
