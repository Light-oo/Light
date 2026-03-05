import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { ApiError } from "../lib/apiClient";
import { WhatsappSvInput } from "../components/WhatsappSvInput";
import { toUiErrorMessage } from "../lib/errorMessages";

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
  const [whatsappLocal, setWhatsappLocal] = useState("");
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditingWhatsapp, setIsEditingWhatsapp] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
    setWhatsappLocal(toLocalWhatsappNumber(response.data.whatsappE164 ?? null));
    setIsEditingWhatsapp(false);
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
      setSaveMessage("WhatsApp actualizado.");
      setMenuOpen(false);
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
    <div className="screen screen-fill stack gap-lg">
      <div className="stack gap-lg">
        {error ? <p className="error">{error}</p> : null}
        {saveMessage ? <p className="success">{saveMessage}</p> : null}
        <Card className="stack gap-sm">
          <h3 className="section-title">Correo</h3>
          <p>{email ?? "-"}</p>
        </Card>

        <Card className="stack gap-sm">
          <h3 className="section-title">WhatsApp</h3>
          <WhatsappSvInput
            label="WhatsApp"
            localNumber={whatsappLocal}
            onChangeLocalNumber={setWhatsappLocal}
            readOnly={!isEditingWhatsapp}
            disabled={savingWhatsapp}
            errorText={isEditingWhatsapp ? whatsappInlineError : null}
            actions={
              <>
                {isEditingWhatsapp ? (
                  <button
                    type="button"
                    className="whatsapp-save-button"
                    disabled={!canSaveWhatsapp}
                    onClick={() => saveWhatsapp(`+503${whatsappLocal}`)}
                  >
                    Guardar
                  </button>
                ) : null}
                <div className="whatsapp-menu-shell">
                  <button
                    type="button"
                    className="icon-action-button"
                    aria-label="Opciones de WhatsApp"
                    title="Opciones de WhatsApp"
                    disabled={savingWhatsapp}
                    onClick={() => setMenuOpen((current) => !current)}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="6" cy="12" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="18" cy="12" r="1.5" />
                    </svg>
                  </button>
                  {menuOpen ? (
                    <div className="whatsapp-menu-popover">
                      <button
                        type="button"
                        className="ghost whatsapp-menu-item"
                        disabled={savingWhatsapp}
                        onClick={() => {
                          setSaveMessage(null);
                          setError(null);
                          setIsEditingWhatsapp(true);
                          setMenuOpen(false);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="ghost whatsapp-menu-item"
                        disabled={savingWhatsapp}
                        onClick={() => saveWhatsapp(null)}
                      >
                        Borrar
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            }
          />
        </Card>

        <button type="button" onClick={() => navigate("/tokens-info")}>
          Agregar tokens
        </button>
      </div>

      <div className="stack account-bottom-actions">
        <button type="button" className="ghost" onClick={() => navigate("/my-listings")}>
          Mis listas
        </button>
        <button type="button" onClick={signOut}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
