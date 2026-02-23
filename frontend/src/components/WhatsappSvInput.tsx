type WhatsappSvInputProps = {
  label: string;
  localNumber: string;
  onChangeLocalNumber: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  errorText?: string | null;
};

export function WhatsappSvInput({
  label,
  localNumber,
  onChangeLocalNumber,
  required = false,
  disabled = false,
  placeholder = "Numero de telefono",
  errorText = null
}: WhatsappSvInputProps) {
  return (
    <label className="whatsapp-field">
      {label}
      <div className="phone-input-shell">
        <div className="phone-country-fixed" aria-label="El Salvador country selector">
          <span className="phone-flag" aria-hidden="true">🇸🇻</span>
          <span className="phone-caret" aria-hidden="true">▼</span>
        </div>
        <div className="phone-prefix" aria-hidden="true">+503</div>
        <input
          type="tel"
          inputMode="numeric"
          pattern="\d{8}"
          maxLength={8}
          required={required}
          disabled={disabled}
          value={localNumber}
          onChange={(event) => {
            const digitsOnly = event.target.value.replace(/\D/g, "").slice(0, 8);
            onChangeLocalNumber(digitsOnly);
          }}
          placeholder={placeholder}
          className="phone-local-input"
          autoComplete="tel"
        />
      </div>
      {errorText ? <small className="error">{errorText}</small> : null}
    </label>
  );
}
