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

type PublishSuccessCard = {
  title: string;
  createdAtIso: string;
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
  const [successCard, setSuccessCard] = useState<PublishSuccessCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);

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

    api.get<BrandsResponse>("/catalog/brands")
      .then((response) => {
        setBrands(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch(() => setError("Unable to load catalog options."));

    api.get<YearsResponse>("/catalog/years")
      .then((response) => {
        setYears(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch(() => setError("Unable to load catalog options."));

    api.get<ItemTypesResponse>("/catalog/item-types")
      .then((response) => {
        setCatalogItemTypes(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch(() => setError("Unable to load catalog options."));
  }, [api, token]);

  useEffect(() => {
    if (!form.brandId) {
      setModels([]);
      return;
    }

    api.get<ModelsResponse>("/catalog/models", { brandId: form.brandId })
      .then((response) => {
        setModels(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch(() => {
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
        setPartOptions(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch(() => {
        setPartOptions([]);
      });
  }, [api, form.itemTypeId]);

  const itemTypes = useMemo(() => catalogItemTypes, [catalogItemTypes]);

  function labelFor(options: Option[], id: string) {
    return options.find((opt) => opt.id === id)?.label ?? "";
  }

  function buildReadableItemName() {
    const brandLabel = labelFor(brands, form.brandId);
    const modelLabel = labelFor(models, form.modelId);
    const yearLabel = labelFor(years, form.yearId);
    const partLabel = labelFor(partOptions, form.partId);
    const head = [brandLabel, modelLabel, yearLabel].filter(Boolean).join(" ");
    return [head, partLabel].filter(Boolean).join(" - ") || "esta pieza";
  }

  function buildSuccessCardTitle() {
    const modelLabel = labelFor(models, form.modelId) || "-";
    const yearLabel = labelFor(years, form.yearId) || "-";
    const partLabel = labelFor(partOptions, form.partId) || "-";
    return `${partLabel} PARA ${modelLabel} ${yearLabel}`.toUpperCase();
  }

  function formatWhen(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 1) return "Hace un momento";
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.round(hours / 24);
    if (days < 7) return `Hace ${days} dias`;
    return date.toLocaleString();
  }

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
    if (loading) return;

    setLoading(true);
    setError(null);
    setSuccessCard(null);
    setDuplicateNotice(null);

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

      setSuccessCard({
        title: buildSuccessCardTitle(),
        createdAtIso: new Date().toISOString()
      });
      setForm(initialState);
      setPartOptions([]);
    } catch (err) {
      debugLog("publish.error", {
        message: err instanceof Error ? err.message : "unknown"
      });
      if (err instanceof ApiError && err.status === 409) {
        const code = String(err.payload?.error ?? "");
        if (code === "OFFER_ALREADY_EXISTS" || code === "duplicate_listing") {
          setDuplicateNotice(buildReadableItemName());
          setError(null);
        } else {
          setError(toUiErrorMessage(err));
        }
      } else {
        setError(toUiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen screen-fill stack gap-lg">
      <Card className="stack">
        <form className="stack" onSubmit={onSubmit}>
          <FilterSelect
            label="Marca"
            required
            value={form.brandId}
            options={brands}
            onChange={(value) => update("brandId", value)}
          />

          <FilterSelect
            label="Modelo"
            required
            disabled={!form.brandId}
            value={form.modelId}
            options={models}
            onChange={(value) => update("modelId", value)}
          />

          <FilterSelect
            label="Año"
            required
            disabled={!form.modelId}
            value={form.yearId}
            options={years}
            onChange={(value) => update("yearId", value)}
          />

          <FilterSelect
            label="Sistema"
            required
            disabled={!form.yearId}
            value={form.itemTypeId}
            options={itemTypes}
            onChange={(value) => update("itemTypeId", value)}
          />

          <FilterSelect
            label="Pieza"
            required
            disabled={!form.itemTypeId}
            value={form.partId}
            options={partOptions}
            onChange={(value) => update("partId", value)}
          />

          <PriceInput amount={form.priceAmount} onAmountChange={(value) => update("priceAmount", value)} />

          <button type="submit" disabled={loading}>
            Publicar
          </button>
        </form>
      </Card>

      {successCard ? (
        <article className="card stack card-elevated demand-card-compact">
          <h3>{successCard.title}</h3>
          <p>
            <strong>Creado:</strong> {formatWhen(successCard.createdAtIso)}
          </p>
        </article>
      ) : null}

      {duplicateNotice ? (
        <Card className="stack">
          <p>
            Ya tienes una publicacion activa equivalente para <strong>{duplicateNotice}</strong>.
          </p>
          <p className="info">Puedes administrarla desde Mis publicaciones.</p>
          <button type="button" className="ghost" onClick={() => navigate("/my-listings")}>
            Ir a Mis publicaciones
          </button>
        </Card>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <button
        type="button"
        className="ghost publish-bottom-action publish-bottom-button"
        onClick={() => navigate("/sell-demands")}
      >
        Buscar Demandas
      </button>
    </div>
  );
}
