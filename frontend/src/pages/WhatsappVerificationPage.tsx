import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useProfileStatus } from "../context/ProfileStatusContext";
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

type StartWhatsappVerificationResponse = {
  ok: true;
  data: {
    whatsappE164: string;
    whatsappVerificationStatus: "pending" | "verified" | "missing";
    whatsappVerificationCode: string;
    whatsappVerifiedAt?: string | null;
  };
};

type ConfirmWhatsappVerificationResponse = {
  ok: true;
  data: {
    whatsappE164: string;
    whatsappVerificationStatus: "pending" | "verified" | "missing";
    whatsappVerifiedAt?: string | null;
  };
};

const verificationWhatsappDigits = "50376283646";

export function WhatsappVerificationPage() {
  const { token, api } = useAuth();
  const { profileStatus, loading: loadingProfileStatus, refreshProfileStatus } = useProfileStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const [whatsappLocal, setWhatsappLocal] = useState("");
  const [selectedWhatsappCountry, setSelectedWhatsappCountry] =
    useState<WhatsappCountry>(defaultWhatsappCountry);
  const [verificationCode, setVerificationCode] = useState("");
  const [startLoading, setStartLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showCodeStep, setShowCodeStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const redirectTarget =
    typeof (location.state as { from?: unknown } | null)?.from === "string"
      ? ((location.state as { from?: string }).from ?? "/search")
      : "/search";

  const whatsappInlineError = useMemo(
    () =>
      whatsappLocal.length === 0 ||
      (whatsappLocal.length >= WHATSAPP_LOCAL_MIN_DIGITS &&
        whatsappLocal.length <= WHATSAPP_LOCAL_MAX_DIGITS)
        ? null
        : `Debe ingresar entre ${WHATSAPP_LOCAL_MIN_DIGITS} y ${WHATSAPP_LOCAL_MAX_DIGITS} digitos.`,
    [whatsappLocal]
  );

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  useEffect(() => {
    if (loadingProfileStatus) {
      return;
    }

    if (profileStatus?.whatsappVerificationStatus === "verified") {
      navigate(redirectTarget, { replace: true });
      return;
    }

    const parsedWhatsapp = parseWhatsappE164(profileStatus?.whatsappE164 ?? null);
    setWhatsappLocal(parsedWhatsapp.localNumber);
    setSelectedWhatsappCountry(parsedWhatsapp.country);
    if (profileStatus?.whatsappVerificationStatus === "pending") {
      setShowCodeStep(true);
    }
  }, [
    loadingProfileStatus,
    navigate,
    profileStatus?.whatsappE164,
    profileStatus?.whatsappVerificationStatus,
    redirectTarget
  ]);

  async function onStartVerification(event: FormEvent) {
    event.preventDefault();
    if (startLoading || confirmLoading) {
      return;
    }

    if (whatsappLocal.length < WHATSAPP_LOCAL_MIN_DIGITS || whatsappLocal.length > WHATSAPP_LOCAL_MAX_DIGITS) {
      setError(`Debe ingresar entre ${WHATSAPP_LOCAL_MIN_DIGITS} y ${WHATSAPP_LOCAL_MAX_DIGITS} digitos.`);
      return;
    }

    setStartLoading(true);
    setError(null);
    setInfo(null);

    try {
      const response = await api.post<StartWhatsappVerificationResponse>("/profile/whatsapp/verification/start", {
        whatsapp: buildWhatsappE164(selectedWhatsappCountry, whatsappLocal)
      });

      const nextCode = String(response.data.whatsappVerificationCode ?? "").trim();
      const message = [
        `Su código de verificación es: ${nextCode}`,
        "Por favor introdúzcalo en la plataforma."
      ].join("\n");
      const whatsappUrl = `https://wa.me/${verificationWhatsappDigits}?text=${encodeURIComponent(message)}`;

      const popup = window.open(whatsappUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        window.location.href = whatsappUrl;
      }

      await refreshProfileStatus();
      setShowCodeStep(true);
      setVerificationCode("");
      setInfo("Revise WhatsApp e ingrese el codigo para completar la verificacion.");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(toUiErrorMessage(err));
      } else {
        setError(toUiErrorMessage(err));
      }
    } finally {
      setStartLoading(false);
    }
  }

  async function onConfirmVerification(event: FormEvent) {
    event.preventDefault();
    if (confirmLoading || startLoading) {
      return;
    }

    const normalizedCode = verificationCode.trim();
    if (!normalizedCode) {
      setError("Ingrese el codigo de verificacion.");
      return;
    }

    setConfirmLoading(true);
    setError(null);
    setInfo(null);

    try {
      await api.post<ConfirmWhatsappVerificationResponse>(
        "/profile/whatsapp/verification/confirm",
        { code: normalizedCode }
      );
      await refreshProfileStatus();
      setInfo("WhatsApp verificado correctamente.");
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(toUiErrorMessage(err));
      } else {
        setError(toUiErrorMessage(err));
      }
    } finally {
      setConfirmLoading(false);
    }
  }

  if (loadingProfileStatus) {
    return <div className="screen auth-screen" />;
  }

  return (
    <div className="screen auth-screen">
      <h2>Verificar WhatsApp</h2>
      <div className="stack auth-form">
        <form onSubmit={onStartVerification} className="stack">
          <WhatsappSvInput
            label="WhatsApp"
            localNumber={whatsappLocal}
            onChangeLocalNumber={setWhatsappLocal}
            countryIso={selectedWhatsappCountry.iso}
            onChangeCountryIso={(iso) => setSelectedWhatsappCountry(getWhatsappCountryByIso(iso))}
            required
            disabled={startLoading || confirmLoading}
            errorText={whatsappInlineError}
          />
          <button
            type="submit"
            disabled={
              startLoading ||
              confirmLoading ||
              whatsappLocal.length < WHATSAPP_LOCAL_MIN_DIGITS ||
              whatsappLocal.length > WHATSAPP_LOCAL_MAX_DIGITS
            }
          >
            {startLoading ? "Enviando..." : "Verificar WhatsApp"}
          </button>
        </form>

        {showCodeStep ? (
          <form onSubmit={onConfirmVerification} className="stack">
            <p>Su código de verificación es:</p>
            <label>
              Código
              <input
                type="text"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={confirmLoading || startLoading}
                placeholder=""
                required
              />
            </label>
            <button type="submit" disabled={confirmLoading || startLoading || verificationCode.trim().length === 0}>
              {confirmLoading ? "Guardando..." : "Guardar"}
            </button>
          </form>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
        {info ? <p className="info">{info}</p> : null}
      </div>
    </div>
  );
}
