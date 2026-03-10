import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
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

type DepartmentsResponse = {
  ok: true;
  departments?: Array<{
    id: number;
    name: string;
  }>;
  data: {
    options: Array<{
      id: number;
      name: string;
    }>;
  };
};

export function AccountPage() {
  const { api, userId, token, email, signOut } = useAuth();
  const { profileStatus, refreshProfileStatus } = useProfileStatus();
  const navigate = useNavigate();
  const [whatsappLocal, setWhatsappLocal] = useState("");
  const [selectedWhatsappCountry, setSelectedWhatsappCountry] = useState<WhatsappCountry>(defaultWhatsappCountry);
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditingWhatsapp, setIsEditingWhatsapp] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [savingDepartment, setSavingDepartment] = useState(false);
  const [openingHelpWhatsapp, setOpeningHelpWhatsapp] = useState(false);
  const tokenStripRef = useRef<HTMLDivElement | null>(null);
  const tokenSnapFrameRef = useRef<number | null>(null);
  const tokenDragStateRef = useRef<{
    pointerId: number | null;
    startX: number;
    startScrollLeft: number;
    startAtMs: number;
    startIndex: number;
  }>({
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
    startAtMs: 0,
    startIndex: 0
  });
  const [isTokenStripDragging, setIsTokenStripDragging] = useState(false);
  const [activeTokenCard, setActiveTokenCard] = useState(0);
  const tokenCardCount = 7;

  const whatsappInlineError =
    whatsappLocal.length === 0 ||
    (whatsappLocal.length >= WHATSAPP_LOCAL_MIN_DIGITS && whatsappLocal.length <= WHATSAPP_LOCAL_MAX_DIGITS)
      ? null
      : `Debe ingresar entre ${WHATSAPP_LOCAL_MIN_DIGITS} y ${WHATSAPP_LOCAL_MAX_DIGITS} digitos.`;
  const canSaveWhatsapp =
    !savingWhatsapp &&
    whatsappLocal.length >= WHATSAPP_LOCAL_MIN_DIGITS &&
    whatsappLocal.length <= WHATSAPP_LOCAL_MAX_DIGITS;

  useEffect(() => {
    if (!token || !userId) {
      return;
    }

    api.get<{ ok: true; userId: string }>("/auth/ping")
      .then(() => {})
      .catch((err) => setError(toUiErrorMessage(err)));
  }, [api, token, userId]);

  useEffect(() => {
    const parsedWhatsapp = parseWhatsappE164(profileStatus?.whatsappE164 ?? null);
    setWhatsappLocal(parsedWhatsapp.localNumber);
    setSelectedWhatsappCountry(parsedWhatsapp.country);
    setDepartmentId(
      typeof profileStatus?.departmentId === "number" && Number.isFinite(profileStatus.departmentId)
        ? profileStatus.departmentId
        : null
    );
    setIsEditingWhatsapp(false);
  }, [profileStatus?.departmentId, profileStatus?.whatsappE164]);

  useEffect(() => {
    if (!token) {
      return;
    }

    api.get<DepartmentsResponse>("/catalog/departments")
      .then((response) => {
        const options = response.departments ?? response.data.options ?? [];
        setDepartmentOptions(options);
      })
      .catch((err) => {
        console.error("departments_load_error", err);
        setDepartmentOptions([]);
      });
  }, [api, token]);

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
      await refreshProfileStatus();
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

  async function saveDepartment(nextDepartmentId: number | null) {
    if (savingDepartment) {
      return;
    }
    setSavingDepartment(true);
    setError(null);
    setSaveMessage(null);

    try {
      await api.patch("/api/me", {
        department_id: nextDepartmentId
      });
      await refreshProfileStatus();
      setSaveMessage("Departamento actualizado.");
    } catch (err) {
      setError(toUiErrorMessage(err));
    } finally {
      setSavingDepartment(false);
    }
  }

  async function openHelpWhatsapp() {
    if (openingHelpWhatsapp) {
      return;
    }

    setOpeningHelpWhatsapp(true);
    setError(null);

    try {
      if (profileStatus?.whatsappVerificationStatus !== "verified") {
        navigate("/verify-whatsapp");
        return;
      }
      window.location.assign(`https://wa.me/50376283646?text=${encodeURIComponent("Hola")}`);
    } catch (err) {
      setError(toUiErrorMessage(err));
    } finally {
      setOpeningHelpWhatsapp(false);
    }
  }

  function findNearestTokenCard(container: HTMLDivElement) {
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0) {
      return { index: 0, left: 0 };
    }

    const scrollLeft = container.scrollLeft;
    let nearestIndex = 0;
    let nearestLeft = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    children.forEach((child, index) => {
      const left = child.offsetLeft;
      const distance = Math.abs(left - scrollLeft);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
        nearestLeft = left;
      }
    });

    return { index: nearestIndex, left: nearestLeft };
  }

  function clampTokenCardIndex(index: number, container: HTMLDivElement) {
    const maxIndex = Math.max(0, container.children.length - 1);
    return Math.max(0, Math.min(maxIndex, index));
  }

  function scrollTokenStripToIndex(container: HTMLDivElement, index: number) {
    const target = container.children.item(index) as HTMLElement | null;
    if (!target) {
      return;
    }
    container.scrollTo({
      left: target.offsetLeft,
      behavior: "smooth"
    });
  }

  function snapTokenStripToNearestCard() {
    const container = tokenStripRef.current;
    if (!container) {
      return;
    }

    const nearest = findNearestTokenCard(container);
    scrollTokenStripToIndex(container, nearest.index);
  }

  function updateActiveTokenCard() {
    const container = tokenStripRef.current;
    if (!container) {
      return;
    }
    const nearest = findNearestTokenCard(container);
    setActiveTokenCard(nearest.index);
  }

  useEffect(() => {
    updateActiveTokenCard();
    window.addEventListener("resize", updateActiveTokenCard);
    return () => {
      window.removeEventListener("resize", updateActiveTokenCard);
      if (tokenSnapFrameRef.current !== null) {
        window.cancelAnimationFrame(tokenSnapFrameRef.current);
      }
    };
  }, []);

  function onTokenStripPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const container = tokenStripRef.current;
    if (!container) {
      return;
    }

    tokenDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
      startAtMs: performance.now(),
      startIndex: findNearestTokenCard(container).index
    };
    setIsTokenStripDragging(true);
    container.setPointerCapture(event.pointerId);
  }

  function onTokenStripPointerMove(event: PointerEvent<HTMLDivElement>) {
    const container = tokenStripRef.current;
    if (!container) {
      return;
    }

    const state = tokenDragStateRef.current;
    if (state.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - state.startX;
    container.scrollLeft = state.startScrollLeft - deltaX;
  }

  function onTokenStripPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const container = tokenStripRef.current;
    if (!container) {
      return;
    }

    const state = tokenDragStateRef.current;
    if (state.pointerId !== event.pointerId) {
      return;
    }

    if (container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }

    tokenDragStateRef.current = {
      pointerId: null,
      startX: 0,
      startScrollLeft: container.scrollLeft,
      startAtMs: 0,
      startIndex: 0
    };
    setIsTokenStripDragging(false);

    const deltaX = event.clientX - state.startX;
    const travel = Math.abs(deltaX);
    const elapsedMs = Math.max(1, performance.now() - state.startAtMs);
    const velocity = travel / elapsedMs;
    const cardWidth = Math.max(container.clientWidth, 1);
    const distanceThreshold = Math.min(72, Math.max(24, cardWidth * 0.12));
    const velocityThreshold = 0.45;

    const shouldAdvance = travel >= distanceThreshold || velocity >= velocityThreshold;
    let targetIndex: number | null = null;

    if (shouldAdvance) {
      if (deltaX < 0) {
        targetIndex = clampTokenCardIndex(state.startIndex + 1, container);
      } else if (deltaX > 0) {
        targetIndex = clampTokenCardIndex(state.startIndex - 1, container);
      }
    }

    if (tokenSnapFrameRef.current !== null) {
      window.cancelAnimationFrame(tokenSnapFrameRef.current);
    }
    tokenSnapFrameRef.current = window.requestAnimationFrame(() => {
      if (targetIndex !== null) {
        scrollTokenStripToIndex(container, targetIndex);
      } else {
        snapTokenStripToNearestCard();
      }
      tokenSnapFrameRef.current = null;
    });
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
            localNumber={whatsappLocal}
            onChangeLocalNumber={setWhatsappLocal}
            countryIso={selectedWhatsappCountry.iso}
            onChangeCountryIso={(iso) =>
              setSelectedWhatsappCountry((current) =>
                current.iso === iso ? current : getWhatsappCountryByIso(iso)
              )
            }
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
                    onClick={() => saveWhatsapp(buildWhatsappE164(selectedWhatsappCountry, whatsappLocal))}
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

        <Card className="stack gap-sm">
          <h3 className="section-title">Departamento</h3>
          <select
            value={departmentId === null ? "" : String(departmentId)}
            disabled={savingDepartment}
            onChange={(event) => {
              const raw = event.target.value.trim();
              setDepartmentId(raw ? Number(raw) : null);
            }}
          >
            <option value="">Sin seleccionar</option>
            {departmentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost"
            disabled={savingDepartment}
            onClick={() => saveDepartment(departmentId)}
          >
            {savingDepartment ? "Guardando..." : "Guardar"}
          </button>
        </Card>

        <div
          ref={tokenStripRef}
          className={isTokenStripDragging ? "token-swipe-strip is-dragging" : "token-swipe-strip"}
          aria-label="Informacion de tokens"
          onScroll={updateActiveTokenCard}
          onPointerDown={onTokenStripPointerDown}
          onPointerMove={onTokenStripPointerMove}
          onPointerUp={onTokenStripPointerEnd}
          onPointerCancel={onTokenStripPointerEnd}
        >
          <Card className="stack gap-sm token-swipe-card token-entry-card">
            <h3 className="section-title">¿Quiere agregar Tokens?</h3>
            <p className="token-swipe-hint">Deslice para saber cómo 👉</p>
          </Card>

          <Card className="stack gap-sm token-swipe-card">
            <h3 className="section-title">Qué son los Tokens</h3>
            <p>Los Tokens se usan para revelar contactos.</p>
            <p>1 Token = 1 contacto revelado.</p>
            <p>Cada Token cuesta $0.25.</p>
            <p>El monto mínimo de compra es $1.00 (5 Tokens).</p>
          </Card>

          <Card className="stack gap-sm token-swipe-card">
            <h3 className="section-title">Sin Tokens</h3>
            <p>Si tiene 0 Tokens, puede Buscar o Vender.</p>
            <p>Pero no puede revelar contactos.</p>
          </Card>

          <Card className="stack gap-sm token-swipe-card">
            <h3 className="section-title">Reglas</h3>
            <ul className="tokens-info-list">
              <li>Los Tokens no expiran</li>
              <li>Solo sirven para revelar contactos</li>
              <li>No hay refunds por compra de Tokens</li>
            </ul>
          </Card>

          <Card className="stack gap-sm token-swipe-card">
            <h3 className="section-title">Importante</h3>
            <p>Sin comprobante de pago no podemos acreditar tokens.</p>
            <p>El comprobante es la única forma de identificar su transacción.</p>
            <p>Después de realizar el pago, envíe el comprobante al WhatsApp:</p>
            <p><strong>+503 7628 3646</strong></p>
          </Card>

          <Card className="stack gap-sm token-swipe-card">
            <h3 className="section-title">Transferencia bancaria</h3>
            <p><strong>Bancoagrícola</strong></p>
            <p>Cuenta de ahorro</p>
            <p>3113605425</p>
            <p><strong>BAC</strong></p>
            <p>Cuenta de ahorro</p>
            <p>113304398</p>
            <p>Después de la transferencia, envíe el comprobante al WhatsApp:</p>
            <p><strong>+503 7628 3646</strong></p>
          </Card>

          <Card className="stack gap-sm token-swipe-card token-logo-card" data-latent-skip>
            <h3 className="section-title">Recuerden</h3>
            <p>Por favor, mandar comprobante de pago al WhatsApp:</p>
            <p><strong>+503 7628 3646</strong></p>
          </Card>
        </div>
        <div className="token-swipe-dots" aria-hidden="true">
          {Array.from({ length: tokenCardCount }).map((_, index) => (
            <span
              key={`token-dot-${index}`}
              className={index === activeTokenCard ? "token-swipe-dot is-active" : "token-swipe-dot"}
            />
          ))}
        </div>
      </div>

      <div className="stack account-bottom-actions">
        <button type="button" className="account-help-button" onClick={openHelpWhatsapp} disabled={openingHelpWhatsapp}>
          {openingHelpWhatsapp ? "Abriendo..." : "¿Necesitas ayuda?"}
        </button>
        <button type="button" onClick={signOut}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

