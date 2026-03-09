import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";

export type MarketOption = {
  key: string;
  label: string;
};

type MarketContextValue = {
  ready: boolean;
  marketKey: string | null;
  selectedMarket: MarketOption | null;
  availableMarkets: MarketOption[];
  setMarket: (marketKey: string) => void;
  clearMarket: () => void;
};

const STORAGE_KEY = "light_selected_market_v1";
const FALLBACK_MARKETS: MarketOption[] = [];
const MARKET_LABEL_OVERRIDES: Record<string, string> = {
  automotive: "Carros",
  home_services: "Servicios para el Hogar"
};

const MarketContext = createContext<MarketContextValue | null>(null);

type MarketsResponse = {
  ok: true;
  data: {
    markets: Array<{
      key: string;
      label: string;
      label_es?: string;
      active?: boolean;
    }>;
  };
};

function resolveMarketLabel(marketKey: string, rawLabel: unknown, rawSpanishLabel: unknown) {
  const normalizedKey = marketKey.trim().toLowerCase();
  const override = MARKET_LABEL_OVERRIDES[normalizedKey];
  if (override) {
    return override;
  }

  const spanishLabel = String(rawSpanishLabel ?? "").trim();
  if (spanishLabel) {
    return spanishLabel;
  }

  const label = String(rawLabel ?? "").trim();
  if (label) {
    return label;
  }

  return normalizedKey;
}

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const { api, token, ready: authReady } = useAuth();
  const [marketKey, setMarketKey] = useState<string | null>(null);
  const [availableMarkets, setAvailableMarkets] = useState<MarketOption[]>(FALLBACK_MARKETS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (!token) {
      setAvailableMarkets(FALLBACK_MARKETS);
      setMarketKey(null);
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    api
      .get<MarketsResponse>("/catalog/markets", undefined, { suppressGlobalLoader: true })
      .then((response) => {
        if (cancelled) {
          return;
        }

        const markets = (response.data.markets ?? [])
          .filter((market) => String(market.key ?? "").trim().length > 0)
          .map((market) => {
            const key = String(market.key).trim().toLowerCase();
            return {
              key,
              label: resolveMarketLabel(key, market.label, market.label_es)
            };
          });

        setAvailableMarkets(markets);

        localStorage.removeItem(STORAGE_KEY);
        setMarketKey(null);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAvailableMarkets(FALLBACK_MARKETS);
        setMarketKey(null);
        localStorage.removeItem(STORAGE_KEY);
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [api, authReady, token]);

  const value = useMemo<MarketContextValue>(() => {
    const selectedMarket =
      marketKey ? availableMarkets.find((market) => market.key === marketKey) ?? null : null;

    return {
      ready,
      marketKey,
      selectedMarket,
      availableMarkets,
      setMarket: (nextMarketKey: string) => {
        const normalized = nextMarketKey.trim().toLowerCase();
        const exists = availableMarkets.some((market) => market.key === normalized);
        if (!exists) {
          return;
        }
        setMarketKey(normalized);
      },
      clearMarket: () => {
        localStorage.removeItem(STORAGE_KEY);
        setMarketKey(null);
      }
    };
  }, [availableMarkets, marketKey, ready]);

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error("useMarket must be used within MarketProvider");
  }
  return context;
}
