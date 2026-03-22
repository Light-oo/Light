import { KeyboardEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { isInteractiveCardTarget } from "../components/Card";
import { CertificationBadge } from "../components/CertificationBadge";
import { ApiError } from "../lib/apiClient";
import type { createApiClient } from "../lib/apiClient";
import { toUiErrorMessage } from "../lib/errorMessages";
import type { MarketDefinitionResponse } from "../lib/marketDefinition";
import {
  buildCardContent,
  buildCardFieldRows,
  parseSignatureIdentityValues
} from "../lib/listingDisplay";
import {
  type MarketCardTemplates,
  normalizeMarketFields,
  resolveOrderedFlowFields,
  type MarketFieldDefinition
} from "../lib/marketForm";

type IdentityValueMap = Record<string, string>;

type MyListingRow = {
  id: string;
  marketKey: string;
  identityValues: IdentityValueMap;
  signature: string;
  isCertified?: boolean;
  status: "active" | "inactive" | string;
  created_at: string | null;
  price?: {
    amount: number | null;
    type: string | null;
    currency: string | null;
  } | null;
  location?: {
    department: string | null;
    municipality: string | null;
  } | null;
};

type MyDemandRow = {
  id: string;
  marketKey: string;
  identityValues: IdentityValueMap;
  signature: string;
  isCertified?: boolean;
  status: "open" | "closed" | "inactive" | "cancelled" | string;
  created_at: string | null;
  request?: {
    detailsText: string | null;
  } | null;
};

type MyListingsResponse = {
  ok: true;
  data: MyListingRow[];
};

type MyDemandsResponse = {
  ok: true;
  data: MyDemandRow[];
};

type MarketFieldsByKey = Record<
  string,
  {
    cardTemplates?: MarketCardTemplates;
    buy: MarketFieldDefinition[];
    sell: MarketFieldDefinition[];
  }
>;

type MyListingsPageData = {
  listings: MyListingRow[];
  demands: MyDemandRow[];
};

const pageDataCache = new Map<string, Promise<MyListingsPageData>>();
const marketDefinitionCache = new Map<string, MarketFieldsByKey[string]>();
const marketDefinitionInFlight = new Map<string, Promise<readonly [string, MarketFieldsByKey[string]]>>();

function getPageDataCacheKey(token: string) {
  return token.trim();
}

function loadMyListingsPageData(
  api: ReturnType<typeof createApiClient>,
  token: string
): Promise<MyListingsPageData> {
  const cacheKey = getPageDataCacheKey(token);
  const cached = pageDataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = Promise.all([
    api.get<MyListingsResponse>("/api/me/listings"),
    api.get<MyDemandsResponse>("/api/me/buy-demands")
  ])
    .then(([listings, demandRows]) => ({
      listings: Array.isArray(listings.data) ? listings.data : [],
      demands: Array.isArray(demandRows.data) ? demandRows.data : []
    }))
    .catch((error) => {
      pageDataCache.delete(cacheKey);
      throw error;
    });

  pageDataCache.set(cacheKey, request);
  return request;
}

async function loadMarketDefinitionOnce(
  api: ReturnType<typeof createApiClient>,
  marketKey: string
): Promise<readonly [string, MarketFieldsByKey[string]]> {
  const normalizedMarketKey = marketKey.trim().toLowerCase();
  const cached = marketDefinitionCache.get(normalizedMarketKey);
  if (cached) {
    return [normalizedMarketKey, cached] as const;
  }

  const inFlight = marketDefinitionInFlight.get(normalizedMarketKey);
  if (inFlight) {
    return inFlight;
  }

  const request = api
    .get<MarketDefinitionResponse>(`/catalog/markets/${encodeURIComponent(normalizedMarketKey)}`)
    .then((response) => {
      const normalizedFields = normalizeMarketFields(response.data.fields);
      const definitions = {
        cardTemplates: response.data.cardTemplates,
        buy: resolveOrderedFlowFields(normalizedFields, "BUY"),
        sell: resolveOrderedFlowFields(normalizedFields, "SELL")
      } satisfies MarketFieldsByKey[string];
      marketDefinitionCache.set(normalizedMarketKey, definitions);
      marketDefinitionInFlight.delete(normalizedMarketKey);
      return [normalizedMarketKey, definitions] as const;
    })
    .catch((error) => {
      marketDefinitionInFlight.delete(normalizedMarketKey);
      throw error;
    });

  marketDefinitionInFlight.set(normalizedMarketKey, request);
  return request;
}

function inferDisplayFieldsFromIdentity(identityValues: IdentityValueMap): MarketFieldDefinition[] {
  return Object.keys(identityValues).map((key, index) => ({
    key,
    label: key,
    required: false,
    requiredInBuy: false,
    requiredInSell: false,
    sortOrder: index + 1,
    type: null,
    inputType: "select",
    allowedInBuy: true,
    allowedInSell: true
  }));
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolveListingPrice(row: MyListingRow) {
  const amount = numericValue(row.price?.amount);
  if (amount === null) {
    return null;
  }

  const formattedAmount = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `$${formattedAmount}`;
}

function formatWhen(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) {
    return "hace un momento";
  }
  if (minutes < 60) {
    return `hace ${minutes} minutos`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `hace ${hours} horas`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `hace ${days} dias`;
  }
  return date.toLocaleString();
}

function uniqueMarketKeys(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0))
  );
}

function resolveRowDisplayFields(params: {
  marketKey: string;
  mode: "BUY" | "SELL";
  identityValues: IdentityValueMap;
  marketFieldsByKey: MarketFieldsByKey;
}) {
  const flowFields =
    params.mode === "BUY"
      ? params.marketFieldsByKey[params.marketKey]?.buy ?? []
      : params.marketFieldsByKey[params.marketKey]?.sell ?? [];

  const visibleFieldKeys = new Set(Object.keys(params.identityValues));
  const orderedFields = flowFields.filter((field) => visibleFieldKeys.has(field.key));

  return orderedFields.length > 0 ? orderedFields : inferDisplayFieldsFromIdentity(params.identityValues);
}

function ListingGroup({
  title,
  rows,
  marketFieldsByKey,
  mode,
  expanded,
  onToggle,
  onNavigate,
  onSetInactive,
  onSetActive,
  togglingById
}: {
  title: string;
  rows: MyListingRow[];
  marketFieldsByKey: MarketFieldsByKey;
  mode: "active" | "inactive";
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, path: string) => void;
  onSetInactive: (row: MyListingRow) => void;
  onSetActive: (row: MyListingRow) => void;
  togglingById: Record<string, boolean>;
}) {
  return (
    <section className="stack">
      <button type="button" className="ghost section-toggle" onClick={onToggle} aria-expanded={expanded}>
        <span className="section-title">{title}</span>
        <span aria-hidden="true">{expanded ? "-" : "+"}</span>
      </button>
      {expanded
        ? rows.map((row) => {
            const signatureIdentity = parseSignatureIdentityValues(row.signature);
            const identityValues =
              Object.keys(row.identityValues ?? {}).length > 0 ? row.identityValues : signatureIdentity;
            const displayFields = resolveRowDisplayFields({
              marketKey: row.marketKey,
              mode: "SELL",
              identityValues,
              marketFieldsByKey
            });
            const price = resolveListingPrice(row);
            const template = marketFieldsByKey[row.marketKey]?.cardTemplates?.sellListing;
            const cardContent = buildCardContent({
              intentLabel: "Vendo",
              orderedFields: displayFields,
              values: identityValues,
              fallbackLabel: "Publicacion",
              template,
              price,
              location: row.location
            });
            const fieldRows = buildCardFieldRows({
              subtitleTemplate: template?.subtitleTemplate,
              orderedFields: displayFields,
              values: identityValues,
              locationDepartment: row.location?.department ?? null,
              maxRows: 4
            });

            return (
              <article
                key={row.id}
                className={row.isCertified ? "card stack listing-row card-with-certification is-clickable" : "card stack listing-row is-clickable"}
                role="link"
                tabIndex={0}
                onClick={(event) => onNavigate(event, `/l/${row.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onNavigate(event, `/l/${row.id}`);
                  }
                }}
              >
                <div className="card-header-row">
                  <p className="card-title-text">
                    <strong>{cardContent.title}</strong>
                  </p>
                  {row.isCertified ? <CertificationBadge inline /> : null}
                </div>
                {fieldRows.length > 0 ? (
                  <div className="card-field-rows">
                    {fieldRows.map((fieldRow) => (
                      <div key={fieldRow.key} className="card-field-row">
                        <span className="card-field-label">{fieldRow.label}</span>
                        <span className="card-field-value">{fieldRow.value}</span>
                      </div>
                    ))}
                  </div>
                ) : cardContent.secondaryLine ? <p>{cardContent.secondaryLine}</p> : null}
                {cardContent.metaLine ? <p>{cardContent.metaLine}</p> : null}
                {!template && price ? <p>{`Precio: ${price}`}</p> : null}
                {mode === "active" ? (
                  <button type="button" onClick={() => onSetInactive(row)} disabled={Boolean(togglingById[row.id])}>
                    {togglingById[row.id] ? "Actualizando..." : "Desactivar"}
                  </button>
                ) : (
                  <button type="button" onClick={() => onSetActive(row)} disabled={Boolean(togglingById[row.id])}>
                    {togglingById[row.id] ? "Actualizando..." : "Reactivar"}
                  </button>
                )}
              </article>
            );
          })
        : null}
    </section>
  );
}

function DemandGroup({
  title,
  rows,
  marketFieldsByKey,
  expanded,
  onToggle,
  onNavigate,
  onSetInactive,
  togglingById
}: {
  title: string;
  rows: MyDemandRow[];
  marketFieldsByKey: MarketFieldsByKey;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, path: string) => void;
  onSetInactive: (row: MyDemandRow) => void;
  togglingById: Record<string, boolean>;
}) {
  return (
    <section className="stack">
      <button type="button" className="ghost section-toggle" onClick={onToggle} aria-expanded={expanded}>
        <span className="section-title">{title}</span>
        <span aria-hidden="true">{expanded ? "-" : "+"}</span>
      </button>
      {expanded
        ? rows.map((row) => {
            const signatureIdentity = parseSignatureIdentityValues(row.signature);
            const identityValues =
              Object.keys(row.identityValues ?? {}).length > 0 ? row.identityValues : signatureIdentity;
            const displayFields = resolveRowDisplayFields({
              marketKey: row.marketKey,
              mode: "BUY",
              identityValues,
              marketFieldsByKey
            });
            const template = marketFieldsByKey[row.marketKey]?.cardTemplates?.buyDemand;
            const cardContent = buildCardContent({
              intentLabel: "Busco",
              orderedFields: displayFields,
              values: identityValues,
              fallbackLabel: "Publicacion",
              template,
              detailsText: row.request?.detailsText ?? null
            });
            const fieldRows = buildCardFieldRows({
              subtitleTemplate: template?.subtitleTemplate,
              orderedFields: displayFields,
              values: identityValues,
              maxRows: 4
            });
            const isActive = row.status === "open";

            return (
              <article
                key={row.id}
                className={row.isCertified ? "card stack listing-row card-with-certification is-clickable" : "card stack listing-row is-clickable"}
                role="link"
                tabIndex={0}
                onClick={(event) => onNavigate(event, `/d/${row.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onNavigate(event, `/d/${row.id}`);
                  }
                }}
              >
                <div className="card-header-row">
                  <p className="card-title-text">
                    <strong>{cardContent.title}</strong>
                  </p>
                  {row.isCertified ? <CertificationBadge inline /> : null}
                </div>
                {fieldRows.length > 0 ? (
                  <div className="card-field-rows">
                    {fieldRows.map((fieldRow) => (
                      <div key={fieldRow.key} className="card-field-row">
                        <span className="card-field-label">{fieldRow.label}</span>
                        <span className="card-field-value">{fieldRow.value}</span>
                      </div>
                    ))}
                  </div>
                ) : cardContent.secondaryLine ? <p>{cardContent.secondaryLine}</p> : null}
                {cardContent.metaLine ? <p>{cardContent.metaLine}</p> : null}
                {isActive ? (
                  <button type="button" onClick={() => onSetInactive(row)} disabled={Boolean(togglingById[row.id])}>
                    {togglingById[row.id] ? "Actualizando..." : "Desactivar"}
                  </button>
                ) : null}
              </article>
            );
          })
        : null}
    </section>
  );
}

export function MyListingsPage() {
  const { api, token } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<MyListingRow[]>([]);
  const [demands, setDemands] = useState<MyDemandRow[]>([]);
  const [marketFieldsByKey, setMarketFieldsByKey] = useState<MarketFieldsByKey>({});
  const [expandedSections, setExpandedSections] = useState({
    activeDemands: false,
    activeListings: false,
    inactiveListings: false
  });
  const [error, setError] = useState<string | null>(null);
  const [togglingById, setTogglingById] = useState<Record<string, boolean>>({});
  const [togglingDemandById, setTogglingDemandById] = useState<Record<string, boolean>>({});

  function activateCardNavigation(
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    path: string
  ) {
    if (isInteractiveCardTarget(event.target)) {
      return;
    }
    navigate(path);
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    setError(null);
    loadMyListingsPageData(api, token)
      .then(({ listings, demands }) => {
        if (cancelled) {
          return;
        }
        setRows(listings);
        setDemands(demands);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(toUiErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [api, token]);

  const loadedMarketKeys = useMemo(
    () => uniqueMarketKeys([...rows.map((row) => row.marketKey), ...demands.map((row) => row.marketKey)]),
    [demands, rows]
  );

  useEffect(() => {
    if (!token || loadedMarketKeys.length === 0) {
      setMarketFieldsByKey({});
      return;
    }

    let cancelled = false;

    Promise.allSettled(
      loadedMarketKeys.map((marketKey) => loadMarketDefinitionOnce(api, marketKey))
    ).then((results) => {
      if (cancelled) {
        return;
      }

      const nextMarketFieldsByKey: MarketFieldsByKey = {};
      let firstError: unknown = null;

      for (const result of results) {
        if (result.status === "fulfilled") {
          const [marketKey, definitions] = result.value;
          nextMarketFieldsByKey[marketKey] = definitions;
          continue;
        }

        if (!firstError) {
          firstError = result.reason;
        }
      }

      setMarketFieldsByKey(nextMarketFieldsByKey);
      if (firstError) {
        setError(toUiErrorMessage(firstError));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [api, loadedMarketKeys, token]);

  async function updateListingStatus(row: MyListingRow, nextStatus: "active" | "inactive") {
    if (togglingById[row.id] || row.status === nextStatus) {
      return;
    }
    const confirmed = window.confirm(
      nextStatus === "inactive"
        ? "¿Seguro que desea desactivar esta publicacion?"
        : "¿Seguro que desea reactivar esta publicacion?"
    );
    if (!confirmed) {
      return;
    }

    setTogglingById((current) => ({ ...current, [row.id]: true }));

    try {
      await api.patch<{ ok: true; data: { listingId: string; status: string } }>(`/listings/${row.id}/status`, {
        status: nextStatus
      });
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status: nextStatus } : item)));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setError(toUiErrorMessage(err));
        return;
      }
      setError(toUiErrorMessage(err));
    } finally {
      setTogglingById((current) => ({ ...current, [row.id]: false }));
    }
  }

  function setInactive(row: MyListingRow) {
    return updateListingStatus(row, "inactive");
  }

  function setActive(row: MyListingRow) {
    return updateListingStatus(row, "active");
  }

  async function setDemandInactive(row: MyDemandRow) {
    if (!token || togglingDemandById[row.id]) {
      return;
    }

    const confirmed = window.confirm("¿Seguro que desea desactivar esta búsqueda?");
    if (!confirmed) {
      return;
    }

    setTogglingDemandById((current) => ({ ...current, [row.id]: true }));

    try {
      await api.patch<{ ok: true; data: { id: string; status: string } }>(
        `/api/me/buy-demands/${row.id}/status`,
        {
          status: "closed"
        }
      );
      setDemands((current) => current.map((item) => (item.id === row.id ? { ...item, status: "closed" } : item)));
    } catch (err) {
      setError(toUiErrorMessage(err));
    } finally {
      setTogglingDemandById((current) => ({ ...current, [row.id]: false }));
    }
  }

  const activeRows = useMemo(() => rows.filter((row) => row.status === "active"), [rows]);
  const inactiveRows = useMemo(() => rows.filter((row) => row.status !== "active"), [rows]);
  const activeDemands = useMemo(() => demands.filter((row) => row.status === "open"), [demands]);

  function toggleSection(section: keyof typeof expandedSections) {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section]
    }));
  }

  return (
    <div className="screen stack gap-lg">
      {error ? <p className="error">{error}</p> : null}

      <DemandGroup
        title={`Búsquedas Activas (${activeDemands.length})`}
        rows={activeDemands}
        marketFieldsByKey={marketFieldsByKey}
        expanded={expandedSections.activeDemands}
        onToggle={() => toggleSection("activeDemands")}
        onNavigate={activateCardNavigation}
        onSetInactive={setDemandInactive}
        togglingById={togglingDemandById}
      />

      <ListingGroup
        title={`Ventas Activas (${activeRows.length})`}
        rows={activeRows}
        marketFieldsByKey={marketFieldsByKey}
        mode="active"
        expanded={expandedSections.activeListings}
        onToggle={() => toggleSection("activeListings")}
        onNavigate={activateCardNavigation}
        onSetInactive={setInactive}
        onSetActive={setActive}
        togglingById={togglingById}
      />

      <ListingGroup
        title={`Ventas Inactivas (${inactiveRows.length})`}
        rows={inactiveRows}
        marketFieldsByKey={marketFieldsByKey}
        mode="inactive"
        expanded={expandedSections.inactiveListings}
        onToggle={() => toggleSection("inactiveListings")}
        onNavigate={activateCardNavigation}
        onSetInactive={setInactive}
        onSetActive={setActive}
        togglingById={togglingById}
      />
    </div>
  );
}
