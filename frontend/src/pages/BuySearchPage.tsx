import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { FilterSelect } from "../components/FilterSelect";
import { RevealButton } from "../components/RevealButton";
import { useMarket } from "../context/MarketContext";
import { useOptions } from "../context/OptionsContext";
import { buildBuySearchQuery, normalizeBuySearchResponse } from "../lib/buyEngine";
import { debugLog } from "../lib/debug";
import { toUiErrorMessage } from "../lib/errorMessages";
import {
  buildGenericCardContent,
  extractIdentityValuesForFields,
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

type BuyCard = {
  id: string;
  marketKey: string;
  identityValues: Record<string, string>;
  signature: string;
  status: string;
  created_at: string;
  type: "sell";
  price: { amount: number; currency: string; type?: string };
  location: { department?: string; municipality?: string };
  audit?: { createdAt?: string; ownerUserId?: string | null };
};

type RevealResponse = {
  ok: true;
  data: {
    listingId: string;
    whatsappUrl: string;
    didConsume: boolean;
  };
};

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

export function BuySearchPage() {
  const { api, token } = useAuth();
  const { getOptions } = useOptions();
  const { marketKey, availableMarkets, setMarket } = useMarket();
  const [marketFields, setMarketFields] = useState<MarketFieldDefinition[]>([]);
  const [marketDependencies, setMarketDependencies] = useState<MarketDependency[]>([]);
  const [marketDefinitionLoaded, setMarketDefinitionLoaded] = useState(false);
  const [marketDefinitionKey, setMarketDefinitionKey] = useState<string | null>(null);
  const [optionsByFieldKey, setOptionsByFieldKey] = useState<Record<string, Option[]>>({});
  const [structuredValues, setStructuredValues] = useState<Record<string, string>>({});
  const [detailsText, setDetailsText] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchRequest, setSearchRequest] = useState<{
    structuredValues: Record<string, string>;
    detailsText: string;
  } | null>(null);
  const [results, setResults] = useState<BuyCard[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isSearchQueued, setIsSearchQueued] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealState, setRevealState] = useState<
    Record<string, { loading: boolean; whatsappUrl?: string; didConsume?: boolean; error?: string }>
  >({});
  const searchDebounceRef = useRef<number | null>(null);
  const optionIdToKeyRef = useRef<Record<string, Record<string, string>>>({});

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        window.clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setMarketDefinitionLoaded(false);
    setMarketDefinitionKey(null);
    setMarketFields([]);
    setMarketDependencies([]);
    setOptionsByFieldKey({});
    setStructuredValues({});
    setDetailsText("");
    setSearched(false);
    setSearchRequest(null);
    setResults([]);
    setPage(1);
    setTotal(0);
    setMessage(null);
    setError(null);
    setRevealState({});
    optionIdToKeyRef.current = {};
  }, [marketKey]);

  useEffect(() => {
    if (!token || !marketKey) {
      return;
    }

    let cancelled = false;
    const requestedMarketKey = marketKey;

    api.get<MarketDefinitionResponse>(`/catalog/markets/${encodeURIComponent(marketKey)}`)
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

  const buyFields = useMemo(
    () => resolveOrderedFlowFields(marketFields, "BUY"),
    [marketFields]
  );
  const searchFormFields = useMemo(
    () => buyFields.filter((field) => field.key.trim().toLowerCase() !== "price"),
    [buyFields]
  );
  const marketOptions = useMemo<Option[]>(
    () => availableMarkets.map((market) => ({ id: market.key, label: market.label })),
    [availableMarkets]
  );
  const hasDetailField = useMemo(
    () => searchFormFields.some((field) => field.key.toLowerCase() === "detail"),
    [searchFormFields]
  );
  const dependencyMaps = useMemo(
    () => buildDependencyMaps(marketDependencies),
    [marketDependencies]
  );
  const buyFieldKeysSignature = useMemo(
    () => searchFormFields.map((field) => field.key).join("|"),
    [searchFormFields]
  );
  const visibleSearchFields = useMemo(
    () =>
      searchFormFields.filter((field) =>
        hasDependencyParentsSelected(
          field.key,
          structuredValues,
          dependencyMaps.parentKeysByChild
        )
      ),
    [dependencyMaps.parentKeysByChild, searchFormFields, structuredValues]
  );
  const requiredSearchFieldsComplete = useMemo(
    () =>
      searchFormFields
        .filter((field) => field.required)
        .every((field) => {
          const value = structuredValues[field.key];
          return typeof value === "string" && value.trim().length > 0;
        }),
    [searchFormFields, structuredValues]
  );

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
    const requestMarketKey = marketKey ?? "automotive";
    const rows = await getOptions({
      marketKey: requestMarketKey,
      fieldKey,
      deps: dependencyQuery
    });
    const idToKeyMap: Record<string, string> = {};
    const mapped = rows
      .map((option) => {
        const key = String(option.key ?? "").trim();
        if (!key) {
          return null;
        }
        const rawId = String(option.id ?? "").trim();
        if (rawId && rawId !== key) {
          idToKeyMap[rawId] = key;
        }
        return {
          id: key,
          label: option.label_es ?? option.label ?? key
        } satisfies Option;
      })
      .filter((option): option is Option => option !== null);
    const idMapKey = `${requestMarketKey}::${fieldKey}`;
    optionIdToKeyRef.current[idMapKey] = {
      ...(optionIdToKeyRef.current[idMapKey] ?? {}),
      ...idToKeyMap
    };
    return mapFieldOptionsForUi(fieldKey, mapped);
  }

  useEffect(() => {
    optionIdToKeyRef.current = {};
    setOptionsByFieldKey({});
  }, [marketKey, buyFieldKeysSignature]);

  function canonicalizeFieldValue(fieldKey: string, value: string) {
    const normalized = value.trim();
    if (!normalized) {
      return "";
    }
    const currentMarketKey = marketKey ?? "automotive";
    return optionIdToKeyRef.current[`${currentMarketKey}::${fieldKey}`]?.[normalized] ?? normalized;
  }

  function canonicalizeStructuredValues(values: Record<string, string>) {
    let changed = false;
    const next: Record<string, string> = { ...values };

    for (const field of searchFormFields) {
      const inputType = field.inputType.toLowerCase();
      if (inputType === "text" || inputType === "number") {
        continue;
      }
      const current = next[field.key] ?? "";
      if (!current) {
        continue;
      }
      const canonical = canonicalizeFieldValue(field.key, current);
      if (canonical !== current) {
        next[field.key] = canonical;
        changed = true;
      }
    }

    return changed ? next : values;
  }

  function hasResolvedOptionsForField(fieldKey: string, values: Record<string, string>) {
    const dependenciesReady = hasDependencyParentsSelected(
      fieldKey,
      values,
      dependencyMaps.parentKeysByChild
    );
    if (!dependenciesReady) {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(optionsByFieldKey, fieldKey);
  }

  function sanitizeStructuredValuesAgainstOptions(values: Record<string, string>) {
    let changed = false;
    let next: Record<string, string> = { ...values };

    for (const field of searchFormFields) {
      const inputType = field.inputType.toLowerCase();
      if (inputType === "text" || inputType === "number") {
        continue;
      }

      const current = next[field.key] ?? "";
      if (!current) {
        continue;
      }

      const canonical = canonicalizeFieldValue(field.key, current);
      if (canonical !== current) {
        next[field.key] = canonical;
        changed = true;
      }

      const dependenciesReady = hasDependencyParentsSelected(
        field.key,
        next,
        dependencyMaps.parentKeysByChild
      );
      if (!dependenciesReady) {
        delete next[field.key];
        next = resetDependentValues(field.key, next, dependencyMaps.childKeysByParent);
        changed = true;
        continue;
      }

      if (!hasResolvedOptionsForField(field.key, next)) {
        continue;
      }

      const options = optionsByFieldKey[field.key] ?? [];
      const exists = options.some((option) => option.id === next[field.key]);
      if (!exists) {
        delete next[field.key];
        next = resetDependentValues(field.key, next, dependencyMaps.childKeysByParent);
        changed = true;
      }
    }

    return changed ? next : values;
  }

  function getInvalidSelectValueMessage(values: Record<string, string>) {
    for (const field of searchFormFields) {
      const inputType = field.inputType.toLowerCase();
      if (inputType === "text" || inputType === "number") {
        continue;
      }

      const current = values[field.key] ?? "";
      if (!current) {
        continue;
      }

      const dependenciesReady = hasDependencyParentsSelected(
        field.key,
        values,
        dependencyMaps.parentKeysByChild
      );
      if (!dependenciesReady) {
        return `Complete el campo requerido: ${getFieldLabel(field)}.`;
      }

      if (!hasResolvedOptionsForField(field.key, values)) {
        return `Espere a que carguen las opciones de ${getFieldLabel(field)}.`;
      }

      const options = optionsByFieldKey[field.key] ?? [];
      const exists = options.some((option) => option.id === current);
      if (!exists) {
        return `El valor seleccionado para ${getFieldLabel(field)} ya no es válido. Selecciónelo nuevamente.`;
      }
    }

    return null;
  }

  useEffect(() => {
    setStructuredValues((current) => canonicalizeStructuredValues(current));
  }, [searchFormFields, optionsByFieldKey]);

  useEffect(() => {
    setStructuredValues((current) => sanitizeStructuredValuesAgainstOptions(current));
  }, [searchFormFields, dependencyMaps.childKeysByParent, dependencyMaps.parentKeysByChild, optionsByFieldKey]);

  useEffect(() => {
    if (
      !token ||
      !marketKey ||
      !marketDefinitionLoaded ||
      marketDefinitionKey !== marketKey ||
      searchFormFields.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const independentFields = searchFormFields.filter((field) => {
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
    api,
    searchFormFields,
    dependencyMaps.parentKeysByChild,
    marketDefinitionKey,
    marketDefinitionLoaded,
    marketKey,
    token
  ]);

  useEffect(() => {
    if (
      !token ||
      !marketKey ||
      !marketDefinitionLoaded ||
      marketDefinitionKey !== marketKey ||
      searchFormFields.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const dependentFields = searchFormFields.filter((field) => {
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
    searchFormFields,
    dependencyMaps.parentKeysByChild,
    marketDefinitionLoaded,
    marketDefinitionKey,
    marketKey,
    structuredValues,
    token
  ]);

  useEffect(() => {
    if (!searchRequest) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const query = buildBuySearchQuery({
      marketKey: marketKey ?? "automotive",
      fields: searchFormFields,
      structuredValues: searchRequest.structuredValues,
      detailsText: hasDetailField
        ? searchRequest.structuredValues.detail ?? ""
        : searchRequest.detailsText,
      page,
      pageSize
    });

      debugLog("search.request", {
      mode: "BUY",
      marketKey: marketKey ?? "automotive",
      page,
      pageSize,
      filters: query
    });

    api.get<unknown>("/search/listings", query)
      .then((response) => {
        const normalized = normalizeBuySearchResponse<BuyCard>(response);
        debugLog("search.success", {
          mode: "BUY",
          total: normalized.total,
          count: normalized.results.length,
          page: normalized.page
        });

        setResults(normalized.results);
        setPageSize(normalized.pageSize);
        setTotal(normalized.total);

          if (normalized.results.length === 0) {
            if (normalized.reason === "ONLY_OWN_LISTINGS") {
              setMessage("No hay resultados porque ya tienes una oferta activa para esta pieza.");
            } else if (normalized.reason === "WHATSAPP_REQUIRED") {
              setMessage("Registra tu número de WhatsApp para continuar.");
            } else if (normalized.demandAction === "updated") {
            setMessage("La búsqueda fue actualizada.");
          } else if (normalized.demandAction === "existing") {
            setMessage("La búsqueda ya existe.");
            } else {
            setMessage("No se encontraron resultados por ahora. Su búsqueda ha sido registrada y la plataforma intentará encontrar a alguien que pueda ayudarle.");
            }
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
  }, [api, searchFormFields, hasDetailField, marketKey, page, searchRequest, pageSize]);

  function optionsForField(fieldKey: string): Option[] {
    return optionsByFieldKey[fieldKey] ?? [];
  }

  function getFieldLabel(field: MarketFieldDefinition) {
    const key = field.key.toLowerCase();
    if (key === "detail") {
      return "Detalles (opcional)";
    }
    return field.label;
  }

  function isFieldDisabled(fieldKey: string) {
    return !hasDependencyParentsSelected(
      fieldKey,
      structuredValues,
      dependencyMaps.parentKeysByChild
    );
  }

  function updateField(fieldKey: string, value: string) {
    const canonicalInputValue = canonicalizeFieldValue(fieldKey, value);
    setStructuredValues((current) => {
      const currentValue = current[fieldKey] ?? "";
      if (currentValue === canonicalInputValue) {
        return current;
      }

      const next: Record<string, string> = {
        ...current,
        [fieldKey]: canonicalInputValue
      };
      return resetDependentValues(fieldKey, next, dependencyMaps.childKeysByParent);
    });
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();

    if (loading || isSearchQueued) {
      return;
    }

    if (searchFormFields.length === 0) {
      setError("No hay campos configurados para este mercado.");
      return;
    }

    const canonicalValues = canonicalizeStructuredValues(structuredValues);
    const sanitizedValues = sanitizeStructuredValuesAgainstOptions(canonicalValues);
    if (sanitizedValues !== structuredValues) {
      setStructuredValues(sanitizedValues);
    }

    const missing = searchFormFields
      .filter((field) => field.required)
      .find((field) => !sanitizedValues[field.key]);
    if (missing) {
      setError(`Complete el campo requerido: ${getFieldLabel(missing)}.`);
      return;
    }

    const invalidSelectMessage = getInvalidSelectValueMessage(sanitizedValues);
    if (invalidSelectMessage) {
      setError(invalidSelectMessage);
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
      setSearchRequest({
        structuredValues: { ...sanitizedValues },
        detailsText: hasDetailField ? sanitizedValues.detail ?? "" : detailsText
      });
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
      const response = await api.post<RevealResponse>("/contact-access", { listingId }, { suppressGlobalLoader: true });
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

  return (
    <div className="screen stack gap-lg">
      <Card className="stack">
        <form onSubmit={onSearch} className="stack">
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

          {marketKey ? visibleSearchFields.map((field) => {
            const inputType = field.inputType.toLowerCase();
            if (inputType === "text" || inputType === "number") {
              return (
                <label key={field.key}>
                  {getFieldLabel(field)}
                  <input
                    type={inputType}
                    value={structuredValues[field.key] ?? ""}
                    required={field.required}
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
                required={field.required}
                disabled={isFieldDisabled(field.key)}
                onChange={(value) => updateField(field.key, value)}
              />
            );
          }) : null}

          {marketKey && !hasDetailField ? (
            <label>
              Detalles (opcional)
              <input
                type="text"
                value={detailsText}
                onChange={(event) => setDetailsText(event.target.value)}
                placeholder=""
              />
            </label>
          ) : null}

          {marketKey && requiredSearchFieldsComplete ? (
            <button
              type="submit"
              disabled={loading || isSearchQueued || !requiredSearchFieldsComplete}
            >
              {loading || isSearchQueued ? "Buscando..." : "Buscar"}
            </button>
          ) : null}
        </form>
      </Card>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="info">{message}</p> : null}
      {searched && !loading && results.length === 0 && !message ? (
        <Card>
          <p>No hay resultados.</p>
        </Card>
      ) : null}

      {results.map((card) => {
        if (card.type !== "sell") {
          return null;
        }
        const identityValues = extractIdentityValuesForFields({ identity: card.identityValues }, searchFormFields);
        const priceAmount = Number(card.price.amount);
        const formattedPrice = Number.isFinite(priceAmount) ? `$${priceAmount}` : null;
        const cardContent = buildGenericCardContent({
          intentLabel: "Vendo",
          orderedFields: searchFormFields,
          values: identityValues,
          fallbackLabel: "Publicacion"
        });

        const reveal = revealState[card.id];
        return (
          <article key={card.id} className="card stack card-elevated">
            <p>
              <strong>{cardContent.title}</strong>
            </p>
            {cardContent.secondaryLine ? <p>{cardContent.secondaryLine}</p> : null}
            {formattedPrice ? <p>{`Precio: ${formattedPrice}`}</p> : null}
            <p>Creado: {formatWhen(card.created_at || card.audit?.createdAt || "")}</p>

            <RevealButton
              loading={reveal?.loading}
              whatsappUrl={reveal?.whatsappUrl}
              error={reveal?.error}
              onReveal={() => onReveal(card.id)}
            />
          </article>
        );
      })}

      {searched ? (
        <div className="pager">
          <button type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1 || loading}>
            Anterior
          </button>
          <span>Pagina {page}</span>
          <button type="button" onClick={() => setPage((prev) => prev + 1)} disabled={loading || !canGoNext}>
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}



