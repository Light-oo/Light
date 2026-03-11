import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useMarket } from "../context/MarketContext";
import { Card } from "../components/Card";
import { ApiError } from "../lib/apiClient";
import { toUiErrorMessage } from "../lib/errorMessages";
import {
  extractIdentityValuesForFields,
  formatAutomotiveCardLines,
  formatHomeServicesNarrative,
  isAutomotiveIdentity,
  isHomeServicesIdentity,
  parseSignatureIdentityValues
} from "../lib/listingDisplay";
import {
  normalizeMarketFields,
  resolveOrderedFlowFields,
  type MarketFieldDefinition
} from "../lib/marketForm";
import {
  fetchMyDemands,
  fetchMyListings,
  setMyDemandInactive,
  type MyDemandRow,
  type MyListingRow
} from "../lib/supabaseData";

type MarketDefinitionResponse = {
  ok: true;
  data: {
    fields: Array<{
      key: string;
      label?: string;
      label_es?: string;
      required?: boolean;
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

function inferDisplayFieldsFromIdentity(identityValues: Record<string, string>) {
  return normalizeMarketFields(
    Object.keys(identityValues).map((key, index) => ({
      key,
      label: key,
      order: index + 1,
      allowedInBuy: true,
      allowedInSell: true
    }))
  );
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
  const pricing = row.pricing;
  const rootRow = row as unknown as Record<string, unknown>;
  const amountCandidates: unknown[] = [
    Array.isArray(pricing) ? pricing[0]?.price_amount : pricing?.price_amount,
    row.price_amount,
    row.listing_price,
    row.price,
    rootRow.price_amount,
    rootRow.listing_price,
    rootRow.price
  ];

  const amount = amountCandidates
    .map((candidate) => numericValue(candidate))
    .find((candidate) => candidate !== null);

  if (amount === undefined || amount === null) {
    return "—";
  }

  const numericAmount = amount;
  const formattedAmount =
    Number.isInteger(numericAmount) ? String(numericAmount) : numericAmount.toFixed(2);
  return `$${formattedAmount}`;
}

function formatWhen(value: string) {
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

function ListingGroup({
  title,
  rows,
  orderedFields,
  mode,
  onSetInactive,
  onSetActive,
  togglingById
}: {
  title: string;
  rows: MyListingRow[];
  orderedFields: MarketFieldDefinition[];
  mode: "active" | "inactive";
  onSetInactive: (row: MyListingRow) => void;
  onSetActive: (row: MyListingRow) => void;
  togglingById: Record<string, boolean>;
}) {
  return (
    <Card className="stack">
      <h3 className="section-title">{title}</h3>
      {rows.map((row) => {
        const specs = row.item_specs;
        const signatureIdentity = parseSignatureIdentityValues((row as any).intention_signature);
        const displayFields =
          orderedFields.length > 0 ? orderedFields : inferDisplayFieldsFromIdentity(signatureIdentity);
        const identityValues = extractIdentityValuesForFields({
          part_label_es: row.part_label_es ?? specs?.part_label_es,
          brand_label_es: row.brand_label_es ?? specs?.brand_label_es,
          model_label_es: row.model_label_es ?? specs?.model_label_es,
          item_type_label_es: (row as any).item_type_label_es ?? (specs as any)?.item_type_label_es,
          year: row.year ?? specs?.year,
          identity: signatureIdentity
        }, displayFields);
        const automotiveLines = isAutomotiveIdentity(identityValues)
          ? formatAutomotiveCardLines(identityValues)
          : null;
        const price = resolveListingPrice(row);
        const narrative = isHomeServicesIdentity(identityValues)
          ? formatHomeServicesNarrative({
              intent: "SELL",
              identityValues
            })
          : null;
        return (
          <article key={row.id} className="card stack listing-row">
            <p>
              <strong>
                {narrative
                  ? `Ofrezco ${narrative.headline}`
                  : `Vendo ${automotiveLines?.partLine || "Pieza"}`}
              </strong>
            </p>
            {narrative ? (
              <>
                <p>{narrative.secondaryLine}</p>
              </>
            ) : (
              <>
                {automotiveLines?.vehicleLine ? <p>{automotiveLines.vehicleLine}</p> : null}
                {price !== "—" ? <p>{`Precio: ${price}`}</p> : null}
              </>
            )}
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
      })}
    </Card>
  );
}

function DemandGroup({
  title,
  rows,
  orderedFields,
  onSetInactive,
  togglingById
}: {
  title: string;
  rows: MyDemandRow[];
  orderedFields: MarketFieldDefinition[];
  onSetInactive: (row: MyDemandRow) => void;
  togglingById: Record<string, boolean>;
}) {
  return (
    <Card className="stack">
      <h3 className="section-title">{title}</h3>
      {rows.map((row) => {
        const signatureIdentity = parseSignatureIdentityValues((row as any).intention_signature);
        const displayFields =
          orderedFields.length > 0 ? orderedFields : inferDisplayFieldsFromIdentity(signatureIdentity);
        const identityValues = extractIdentityValuesForFields({
          part_label_es: row.part_label_es,
          brand_label_es: row.brand_label_es,
          model_label_es: row.model_label_es,
          year: row.year,
          identity: signatureIdentity
        }, displayFields);
        const automotiveLines = isAutomotiveIdentity(identityValues)
          ? formatAutomotiveCardLines(identityValues)
          : null;
        const narrative = isHomeServicesIdentity(identityValues)
          ? formatHomeServicesNarrative({
              intent: "BUY",
              identityValues
            })
          : null;
        const isActive = row.status === "open";
        return (
          <article key={row.id} className="card stack listing-row">
            <p>
              <strong>
                {narrative
                  ? `Busco ${narrative.headline}`
                  : `Busco ${automotiveLines?.partLine || "Pieza"}`}
              </strong>
            </p>
            {narrative ? (
              <>
                <p>{narrative.secondaryLine}</p>
              </>
            ) : (
              <>
                {automotiveLines?.vehicleLine ? <p>{automotiveLines.vehicleLine}</p> : null}
              </>
            )}
            <p>Creado: {formatWhen(row.created_at)}</p>
            {isActive ? (
              <button type="button" onClick={() => onSetInactive(row)} disabled={Boolean(togglingById[row.id])}>
                {togglingById[row.id] ? "Actualizando..." : "Desactivar"}
              </button>
            ) : null}
          </article>
        );
      })}
    </Card>
  );
}

export function MyListingsPage() {
  const { api, token, userId } = useAuth();
  const { marketKey } = useMarket();
  const [rows, setRows] = useState<MyListingRow[]>([]);
  const [demands, setDemands] = useState<MyDemandRow[]>([]);
  const [marketFields, setMarketFields] = useState<MarketFieldDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [togglingById, setTogglingById] = useState<Record<string, boolean>>({});
  const [togglingDemandById, setTogglingDemandById] = useState<Record<string, boolean>>({});

  async function load() {
    if (!token || !userId) {
      return;
    }
    setError(null);
    try {
      const [listings, demandRows] = await Promise.all([
        fetchMyListings(token, userId),
        fetchMyDemands(token, userId)
      ]);
      setRows(listings);
      setDemands(demandRows);
    } catch (err) {
      setError(toUiErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
  }, [token, userId]);

  useEffect(() => {
    if (!token || !marketKey) {
      setMarketFields([]);
      return;
    }

    api
      .get<MarketDefinitionResponse>(`/catalog/markets/${encodeURIComponent(marketKey)}`)
      .then((response) => {
        setMarketFields(normalizeMarketFields(response.data.fields));
      })
      .catch((err) => setError(toUiErrorMessage(err)));
  }, [api, marketKey, token]);

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
    if (!token || !userId || togglingDemandById[row.id]) {
      return;
    }

    const confirmed = window.confirm("¿Seguro que desea desactivar esta búsqueda?");
    if (!confirmed) {
      return;
    }

    setTogglingDemandById((current) => ({ ...current, [row.id]: true }));

    try {
      const updated = await setMyDemandInactive(token, userId, row.id);
      if (!updated) {
        setError("No se encontró la búsqueda.");
        return;
      }
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
  const listingDisplayFields = useMemo(
    () => resolveOrderedFlowFields(marketFields, "SELL"),
    [marketFields]
  );
  const demandDisplayFields = useMemo(
    () => resolveOrderedFlowFields(marketFields, "BUY"),
    [marketFields]
  );
  return (
    <div className="screen stack gap-lg">
      {error ? <p className="error">{error}</p> : null}

      <DemandGroup
        title={`Búsquedas Activas (${activeDemands.length})`}
        rows={activeDemands}
        orderedFields={demandDisplayFields}
        onSetInactive={setDemandInactive}
        togglingById={togglingDemandById}
      />

      <ListingGroup
        title={`Ventas Activas (${activeRows.length})`}
        rows={activeRows}
        orderedFields={listingDisplayFields}
        mode="active"
        onSetInactive={setInactive}
        onSetActive={setActive}
        togglingById={togglingById}
      />

      <ListingGroup
        title={`Ventas Inactivas (${inactiveRows.length})`}
        rows={inactiveRows}
        orderedFields={listingDisplayFields}
        mode="inactive"
        onSetInactive={setInactive}
        onSetActive={setActive}
        togglingById={togglingById}
      />
    </div>
  );
}
