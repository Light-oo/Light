import { FormEvent, useEffect, useMemo, useState } from "react";
import { Card } from "../components/Card";
import { FilterSelect } from "../components/FilterSelect";
import { RevealButton } from "../components/RevealButton";
import { useAuth } from "../auth/AuthContext";
import { toUiErrorMessage } from "../lib/errorMessages";
import { type Option } from "../lib/marketOptions";

type OptionResponse = {
  ok: true;
  data: {
    options: Array<{ id: string; label_es: string }>;
  };
};

type ModelsResponse = {
  ok: true;
  data: {
    brand_id?: string;
    options: Array<{ id: string; label_es: string }>;
  };
};

type SearchDemandsResponse = {
  ok: true;
  data: {
    results: Array<{
      cardType: "buy";
      demandId: string;
      what: {
        brandId: string;
        modelId: string;
        yearId: string;
        itemTypeId: string;
        partId: string;
      };
      request: {
        detailsText?: string | null;
      };
      audit: {
        createdAt: string;
        requesterUserId: string;
        status: string;
      };
    }>;
    page: number;
    pageSize: number;
    total: number;
  };
};

type DemandRevealResponse = {
  ok: true;
  data: {
    demandId: string;
    whatsappUrl: string;
    didConsume: boolean;
  };
};

const initialForm = {
  brandId: "",
  modelId: "",
  yearId: "",
  itemTypeId: "",
  partId: ""
};

export function SellDemandsPage() {
  const { api, token, userId } = useAuth();
  const [brandOptions, setBrandOptions] = useState<Option[]>([]);
  const [modelOptions, setModelOptions] = useState<Option[]>([]);
  const [modelLabelById, setModelLabelById] = useState<Record<string, string>>({});
  const [loadedModelBrandIds, setLoadedModelBrandIds] = useState<Record<string, true>>({});
  const [yearOptions, setYearOptions] = useState<Option[]>([]);
  const [itemTypeOptions, setItemTypeOptions] = useState<Option[]>([]);
  const [partOptions, setPartOptions] = useState<Option[]>([]);
  const [partLabelById, setPartLabelById] = useState<Record<string, string>>({});
  const [loadedPartItemTypeIds, setLoadedPartItemTypeIds] = useState<Record<string, true>>({});
  const [form, setForm] = useState(initialForm);
  const [searchRequest, setSearchRequest] = useState<typeof initialForm | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchDemandsResponse["data"]["results"]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [collapseAfterSearch, setCollapseAfterSearch] = useState(false);
  const [revealState, setRevealState] = useState<
    Record<string, { loading: boolean; whatsappUrl?: string; didConsume?: boolean; error?: string }>
  >({});

  useEffect(() => {
    if (!token) {
      return;
    }

    api.get<OptionResponse>("/catalog/brands")
      .then((response) => {
        setBrandOptions(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch((err) => setError(toUiErrorMessage(err)));

    api.get<OptionResponse>("/catalog/years")
      .then((response) => {
        setYearOptions(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch((err) => setError(toUiErrorMessage(err)));

    api.get<OptionResponse>("/catalog/item-types")
      .then((response) => {
        setItemTypeOptions(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch((err) => setError(toUiErrorMessage(err)));
  }, [api, token]);

  useEffect(() => {
    if (!form.brandId) {
      setModelOptions([]);
      return;
    }
    api.get<ModelsResponse>("/catalog/models", { brandId: form.brandId })
      .then((response) => {
        const options = response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es }));
        setModelOptions(options);
        setModelLabelById((current) => {
          const next = { ...current };
          for (const opt of options) {
            next[opt.id] = opt.label;
          }
          return next;
        });
        setLoadedModelBrandIds((current) => ({ ...current, [form.brandId]: true }));
      })
      .catch((err) => {
        setModelOptions([]);
        setError(toUiErrorMessage(err));
      });
  }, [api, form.brandId]);

  useEffect(() => {
    const missingBrandIds = Array.from(
      new Set(
        results
          .map((card) => card.what.brandId)
          .filter((brandId) => Boolean(brandId) && !loadedModelBrandIds[brandId])
      )
    );

    if (missingBrandIds.length === 0) {
      return;
    }

    let cancelled = false;

    Promise.all(
      missingBrandIds.map((brandId) =>
        api.get<ModelsResponse>("/catalog/models", { brandId })
          .then((response) => ({ brandId, options: response.data.options }))
          .catch(() => ({ brandId, options: [] as Array<{ id: string; label_es: string }> }))
      )
    ).then((responses) => {
      if (cancelled) {
        return;
      }

      setModelLabelById((current) => {
        const next = { ...current };
        for (const response of responses) {
          for (const opt of response.options) {
            next[opt.id] = opt.label_es;
          }
        }
        return next;
      });

      setLoadedModelBrandIds((current) => {
        const next = { ...current };
        for (const response of responses) {
          next[response.brandId] = true;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [api, loadedModelBrandIds, results]);

  useEffect(() => {
    if (!form.itemTypeId) {
      setPartOptions([]);
      return;
    }
    api.get<OptionResponse>("/catalog/parts", { itemTypeId: form.itemTypeId })
      .then((response) => {
        const options = response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es }));
        setPartOptions(options);
        setPartLabelById((current) => {
          const next = { ...current };
          for (const opt of options) {
            next[opt.id] = opt.label;
          }
          return next;
        });
        setLoadedPartItemTypeIds((current) => ({ ...current, [form.itemTypeId]: true }));
      })
      .catch((err) => {
        setPartOptions([]);
        setError(toUiErrorMessage(err));
      });
  }, [api, form.itemTypeId]);

  useEffect(() => {
    const missingItemTypeIds = Array.from(
      new Set(
        results
          .map((card) => card.what.itemTypeId)
          .filter((itemTypeId) => Boolean(itemTypeId) && !loadedPartItemTypeIds[itemTypeId])
      )
    );

    if (missingItemTypeIds.length === 0) {
      return;
    }

    let cancelled = false;

    Promise.all(
      missingItemTypeIds.map((itemTypeId) =>
        api.get<OptionResponse>("/catalog/parts", { itemTypeId })
          .then((response) => ({ itemTypeId, options: response.data.options }))
          .catch(() => ({ itemTypeId, options: [] as Array<{ id: string; label_es: string }> }))
      )
    ).then((responses) => {
      if (cancelled) {
        return;
      }

      setPartLabelById((current) => {
        const next = { ...current };
        for (const response of responses) {
          for (const opt of response.options) {
            next[opt.id] = opt.label_es;
          }
        }
        return next;
      });

      setLoadedPartItemTypeIds((current) => {
        const next = { ...current };
        for (const response of responses) {
          next[response.itemTypeId] = true;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [api, loadedPartItemTypeIds, results]);

  useEffect(() => {
    if (!searchRequest) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    api.get<SearchDemandsResponse>("/search/demands", {
      page,
      pageSize,
      brandId: searchRequest.brandId || undefined,
      modelId: searchRequest.modelId || undefined,
      yearId: searchRequest.yearId || undefined,
      itemTypeId: searchRequest.itemTypeId || undefined,
      partId: searchRequest.partId || undefined
    })
      .then((response) => {
        setResults(response.data.results);
        setPageSize(response.data.pageSize);
        setTotal(response.data.total);
        if (collapseAfterSearch) {
          setFiltersExpanded(false);
          setCollapseAfterSearch(false);
        }
        if (response.data.results.length === 0) {
          setMessage("No active demand found.");
        }
      })
      .catch((err) => {
        if (collapseAfterSearch) {
          setCollapseAfterSearch(false);
        }
        setError(toUiErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [api, page, pageSize, searchRequest, collapseAfterSearch]);

  const labelMaps = useMemo(() => {
    const toMap = (options: Option[]) => new Map(options.map((opt) => [opt.id, opt.label]));
    return {
      brands: toMap(brandOptions),
      models: toMap(modelOptions),
      years: toMap(yearOptions),
      itemTypes: toMap(itemTypeOptions),
      parts: toMap(partOptions)
    };
  }, [brandOptions, modelOptions, yearOptions, itemTypeOptions, partOptions]);

  function updateField(field: keyof typeof initialForm, value: string) {
    setForm((current) => {
      if (field === "brandId") {
        return { ...current, brandId: value, modelId: "" };
      }
      if (field === "itemTypeId") {
        return { ...current, itemTypeId: value, partId: "" };
      }
      return { ...current, [field]: value };
    });
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }
    setSearched(true);
    setPage(1);
    setSearchRequest({ ...form });
  }

  function onHeaderAction() {
    if (loading) {
      return;
    }
    if (!filtersExpanded) {
      setFiltersExpanded(true);
      return;
    }
    setSearched(true);
    setPage(1);
    setCollapseAfterSearch(true);
    setSearchRequest({ ...form });
  }

  const canGoNext = page * pageSize < total;

  function formatWhen(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 1) {
      return "Hace un momento";
    }
    if (minutes < 60) {
      return `Hace ${minutes} min`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `Hace ${hours} h`;
    }
    const days = Math.round(hours / 24);
    if (days < 7) {
      return `Hace ${days} dias`;
    }
    return date.toLocaleString();
  }

  function safeLabel(map: Map<string, string>, id: string, fallback: string) {
    return map.get(id) ?? fallback;
  }

  async function onReveal(demandId: string) {
    if (revealState[demandId]?.loading || revealState[demandId]?.whatsappUrl) {
      return;
    }

    setRevealState((current) => ({ ...current, [demandId]: { loading: true } }));

    try {
      const response = await api.post<DemandRevealResponse>("/contact-access", { demandId }, { suppressGlobalLoader: true });
      setRevealState((current) => ({
        ...current,
        [demandId]: {
          loading: false,
          whatsappUrl: response.data.whatsappUrl,
          didConsume: response.data.didConsume
        }
      }));
    } catch (err) {
      setRevealState((current) => ({
        ...current,
        [demandId]: {
          loading: false,
          error: toUiErrorMessage(err)
        }
      }));
    }
  }

  return (
    <div className="screen stack gap-lg">
      {!filtersExpanded ? (
        <button
          type="button"
          className="ghost demand-refine-button"
          onClick={onHeaderAction}
          disabled={loading}
        >
          Refinar búsqueda
        </button>
      ) : null}

      <div className={`collapsible-panel${filtersExpanded ? "" : " is-collapsed"}`}>
        <Card className="stack">
          <form onSubmit={onSearch} className="stack">
          <FilterSelect
            label="Marca"
            value={form.brandId}
            options={brandOptions}
            onChange={(value) => updateField("brandId", value)}
            placeholder="Selecciona"
          />

          <FilterSelect
            label="Modelo"
            value={form.modelId}
            options={modelOptions}
            onChange={(value) => updateField("modelId", value)}
            disabled={!form.brandId}
            placeholder="Selecciona"
          />

          <FilterSelect
            label="Año"
            value={form.yearId}
            options={yearOptions}
            onChange={(value) => updateField("yearId", value)}
            placeholder="Selecciona"
          />

          <FilterSelect
            label="Sistema"
            value={form.itemTypeId}
            options={itemTypeOptions}
            onChange={(value) => updateField("itemTypeId", value)}
            placeholder="Selecciona"
          />

          <FilterSelect
            label="Pieza"
            value={form.partId}
            options={partOptions}
            onChange={(value) => updateField("partId", value)}
            disabled={!form.itemTypeId}
            placeholder="Selecciona"
          />
          <button type="button" className="ghost" onClick={onHeaderAction} disabled={loading}>
            Buscar
          </button>
          </form>
        </Card>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="info">{message}</p> : null}
      {searched && !loading && results.length === 0 ? (
        <Card>
          <p>No active demand found.</p>
        </Card>
      ) : null}

      {results.map((card) => (
        <article key={card.demandId} className="card stack card-elevated demand-card-compact">
          <h3>
            {`${partLabelById[card.what.partId] ?? "—"} PARA ${safeLabel(labelMaps.brands, card.what.brandId, "—")} ${modelLabelById[card.what.modelId] ?? "—"} ${safeLabel(labelMaps.years, card.what.yearId, "—")}`.toUpperCase()}
          </h3>
          {card.request.detailsText ? (
            <p><strong>Detalle:</strong> {card.request.detailsText}</p>
          ) : null}
          <p><strong>Creado:</strong> {formatWhen(card.audit.createdAt)}</p>
          {card.audit.requesterUserId === userId ? (
            <p className="info">This is your demand.</p>
          ) : (
            <RevealButton
              loading={revealState[card.demandId]?.loading}
              whatsappUrl={revealState[card.demandId]?.whatsappUrl}
              error={revealState[card.demandId]?.error}
              onReveal={() => onReveal(card.demandId)}
            />
          )}
        </article>
      ))}

      {searched ? (
        <div className="pager">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page === 1 || loading}
          >
            Prev
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={loading || !canGoNext}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
