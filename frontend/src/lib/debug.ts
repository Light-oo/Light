const DEBUG_FLAG_KEY = "light_debug_mode";

export function isDebugEnabled() {
  if (!import.meta.env.DEV) {
    return false;
  }

  try {
    return localStorage.getItem(DEBUG_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDebugEnabled(enabled: boolean) {
  if (!import.meta.env.DEV) {
    return;
  }

  try {
    if (enabled) {
      localStorage.setItem(DEBUG_FLAG_KEY, "1");
    } else {
      localStorage.removeItem(DEBUG_FLAG_KEY);
    }
  } catch {
    // Ignore storage failures in private mode.
  }
}

export function debugLog(event: string, payload?: Record<string, unknown>) {
  if (!isDebugEnabled()) {
    return;
  }

  console.info("[light-debug]", {
    event,
    at: new Date().toISOString(),
    ...(payload ?? {})
  });
}

