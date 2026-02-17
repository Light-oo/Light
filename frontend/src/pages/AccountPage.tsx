import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { toUiErrorMessage } from "../lib/errorMessages";
import { fetchProfile, type ProfileRow } from "../lib/supabaseData";
import { Card } from "../components/Card";

export function AccountPage() {
  const { api, userId, token, email, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !userId) {
      return;
    }

    Promise.all([api.get<{ ok: true; userId: string }>("/auth/ping"), fetchProfile(token, userId)])
      .then(([, profileData]) => {
        setProfile(profileData);
      })
      .catch((err) => setError(toUiErrorMessage(err)));
  }, [api, token, userId]);

  return (
    <div className="screen stack gap-lg">
      <Card title="Account" className="stack">
        {error ? <p className="error">{error}</p> : null}
        <p><strong>Email:</strong> {email ?? "-"}</p>
        <p><strong>WhatsApp:</strong> {profile?.whatsapp_e164 ?? "-"}</p>
        <p><strong>Role:</strong> {profile?.role ?? "-"}</p>
        <p><strong>Tokens:</strong> {profile?.tokens ?? "-"}</p>

        <button type="button" className="ghost" onClick={() => navigate("/my-listings")}>
          My Listings
        </button>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </Card>
    </div>
  );
}
