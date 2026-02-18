import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { FilterSelect } from "../components/FilterSelect";
import { PriceInput } from "../components/PriceInput";
import { ApiError } from "../lib/apiClient";
import { debugLog } from "../lib/debug";
import { toUiErrorMessage } from "../lib/errorMessages";
import { extractBrandOptions, extractItemTypeOptions, extractModelOptions, extractYearOptions, type Option } from "../lib/marketOptions";
import { fetchMarketOptions, type MarketOptionRow } from "../lib/supabaseData";

type PartsResponse = {
  ok: true;
  data: {
    options: Array<{ id: string; label: string }>;
  };
};

const initialState = {
  brandId: "",
  modelId: "",
  yearId: "",
  itemTypeId: "",
  partId: "",
  priceAmount: "",
  priceType: "fixed"
};

export function PublishPage() {
  const { api, token } = useAuth();
  const [catalogRows, setCatalogRows] = useState<MarketOptionRow[]>([]);
  const [partOptions, setPartOptions] = useState<Option[]>([]);
  const [form, setForm] = useState(initialState);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialState), [form]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!token) {
      return;
    }

    fetchMarketOptions(token)
      .then(setCatalogRows)
      .catch(() => setError("Unable to load catalog options."));
  }, [token]);

  useEffect(() => {
    if (!form.itemTypeId) {
      setPartOptions([]);
      return;
    }

    api.get<PartsResponse>("/catalog/parts", { itemTypeId: form.itemTypeId })
      .then((response) => setPartOptions(response.data.options.map((opt) => ({ id: opt.id, label: opt.label }))))
      .catch(() => setPartOptions([]));
  }, [api, form.itemTypeId]);

  const brands = useMemo(() => extractBrandOptions(catalogRows), [catalogRows]);
  const models = useMemo(() => extractModelOptions(catalogRows, form.brandId), [catalogRows, form.brandId]);
  const years = useMemo(() => extractYearOptions(catalogRows, form.brandId, form.modelId), [catalogRows, form.brandId, form.modelId]);
  const itemTypes = useMemo(
    () => extractItemTypeOptions(catalogRows, form.brandId, form.modelId, form.yearId),
    [catalogRows, form.brandId, form.modelId, form.yearId]
  );

  function update(field: keyof typeof initialState, value: string) {
    setForm((current) => {
      if (field === "brandId") {
        return { ...current, brandId: value, modelId: "", yearId: "", itemTypeId: "", partId: "" };
      }
      if (field === "modelId") {
        return { ...current, modelId: value, yearId: "", itemTypeId: "", partId: "" };
      }
      if (field === "yearId") {
        return { ...current, yearId: value, itemTypeId: "", partId: "" };
      }
      if (field === "itemTypeId") {
        return { ...current, itemTypeId: value, partId: "" };
      }
      return { ...current, [field]: value };
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        brandId: form.brandId,
        modelId: form.modelId,
        yearId: form.yearId,
        itemTypeId: form.itemTypeId,
        partId: form.partId,
        price: {
          amount: Number(form.priceAmount),
          type: "fixed"
        }
      };

      debugLog("publish.request", {
        signature: {
          brandId: payload.brandId,
          modelId: payload.modelId,
          yearId: payload.yearId,
          itemTypeId: payload.itemTypeId,
          partId: payload.partId
        },
        amount: payload.price.amount
      });

      const response = await api.post<{ ok: true; data: { listingId: string } }>("/listings", payload);
      debugLog("publish.success", { listingId: response.data.listingId });
      setMessage(`Listing published: ${response.data.listingId}`);
      setForm(initialState);
      setPartOptions([]);
    } catch (err) {
      debugLog("publish.error", {
        message: err instanceof Error ? err.message : "unknown"
      });
      if (err instanceof ApiError && err.status === 409) {
        setError(toUiErrorMessage(err));
      } else {
        setError(toUiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen stack gap-lg">
      <Card title="Publish Listing">
        <form className="stack" onSubmit={onSubmit}>
          <FilterSelect
            label="Brand"
            required
            value={form.brandId}
            options={brands}
            onChange={(value) => update("brandId", value)}
          />

          <FilterSelect
            label="Model"
            required
            disabled={!form.brandId}
            value={form.modelId}
            options={models}
            onChange={(value) => update("modelId", value)}
          />

          <FilterSelect
            label="Year"
            required
            disabled={!form.modelId}
            value={form.yearId}
            options={years}
            onChange={(value) => update("yearId", value)}
          />

          <FilterSelect
            label="Item Type"
            required
            disabled={!form.yearId}
            value={form.itemTypeId}
            options={itemTypes}
            onChange={(value) => update("itemTypeId", value)}
          />

          <FilterSelect
            label="Part"
            required
            disabled={!form.itemTypeId}
            value={form.partId}
            options={partOptions}
            onChange={(value) => update("partId", value)}
          />

          <PriceInput amount={form.priceAmount} onAmountChange={(value) => update("priceAmount", value)} priceType={form.priceType} />

          <button type="submit" disabled={loading}>
            {loading ? "Publishing..." : "Publish"}
          </button>
        </form>
      </Card>

      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
