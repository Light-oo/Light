import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../lib/apiClient";
import { WhatsappSvInput } from "../components/WhatsappSvInput";
import { toUiErrorMessage } from "../lib/errorMessages";
import { Card } from "../components/Card";

type ProfileStatusResponse = {
  ok: true;
  data: {
    role: string | null;
    tokens: number | null;
    whatsappE164: string | null;
    whatsappStatus: "missing" | "present";
    profileComplete: boolean;
  };
};

export function AccountPage() {
  const { api, userId, token, email, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileStatusResponse["data"] | null>(null);
  const [whatsappLocal, setWhatsappLocal] = useState("");
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const whatsappInlineError =
    whatsappLocal.length === 0 || whatsappLocal.length === 8
      ? null
      : "Debe ingresar 8 digitos.";
  const canSaveWhatsapp = !savingWhatsapp && whatsappLocal.length === 8;

  function toLocalWhatsappNumber(value: string | null) {
    if (!value) {
      return "";
    }
    if (value.startsWith("+503")) {
      return value.slice(4).replace(/\D/g, "").slice(0, 8);
    }
    return value.replace(/\D/g, "").slice(0, 8);
  }

  async function loadProfileStatus() {
    const response = await api.get<ProfileStatusResponse>("/profile/status");
    setProfile(response.data);
    setWhatsappLocal(toLocalWhatsappNumber(response.data.whatsappE164 ?? null));
  }

  useEffect(() => {
    if (!token || !userId) {
      return;
    }

    Promise.all([api.get<{ ok: true; userId: string }>("/auth/ping"), loadProfileStatus()])
      .then(() => {})
      .catch((err) => setError(toUiErrorMessage(err)));
  }, [api, token, userId]);

  async function saveWhatsapp(nextValue: string | null) {
    if (savingWhatsapp) {
      return;
    }
    setSavingWhatsapp(true);
    setError(null);
    setSaveMessage(null);
    try {
      await api.post("/profile/whatsapp", {
        whatsapp: nextValue
      });
      await loadProfileStatus();
      setSaveMessage("WhatsApp updated.");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(toUiErrorMessage(err));
      } else {
        setError(toUiErrorMessage(err));
      }
    } finally {
      setSavingWhatsapp(false);
    }
  }

  return (
    <div className="screen stack gap-lg">
      <Card title="Account" className="stack">
        {error ? <p className="error">{error}</p> : null}
        {saveMessage ? <p className="success">{saveMessage}</p> : null}
        <p><strong>Email:</strong> {email ?? "-"}</p>
        <WhatsappSvInput
          label="WhatsApp"
          localNumber={whatsappLocal}
          onChangeLocalNumber={setWhatsappLocal}
          errorText={whatsappInlineError}
        />
        <div className="row-between">
          <button type="button" disabled={!canSaveWhatsapp} onClick={() => saveWhatsapp(`+503${whatsappLocal}`)}>
            {savingWhatsapp ? "Saving..." : "Save WhatsApp"}
          </button>
          <button type="button" className="ghost" disabled={savingWhatsapp} onClick={() => saveWhatsapp(null)}>
            Remove WhatsApp
          </button>
        </div>
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
