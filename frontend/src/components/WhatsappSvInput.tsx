import type { ReactNode } from "react";
import { WHATSAPP_LOCAL_MAX_DIGITS, whatsappCountries } from "../lib/whatsappCountries";

type WhatsappSvInputProps = {
  label?: string;
  localNumber: string;
  onChangeLocalNumber: (value: string) => void;
  countryIso: string;
  onChangeCountryIso: (iso: string) => void;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  errorText?: string | null;
  actions?: ReactNode;
};

export function WhatsappSvInput({
  label,
  localNumber,
  onChangeLocalNumber,
  countryIso,
  onChangeCountryIso,
  required = false,
  disabled = false,
  readOnly = false,
  placeholder = "Numero de telefono",
  errorText = null,
  actions
}: WhatsappSvInputProps) {
  return (
    <label className="whatsapp-field">
      {label ? <span>{label}</span> : null}
      <div className="whatsapp-input-row">
        <div className="phone-input-shell">
          <select
            value={countryIso}
            onChange={(event) => onChangeCountryIso(event.target.value)}
            className="phone-prefix-select"
            disabled={disabled || readOnly}
            aria-label="Código de país"
          >
            {whatsappCountries.map((country) => (
              <option key={`${country.iso}-${country.country}`} value={country.iso}>
                {`${country.country} ${country.dialCode}`}
              </option>
            ))}
          </select>
          <input
            type="tel"
            inputMode="numeric"
            pattern="\d+"
            maxLength={WHATSAPP_LOCAL_MAX_DIGITS}
            required={required}
            disabled={disabled}
            readOnly={readOnly}
            value={localNumber}
            onChange={(event) => {
              const digitsOnly = event.target.value.replace(/\D/g, "").slice(0, WHATSAPP_LOCAL_MAX_DIGITS);
              onChangeLocalNumber(digitsOnly);
            }}
            placeholder={placeholder}
            className="phone-local-input"
            autoComplete="tel"
          />
        </div>
        {actions ? <div className="whatsapp-inline-actions">{actions}</div> : null}
      </div>
      {errorText ? <small className="error">{errorText}</small> : null}
    </label>
  );
}
