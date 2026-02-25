export type ApiErrorPayload = {
  ok?: false;
  error?: string;
  issues?: Array<{ path: string; message: string; code: string }>;
  [key: string]: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly payload: ApiErrorPayload | null;

  constructor(status: number, payload: ApiErrorPayload | null) {
    super(payload?.error ?? `http_${status}`);
    this.status = status;
    this.payload = payload;
  }
}

type ApiClientConfig = {
  baseUrl: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
  onRequestStart?: () => void;
  onRequestEnd?: () => void;
};

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | undefined>) {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function parseJson(response: Response): Promise<ApiErrorPayload | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as ApiErrorPayload;
  } catch {
    return null;
  }
}

export function createApiClient(config: ApiClientConfig) {
  async function request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    options?: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      auth?: boolean;
      suppressGlobalLoader?: boolean;
    }
  ): Promise<T> {
    if (!options?.suppressGlobalLoader) {
      config.onRequestStart?.();
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (options?.auth !== false) {
      const token = config.getToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    try {
      const response = await fetch(buildUrl(config.baseUrl, path, options?.query), {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined
      });

      const payload = await parseJson(response);

      if (!response.ok) {
        if (response.status === 401) {
          config.onUnauthorized?.();
        }
        throw new ApiError(response.status, payload);
      }

      return (payload ?? {}) as T;
    } finally {
      if (!options?.suppressGlobalLoader) {
        config.onRequestEnd?.();
      }
    }
  }

  return {
    get: <T>(
      path: string,
      query?: Record<string, string | number | undefined>,
      requestOptions?: { suppressGlobalLoader?: boolean; auth?: boolean }
    ) =>
      request<T>("GET", path, { query, ...requestOptions }),
    post: <T>(
      path: string,
      body?: unknown,
      requestOptions?: { suppressGlobalLoader?: boolean; auth?: boolean }
    ) => request<T>("POST", path, { body, ...requestOptions }),
    patch: <T>(
      path: string,
      body?: unknown,
      requestOptions?: { suppressGlobalLoader?: boolean; auth?: boolean }
    ) => request<T>("PATCH", path, { body, ...requestOptions })
  };
}
