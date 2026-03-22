import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import logoLoader from "../assets/logo-loader.svg";
import { useAuth } from "../auth/AuthContext";
import { useProfileStatus } from "../context/ProfileStatusContext";
import { ApiError, createApiClient } from "../lib/apiClient";
import { config } from "../lib/config";
import { toUiErrorMessage } from "../lib/errorMessages";

type DetailKind = "listing" | "demand";

type StructuredField = {
  key: string;
  label: string;
  value: string;
};

type PublicDetailResult = {
  id: string;
  title: string;
  subtitle: string | null;
  status: string;
  market: string;
  type: string;
  price: number | null;
  location: string | null;
  published_at: string | null;
  is_certified: boolean;
  structured_fields?: StructuredField[];
};

type PublicDetailResponse = {
  ok: true;
  data: {
    results: PublicDetailResult;
  };
};

type OwnerListingRow = {
  id: string;
};

type OwnerDemandRow = {
  id: string;
};

type OwnerListingsResponse = {
  ok: true;
  data: OwnerListingRow[];
};

type OwnerDemandsResponse = {
  ok: true;
  data: OwnerDemandRow[];
};

type OwnerData =
  | { isOwner: false }
  | { isOwner: true };

const publicDetailCache = new Map<string, Promise<PublicDetailResult>>();
const ownerLookupCache = new Map<string, Promise<OwnerData>>();

function makePublicDetailCacheKey(kind: DetailKind, id: string) {
  return `${kind}:${id}`;
}

function makeOwnerLookupCacheKey(kind: DetailKind, id: string, token: string | null) {
  return `${kind}:${id}:${token ?? "anon"}`;
}

function getRevealCacheKey(kind: DetailKind, id: string) {
  return `public-detail-reveal:${kind}:${id}`;
}

async function loadPublicDetail(
  api: ReturnType<typeof createApiClient>,
  kind: DetailKind,
  id: string
) {
  const cacheKey = makePublicDetailCacheKey(kind, id);
  const cached = publicDetailCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const path = kind === "listing" ? `/listings/${id}/public` : `/demands/${id}/public`;
  const request = api
    .get<PublicDetailResponse>(path, undefined, { suppressGlobalLoader: true })
    .then((response) => response.data.results)
    .catch((error) => {
      publicDetailCache.delete(cacheKey);
      throw error;
    });

  publicDetailCache.set(cacheKey, request);
  return request;
}

async function loadOwnerData(
  api: ReturnType<typeof createApiClient>,
  kind: DetailKind,
  id: string,
  token: string | null
): Promise<OwnerData> {
  if (!token) {
    return { isOwner: false };
  }

  const cacheKey = makeOwnerLookupCacheKey(kind, id, token);
  const cached = ownerLookupCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request =
    kind === "listing"
      ? api
          .get<OwnerListingsResponse>("/api/me/listings", undefined, { suppressGlobalLoader: true })
          .then((response) => {
            const listing = (Array.isArray(response.data) ? response.data : []).find((row) => row.id === id);
            return listing ? ({ isOwner: true } as const) : ({ isOwner: false } as const);
          })
      : api
          .get<OwnerDemandsResponse>("/api/me/buy-demands", undefined, { suppressGlobalLoader: true })
          .then((response) => {
            const demand = (Array.isArray(response.data) ? response.data : []).find((row) => row.id === id);
            return demand ? ({ isOwner: true } as const) : ({ isOwner: false } as const);
          });

  const guarded = request.catch((error) => {
    ownerLookupCache.delete(cacheKey);
    throw error;
  });
  ownerLookupCache.set(cacheKey, guarded);
  return guarded;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatRelativeTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = date.getTime() - Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

  if (Math.abs(diffMs) < hour) {
    return rtf.format(Math.round(diffMs / minute), "minute");
  }
  if (Math.abs(diffMs) < day) {
    return rtf.format(Math.round(diffMs / hour), "hour");
  }
  return rtf.format(Math.round(diffMs / day), "day");
}

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return `$${value.toFixed(2)}`;
}

function buildShareUrl(location: Location | undefined, pathname: string) {
  if (!location) {
    return pathname;
  }
  return `${location.origin}${pathname}`;
}

function mapStatus(value: string) {
  switch (value.trim().toLowerCase()) {
    case "open":
    case "active":
      return "Activo";
    case "inactive":
    case "closed":
      return "Pausado";
    default:
      return value;
  }
}

function mapType(value: string) {
  switch (value.trim().toLowerCase()) {
    case "buy":
      return "Búsqueda";
    case "sell":
      return "Venta";
    default:
      return value;
  }
}

function mapMarket(value: string) {
  switch (value.trim().toLowerCase()) {
    case "automotive":
      return "Automotriz";
    case "home_services":
      return "Servicios del hogar";
    default:
      return value;
  }
}

function getRevealTitle(detail: PublicDetailResult) {
  return detail.type === "sell" ? "¿Te interesa esto?" : "¿Tenés lo que busca?";
}

function normalizeStructuredFields(detail: PublicDetailResult) {
  return Array.isArray(detail.structured_fields) ? detail.structured_fields : [];
}

function orderStructuredFields(fields: StructuredField[]) {
  const preferredOrder = ["brand", "model", "year", "system", "part"];
  const remaining = [...fields];
  const ordered: StructuredField[] = [];

  for (const key of preferredOrder) {
    const index = remaining.findIndex((field) => field.key.trim().toLowerCase() === key);
    if (index === -1) {
      continue;
    }
    ordered.push(remaining[index]);
    remaining.splice(index, 1);
  }

  return [...ordered, ...remaining];
}

function parseWhatsappUrl(value: string | undefined) {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    const digits = url.pathname.replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  } catch {
    const digits = value.replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
}

export function PublicDetailPage({ kind }: { kind: DetailKind }) {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { api, token, ready } = useAuth();
  const { profileStatus } = useProfileStatus();
  const entityId = kind === "listing" ? params.listingId ?? "" : params.demandId ?? "";
  const [detail, setDetail] = useState<PublicDetailResult | null>(null);
  const [ownerData, setOwnerData] = useState<OwnerData>({ isOwner: false });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealState, setRevealState] = useState<{
    loading: boolean;
    whatsappUrl?: string;
    error?: string;
  }>({ loading: false });

  useEffect(() => {
    if (!entityId) {
      setError("No se encontró el recurso.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      loadPublicDetail(api, kind, entityId),
      loadOwnerData(api, kind, entityId, token).catch(() => ({ isOwner: false } as const))
    ])
      .then(([detailResult, ownerResult]) => {
        if (cancelled) {
          return;
        }
        setDetail(detailResult);
        setOwnerData(ownerResult);

        const cachedWhatsappUrl = sessionStorage.getItem(getRevealCacheKey(kind, detailResult.id));
        if (cachedWhatsappUrl) {
          setRevealState({
            loading: false,
            whatsappUrl: cachedWhatsappUrl
          });
          return;
        }

        setRevealState({ loading: false });
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(toUiErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, entityId, kind, token]);

  useEffect(() => {
    if (!shareMessage) {
      return;
    }
    const timer = window.setTimeout(() => setShareMessage(null), 1800);
    return () => window.clearTimeout(timer);
  }, [shareMessage]);

  const shareUrl = useMemo(() => buildShareUrl(window?.location, location.pathname), [location.pathname]);
  const isOwner = ownerData.isOwner;
  const structuredFields = useMemo(() => (detail ? normalizeStructuredFields(detail) : []), [detail]);
  const revealedPhone = useMemo(() => parseWhatsappUrl(revealState.whatsappUrl), [revealState.whatsappUrl]);
  const locationLabel = useMemo(() => {
    const departmentName = profileStatus?.departmentName?.trim();
    return departmentName ? departmentName : "El Salvador";
  }, [profileStatus?.departmentName]);
  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareMessage("Link copiado");
    } catch {
      setShareMessage("No se pudo copiar el link");
    }
  }

  async function handleReveal() {
    if (!detail || actionLoading || revealState.loading) {
      return;
    }

    if (!token) {
      navigate("/login", { state: { from: location.pathname } });
      return;
    }

    setRevealState({ loading: true });
    try {
      const body = kind === "listing" ? { listingId: detail.id } : { demandId: detail.id };
      const response = await api.post<{ ok: true; data: { whatsappUrl: string } }>("/contact-access", body, {
        suppressGlobalLoader: true
      });
      sessionStorage.setItem(getRevealCacheKey(kind, detail.id), response.data.whatsappUrl);
      setRevealState({
        loading: false,
        whatsappUrl: response.data.whatsappUrl
      });
    } catch (revealError) {
      setRevealState({
        loading: false,
        error:
          profileStatus?.tokens === 0 && revealError instanceof ApiError
            ? "No tiene tokens disponibles."
            : toUiErrorMessage(revealError)
      });
    }
  }

  async function handleOwnerDelete() {
    if (kind !== "demand" || !detail || actionLoading) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/me/buy-demands/${detail.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (!response.ok) {
        throw new Error("unexpected_error");
      }
      navigate("/my-listings");
    } catch (deleteError) {
      setError(toUiErrorMessage(deleteError));
    } finally {
      setActionLoading(false);
    }
  }

  if (loading || !ready) {
    return (
      <div className="screen stack gap-lg public-detail-page">
        <div className="public-detail-shell">
          <div className="public-detail-panel">
            <p>Cargando detalle...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="screen stack gap-lg public-detail-page">
        <div className="public-detail-shell">
          <div className="public-detail-panel">
            <p className="error">{error ?? "No se encontró el recurso."}</p>
          </div>
        </div>
      </div>
    );
  }

  const marketLabel = mapMarket(detail.market);
  const priceLabel = formatPrice(detail.price);
  const publishedRelative = formatRelativeTime(detail.published_at);
  const orderedStructuredFields = orderStructuredFields(structuredFields);

  return (
    <div className="screen stack gap-lg public-detail-page">
      <div className="public-detail-shell">
        <article className="public-detail-panel">
          {isOwner ? (
            <>
              <div className="public-detail-heading">
                <h1 className="detail-title">{detail.title}</h1>
                {detail.subtitle ? <p className="detail-subtitle">{detail.subtitle}</p> : null}
              </div>

              <div className="meta-grid">
                <div className="meta-cell">
                  <div className="meta-label">Mercado</div>
                  <div className="meta-value">{marketLabel}</div>
                </div>
                {orderedStructuredFields.map((field) => (
                  <div key={field.key} className="meta-cell">
                    <div className="meta-label">{field.label}</div>
                    <div className="meta-value">{field.value}</div>
                  </div>
                ))}
                <div className="meta-cell">
                  <div className="meta-label">Publicado</div>
                  <div className="meta-value">{publishedRelative}</div>
                </div>
                <div className="meta-cell">
                  <div className="meta-label">Ubicación</div>
                  <div className="meta-value">{locationLabel}</div>
                </div>
                {priceLabel ? (
                  <div className="meta-cell full">
                    <div className="meta-label">Precio</div>
                    <div className="meta-value price">{priceLabel}</div>
                  </div>
                ) : null}
              </div>

              <div className="action-row">
                {kind === "demand" ? (
                  <button
                    type="button"
                    className="btn btn-danger public-detail-delete-button"
                    onClick={handleOwnerDelete}
                    disabled={actionLoading}
                  >
                    Eliminar
                  </button>
                ) : null}
                <button type="button" className="btn btn-primary" onClick={copyShareUrl}>
                  Copiar enlace
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="visitor-header">
                <div className="public-detail-heading">
                  <h1 className="detail-title">{detail.title}</h1>
                  {detail.subtitle ? <p className="detail-subtitle">{detail.subtitle}</p> : null}
                </div>

                {detail.is_certified ? (
                  <div className="certified-badge-detail">
                    <img src={logoLoader} alt="" className="certified-badge-icon" />
                    Certificado
                  </div>
                ) : null}
              </div>

              <div className="meta-grid">
                <div className="meta-cell">
                  <div className="meta-label">Mercado</div>
                  <div className="meta-value">{marketLabel}</div>
                </div>
                {orderedStructuredFields.map((field) => (
                  <div key={field.key} className="meta-cell">
                    <div className="meta-label">{field.label}</div>
                    <div className="meta-value">{field.value}</div>
                  </div>
                ))}
                <div className="meta-cell">
                  <div className="meta-label">Publicado</div>
                  <div className="meta-value">{publishedRelative}</div>
                </div>
                <div className="meta-cell">
                  <div className="meta-label">Ubicación</div>
                  <div className="meta-value">{locationLabel}</div>
                </div>
                {priceLabel ? (
                  <div className="meta-cell full">
                    <div className="meta-label">Precio</div>
                    <div className="meta-value price">{priceLabel}</div>
                  </div>
                ) : null}
              </div>

              <section className="reveal-block">
                {revealState.whatsappUrl ? (
                  <>
                    <div className="reveal-block-title">WhatsApp revelado</div>
                    <div className="reveal-phone">{revealedPhone ?? "Número disponible"}</div>
                    <a href={revealState.whatsappUrl} target="_blank" rel="noreferrer" className="btn-reveal">
                      Abrir WhatsApp
                    </a>
                  </>
                ) : (
                  <>
                    <div className="reveal-block-title">{getRevealTitle(detail)}</div>
                    <div className="reveal-block-sub">
                      Revelá su WhatsApp y escribile directo. Esta persona pagó para que la encuentren, hay alta probabilidad de que cierre.
                    </div>
                    <div className="token-cost">
                      <span>Costo</span>
                      <span className="token-amount">1 token</span>
                    </div>
                    <button type="button" className="btn-reveal" onClick={handleReveal} disabled={revealState.loading}>
                      {!token
                        ? "Inicia sesión para revelar"
                        : revealState.loading
                          ? "Revelando..."
                          : "Revelar WhatsApp"}
                    </button>
                    {revealState.error ? <p className="error">{revealState.error}</p> : null}
                  </>
                )}
              </section>

              <div className="action-row">
                <button type="button" className="btn btn-primary" onClick={copyShareUrl}>
                  Copiar enlace
                </button>
              </div>
            </>
          )}

          {shareMessage ? <div className="toast show">{shareMessage}</div> : null}
        </article>
      </div>
    </div>
  );
}
