import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";

export type ProfileStatus = {
  role: string | null;
  tokens: number | null;
  whatsappE164: string | null;
  whatsappVerificationStatus: "missing" | "pending" | "verified" | null;
  whatsappVerifiedAt: string | null;
  departmentId: number | null;
  departmentName: string | null;
  whatsappStatus: "missing" | "present";
  profileComplete: boolean;
};

type ProfileStatusResponse = {
  ok: true;
  data: {
    role?: string | null;
    tokens?: number | null;
    whatsappE164?: string | null;
    whatsappVerificationStatus?: "missing" | "pending" | "verified" | null;
    whatsappVerifiedAt?: string | null;
    departmentId?: number | null;
    departmentName?: string | null;
    whatsappStatus?: "missing" | "present";
    profileComplete?: boolean;
  };
};

type ProfileStatusContextValue = {
  profileStatus: ProfileStatus | null;
  loading: boolean;
  refreshProfileStatus: () => Promise<ProfileStatus | null>;
};

const PROFILE_STATUS_TTL_MS = 30_000;
let sharedStatusCache: { token: string; fetchedAt: number; status: ProfileStatus | null } | null = null;
let sharedStatusInFlight: { token: string; promise: Promise<ProfileStatus | null> } | null = null;

function normalizeProfileStatus(data: ProfileStatusResponse["data"] | null | undefined): ProfileStatus | null {
  if (!data) {
    return null;
  }

  return {
    role: typeof data.role === "string" ? data.role : null,
    tokens: typeof data.tokens === "number" ? data.tokens : null,
    whatsappE164: typeof data.whatsappE164 === "string" ? data.whatsappE164 : null,
    whatsappVerificationStatus:
      data.whatsappVerificationStatus === "missing" ||
      data.whatsappVerificationStatus === "pending" ||
      data.whatsappVerificationStatus === "verified"
        ? data.whatsappVerificationStatus
        : null,
    whatsappVerifiedAt: typeof data.whatsappVerifiedAt === "string" ? data.whatsappVerifiedAt : null,
    departmentId: typeof data.departmentId === "number" ? data.departmentId : null,
    departmentName: typeof data.departmentName === "string" ? data.departmentName : null,
    whatsappStatus: data.whatsappStatus === "present" ? "present" : "missing",
    profileComplete: data.profileComplete === true
  };
}

const ProfileStatusContext = createContext<ProfileStatusContextValue | null>(null);

export function ProfileStatusProvider({ children }: { children: React.ReactNode }) {
  const { api, token, ready } = useAuth();
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchedAtRef = useRef<number>(0);
  const inFlightRef = useRef<Promise<ProfileStatus | null> | null>(null);

  const loadProfileStatus = useCallback(
    (forceRefresh: boolean) => {
      if (!token) {
        setProfileStatus(null);
        lastFetchedAtRef.current = 0;
        sharedStatusCache = null;
        sharedStatusInFlight = null;
        return Promise.resolve(null);
      }

      const now = Date.now();
      const isFresh = now - lastFetchedAtRef.current < PROFILE_STATUS_TTL_MS;
      if (!forceRefresh && profileStatus && isFresh) {
        return Promise.resolve(profileStatus);
      }

      const cache = sharedStatusCache;
      const hasFreshSharedCache =
        !forceRefresh &&
        cache?.token === token &&
        now - cache.fetchedAt < PROFILE_STATUS_TTL_MS;
      if (hasFreshSharedCache && cache) {
        setProfileStatus(cache.status);
        lastFetchedAtRef.current = cache.fetchedAt;
        setLoading(false);
        return Promise.resolve(cache.status);
      }

      if (sharedStatusInFlight?.token === token) {
        setLoading(true);
        return sharedStatusInFlight.promise.then((status) => {
          setProfileStatus(status);
          if (sharedStatusCache?.token === token) {
            lastFetchedAtRef.current = sharedStatusCache.fetchedAt;
          }
          return status;
        });
      }

      if (inFlightRef.current) {
        return inFlightRef.current;
      }

      setLoading(true);
      const request = api
        .get<ProfileStatusResponse>("/profile/status", undefined, { suppressGlobalLoader: true })
        .then((response) => {
          const normalized = normalizeProfileStatus(response.data);
          setProfileStatus(normalized);
          const fetchedAt = Date.now();
          lastFetchedAtRef.current = fetchedAt;
          sharedStatusCache = { token, fetchedAt, status: normalized };
          return normalized;
        })
        .catch(() => {
          setProfileStatus(null);
          lastFetchedAtRef.current = 0;
          sharedStatusCache = null;
          return null;
        })
        .finally(() => {
          inFlightRef.current = null;
          if (sharedStatusInFlight?.promise === request) {
            sharedStatusInFlight = null;
          }
          setLoading(false);
        });

      inFlightRef.current = request;
      sharedStatusInFlight = { token, promise: request };
      return request;
    },
    [api, profileStatus, token]
  );

  const refreshProfileStatus = useCallback(() => loadProfileStatus(true), [loadProfileStatus]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    if (!token) {
      setProfileStatus(null);
      setLoading(false);
      lastFetchedAtRef.current = 0;
      return;
    }

    void loadProfileStatus(false);
  }, [loadProfileStatus, ready, token]);

  const value = useMemo<ProfileStatusContextValue>(
    () => ({
      profileStatus,
      loading,
      refreshProfileStatus
    }),
    [loading, profileStatus, refreshProfileStatus]
  );

  return <ProfileStatusContext.Provider value={value}>{children}</ProfileStatusContext.Provider>;
}

export function useProfileStatus() {
  const context = useContext(ProfileStatusContext);
  if (!context) {
    throw new Error("useProfileStatus must be used within ProfileStatusProvider");
  }
  return context;
}
