import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../lib/apiClient";
import { toUiErrorMessage } from "../lib/errorMessages";
import { buildGenericCardContent, parseSignatureIdentityValues } from "../lib/listingDisplay";
import {
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
  status: "open" | "inactive" | "closed" | "cancelled" | string;
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

type MarketDefinitionResponse = {
  ok: true;
  data: {
    fields: Array<{
      key: string;
      label?: string;
      label_es?: string;
      required?: boolean;
      requiredInBuy?: boolean;
      required_in_buy?: boolean;
      requiredInSell?: boolean;
      required_in_sell?: boolean;
      order?: number;
      sortOrder?: number;
      type?: string | null;
      inputType?: string;
      input_type?: string;
      allowedInBuy?: boolean;
      allowed_in_buy?: boolean;
      allowedInSell?: boolean;
      allowed_in_sell?: boolean;
    }>;
  };
};

type MarketFieldsByKey = Record<
  string,
  {
    buy: MarketFieldDefinition[];
    sell: MarketFieldDefinition[];
  }
>;

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
            const cardContent = buildGenericCardContent({
              intentLabel: "Vendo",
              orderedFields: displayFields,
              values: identityValues,
              fallbackLabel: "Publicacion"
            });
            const price = resolveListingPrice(row);

            return (
              <article key={row.id} className="card stack listing-row">
                <p>
                  <strong>{cardContent.title}</strong>
                </p>
                {cardContent.secondaryLine ? <p>{cardContent.secondaryLine}</p> : null}
                {price ? <p>{`Precio: ${price}`}</p> : null}
                <p>Creado: {formatWhen(row.created_at)}</p>
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
  onSetInactive,
  togglingById
}: {
  title: string;
  rows: MyDemandRow[];
  marketFieldsByKey: MarketFieldsByKey;
  expanded: boolean;
  onToggle: () => void;
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
            const cardContent = buildGenericCardContent({
              intentLabel: "Busco",
              orderedFields: displayFields,
              values: identityValues,
              fallbackLabel: "Publicacion"
            });
            const isActive = row.status === "open";

            return (
              <article key={row.id} className="card stack listing-row">
                <p>
                  <strong>{cardContent.title}</strong>
                </p>
                {cardContent.secondaryLine ? <p>{cardContent.secondaryLine}</p> : null}
                <p>Creado: {formatWhen(row.created_at)}</p>
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

  useEffect(() => {
    if (!token) {
      return;
    }

    setError(null);
    Promise.all([
      api.get<MyListingsResponse>("/api/me/listings"),
      api.get<MyDemandsResponse>("/api/me/buy-demands")
    ])
      .then(([listings, demandRows]) => {
        setRows(Array.isArray(listings.data) ? listings.data : []);
        setDemands(Array.isArray(demandRows.data) ? demandRows.data : []);
      })
      .catch((err) => {
        setError(toUiErrorMessage(err));
      });
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
      loadedMarketKeys.map(async (marketKey) => {
        const response = await api.get<MarketDefinitionResponse>(
          `/catalog/markets/${encodeURIComponent(marketKey)}`
        );
        const normalizedFields = normalizeMarketFields(response.data.fields);
        return [
          marketKey,
          {
            buy: resolveOrderedFlowFields(normalizedFields, "BUY"),
            sell: resolveOrderedFlowFields(normalizedFields, "SELL")
          }
        ] as const;
      })
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
          status: "inactive"
        }
      );
      setDemands((current) => current.map((item) => (item.id === row.id ? { ...item, status: "inactive" } : item)));
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
        onSetInactive={setInactive}
        onSetActive={setActive}
        togglingById={togglingById}
      />
    </div>
  );
}
