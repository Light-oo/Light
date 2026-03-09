import type { Option } from "./marketOptions";

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isLocalOnlyTravelRangeOption(option: Option) {
  const normalizedId = normalizeText(option.id);
  const normalizedLabel = normalizeText(option.label);

  if (["local", "department", "same_department", "in_department"].includes(normalizedId)) {
    return true;
  }

  return (
    normalizedLabel.includes("mi departamento") ||
    normalizedLabel.includes("dentro de su departamento") ||
    normalizedLabel === "en mi departamento"
  );
}

function toTravelRangeLabel(option: Option) {
  const normalizedId = normalizeText(option.id);
  const normalizedLabel = normalizeText(option.label);

  if (
    ["interdepartmental", "inter_department", "nearby_departments", "departments_nearby"].includes(
      normalizedId
    ) ||
    normalizedLabel.includes("interdepart")
  ) {
    return "Departamentos cercanos";
  }

  if (
    ["national", "countrywide", "all_country"].includes(normalizedId) ||
    normalizedLabel.includes("todo el pais") ||
    normalizedLabel.includes("en todo el pais")
  ) {
    return "Todo el país";
  }

  return option.label;
}

export function mapFieldOptionsForUi(fieldKey: string, options: Option[]) {
  if (fieldKey !== "travel_range") {
    return options;
  }

  return options
    .filter((option) => !isLocalOnlyTravelRangeOption(option))
    .map((option) => ({
      ...option,
      label: toTravelRangeLabel(option)
    }));
}

