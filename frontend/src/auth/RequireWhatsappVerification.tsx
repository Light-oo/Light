import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { GlobalLoader } from "../components/GlobalLoader";

type ProfileStatusResponse = {
  ok: true;
  data: {
    whatsappVerificationStatus?: "missing" | "pending" | "verified" | null;
  };
};

export function RequireWhatsappVerification() {
  const location = useLocation();
  const { token, api } = useAuth();
  const [loading, setLoading] = useState(true);
  const [needsVerification, setNeedsVerification] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setLoading(false);
      setNeedsVerification(false);
      return;
    }

    setLoading(true);
    api
      .get<ProfileStatusResponse>("/profile/status", undefined, { suppressGlobalLoader: true })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setNeedsVerification(response.data.whatsappVerificationStatus !== "verified");
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setNeedsVerification(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, token, location.pathname]);

  if (loading) {
    return <GlobalLoader visible mode="overlay" />;
  }

  if (needsVerification) {
    return <Navigate to="/verify-whatsapp" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

