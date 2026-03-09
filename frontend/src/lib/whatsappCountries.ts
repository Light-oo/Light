export type WhatsappCountry = {
  country: string;
  iso: string;
  dialCode: string;
};

export const whatsappCountries: WhatsappCountry[] = [
  { country: "El Salvador", iso: "SV", dialCode: "+503" },
  { country: "Guatemala", iso: "GT", dialCode: "+502" },
  { country: "Honduras", iso: "HN", dialCode: "+504" },
  { country: "Nicaragua", iso: "NI", dialCode: "+505" },
  { country: "Costa Rica", iso: "CR", dialCode: "+506" },
  { country: "Panamá", iso: "PA", dialCode: "+507" },
  { country: "Belice", iso: "BZ", dialCode: "+501" },
  { country: "México", iso: "MX", dialCode: "+52" },
  { country: "Estados Unidos", iso: "US", dialCode: "+1" },
  { country: "Canadá", iso: "CA", dialCode: "+1" }
];

export const WHATSAPP_LOCAL_MIN_DIGITS = 6;
export const WHATSAPP_LOCAL_MAX_DIGITS = 14;

export const defaultWhatsappCountry =
  whatsappCountries.find((country) => country.iso === "SV") ?? whatsappCountries[0];

export function getWhatsappCountryByIso(iso: string | null | undefined) {
  const normalized = String(iso ?? "").trim().toUpperCase();
  return whatsappCountries.find((country) => country.iso === normalized) ?? defaultWhatsappCountry;
}

export function parseWhatsappE164(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().replace(/[\s-]+/g, "");
  if (!normalized) {
    return {
      country: defaultWhatsappCountry,
      localNumber: ""
    };
  }

  const matchedCountries = whatsappCountries.filter((country) => normalized.startsWith(country.dialCode));
  const selectedCountry =
    matchedCountries.sort((left, right) => right.dialCode.length - left.dialCode.length)[0] ??
    defaultWhatsappCountry;

  if (matchedCountries.length === 0) {
    return {
      country: defaultWhatsappCountry,
      localNumber: normalized.replace(/\D/g, "").slice(0, WHATSAPP_LOCAL_MAX_DIGITS)
    };
  }

  const localNumber = normalized
    .slice(selectedCountry.dialCode.length)
    .replace(/\D/g, "")
    .slice(0, WHATSAPP_LOCAL_MAX_DIGITS);

  return {
    country: selectedCountry,
    localNumber
  };
}

export function buildWhatsappE164(country: WhatsappCountry, localNumber: string) {
  const digits = String(localNumber ?? "").replace(/\D/g, "").slice(0, WHATSAPP_LOCAL_MAX_DIGITS);
  return `${country.dialCode}${digits}`;
}

