import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useAuth } from "../auth/AuthContext";

export type FieldOptionResponseRow = {
  id: string;
  key?: string;
  label?: string;
  label_es?: string;
};

type MarketFieldOptionsResponse = {
  ok: true;
  data: {
    options: FieldOptionResponseRow[];
  };
};

type GetOptionsParams = {
  marketKey: string;
  fieldKey: string;
  deps?: Record<string, string>;
};

type OptionsContextValue = {
  getOptions: (params: GetOptionsParams) => Promise<FieldOptionResponseRow[]>;
  refreshOptions: (params: GetOptionsParams) => Promise<FieldOptionResponseRow[]>;
};

type OptionsCacheEntry = {
  value: FieldOptionResponseRow[];
  fetchedAt: number;
};

const OPTIONS_TTL_MS = 5 * 60 * 1000;
const OptionsContext = createContext<OptionsContextValue | null>(null);

function buildDependencySignature(deps?: Record<string, string>) {
  if (!deps) {
    return "";
  }

  return Object.entries(deps)
    .filter(([, value]) => String(value ?? "").trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join("&");
}

function buildOptionsCacheKey(params: GetOptionsParams) {
  const marketKey = params.marketKey.trim().toLowerCase();
  const fieldKey = params.fieldKey.trim().toLowerCase();
  const dependencySignature = buildDependencySignature(params.deps);
  return `${marketKey}::${fieldKey}::${dependencySignature}`;
}

export function OptionsProvider({ children }: { children: React.ReactNode }) {
  const { api } = useAuth();
  const optionsCacheRef = useRef<Map<string, OptionsCacheEntry>>(new Map());
  const optionsInFlightRef = useRef<Map<string, Promise<FieldOptionResponseRow[]>>>(new Map());

  const loadOptions = useCallback(
    async (params: GetOptionsParams, forceRefresh: boolean) => {
      const cacheKey = buildOptionsCacheKey(params);
      const now = Date.now();
      const cached = optionsCacheRef.current.get(cacheKey);

      if (!forceRefresh && cached && now - cached.fetchedAt < OPTIONS_TTL_MS) {
        return cached.value;
      }

      const inFlight = optionsInFlightRef.current.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }

      const request = api
        .get<MarketFieldOptionsResponse>(
          `/catalog/markets/${encodeURIComponent(params.marketKey)}/fields/${encodeURIComponent(params.fieldKey)}/options`,
          params.deps
        )
        .then((response) => {
          const options = Array.isArray(response.data.options) ? response.data.options : [];
          optionsCacheRef.current.set(cacheKey, {
            value: options,
            fetchedAt: Date.now()
          });
          return options;
        })
        .finally(() => {
          optionsInFlightRef.current.delete(cacheKey);
        });

      optionsInFlightRef.current.set(cacheKey, request);
      return request;
    },
    [api]
  );

  const getOptions = useCallback(
    (params: GetOptionsParams) => loadOptions(params, false),
    [loadOptions]
  );

  const refreshOptions = useCallback(
    (params: GetOptionsParams) => loadOptions(params, true),
    [loadOptions]
  );

  const value = useMemo<OptionsContextValue>(
    () => ({
      getOptions,
      refreshOptions
    }),
    [getOptions, refreshOptions]
  );

  return <OptionsContext.Provider value={value}>{children}</OptionsContext.Provider>;
}

export function useOptions() {
  const context = useContext(OptionsContext);
  if (!context) {
    throw new Error("useOptions must be used within OptionsProvider");
  }
  return context;
}
