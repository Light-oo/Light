import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { ApiError } from "../lib/apiClient";
import { toUiErrorMessage } from "../lib/errorMessages";
import {
  fetchMyDemands,
  fetchMyListings,
  setMyDemandInactive,
  type MyDemandRow,
  type MyListingRow
} from "../lib/supabaseData";

function displayValue(value: unknown) {
  if (value === undefined || value === null) {
    return "\u2014";
  }
  return String(value);
}

function buildIdentityLabel(input: {
  partLabel: unknown;
  brandLabel: unknown;
  modelLabel: unknown;
  yearLabel: unknown;
}) {
  return `${displayValue(input.partLabel)} / ${displayValue(input.brandLabel)} / ${displayValue(input.modelLabel)} / ${displayValue(input.yearLabel)}`;
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

function ListingGroup({
  title,
  rows,
  mode,
  onSetInactive,
  onSetActive,
  togglingById
}: {
  title: string;
  rows: MyListingRow[];
  mode: "active" | "inactive";
  onSetInactive: (row: MyListingRow) => void;
  onSetActive: (row: MyListingRow) => void;
  togglingById: Record<string, boolean>;
}) {
  return (
    <Card className="stack">
      <h3 className="section-title">{title}</h3>
      {rows.length === 0 ? <p>No hay publicaciones en este grupo.</p> : null}
      {rows.map((row) => {
        const specs = row.item_specs;
        const identityLabel = buildIdentityLabel({
          partLabel: row.part_label_es ?? specs?.part_label_es,
          brandLabel: row.brand_label_es ?? specs?.brand_label_es,
          modelLabel: row.model_label_es ?? specs?.model_label_es,
          yearLabel: row.year ?? specs?.year
        });
        return (
          <article key={row.id} className="card stack listing-row">
            <strong>{identityLabel}</strong>
            <p>{resolveListingPrice(row)}</p>
            <p><strong>Creado:</strong> {new Date(row.created_at).toLocaleString()}</p>
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
  onSetInactive,
  togglingById
}: {
  title: string;
  rows: MyDemandRow[];
  onSetInactive: (row: MyDemandRow) => void;
  togglingById: Record<string, boolean>;
}) {
  return (
    <Card className="stack">
      <h3 className="section-title">{title}</h3>
      {rows.length === 0 ? <p>No hay publicaciones en este grupo.</p> : null}
      {rows.map((row) => {
        const identityLabel = buildIdentityLabel({
          partLabel: row.part_label_es,
          brandLabel: row.brand_label_es,
          modelLabel: row.model_label_es,
          yearLabel: row.year
        });
        const isActive = row.status === "open";
        return (
          <article key={row.id} className="card stack listing-row">
            <strong>{identityLabel}</strong>
            <p><strong>Creado:</strong> {new Date(row.created_at).toLocaleString()}</p>
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
  const [rows, setRows] = useState<MyListingRow[]>([]);
  const [demands, setDemands] = useState<MyDemandRow[]>([]);
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

  async function updateListingStatus(row: MyListingRow, nextStatus: "active" | "inactive") {
    if (togglingById[row.id] || row.status === nextStatus) {
      return;
    }
    const confirmed = window.confirm(
      nextStatus === "inactive"
        ? "Are you sure you want to set this listing inactive?"
        : "Are you sure you want to reactivate this listing?"
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

    const confirmed = window.confirm("Are you sure you want to set this demand inactive?");
    if (!confirmed) {
      return;
    }

    setTogglingDemandById((current) => ({ ...current, [row.id]: true }));

    try {
      const updated = await setMyDemandInactive(token, userId, row.id);
      if (!updated) {
        setError("No se encontro la demanda.");
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

  return (
    <div className="screen stack gap-lg">
      {error ? <p className="error">{error}</p> : null}

      <DemandGroup
        title={`Demandas Activas (${activeDemands.length})`}
        rows={activeDemands}
        onSetInactive={setDemandInactive}
        togglingById={togglingDemandById}
      />

      <ListingGroup
        title={`Ventas Activas (${activeRows.length})`}
        rows={activeRows}
        mode="active"
        onSetInactive={setInactive}
        onSetActive={setActive}
        togglingById={togglingById}
      />

      <ListingGroup
        title={`Ventas Inactivas (${inactiveRows.length})`}
        rows={inactiveRows}
        mode="inactive"
        onSetInactive={setInactive}
        onSetActive={setActive}
        togglingById={togglingById}
      />
    </div>
  );
}
