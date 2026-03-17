export function parseSignatureIdentityValues(signature?: string | null): Record<string, string> {
  const text = String(signature ?? "").trim();
  if (!text.includes("|")) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const part of text.split("|").slice(1)) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (!key || !value) {
      continue;
    }
    out[key] = value;
  }

  return out;
}
