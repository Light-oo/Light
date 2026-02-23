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
  const [yearOptions, setYearOptions] = useState<Option[]>([]);
  const [itemTypeOptions, setItemTypeOptions] = useState<Option[]>([]);
  const [partOptions, setPartOptions] = useState<Option[]>([]);
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
        setModelOptions(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch((err) => {
        setModelOptions([]);
        setError(toUiErrorMessage(err));
      });
  }, [api, form.brandId]);

  useEffect(() => {
    if (!form.itemTypeId) {
      setPartOptions([]);
      return;
    }
    api.get<OptionResponse>("/catalog/parts", { itemTypeId: form.itemTypeId })
      .then((response) => {
        setPartOptions(response.data.options.map((opt) => ({ id: opt.id, label: opt.label_es })));
      })
      .catch((err) => {
        setPartOptions([]);
        setError(toUiErrorMessage(err));
      });
  }, [api, form.itemTypeId]);

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
        if (response.data.results.length === 0) {
          setMessage("No active demand found.");
        }
      })
      .catch((err) => setError(toUiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [api, page, pageSize, searchRequest]);

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

  const canGoNext = page * pageSize < total;

  async function onReveal(demandId: string) {
    if (revealState[demandId]?.loading || revealState[demandId]?.whatsappUrl) {
      return;
    }

    setRevealState((current) => ({ ...current, [demandId]: { loading: true } }));

    try {
      const response = await api.post<DemandRevealResponse>("/contact-access", { demandId });
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
      <h2 className="page-title">Search Demands</h2>

      <Card className="stack">
        <form onSubmit={onSearch} className="stack">
          <FilterSelect
            label="Brand"
            value={form.brandId}
            options={brandOptions}
            onChange={(value) => updateField("brandId", value)}
            placeholder="All"
          />

          <FilterSelect
            label="Model"
            value={form.modelId}
            options={modelOptions}
            onChange={(value) => updateField("modelId", value)}
            disabled={!form.brandId}
            placeholder="All"
          />

          <FilterSelect
            label="Year"
            value={form.yearId}
            options={yearOptions}
            onChange={(value) => updateField("yearId", value)}
            placeholder="All"
          />

          <FilterSelect
            label="Item Type"
            value={form.itemTypeId}
            options={itemTypeOptions}
            onChange={(value) => updateField("itemTypeId", value)}
            placeholder="All"
          />

          <FilterSelect
            label="Part"
            value={form.partId}
            options={partOptions}
            onChange={(value) => updateField("partId", value)}
            disabled={!form.itemTypeId}
            placeholder="All"
          />

          <button type="submit" disabled={loading}>
            {loading ? "Searching..." : "Search Demands"}
          </button>
        </form>
      </Card>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="info">{message}</p> : null}
      {loading ? <p>Loading demands...</p> : null}

      {searched && !loading && results.length === 0 ? (
        <Card>
          <p>No active demand found.</p>
        </Card>
      ) : null}

      {results.map((card) => (
        <article key={card.demandId} className="card stack card-elevated">
          <h3>
            {labelMaps.brands.get(card.what.brandId) ?? card.what.brandId}
            {" "}
            {labelMaps.models.get(card.what.modelId) ?? card.what.modelId}
          </h3>
          <p>
            <strong>Part:</strong>{" "}
            {labelMaps.parts.get(card.what.partId) ?? card.what.partId}
          </p>
          <p>
            <strong>Year:</strong>{" "}
            {labelMaps.years.get(card.what.yearId) ?? card.what.yearId}
          </p>
          <p>
            <strong>System:</strong>{" "}
            {labelMaps.itemTypes.get(card.what.itemTypeId) ?? card.what.itemTypeId}
          </p>
          {card.request.detailsText ? (
            <p><strong>Details:</strong> {card.request.detailsText}</p>
          ) : null}
          <p><strong>Created:</strong> {new Date(card.audit.createdAt).toLocaleString()}</p>
          {card.audit.requesterUserId === userId ? (
            <p className="info">This is your demand.</p>
          ) : (
            <RevealButton
              loading={revealState[card.demandId]?.loading}
              whatsappUrl={revealState[card.demandId]?.whatsappUrl}
              didConsume={revealState[card.demandId]?.didConsume}
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
