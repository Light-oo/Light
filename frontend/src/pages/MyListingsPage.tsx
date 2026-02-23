import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { ApiError } from "../lib/apiClient";
import { toUiErrorMessage } from "../lib/errorMessages";
import { labelForId } from "../lib/marketOptions";
import {
  fetchActiveListingPrices,
  fetchMarketOptions,
  fetchMyListings,
  type MarketOptionRow,
  type MyListingRow
} from "../lib/supabaseData";

function resolvePrice(row: MyListingRow, activePriceMap: Record<string, { price_amount: number; currency: string }>) {
  const pricing = row.pricing;
  if (Array.isArray(pricing) && pricing.length > 0) {
    return { amount: pricing[0].price_amount, currency: pricing[0].currency };
  }
  if (pricing && !Array.isArray(pricing)) {
    return { amount: pricing.price_amount, currency: pricing.currency };
  }
  const activePrice = activePriceMap[row.id];
  if (activePrice) {
    return { amount: activePrice.price_amount, currency: activePrice.currency };
  }
  return null;
}

function resolveLocation(row: MyListingRow) {
  const location = row.listing_locations;
  if (Array.isArray(location) && location.length > 0) {
    return {
      department: location[0].department,
      municipality: location[0].municipality
    };
  }
  if (location && !Array.isArray(location)) {
    return {
      department: location.department,
      municipality: location.municipality
    };
  }
  return null;
}

function ListingGroup({
  title,
  rows,
  marketRows,
  activePriceMap,
  mode,
  onSetInactive,
  onRepublish,
  togglingById
}: {
  title: string;
  rows: MyListingRow[];
  marketRows: MarketOptionRow[];
  activePriceMap: Record<string, { price_amount: number; currency: string }>;
  mode: "active" | "inactive";
  onSetInactive: (row: MyListingRow) => void;
  onRepublish: (row: MyListingRow) => void;
  togglingById: Record<string, boolean>;
}) {
  return (
    <Card className="stack">
      <h3 className="section-title">{title}</h3>
      {rows.length === 0 ? <p>No listings in this group.</p> : null}
      {rows.map((row) => {
        const specs = row.item_specs;
        const price = resolvePrice(row, activePriceMap);
        const location = resolveLocation(row);
        return (
          <article key={row.id} className="card stack listing-row">
            <div className="row-between">
              <strong>{row.id}</strong>
              <span className={row.status === "active" ? "status status-active" : "status status-inactive"}>
                {row.status}
              </span>
            </div>
            <p><strong>Created:</strong> {new Date(row.created_at).toLocaleString()}</p>
            <p>
              <strong>Signature:</strong>{" "}
              {specs
                ? `${labelForId(marketRows, "brand", specs.brand_id)} / ${labelForId(marketRows, "model", specs.model_id)} / ${labelForId(marketRows, "year", specs.year_id)} / ${labelForId(marketRows, "itemType", specs.item_type_id)} / ${labelForId(marketRows, "part", specs.part_id)}`
                : "No item_specs"}
            </p>
            <p><strong>Price:</strong> {price ? `${price.amount} ${price.currency}` : "Not available"}</p>
            {location ? <p><strong>Location:</strong> {location.department}, {location.municipality}</p> : null}
            {mode === "active" ? (
              <button type="button" onClick={() => onSetInactive(row)} disabled={Boolean(togglingById[row.id])}>
                {togglingById[row.id] ? "Updating..." : "Set Inactive"}
              </button>
            ) : (
              <button type="button" onClick={() => onRepublish(row)}>
                Republish
              </button>
            )}
          </article>
        );
      })}
    </Card>
  );
}

export function MyListingsPage() {
  const { api, token, userId } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<MyListingRow[]>([]);
  const [marketRows, setMarketRows] = useState<MarketOptionRow[]>([]);
  const [activePriceMap, setActivePriceMap] = useState<Record<string, { price_amount: number; currency: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingById, setTogglingById] = useState<Record<string, boolean>>({});

  async function load() {
    if (!token || !userId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [listings, options, prices] = await Promise.all([
        fetchMyListings(token, userId),
        fetchMarketOptions(token),
        fetchActiveListingPrices(token)
      ]);
      setRows(listings);
      setMarketRows(options);
      setActivePriceMap(prices);
    } catch (err) {
      setError(toUiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [token, userId]);

  async function setInactive(row: MyListingRow) {
    if (togglingById[row.id]) {
      return;
    }
    const confirmed = window.confirm("Are you sure you want to set this listing inactive?");
    if (!confirmed) {
      return;
    }

    setTogglingById((current) => ({ ...current, [row.id]: true }));

    try {
      await api.patch<{ ok: true; data: { listingId: string; status: string } }>(`/listings/${row.id}/status`, {
        status: "inactive"
      });
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status: "inactive" } : item)));
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

  function republish(row: MyListingRow) {
    const specs = row.item_specs;
    const price = resolvePrice(row, activePriceMap);
    const location = resolveLocation(row);
    if (!specs) {
      setError("Unable to republish this listing. Listing signature is incomplete.");
      return;
    }

    const confirmed = window.confirm("Are you sure you want to publish this offer again?");
    if (!confirmed) {
      return;
    }

    navigate("/publish", {
      state: {
        republishPrefill: {
          brandId: specs.brand_id,
          modelId: specs.model_id,
          yearId: specs.year_id,
          itemTypeId: specs.item_type_id,
          partId: specs.part_id,
          priceAmount: price ? String(price.amount) : "",
          location: location ?? undefined
        }
      }
    });
  }

  const activeRows = useMemo(() => rows.filter((row) => row.status === "active"), [rows]);
  const inactiveRows = useMemo(() => rows.filter((row) => row.status !== "active"), [rows]);

  return (
    <div className="screen stack gap-lg">
      <Card title="Seller Listings Management">
        <button type="button" onClick={load} disabled={loading} className="ghost">Refresh</button>
      </Card>

      {loading ? <p>Loading...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <ListingGroup
        title={`Active Listings (${activeRows.length})`}
        rows={activeRows}
        marketRows={marketRows}
        activePriceMap={activePriceMap}
        mode="active"
        onSetInactive={setInactive}
        onRepublish={republish}
        togglingById={togglingById}
      />

      <ListingGroup
        title={`Inactive Listings (${inactiveRows.length})`}
        rows={inactiveRows}
        marketRows={marketRows}
        activePriceMap={activePriceMap}
        mode="inactive"
        onSetInactive={setInactive}
        onRepublish={republish}
        togglingById={togglingById}
      />
    </div>
  );
}
