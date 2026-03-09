import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { FilterSelect } from "../components/FilterSelect";
import { PriceInput } from "../components/PriceInput";
import { useMarket } from "../context/MarketContext";
import { debugLog } from "../lib/debug";
import { toUiErrorMessage } from "../lib/errorMessages";
import {
  formatMarketListingIdentity,
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

type MarketFieldOptionsResponse = {
  ok: true;
  data: {
    options: Array<{ id: string; key?: string; label?: string; label_es?: string }>;
  };
};

type PublishSuccessCard = {
  identityLine: string;
  secondaryLine?: string | null;
  priceLine?: string | null;
  locationLine: string;
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

type ProfileStatusResponse = {
  ok: true;
  data: {
    departmentId: number | null;
    departmentName: string | null;
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

export function PublishPage() {
  const { api, token } = useAuth();
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
  const [profileDepartmentId, setProfileDepartmentId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [successCard, setSuccessCard] = useState<PublishSuccessCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const optionCacheRef = useRef<Record<string, Option[]>>({});
  const optionsInFlightRef = useRef<Record<string, Promise<Option[]>>>({});
  const dependencySignatureRef = useRef<Record<string, string>>({});
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
    optionCacheRef.current = {};
    optionsInFlightRef.current = {};
    dependencySignatureRef.current = {};
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

  useEffect(() => {
    if (!token) {
      setProfileDepartmentId("");
      return;
    }

    let cancelled = false;
    api
      .get<ProfileStatusResponse>("/profile/status", undefined, { suppressGlobalLoader: true })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const departmentId = response.data.departmentId;
        const normalized = departmentId === null || departmentId === undefined ? "" : String(departmentId);
        setProfileDepartmentId(normalized);
      })
      .catch(() => {
        if (!cancelled) {
          setProfileDepartmentId("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, token]);

  const sellFields = useMemo(
    () => resolveOrderedFlowFields(marketFields, "SELL"),
    [marketFields]
  );
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
        ? sellFields.filter((field) => field.key.toLowerCase() !== "travel_range")
        : sellFields,
    [isHomeServicesMarket, sellFields]
  );
  const dependencyMaps = useMemo(
    () => buildDependencyMaps(marketDependencies),
    [marketDependencies]
  );
  const sellFieldKeysSignature = useMemo(
    () => sellFields.map((field) => field.key).join("|"),
    [sellFields]
  );

  function isDerivedProfileField(field: MarketFieldDefinition) {
    return field.inputType.trim().toLowerCase() === "derived_profile_value";
  }

  function getFieldLabel(field: MarketFieldDefinition) {
    const key = field.key.toLowerCase();
    if (key === "warranty") {
      return "¿Da Garantía con su Trabajo?";
    }
    if (key === "travel_range") {
      return "¿Puede moverse entre?";
    }
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

  function buildOptionsCacheKey(
    fieldKey: string,
    dependencyQuery: Record<string, string>,
    targetMarketKey: string
  ) {
    const dependencyKey = Object.entries(dependencyQuery)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    return `${targetMarketKey}::${fieldKey}::${dependencyKey || "base"}`;
  }

  async function getOrLoadFieldOptions(fieldKey: string, dependencyQuery: Record<string, string>) {
    const requestMarketKey = marketKey ?? "automotive";
    const cacheKey = buildOptionsCacheKey(fieldKey, dependencyQuery, requestMarketKey);
    const cached = optionCacheRef.current[cacheKey];
    if (cached) {
      return cached;
    }

    const inFlight = optionsInFlightRef.current[cacheKey];
    if (inFlight) {
      return inFlight;
    }

    const request = api
      .get<MarketFieldOptionsResponse>(
        `/catalog/markets/${encodeURIComponent(requestMarketKey)}/fields/${encodeURIComponent(fieldKey)}/options`,
        dependencyQuery
      )
      .then((response) => {
        const idToKeyMap: Record<string, string> = {};
        const mapped = response.data.options
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
      })
      .then((options) => {
        optionCacheRef.current[cacheKey] = options;
        return options;
      })
      .finally(() => {
        delete optionsInFlightRef.current[cacheKey];
      });

    optionsInFlightRef.current[cacheKey] = request;
    return request;
  }

  useEffect(() => {
    optionCacheRef.current = {};
    optionsInFlightRef.current = {};
    dependencySignatureRef.current = {};
    optionIdToKeyRef.current = {};
    setOptionsByFieldKey({});
  }, [marketKey, sellFieldKeysSignature]);

  useEffect(() => {
    if (!profileDepartmentId) {
      return;
    }
    if (!sellFields.some((field) => field.key.toLowerCase() === "work_area")) {
      return;
    }
    setStructuredValues((current) => {
      if (current.work_area === profileDepartmentId) {
        return current;
      }
      return {
        ...current,
        work_area: profileDepartmentId
      };
    });
  }, [profileDepartmentId, sellFields]);

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
    for (const field of sellFields) {
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
    const currentMarketKey = marketKey ?? "automotive";
    const dependencyQuery = dependencyQueryForField(
      fieldKey,
      values,
      dependencyMaps.parentKeysByChild
    );
    const cacheKey = buildOptionsCacheKey(fieldKey, dependencyQuery, currentMarketKey);
    return Object.prototype.hasOwnProperty.call(optionCacheRef.current, cacheKey);
  }

  function sanitizeStructuredValuesAgainstOptions(values: Record<string, string>) {
    let changed = false;
    let next: Record<string, string> = { ...values };

    for (const field of sellFields) {
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
    for (const field of sellFields) {
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
  }, [sellFields, optionsByFieldKey]);

  useEffect(() => {
    setStructuredValues((current) => sanitizeStructuredValuesAgainstOptions(current));
  }, [dependencyMaps.childKeysByParent, dependencyMaps.parentKeysByChild, optionsByFieldKey, sellFields]);

  useEffect(() => {
    if (
      !token ||
      !marketKey ||
      !marketDefinitionLoaded ||
      marketDefinitionKey !== marketKey ||
      sellFields.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const independentFields = sellFields.filter((field) => {
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
    sellFields,
    token
  ]);

  useEffect(() => {
    if (
      !token ||
      !marketKey ||
      !marketDefinitionLoaded ||
      marketDefinitionKey !== marketKey ||
      sellFields.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const dependentFields = sellFields.filter((field) => {
      const inputType = field.inputType.toLowerCase();
      if (inputType === "text" || inputType === "number") {
        return false;
      }
      return (dependencyMaps.parentKeysByChild[field.key]?.length ?? 0) > 0;
    });

    async function loadDependentOptions() {
      for (const field of dependentFields) {
        const parentKeys = dependencyMaps.parentKeysByChild[field.key] ?? [];
        const signature = parentKeys
          .map((parentKey) => `${parentKey}=${structuredValues[parentKey] ?? ""}`)
          .join("|");

        if (dependencySignatureRef.current[field.key] === signature) {
          continue;
        }
        dependencySignatureRef.current[field.key] = signature;

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
    api,
    dependencyMaps.parentKeysByChild,
    marketDefinitionLoaded,
    marketDefinitionKey,
    marketKey,
    sellFields,
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
    return formatMarketListingIdentity({
      orderedFields: publishFormFields,
      values: resolvedIdentityValues(),
      separator: " - ",
      fallback: "esta pieza"
    });
  }

  function buildSuccessCardTitle() {
    if (isHomeServicesMarket) {
      const values = resolvedIdentityValues();
      const trade = String(values.trade ?? "").trim();
      const rawExperience = String(values.experience ?? "").trim();
      const experience = rawExperience
        ? (/años?|year/i.test(rawExperience) ? rawExperience : `${rawExperience} años de experiencia`)
        : "";
      const warrantyToken = String(values.warranty ?? "").trim().toLowerCase();
      const hasWarranty = ["yes", "si", "sí", "true", "1"].includes(warrantyToken);
      const warrantyText = hasWarranty ? "que garantiza su trabajo" : "sin garantía declarada";
      const parts = [trade || "Servicio", experience ? `con ${experience}` : "", warrantyText].filter(
        (part) => part.trim().length > 0
      );
      return `${parts.join(" ")}.`.replace(/\s+/g, " ").trim();
    }

    return formatMarketListingIdentity({
      orderedFields: publishFormFields,
      values: resolvedIdentityValues(),
      separator: " / ",
      fallback: "-"
    });
  }

  function buildSuccessPriceLine() {
    const parsed = Number(priceAmount);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const formatted = Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
    return `$${formatted}`;
  }

  function buildSuccessLocationLine() {
    if (isHomeServicesMarket) {
      const values = resolvedIdentityValues();
      const workArea = String(values.work_area ?? "").trim();
      const fallbackArea = locationDepartment.trim() || "El Salvador";
      return `Zona de trabajo: ${workArea || fallbackArea}.`;
    }

    const normalized = locationDepartment.trim();
    return normalized || "El Salvador";
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
          delete dependencySignatureRef.current[dependentKey];
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

    if (sellFields.length === 0) {
      setError("No hay campos configurados para este mercado.");
      return;
    }

    const canonicalValues = canonicalizeStructuredValues(structuredValues);
    const sanitizedValues = sanitizeStructuredValuesAgainstOptions(canonicalValues);
    if (sanitizedValues !== structuredValues) {
      setStructuredValues(sanitizedValues);
    }

    const missing = publishFormFields
      .filter((field) => field.required && !isDerivedProfileField(field))
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
        secondaryLine: null,
        priceLine: requiresPrice ? buildSuccessPriceLine() : null,
        locationLine: buildSuccessLocationLine(),
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
            if (isDerivedProfileField(field)) {
              const derivedValueId = structuredValues[field.key] ?? profileDepartmentId;
              const derivedValueLabel = derivedValueId ? labelFor(field.key, derivedValueId) || derivedValueId : "";
              if (profileDepartmentId) {
                return (
                  <label key={field.key} className="derived-profile-field">
                    {getFieldLabel(field)}
                    <input type="text" value={derivedValueLabel} readOnly />
                    <span className="info">Se usa su departamento de perfil.</span>
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
            }
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
            <p><strong>{isHomeServicesMarket ? "Ofrezco Servicio De:" : "Vendo"}</strong></p>
            <p>
              {successCard.priceLine
                ? `${successCard.identityLine} - ${successCard.priceLine}`
                : successCard.identityLine}
            </p>
            {successCard.secondaryLine ? <p>{successCard.secondaryLine}</p> : null}
            <p>{successCard.locationLine}</p>
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
