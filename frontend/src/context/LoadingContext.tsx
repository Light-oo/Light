import { createContext, useCallback, useContext, useMemo, useState } from "react";

type LoadingContextValue = {
  isLoading: boolean;
  setLoading: (next: boolean) => void;
};

const LoadingContext = createContext<LoadingContextValue | null>(null);

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);

  const setLoading = useCallback((next: boolean) => {
    setPendingCount((current) => {
      if (next) {
        return current + 1;
      }
      return Math.max(0, current - 1);
    });
  }, []);

  const value = useMemo<LoadingContextValue>(() => ({
    isLoading: pendingCount > 0,
    setLoading
  }), [pendingCount, setLoading]);

  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>;
}

export function useLoading() {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error("useLoading must be used within LoadingProvider");
  }
  return context;
}
