import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/Card";
import { useMarket } from "../context/MarketContext";
import { toUiErrorMessage } from "../lib/errorMessages";
import type { MarketDefinitionResponse } from "../lib/marketDefinition";

type LocationState = {
  from?: string;
};

export function MarketSelectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { api } = useAuth();
  const { marketKey, availableMarkets, setMarket } = useMarket();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const returnTo = ((location.state as LocationState | null)?.from ?? "/search").trim();

  if (marketKey) {
    return <Navigate to={returnTo || "/search"} replace />;
  }

  async function onSelectMarket(nextMarketKey: string) {
    if (loadingKey) {
      return;
    }

    setLoadingKey(nextMarketKey);
    setError(null);

    try {
      await api.get<MarketDefinitionResponse>(`/catalog/markets/${encodeURIComponent(nextMarketKey)}`);
      setMarket(nextMarketKey);
      navigate(returnTo || "/search", { replace: true });
    } catch (err) {
      setError(toUiErrorMessage(err));
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="screen auth-screen">
      <Card className="stack auth-form">
        <h2>Seleccione mercado</h2>
        <p className="info">Esta selección se usa para los flujos Busco y Vendo.</p>
        {availableMarkets.map((market) => (
          <button
            key={market.key}
            type="button"
            disabled={Boolean(loadingKey)}
            onClick={() => onSelectMarket(market.key)}
          >
            {loadingKey === market.key ? "Cargando..." : market.label}
          </button>
        ))}
        {error ? <p className="error">{error}</p> : null}
      </Card>
    </div>
  );
}
