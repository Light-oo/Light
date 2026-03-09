import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../lib/apiClient";
import { WhatsappSvInput } from "../components/WhatsappSvInput";
import { toUiErrorMessage } from "../lib/errorMessages";
import {
  WHATSAPP_LOCAL_MAX_DIGITS,
  WHATSAPP_LOCAL_MIN_DIGITS,
  buildWhatsappE164,
  defaultWhatsappCountry,
  getWhatsappCountryByIso,
  parseWhatsappE164,
  type WhatsappCountry
} from "../lib/whatsappCountries";

type ProfileStatusResponse = {
  ok: true;
  data: {
    whatsappE164: string | null;
    whatsappVerificationStatus?: "missing" | "pending" | "verified" | null;
  };
};

type StartWhatsappVerificationResponse = {
  ok: true;
  data: {
    whatsappE164: string;
    whatsappVerificationStatus: "pending" | "verified" | "missing";
    whatsappVerificationCode: string;
  };
};

const verificationWhatsappDigits = "50376283646";

export function WhatsappVerificationPage() {
  const { token, email, api } = useAuth();
  const navigate = useNavigate();
  const [whatsappLocal, setWhatsappLocal] = useState("");
  const [selectedWhatsappCountry, setSelectedWhatsappCountry] = useState<WhatsappCountry>(defaultWhatsappCountry);
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const whatsappInlineError = useMemo(
    () =>
      whatsappLocal.length === 0 ||
      (whatsappLocal.length >= WHATSAPP_LOCAL_MIN_DIGITS && whatsappLocal.length <= WHATSAPP_LOCAL_MAX_DIGITS)
        ? null
        : `Debe ingresar entre ${WHATSAPP_LOCAL_MIN_DIGITS} y ${WHATSAPP_LOCAL_MAX_DIGITS} digitos.`,
    [whatsappLocal]
  );

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  useEffect(() => {
    let cancelled = false;
    setCheckingStatus(true);
    api
      .get<ProfileStatusResponse>("/profile/status", undefined, { suppressGlobalLoader: true })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const parsedWhatsapp = parseWhatsappE164(response.data.whatsappE164 ?? null);
        setWhatsappLocal(parsedWhatsapp.localNumber);
        setSelectedWhatsappCountry(parsedWhatsapp.country);
        if (response.data.whatsappVerificationStatus === "verified") {
          navigate("/search", { replace: true });
          return;
        }
        setCheckingStatus(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(toUiErrorMessage(err));
        setCheckingStatus(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }
    if (whatsappLocal.length < WHATSAPP_LOCAL_MIN_DIGITS || whatsappLocal.length > WHATSAPP_LOCAL_MAX_DIGITS) {
      setError(`Debe ingresar entre ${WHATSAPP_LOCAL_MIN_DIGITS} y ${WHATSAPP_LOCAL_MAX_DIGITS} digitos.`);
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const response = await api.post<StartWhatsappVerificationResponse>("/profile/whatsapp/verification/start", {
        whatsapp: buildWhatsappE164(selectedWhatsappCountry, whatsappLocal)
      });

      const whatsappE164 = response.data.whatsappE164;
      const verificationCode = response.data.whatsappVerificationCode;
      const userEmail = email?.trim() || "-";
      const message = [
        "VERIFICAR LIGHT",
        `Codigo: ${verificationCode}`,
        `WhatsApp: ${whatsappE164}`,
        `Email: ${userEmail}`
      ].join("\n");
      const whatsappUrl = `https://wa.me/${verificationWhatsappDigits}?text=${encodeURIComponent(message)}`;

      const popup = window.open(whatsappUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        window.location.href = whatsappUrl;
      }

      setInfo("Se abrio WhatsApp para enviar su verificacion. Espere confirmacion del equipo Light.");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(toUiErrorMessage(err));
      } else {
        setError(toUiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  if (checkingStatus) {
    return <div className="screen auth-screen" />;
  }

  return (
    <div className="screen auth-screen">
      <h2>Verificar WhatsApp</h2>
      <form onSubmit={onSubmit} className="stack auth-form">
        <WhatsappSvInput
          label="WhatsApp"
          localNumber={whatsappLocal}
          onChangeLocalNumber={setWhatsappLocal}
          countryIso={selectedWhatsappCountry.iso}
          onChangeCountryIso={(iso) => setSelectedWhatsappCountry(getWhatsappCountryByIso(iso))}
          required
          disabled={loading}
          errorText={whatsappInlineError}
        />

        {error ? <p className="error">{error}</p> : null}
        {info ? <p className="info">{info}</p> : null}

        <button
          type="submit"
          disabled={
            loading ||
            whatsappLocal.length < WHATSAPP_LOCAL_MIN_DIGITS ||
            whatsappLocal.length > WHATSAPP_LOCAL_MAX_DIGITS
          }
        >
          Verificar WhatsApp
        </button>
      </form>
    </div>
  );
}
