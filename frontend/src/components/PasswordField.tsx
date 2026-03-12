import { useId, useState } from "react";

type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  disabled?: boolean;
};

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12s-3.8 6.5-10.5 6.5S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.7 5.7A11.5 11.5 0 0 1 12 5.5c6.7 0 10.5 6.5 10.5 6.5a16.6 16.6 0 0 1-3.6 4.2" />
      <path d="M6.2 8.2A16.1 16.1 0 0 0 1.5 12s3.8 6.5 10.5 6.5c1.8 0 3.4-.5 4.8-1.2" />
      <path d="M14.7 14.7a3.2 3.2 0 0 1-4.5-4.5" />
    </svg>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  required = false,
  minLength,
  disabled = false
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();

  return (
    <label htmlFor={inputId}>
      {label}
      <span className="password-input-shell">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-visibility-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Ocultar contrasena" : "Mostrar contrasena"}
          title={visible ? "Ocultar contrasena" : "Mostrar contrasena"}
          disabled={disabled}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
    </label>
  );
}
