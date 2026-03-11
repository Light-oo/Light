import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { FilterSelect } from "../components/FilterSelect";
import { PriceInput } from "../components/PriceInput";
import { useMarket } from "../context/MarketContext";
import { useOptions } from "../context/OptionsContext";
import { useProfileStatus } from "../context/ProfileStatusContext";
import { debugLog } from "../lib/debug";
import { toUiErrorMessage } from "../lib/errorMessages";
import {
  formatAutomotiveCardLines,
  formatMarketListingIdentity,
  isAutomotiveIdentity,
  type ListingIdentityValues
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
import {
  buildSellPublishPayload,
  normalizeSellPublishResponse,
  resolveSellPublishFailure
} from "../lib/sellEngine";
import { type Option } from "../lib/marketOptions";
import { mapFieldOptionsForUi } from "../lib/travelRangeOptions";

type PublishSuccessCard = {
  identityLine: string;
  secondaryLine?: string | null;
  priceLine?: string | null;
  locationLine?: string | null;
  createdAtIso: string;
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

const HOME_SERVICES_RUNTIME_FIELDS = new Set(["trade", "experience", "work_area", "detail"]);

export function PublishPage() {
  const { api, token } = useAuth();
  const { getOptions } = useOptions();
  const { profileStatus } = useProfileStatus();
  const { marketKey, availableMarkets, setMarket } = useMarket();
  const location = useLocation();
  const navigate = useNavigate();

  const [marketFields, setMarketFields] = useState<MarketFieldDefinition[]>([]);
  const [marketDependencies, setMarketDependencies] = useState<MarketDependency[]>([]);
  const [marketDefinitionLoaded, setMarketDefinitionLoaded] = useState(false);
  const [marketDefinitionKey, setMarketDefinitionKey] = useState<string | null>(null);
  const [optionsByFieldKey, setOptionsByFieldKey] = useState<Record<string, Option[]>>({});
  const [structuredValues, setStructuredValues] = useState<Record<string, string>>({});
  const [priceAmount, setPriceAmount] = useState("");
  const [locationDepartment, setLocationDepartment] = useState("");
  const [locationMunicipality, setLocationMunicipality] = useState("");
  const [loading, setLoading] = useState(false);
  const [successCard, setSuccessCard] = useState<PublishSuccessCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const optionIdToKeyRef = useRef<Record<string, Record<string, string>>>({});

  const prefillAppliedRef = useRef(false);
  const isDirty = useMemo(
    () =>
      Object.values(structuredValues).some((value) => String(value ?? "").trim().length > 0) ||
      priceAmount.trim().length > 0 ||
      locationDepartment.trim().length > 0 ||
      locationMunicipality.trim().length > 0,
    [locationDepartment, locationMunicipality, priceAmount, structuredValues]
  );

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

    setStructuredValues({
      brand: prefill.brandId,
      model: prefill.modelId,
      year: prefill.yearId,
      item_type: prefill.itemTypeId,
      part: prefill.partId
    });
    setPriceAmount(prefill.priceAmount);
    setLocationDepartment(prefill.location?.department ?? "");
    setLocationMunicipality(prefill.location?.municipality ?? "");
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
    setMarketDefinitionLoaded(false);
    setMarketDefinitionKey(null);
    setMarketFields([]);
    setMarketDependencies([]);
    setOptionsByFieldKey({});
    setStructuredValues({});
    setPriceAmount("");
    setLocationDepartment("");
    setLocationMunicipality("");
    setSuccessCard(null);
    setDuplicateNotice(null);
    setError(null);
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

  const sellFields = useMemo(
    () => resolveOrderedFlowFields(marketFields, "SELL"),
    [marketFields]
  );
  const profileDepartmentId = useMemo(() => {
    const departmentId = profileStatus?.departmentId;
    return departmentId === null || departmentId === undefined ? "" : String(departmentId);
  }, [profileStatus?.departmentId]);
  const marketOptions = useMemo<Option[]>(
    () => availableMarkets.map((market) => ({ id: market.key, label: market.label })),
    [availableMarkets]
  );
  const normalizedMarketKey = (marketKey ?? "").trim().toLowerCase();
  const requiresPrice = normalizedMarketKey === "automotive";
  const isHomeServicesMarket = normalizedMarketKey === "home_services";
  const publishFormFields = useMemo(
    () =>
      isHomeServicesMarket
        ? sellFields.filter((field) => HOME_SERVICES_RUNTIME_FIELDS.has(field.key.toLowerCase()))
        : sellFields,
    [isHomeServicesMarket, sellFields]
  );
  const dependencyMaps = useMemo(
    () => buildDependencyMaps(marketDependencies),
    [marketDependencies]
  );
  const sellFieldKeysSignature = useMemo(
    () => publishFormFields.map((field) => field.key).join("|"),
    [publishFormFields]
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
  }, [marketKey, sellFieldKeysSignature]);

  useEffect(() => {
    if (!profileDepartmentId) {
      return;
    }
    if (!publishFormFields.some((field) => field.key.toLowerCase() === "work_area")) {
      return;
    }
    setStructuredValues((current) => {
      const currentValue = String(current.work_area ?? "").trim();
      if (currentValue.length > 0) {
        return current;
      }
      if (current.work_area === profileDepartmentId) {
        return current;
      }
      return {
        ...current,
        work_area: profileDepartmentId
      };
    });
  }, [profileDepartmentId, publishFormFields]);

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
    for (const field of publishFormFields) {
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

    for (const field of publishFormFields) {
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
    for (const field of publishFormFields) {
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
  }, [publishFormFields, optionsByFieldKey]);

  useEffect(() => {
    setStructuredValues((current) => sanitizeStructuredValuesAgainstOptions(current));
  }, [dependencyMaps.childKeysByParent, dependencyMaps.parentKeysByChild, optionsByFieldKey, publishFormFields]);

  useEffect(() => {
    if (
      !token ||
      !marketKey ||
      !marketDefinitionLoaded ||
      marketDefinitionKey !== marketKey ||
      publishFormFields.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const independentFields = publishFormFields.filter((field) => {
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
    dependencyMaps.parentKeysByChild,
    marketDefinitionKey,
    marketDefinitionLoaded,
    marketKey,
    publishFormFields,
    token
  ]);

  useEffect(() => {
    if (
      !token ||
      !marketKey ||
      !marketDefinitionLoaded ||
      marketDefinitionKey !== marketKey ||
      publishFormFields.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const dependentFields = publishFormFields.filter((field) => {
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
    publishFormFields,
    structuredValues,
    token
  ]);

  function optionsForField(fieldKey: string): Option[] {
    return optionsByFieldKey[fieldKey] ?? [];
  }

  function isFieldDisabled(fieldKey: string) {
    return !hasDependencyParentsSelected(
      fieldKey,
      structuredValues,
      dependencyMaps.parentKeysByChild
    );
  }

  function labelFor(fieldKey: string, id: string) {
    const options = optionsByFieldKey[fieldKey] ?? [];
    return options.find((opt) => opt.id === id)?.label ?? "";
  }

  function resolvedIdentityValues(): ListingIdentityValues {
    const entries = publishFormFields.map((field) => {
      const selectedId = structuredValues[field.key];
      const label = selectedId ? labelFor(field.key, selectedId) : "";
      return [field.key, label || selectedId || ""] as const;
    });
    return Object.fromEntries(entries);
  }

  function buildReadableItemName() {
    const identityValues = resolvedIdentityValues();
    if (isAutomotiveIdentity(identityValues)) {
      const lines = formatAutomotiveCardLines(identityValues);
      if (lines.partLine && lines.vehicleLine) {
        return `${lines.partLine} / ${lines.vehicleLine}`;
      }
      return lines.partLine || lines.vehicleLine || "esta pieza";
    }
    return formatMarketListingIdentity({
      orderedFields: publishFormFields,
      values: identityValues,
      separator: " - ",
      fallback: "esta pieza"
    });
  }

  function buildSuccessCardTitle() {
    if (isHomeServicesMarket) {
      const values = resolvedIdentityValues();
      const trade = String(values.trade ?? "").trim();
      return `Servicio de ${trade || "servicio"}`.replace(/\s+/g, " ").trim();
    }

    const identityValues = resolvedIdentityValues();
    if (isAutomotiveIdentity(identityValues)) {
      return formatAutomotiveCardLines(identityValues).partLine || "Pieza";
    }
    return formatMarketListingIdentity({
      orderedFields: publishFormFields,
      values: identityValues,
      separator: " / ",
      fallback: "-"
    });
  }

  function buildSuccessCardSecondaryLine() {
    const values = resolvedIdentityValues();
    if (isHomeServicesMarket) {
      const experience = String(values.experience ?? "").trim();
      return experience || null;
    }

    if (isAutomotiveIdentity(values)) {
      const vehicle = formatAutomotiveCardLines(values).vehicleLine;
      return vehicle || null;
    }

    return null;
  }

  function buildSuccessPriceLine() {
    const parsed = Number(priceAmount);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const formatted = Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
    return `$${formatted}`;
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

  function updateStructuredField(fieldKey: string, value: string) {
    const canonicalInputValue = canonicalizeFieldValue(fieldKey, value);
    if (successCard) {
      setSuccessCard(null);
    }
    if (duplicateNotice) {
      setDuplicateNotice(null);
    }
    const currentValue = structuredValues[fieldKey] ?? "";
    if (currentValue === canonicalInputValue) {
      return;
    }

    const dependentKeys: string[] = [];
    const queue = [...(dependencyMaps.childKeysByParent[fieldKey] ?? [])];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      dependentKeys.push(current);
      for (const nextChild of dependencyMaps.childKeysByParent[current] ?? []) {
        if (!visited.has(nextChild)) {
          queue.push(nextChild);
        }
      }
    }

    if (dependentKeys.length > 0) {
      setOptionsByFieldKey((current) => {
        let changed = false;
        const next = { ...current };
        for (const dependentKey of dependentKeys) {
          if (next[dependentKey] !== undefined) {
            delete next[dependentKey];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }

    setStructuredValues((current) => {
      const next: Record<string, string> = {
        ...current,
        [fieldKey]: canonicalInputValue
      };
      return resetDependentValues(fieldKey, next, dependencyMaps.childKeysByParent);
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;

    if (publishFormFields.length === 0) {
      setError("No hay campos configurados para este mercado.");
      return;
    }

    const canonicalValues = canonicalizeStructuredValues(structuredValues);
    const sanitizedValues = sanitizeStructuredValuesAgainstOptions(canonicalValues);
    if (sanitizedValues !== structuredValues) {
      setStructuredValues(sanitizedValues);
    }

    const missing = publishFormFields
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

    if (requiresPrice) {
      const parsedPrice = Number(priceAmount);
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        setError("Ingrese un precio válido.");
        return;
      }
    }

    setLoading(true);
    setError(null);
    setSuccessCard(null);
    setDuplicateNotice(null);

    try {
      const payload = buildSellPublishPayload({
        marketKey: marketKey ?? "automotive",
        fields: publishFormFields,
        structuredValues: sanitizedValues,
        priceAmount,
        includePrice: requiresPrice,
        locationDepartment,
        locationMunicipality
      });

      debugLog("publish.request", {
        marketKey: marketKey ?? "automotive",
        payloadFields: Object.keys(payload)
      });

      const response = await api.post<unknown>("/listings", payload);
      const normalized = normalizeSellPublishResponse(response);
      debugLog("publish.success", { listingId: normalized.listingId });

      const nextSuccessCard = {
        identityLine: buildSuccessCardTitle(),
        secondaryLine: buildSuccessCardSecondaryLine(),
        priceLine: requiresPrice ? buildSuccessPriceLine() : null,
        locationLine: null,
        createdAtIso: new Date().toISOString()
      };
      setSuccessCard(nextSuccessCard);
      setStructuredValues({});
      setPriceAmount("");
      setLocationDepartment("");
      setLocationMunicipality("");
    } catch (err) {
      debugLog("publish.error", {
        message: err instanceof Error ? err.message : "unknown"
      });
      const failure = resolveSellPublishFailure(err);
      if (failure.kind === "duplicate") {
        setDuplicateNotice(buildReadableItemName());
        setError(null);
      } else if (failure.kind === "validation") {
        setError(failure.message);
      } else {
        setError(toUiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen screen-fill stack gap-lg">
      <button
        type="button"
        className="ghost"
        onClick={() => navigate("/sell-demands")}
      >
        Buscar Demandas
      </button>

      <Card className="stack">
        <form className="stack" onSubmit={onSubmit}>
          <FilterSelect
            label="Mercado"
            value={marketKey ?? ""}
            options={marketOptions}
            required
            disabled={false}
            onChange={(value) => {
              if (value) {
                setSuccessCard(null);
                setDuplicateNotice(null);
                setMarket(value);
              }
            }}
          />

          {marketKey ? publishFormFields.map((field) => {
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
                    onChange={(event) => updateStructuredField(field.key, event.target.value)}
                  />
                </label>
              );
            }

            return (
              <FilterSelect
                key={field.key}
                label={getFieldLabel(field)}
                required={field.required}
                disabled={isFieldDisabled(field.key)}
                value={structuredValues[field.key] ?? ""}
                options={optionsForField(field.key)}
                onChange={(value) => updateStructuredField(field.key, value)}
              />
            );
          }) : null}

          {marketKey && requiresPrice ? (
            <PriceInput
              amount={priceAmount}
              onAmountChange={(nextValue) => {
                if (successCard) {
                  setSuccessCard(null);
                }
                if (duplicateNotice) {
                  setDuplicateNotice(null);
                }
                setPriceAmount(nextValue);
              }}
            />
          ) : null}

          {marketKey ? (
            <button type="submit" disabled={loading}>
              {loading ? "Publicando..." : "Publicar"}
            </button>
          ) : null}
        </form>
      </Card>

      {successCard ? (
        <div className="stack gap-sm">
          <article className="card stack card-elevated demand-card-compact">
            <p><strong>{`${isHomeServicesMarket ? "Ofrezco" : "Vendo"} ${successCard.identityLine}`}</strong></p>
            {successCard.secondaryLine ? <p>{successCard.secondaryLine}</p> : null}
            {successCard.priceLine ? <p>{`Precio: ${successCard.priceLine}`}</p> : null}
            <p>Creado: {formatWhen(successCard.createdAtIso)}</p>
          </article>
          <div className="stack gap-sm publish-success-actions">
            <p className="publish-success-prompt">¿Quiere ver sus publicaciones activas?</p>
            <button type="button" className="ghost" onClick={() => navigate("/my-listings")}>
              Ir a Mis listas
            </button>
          </div>
        </div>
      ) : null}

      {duplicateNotice ? (
        <Card className="stack">
          <p>
            Ya tienes una publicacion activa equivalente para <strong>{duplicateNotice}</strong>.
          </p>
          <p className="info">Puedes administrarla desde Mis listas.</p>
          <button type="button" className="ghost" onClick={() => navigate("/my-listings")}>
            Ir a Mis listas
          </button>
        </Card>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
