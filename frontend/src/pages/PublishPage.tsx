import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { FilterSelect } from "../components/FilterSelect";
import { PriceInput } from "../components/PriceInput";
import { ApiError } from "../lib/apiClient";
import { debugLog } from "../lib/debug";
import { toUiErrorMessage } from "../lib/errorMessages";
import { type Option } from "../lib/marketOptions";

type PartsResponse = {
  ok: true;
  data: {
    options: Array<{ id: string; key: string; label_es: string }>;
  };
};

type BrandsResponse = {
  ok: true;
  data: {
    options: Array<{ id: string; key: string; label_es: string }>;
  };
};

type ModelsResponse = {
  ok: true;
  data: {
    brand_id: string;
    options: Array<{ id: string; key: string; label_es: string }>;
  };
};

type YearsResponse = {
  ok: true;
  data: {
    options: Array<{ id: string; key?: string | null; label_es: string; year?: number | null }>;
  };
};

type ItemTypesResponse = {
  ok: true;
  data: {
    options: Array<{ id: string; key: string; label_es: string }>;
  };
};

const initialState = {
  brandId: "",
  modelId: "",
  yearId: "",
  itemTypeId: "",
  partId: "",
  priceAmount: "",
  locationDepartment: "",
  locationMunicipality: ""
};

type RepublishPrefillState = {
  republishPrefill?: {
    brandId: string;
    modelId: string;
    yearId: string;
    itemTypeId: string;
    partId: string;
    priceAmount: string;
    location?: {
      department: string;
      municipality: string;
    };
  };
};

export function PublishPage() {
  const { api, token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [brands, setBrands] = useState<Option[]>([]);
  const [models, setModels] = useState<Option[]>([]);
  const [years, setYears] = useState<Option[]>([]);
  const [catalogItemTypes, setCatalogItemTypes] = useState<Option[]>([]);
  const [partOptions, setPartOptions] = useState<Option[]>([]);
  const [form, setForm] = useState(initialState);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefillAppliedRef = useRef(false);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialState), [form]);

  useEffect(() => {
    if (prefillAppliedRef.current) {
      return;
    }
    prefillAppliedRef.current = true;

    const state = (location.state as RepublishPrefillState | null) ?? null;
    const prefill = state?.republishPrefill;
    if (!prefill) {
      return;
    }

    setForm({
      brandId: prefill.brandId,
      modelId: prefill.modelId,
      yearId: prefill.yearId,
      itemTypeId: prefill.itemTypeId,
      partId: prefill.partId,
      priceAmount: prefill.priceAmount,
      locationDepartment: prefill.location?.department ?? "",
      locationMunicipality: prefill.location?.municipality ?? ""
    });
  }, [location.state]);

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

    console.log("[catalog] publish.brands.load:start");
    api.get<BrandsResponse>("/catalog/brands")
      .then((response) => {
        const options = response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es }));
        console.log("[catalog] publish.brands.load:success", { count: options.length });
        setBrands(options);
      })
      .catch((err) => {
        console.log("[catalog] publish.brands.load:error", err);
        setError("Unable to load catalog options.");
      });

    console.log("[catalog] publish.years.load:start");
    api.get<YearsResponse>("/catalog/years")
      .then((response) => {
        const options = response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es }));
        console.log("[catalog] publish.years.load:success", { count: options.length });
        setYears(options);
      })
      .catch((err) => {
        console.log("[catalog] publish.years.load:error", err);
        setError("Unable to load catalog options.");
      });

    api.get<ItemTypesResponse>("/catalog/item-types")
      .then((response) => {
        console.log("[catalog] publish.itemTypes.load:success", { count: response.data.options.length });
        setCatalogItemTypes(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch((err) => {
        console.log("[catalog] publish.itemTypes.load:error", err);
        setError("Unable to load catalog options.");
      });
  }, [api, token]);

  useEffect(() => {
    if (!form.brandId) {
      setModels([]);
      return;
    }

    console.log("[catalog] publish.models.load:start", { brandId: form.brandId });
    api.get<ModelsResponse>("/catalog/models", { brandId: form.brandId })
      .then((response) => {
        const options = response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es }));
        console.log("[catalog] publish.models.load:success", { brandId: form.brandId, count: options.length });
        setModels(options);
      })
      .catch((err) => {
        console.log("[catalog] publish.models.load:error", err);
        setModels([]);
        setError("Unable to load catalog options.");
      });
  }, [api, form.brandId]);

  useEffect(() => {
    if (!form.itemTypeId) {
      setPartOptions([]);
      return;
    }

    api.get<PartsResponse>("/catalog/parts", { itemTypeId: form.itemTypeId })
      .then((response) => {
        const options = response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es }));
        console.log("[catalog] publish.parts.load:success", { itemTypeId: form.itemTypeId, count: options.length });
        setPartOptions(options);
      })
      .catch((err) => {
        console.log("[catalog] publish.parts.load:error", err);
        setPartOptions([]);
      });
  }, [api, form.itemTypeId]);
  const itemTypes = useMemo(() => catalogItemTypes, [catalogItemTypes]);

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
        },
        ...(form.locationDepartment && form.locationMunicipality
          ? {
            location: {
              department: form.locationDepartment,
              municipality: form.locationMunicipality
            }
          }
          : {})
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
        <div className="row-between" style={{ marginBottom: "0.6rem" }}>
          <small>SELL mode</small>
          <button type="button" className="ghost" onClick={() => navigate("/sell-demands")}>
            Search Demands
          </button>
        </div>
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

          <PriceInput amount={form.priceAmount} onAmountChange={(value) => update("priceAmount", value)} />

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
