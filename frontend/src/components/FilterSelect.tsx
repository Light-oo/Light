import type { Option } from "../lib/marketOptions";

type FilterSelectProps = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  required = false,
  disabled = false,
  placeholder = "Selecciona"
}: FilterSelectProps) {
  const sortedOptions = [...options].sort((a, b) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base", numeric: true })
  );
  const useHiddenPlaceholder = placeholder.trim().toLowerCase() === "selecciona";

  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled}>
        {useHiddenPlaceholder ? (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        ) : (
          <option value="">{placeholder}</option>
        )}
        {sortedOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

