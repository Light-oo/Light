import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { FilterSelect } from "../components/FilterSelect";
import { RevealButton } from "../components/RevealButton";
import { useMarket } from "../context/MarketContext";
import { useOptions } from "../context/OptionsContext";
import { toUiErrorMessage } from "../lib/errorMessages";
import {
  formatAutomotiveCardLines,
  formatHomeServicesNarrative,
  isAutomotiveIdentity,
  isHomeServicesIdentity
} from "../lib/listingDisplay";
import {
  buildDependencyMaps,
  dependencyQueryForField,
  hasDependencyParentsSelected,
  normalizeMarketDependencies,
  normalizeMarketFields,
  resetDependentValues,
  resolveOrderedFlowFields,
  type MarketDependency,
  type MarketFieldDefinition
} from "../lib/marketForm";
import { type Option } from "../lib/marketOptions";
import { mapFieldOptionsForUi } from "../lib/travelRangeOptions";

type MarketDefinitionResponse = {
  ok: true;
  data: {
    market: {
      key: string;
      label: string;
      active: boolean;
    };
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
    dependencies?: Array<{
      fieldKey?: string;
      field_key?: string;
      dependsOnFieldKey?: string;
      depends_on_field_key?: string;
      order?: number;
      sortOrder?: number;
    }>;
  };
};

type DemandSearchResult = {
  id: string;
  marketKey: string;
  identityValues: Record<string, string>;
  signature: string;
  status: string;
  created_at: string;
  type: "buy";
  request?: {
    detailsText?: string | null;
  };
  location?: {
    department?: string | null;
  };
  audit?: {
    requesterUserId?: string | null;
    createdAt?: string;
  };
};

type DemandSearchResponse = {
  ok: true;
  marketKey?: string;
  results?: DemandSearchResult[];
  page?: number;
  pageSize?: number;
  total?: number;
  data?: {
    marketKey?: string;
    results?: DemandSearchResult[];
    page?: number;
    pageSize?: number;
    total?: number;
  };
};

type RevealResponse = {
  ok: true;
  data: {
    demandId: string;
    whatsappUrl: string;
    didConsume: boolean;
  };
};

const HOME_SERVICES_RUNTIME_FIELDS = new Set(["trade", "experience", "work_area", "detail"]);

function normalizeDemandSearchResponse(payload: DemandSearchResponse) {
  if (payload.ok !== true) {
    throw new Error("invalid_demand_search_response");
  }

  if (Array.isArray(payload.results)) {
    return {
      results: payload.results,
      page: Number(payload.page ?? 1),
      pageSize: Number(payload.pageSize ?? 20),
      total: Number(payload.total ?? payload.results.length)
    };
  }

  if (Array.isArray(payload.data?.results)) {
    return {
      results: payload.data.results,
      page: Number(payload.data.page ?? payload.page ?? 1),
      pageSize: Number(payload.data.pageSize ?? payload.pageSize ?? 20),
      total: Number(payload.data.total ?? payload.total ?? payload.data.results.length)
    };
  }

  throw new Error("invalid_demand_search_response");
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

export function SellDemandsPage() {
  const { api, token, userId } = useAuth();
  const { getOptions } = useOptions();
  const { marketKey, availableMarkets, setMarket } = useMarket();

  const [marketFields, setMarketFields] = useState<MarketFieldDefinition[]>([]);
  const [marketDependencies, setMarketDependencies] = useState<MarketDependency[]>([]);
  const [marketDefinitionLoaded, setMarketDefinitionLoaded] = useState(false);
  const [marketDefinitionKey, setMarketDefinitionKey] = useState<string | null>(null);

  const [optionsByFieldKey, setOptionsByFieldKey] = useState<Record<string, Option[]>>({});
  const [structuredValues, setStructuredValues] = useState<Record<string, string>>({});
  const [searched, setSearched] = useState(false);
  const [searchRequest, setSearchRequest] = useState<Record<string, string> | null>(null);
  const [results, setResults] = useState<DemandSearchResult[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revealState, setRevealState] = useState<
    Record<string, { loading: boolean; whatsappUrl?: string; didConsume?: boolean; error?: string }>
  >({});

  const marketOptions = useMemo<Option[]>(
    () => availableMarkets.map((market) => ({ id: market.key, label: market.label })),
    [availableMarkets]
  );

  useEffect(() => {
    setMarketDefinitionLoaded(false);
    setMarketDefinitionKey(null);
    setMarketFields([]);
    setMarketDependencies([]);
    setOptionsByFieldKey({});
    setStructuredValues({});
    setSearched(false);
    setSearchRequest(null);
    setResults([]);
    setPage(1);
    setPageSize(20);
    setTotal(0);
    setError(null);
    setMessage(null);
    setRevealState({});
  }, [marketKey]);

  useEffect(() => {
    if (!token || !marketKey) {
      return;
    }

    let cancelled = false;
    const requestedMarketKey = marketKey;

    api
      .get<MarketDefinitionResponse>(`/catalog/markets/${encodeURIComponent(marketKey)}`)
      .then((response) => {
        if (cancelled || requestedMarketKey !== marketKey) {
          return;
        }
        setMarketFields(normalizeMarketFields(response.data.fields));
        setMarketDependencies(normalizeMarketDependencies(response.data.dependencies ?? []));
        setMarketDefinitionLoaded(true);
        setMarketDefinitionKey(requestedMarketKey);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(toUiErrorMessage(err));
        setMarketDefinitionLoaded(false);
        setMarketDefinitionKey(null);
      });

    return () => {
      cancelled = true;
    };
  }, [api, marketKey, token]);

  const sellFields = useMemo(
    () => resolveOrderedFlowFields(marketFields, "SELL"),
    [marketFields]
  );
  const normalizedMarketKey = (marketKey ?? "").trim().toLowerCase();
  const isHomeServicesMarket = normalizedMarketKey === "home_services";
  const sellFormFields = useMemo(
    () =>
      isHomeServicesMarket
        ? sellFields.filter((field) =>
            HOME_SERVICES_RUNTIME_FIELDS.has(field.key.toLowerCase())
          )
        : sellFields,
    [isHomeServicesMarket, sellFields]
  );

  const dependencyMaps = useMemo(
    () => buildDependencyMaps(marketDependencies),
    [marketDependencies]
  );

  const sellFieldKeysSignature = useMemo(
    () => sellFormFields.map((field) => field.key).join("|"),
    [sellFormFields]
  );

  function getFieldLabel(field: MarketFieldDefinition) {
    const key = field.key.toLowerCase();
    if (key === "detail") {
      return "Detalles (opcional)";
    }
    if (key === "trade") {
      return "Oficio";
    }
    if (key === "work_area") {
      return "Zona de trabajo";
    }
    return field.label;
  }

  function areSameOptions(left: Option[], right: Option[]) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (left[index]?.id !== right[index]?.id || left[index]?.label !== right[index]?.label) {
        return false;
      }
    }
    return true;
  }

  function setFieldOptions(fieldKey: string, nextOptions: Option[]) {
    setOptionsByFieldKey((current) => {
      const previous = current[fieldKey] ?? [];
      if (areSameOptions(previous, nextOptions)) {
        return current;
      }
      return { ...current, [fieldKey]: nextOptions };
    });
  }

  async function getOrLoadFieldOptions(fieldKey: string, dependencyQuery: Record<string, string>) {
    const requestMarketKey = marketKey ?? "";
    const rows = await getOptions({
      marketKey: requestMarketKey,
      fieldKey,
      deps: dependencyQuery
    });
    return mapFieldOptionsForUi(
      fieldKey,
      rows
        .map((option) => {
          const key = String(option.key ?? "").trim();
          if (!key) {
            return null;
          }
          return {
            id: key,
            label: option.label_es ?? option.label ?? key
          } satisfies Option;
        })
        .filter((option): option is Option => option !== null)
    );
  }

  useEffect(() => {
    setOptionsByFieldKey({});
  }, [marketKey, sellFieldKeysSignature]);

  useEffect(() => {
    if (
      !token ||
      !marketKey ||
      !marketDefinitionLoaded ||
      marketDefinitionKey !== marketKey ||
      sellFormFields.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const independentFields = sellFormFields.filter((field) => {
      const inputType = field.inputType.toLowerCase();
      if (inputType === "text" || inputType === "number") {
        return false;
      }
      return (dependencyMaps.parentKeysByChild[field.key]?.length ?? 0) === 0;
    });

    async function loadIndependentOptions() {
      for (const field of independentFields) {
        try {
          const options = await getOrLoadFieldOptions(field.key, {});
          if (cancelled) {
            return;
          }
          setFieldOptions(field.key, options);
        } catch (err) {
          if (cancelled) {
            return;
          }
          setFieldOptions(field.key, []);
          setError(toUiErrorMessage(err));
        }
      }
    }

    void loadIndependentOptions();
    return () => {
      cancelled = true;
    };
  }, [
    dependencyMaps.parentKeysByChild,
    marketDefinitionLoaded,
    marketDefinitionKey,
    marketKey,
    sellFormFields,
    token
  ]);

  useEffect(() => {
    if (
      !token ||
      !marketKey ||
      !marketDefinitionLoaded ||
      marketDefinitionKey !== marketKey ||
      sellFormFields.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const dependentFields = sellFormFields.filter((field) => {
      const inputType = field.inputType.toLowerCase();
      if (inputType === "text" || inputType === "number") {
        return false;
      }
      return (dependencyMaps.parentKeysByChild[field.key]?.length ?? 0) > 0;
    });

    async function loadDependentOptions() {
      for (const field of dependentFields) {
        const dependenciesReady = hasDependencyParentsSelected(
          field.key,
          structuredValues,
          dependencyMaps.parentKeysByChild
        );

        if (!dependenciesReady) {
          setFieldOptions(field.key, []);
          continue;
        }

        const dependencyQuery = dependencyQueryForField(
          field.key,
          structuredValues,
          dependencyMaps.parentKeysByChild
        );

        try {
          const options = await getOrLoadFieldOptions(field.key, dependencyQuery);
          if (cancelled) {
            return;
          }
          setFieldOptions(field.key, options);
        } catch (err) {
          if (cancelled) {
            return;
          }
          setFieldOptions(field.key, []);
          setError(toUiErrorMessage(err));
        }
      }
    }

    void loadDependentOptions();
    return () => {
      cancelled = true;
    };
  }, [
    getOptions,
    dependencyMaps.parentKeysByChild,
    marketDefinitionLoaded,
    marketDefinitionKey,
    marketKey,
    sellFormFields,
    structuredValues,
    token
  ]);

  function isFieldDisabled(fieldKey: string) {
    return !hasDependencyParentsSelected(
      fieldKey,
      structuredValues,
      dependencyMaps.parentKeysByChild
    );
  }

  function optionsForField(fieldKey: string) {
    return optionsByFieldKey[fieldKey] ?? [];
  }

  function normalizeDisplayToken(value: string) {
    const normalized = value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  function resolveFieldDisplayValue(fieldKey: string, value: string) {
    const options = optionsByFieldKey[fieldKey] ?? [];
    const exact = options.find((option) => option.id === value)?.label;
    if (exact) {
      return exact;
    }
    return normalizeDisplayToken(value);
  }

  function updateField(fieldKey: string, value: string) {
    setMessage(null);
    setError(null);

    setStructuredValues((current) => {
      const next = value ? { ...current, [fieldKey]: value } : { ...current };
      if (!value) {
        delete next[fieldKey];
      }
      return resetDependentValues(fieldKey, next, dependencyMaps.childKeysByParent);
    });
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    if (loading || !marketKey) {
      return;
    }

    setSearched(true);
    setPage(1);
    setSearchRequest({ ...structuredValues });
  }

  useEffect(() => {
    if (!searchRequest || !marketKey) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const query: Record<string, string | number | undefined> = {
      mode: "SELL",
      marketKey,
      page,
      pageSize
    };
    for (const [fieldKey, value] of Object.entries(searchRequest)) {
      if (value) {
        query[fieldKey] = value;
      }
    }

    api
      .get<DemandSearchResponse>("/search/listings", query)
      .then((response) => {
        const normalized = normalizeDemandSearchResponse(response);
        setResults(normalized.results);
        setPageSize(normalized.pageSize);
        setTotal(normalized.total);
        if (normalized.results.length === 0) {
          setMessage("No hay búsquedas activas.");
        }
      })
      .catch((err) => {
        setError(toUiErrorMessage(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [api, marketKey, page, pageSize, searchRequest]);

  async function onReveal(demandId: string) {
    if (revealState[demandId]?.loading || revealState[demandId]?.whatsappUrl) {
      return;
    }

    setRevealState((current) => ({
      ...current,
      [demandId]: {
        loading: true
      }
    }));

    try {
      const response = await api.post<RevealResponse>(
        "/contact-access",
        { demandId },
        { suppressGlobalLoader: true }
      );

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

  const canGoNext = page * pageSize < total;

  return (
    <div className="screen stack gap-lg">
      <Card className="stack">
        <form className="stack" onSubmit={onSearch}>
          <FilterSelect
            label="Mercado"
            value={marketKey ?? ""}
            options={marketOptions}
            required
            disabled={false}
            onChange={(value) => {
              if (value) {
                setMarket(value);
              }
            }}
          />

          {marketKey ? sellFormFields.map((field) => {
            const inputType = field.inputType.toLowerCase();
            if (inputType === "text" || inputType === "number") {
              return (
                <label key={field.key}>
                  {getFieldLabel(field)}
                  <input
                    type={inputType}
                    value={structuredValues[field.key] ?? ""}
                    disabled={isFieldDisabled(field.key)}
                    onChange={(event) => updateField(field.key, event.target.value)}
                  />
                </label>
              );
            }

            return (
              <FilterSelect
                key={field.key}
                label={getFieldLabel(field)}
                value={structuredValues[field.key] ?? ""}
                options={optionsForField(field.key)}
                disabled={isFieldDisabled(field.key)}
                onChange={(value) => updateField(field.key, value)}
                placeholder="Todos/as"
              />
            );
          }) : null}

          <button type="submit" disabled={!marketKey || loading}>
            {loading ? "Buscando..." : "Ver Búsquedas"}
          </button>
        </form>
      </Card>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="info">{message}</p> : null}
      {searched && !loading && results.length === 0 && !message ? (
        <Card>
          <p>No hay búsquedas activas.</p>
        </Card>
      ) : null}

      {results.map((card) => {
        const displayIdentityValues = Object.fromEntries(
          Object.entries(card.identityValues).map(([fieldKey, value]) => [
            fieldKey,
            resolveFieldDisplayValue(fieldKey, value)
          ])
        );
        const automotiveLines =
          normalizedMarketKey === "automotive" && isAutomotiveIdentity(displayIdentityValues)
            ? formatAutomotiveCardLines(displayIdentityValues)
            : null;
        const createdAt = card.created_at || card.audit?.createdAt || "";
        const narrative = isHomeServicesIdentity(displayIdentityValues)
          ? formatHomeServicesNarrative({
            intent: "BUY",
            identityValues: displayIdentityValues
          })
          : null;
        const requesterUserId = String(card.audit?.requesterUserId ?? "").trim();
        const reveal = revealState[card.id];

        return (
          <article key={card.id} className="card stack card-elevated demand-card-compact">
            <p><strong>{narrative ? `Busco ${narrative.headline}` : `Busco ${automotiveLines?.partLine || "Pieza"}`}</strong></p>
            {narrative ? (
              <>
                <p>{narrative.secondaryLine}</p>
              </>
            ) : (
              <>
                {automotiveLines?.vehicleLine ? <p>{automotiveLines.vehicleLine}</p> : null}
              </>
            )}
            <p>Creado: {formatWhen(createdAt)}</p>
            {requesterUserId && requesterUserId === userId ? (
              <p className="info">Esta es su búsqueda.</p>
            ) : (
              <RevealButton
                loading={reveal?.loading}
                whatsappUrl={reveal?.whatsappUrl}
                error={reveal?.error}
                onReveal={() => onReveal(card.id)}
              />
            )}
          </article>
        );
      })}

      {searched ? (
        <div className="pager">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page === 1 || loading}
          >
            Anterior
          </button>
          <span>Página {page}</span>
          <button
            type="button"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={loading || !canGoNext}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
