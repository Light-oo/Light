import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { FilterSelect } from "../components/FilterSelect";
import { RevealButton } from "../components/RevealButton";
import { debugLog } from "../lib/debug";
import { toUiErrorMessage } from "../lib/errorMessages";
import {
  extractBrandOptions,
  extractItemTypeOptions,
  extractModelOptions,
  extractYearOptions,
  type Option
} from "../lib/marketOptions";
import { fetchMarketOptions, type MarketOptionRow } from "../lib/supabaseData";

type BuyCard = {
  cardType: "sell";
  listingId: string;
  what: {
    brandLabelEs: string;
    modelLabelEs: string;
    year: number;
    partLabelEs: string;
  };
  price: { amount: number; currency: string };
  location: { department?: string; municipality?: string };
  audit: { createdAt: string };
};

type SearchResponse = {
  ok: true;
  results: BuyCard[];
  page: number;
  pageSize: number;
  total: number;
};

type RevealResponse = {
  ok: true;
  data: {
    listingId: string;
    whatsappUrl: string;
    didConsume: boolean;
  };
};

type PartsResponse = {
  ok: true;
  data: {
    options: Array<{ id: string; label: string }>;
  };
};

const SEARCH_STATE_KEY = "light_search_state_v1";

const initialForm = {
  brandId: "",
  modelId: "",
  yearId: "",
  itemTypeId: "",
  partId: "",
  detailsText: ""
};

const requiredBuyFields: Array<keyof typeof initialForm> = [
  "brandId",
  "modelId",
  "yearId",
  "itemTypeId",
  "partId"
];

function parseStoredState() {
  try {
    const raw = localStorage.getItem(SEARCH_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { form?: Partial<typeof initialForm> };
    return {
      brandId: String(parsed.form?.brandId ?? ""),
      modelId: String(parsed.form?.modelId ?? ""),
      yearId: String(parsed.form?.yearId ?? ""),
      itemTypeId: String(parsed.form?.itemTypeId ?? ""),
      partId: String(parsed.form?.partId ?? ""),
      detailsText: String(parsed.form?.detailsText ?? "")
    };
  } catch {
    return null;
  }
}

export function BuySearchPage() {
  const { api, token } = useAuth();
  const [marketRows, setMarketRows] = useState<MarketOptionRow[]>([]);
  const [form, setForm] = useState(initialForm);
  const [partOptions, setPartOptions] = useState<Option[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchRequest, setSearchRequest] = useState<typeof initialForm | null>(null);
  const [results, setResults] = useState<BuyCard[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isSearchQueued, setIsSearchQueued] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [revealState, setRevealState] = useState<
    Record<string, { loading: boolean; whatsappUrl?: string; didConsume?: boolean; error?: string }>
  >({});
  const searchDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    const stored = parseStoredState();
    if (stored) {
      setForm(stored);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    localStorage.setItem(
      SEARCH_STATE_KEY,
      JSON.stringify({
        form
      })
    );
  }, [hydrated, form]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        window.clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    fetchMarketOptions(token)
      .then(setMarketRows)
      .catch((err) => setError(toUiErrorMessage(err)));
  }, [token]);

  useEffect(() => {
    if (!form.itemTypeId) {
      setPartOptions([]);
      return;
    }

    api.get<PartsResponse>("/catalog/parts", { itemTypeId: form.itemTypeId })
      .then((response) => {
        setPartOptions(response.data.options.map((option) => ({ id: option.id, label: option.label })));
      })
      .catch(() => {
        setPartOptions([]);
      });
  }, [api, form.itemTypeId]);

  useEffect(() => {
    if (!searchRequest) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const query: Record<string, string | number | undefined> = {
      mode: "BUY",
      page,
      pageSize,
      brandId: searchRequest.brandId,
      modelId: searchRequest.modelId,
      yearId: searchRequest.yearId,
      itemTypeId: searchRequest.itemTypeId,
      partId: searchRequest.partId,
      detailsText: searchRequest.detailsText || undefined
    };

    debugLog("search.request", {
      mode: "BUY",
      page,
      pageSize,
      filters: query
    });

    api.get<SearchResponse>("/search/listings", query)
      .then((response) => {
        debugLog("search.success", {
          mode: "BUY",
          total: response.total,
          count: response.results.length,
          page: response.page
        });

        setResults(response.results);
        setPageSize(response.pageSize);
        setTotal(response.total);

        if (response.results.length === 0) {
          setMessage("No results. Demand was registered for this signature.");
        }
      })
      .catch((apiError) => {
        debugLog("search.error", {
          mode: "BUY",
          message: apiError instanceof Error ? apiError.message : "unknown"
        });
        setError(toUiErrorMessage(apiError));
      })
      .finally(() => setLoading(false));
  }, [api, page, searchRequest, pageSize]);

  const brandOptions = useMemo(() => extractBrandOptions(marketRows), [marketRows]);
  const modelOptions = useMemo(() => extractModelOptions(marketRows, form.brandId), [marketRows, form.brandId]);
  const yearOptions = useMemo(
    () => extractYearOptions(marketRows, form.brandId, form.modelId),
    [marketRows, form.brandId, form.modelId]
  );
  const itemTypeOptions = useMemo(
    () => extractItemTypeOptions(marketRows, form.brandId, form.modelId, form.yearId),
    [marketRows, form.brandId, form.modelId, form.yearId]
  );

  function updateField(field: keyof typeof initialForm, value: string) {
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

  function onSearch(event: FormEvent) {
    event.preventDefault();

    if (loading || isSearchQueued) {
      return;
    }

    const missing = requiredBuyFields.find((field) => !form[field]);
    if (missing) {
      setError("Please complete all required BUY filters.");
      return;
    }

    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }

    setError(null);
    setIsSearchQueued(true);

    searchDebounceRef.current = window.setTimeout(() => {
      setSearched(true);
      setPage(1);
      setSearchRequest({ ...form });
      setIsSearchQueued(false);
      searchDebounceRef.current = null;
    }, 300);
  }

  async function onReveal(listingId: string) {
    if (revealState[listingId]?.loading || revealState[listingId]?.whatsappUrl) {
      return;
    }

    setRevealState((current) => ({ ...current, [listingId]: { loading: true } }));
    debugLog("reveal.request", { listingId });

    try {
      const response = await api.post<RevealResponse>("/contact-access", { listingId });
      debugLog("reveal.success", {
        listingId,
        didConsume: response.data.didConsume
      });

      setRevealState((current) => ({
        ...current,
        [listingId]: {
          loading: false,
          whatsappUrl: response.data.whatsappUrl,
          didConsume: response.data.didConsume
        }
      }));
    } catch (err) {
      debugLog("reveal.error", {
        listingId,
        message: err instanceof Error ? err.message : "unknown"
      });

      setRevealState((current) => ({
        ...current,
        [listingId]: { loading: false, error: toUiErrorMessage(err) }
      }));
    }
  }

  const canGoNext = page * pageSize < total;

  return (
    <div className="screen stack gap-lg">
      <h2 className="page-title">Search</h2>

      <Card className="stack">
        <form onSubmit={onSearch} className="stack">
          <FilterSelect
            label="Brand"
            value={form.brandId}
            options={brandOptions}
            required
            onChange={(value) => updateField("brandId", value)}
          />

          <FilterSelect
            label="Model"
            value={form.modelId}
            options={modelOptions}
            required
            disabled={!form.brandId}
            onChange={(value) => updateField("modelId", value)}
          />

          <FilterSelect
            label="Year"
            value={form.yearId}
            options={yearOptions}
            required
            disabled={!form.modelId}
            onChange={(value) => updateField("yearId", value)}
          />

          <FilterSelect
            label="Item Type"
            value={form.itemTypeId}
            options={itemTypeOptions}
            required
            disabled={!form.yearId}
            onChange={(value) => updateField("itemTypeId", value)}
          />

          <FilterSelect
            label="Part"
            value={form.partId}
            options={partOptions}
            required
            disabled={!form.itemTypeId}
            onChange={(value) => updateField("partId", value)}
          />

          <label>
            Detail (optional)
            <input
              type="text"
              value={form.detailsText}
              onChange={(event) => updateField("detailsText", event.target.value)}
              placeholder="Any specific note"
            />
          </label>

          <button type="submit" disabled={loading || isSearchQueued}>
            {loading || isSearchQueued ? "Searching..." : "Search"}
          </button>
        </form>
      </Card>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="info">{message}</p> : null}
      {loading ? <p>Loading results...</p> : null}

      {searched && !loading && results.length === 0 ? (
        <Card>
          <p>No results.</p>
        </Card>
      ) : null}

      {results.map((card) => {
        if (card.cardType !== "sell") {
          return null;
        }

        const reveal = revealState[card.listingId];
        return (
          <article key={card.listingId} className="card stack card-elevated">
            <h3>{card.what.brandLabelEs} {card.what.modelLabelEs}</h3>
            <p><strong>Part:</strong> {card.what.partLabelEs} ({card.what.year})</p>
            <p><strong>Price:</strong> {card.price.amount} {card.price.currency}</p>
            <p><strong>Location:</strong> {card.location.department ?? "-"}, {card.location.municipality ?? "-"}</p>
            <p><strong>Created:</strong> {new Date(card.audit.createdAt).toLocaleString()}</p>

            <RevealButton
              loading={reveal?.loading}
              whatsappUrl={reveal?.whatsappUrl}
              didConsume={reveal?.didConsume}
              error={reveal?.error}
              onReveal={() => onReveal(card.listingId)}
            />
          </article>
        );
      })}

      {searched ? (
        <div className="pager">
          <button type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1 || loading}>
            Prev
          </button>
          <span>Page {page}</span>
          <button type="button" onClick={() => setPage((prev) => prev + 1)} disabled={loading || !canGoNext}>
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

