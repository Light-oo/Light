export type MarketFlow = "BUY" | "SELL";

export type MarketFieldDefinition = {
  key: string;
  label: string;
  required: boolean;
  sortOrder: number;
  type: string | null;
  inputType: string;
  allowedInBuy: boolean;
  allowedInSell: boolean;
};

export type MarketDependency = {
  fieldKey: string;
  dependsOnFieldKey: string;
  order: number;
};

type RawDependency = {
  fieldKey?: unknown;
  field_key?: unknown;
  dependsOnFieldKey?: unknown;
  depends_on_field_key?: unknown;
  order?: unknown;
  sortOrder?: unknown;
};

type RawField = {
  key?: unknown;
  label?: unknown;
  label_es?: unknown;
  required?: unknown;
  order?: unknown;
  sortOrder?: unknown;
  type?: unknown;
  inputType?: unknown;
  input_type?: unknown;
  allowedInBuy?: unknown;
  allowed_in_buy?: unknown;
  allowedInSell?: unknown;
  allowed_in_sell?: unknown;
};

function toStringOrNull(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function toNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function compareBySortOrder(left: MarketFieldDefinition, right: MarketFieldDefinition) {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return left.key.localeCompare(right.key);
}

function compareDependencyOrder(left: MarketDependency, right: MarketDependency) {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  const fieldCompare = left.fieldKey.localeCompare(right.fieldKey);
  if (fieldCompare !== 0) {
    return fieldCompare;
  }
  return left.dependsOnFieldKey.localeCompare(right.dependsOnFieldKey);
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on", "enabled", "active"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off", "disabled", "inactive"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function inferInputType(rawType: string | null, fieldKey?: string | null) {
  const normalizedKey = (fieldKey ?? "").trim().toLowerCase();
  if (["detail", "details", "details_text", "detalle"].includes(normalizedKey)) {
    return "text";
  }

  const normalized = (rawType ?? "").trim().toLowerCase();
  if (!normalized) {
    return "select";
  }

  if (
    [
      "text",
      "textarea",
      "string",
      "free_text",
      "free-text",
      "detail",
      "details"
    ].includes(normalized)
  ) {
    return "text";
  }

  if (["number", "numeric", "integer", "int", "decimal", "float"].includes(normalized)) {
    return "number";
  }

  if (["select", "catalog", "option", "options", "enum"].includes(normalized)) {
    return "select";
  }

  return "select";
}

export function normalizeMarketFields(rawFields: RawField[]): MarketFieldDefinition[] {
  return rawFields
    .map((row, index) => {
      const key = toStringOrNull(row.key)?.toLowerCase();
      if (!key) {
        return null;
      }
      const label =
        toStringOrNull(row.label) ??
        toStringOrNull(row.label_es) ??
        key;
      const type = toStringOrNull(row.type);
      const inputTypeRaw =
        toStringOrNull(row.inputType) ??
        toStringOrNull(row.input_type);
      let inputType = (inputTypeRaw ?? inferInputType(type, key)).toLowerCase();
      if (
        ["detail", "details", "details_text", "detalle"].includes(key) &&
        (inputType === "select" || inputType.length === 0)
      ) {
        inputType = "text";
      }
      const resolvedSortOrder = toNumber(row.sortOrder ?? row.order, Number.MAX_SAFE_INTEGER - index);
      return {
        key,
        label,
        required: toBoolean(row.required, false),
        sortOrder: resolvedSortOrder,
        type,
        inputType,
        allowedInBuy: toBoolean(row.allowedInBuy ?? row.allowed_in_buy, true),
        allowedInSell: toBoolean(row.allowedInSell ?? row.allowed_in_sell, true)
      } satisfies MarketFieldDefinition;
    })
    .filter((field): field is MarketFieldDefinition => field !== null)
    .sort(compareBySortOrder);
}

export function normalizeMarketDependencies(rawDependencies: RawDependency[]): MarketDependency[] {
  const dependencies = rawDependencies
    .map((row, index) => {
      const fieldKey = toStringOrNull(row.fieldKey ?? row.field_key)?.toLowerCase();
      const dependsOnFieldKey = toStringOrNull(
        row.dependsOnFieldKey ?? row.depends_on_field_key
      )?.toLowerCase();
      if (!fieldKey || !dependsOnFieldKey) {
        return null;
      }

      return {
        fieldKey,
        dependsOnFieldKey,
        order: toNumber(row.sortOrder ?? row.order, Number.MAX_SAFE_INTEGER - index)
      } satisfies MarketDependency;
    })
    .filter((dependency): dependency is MarketDependency => dependency !== null)
    .sort(compareDependencyOrder);

  return dependencies;
}

export function isFieldVisibleInFlow(field: MarketFieldDefinition, flow: MarketFlow) {
  if (flow === "BUY") {
    return field.allowedInBuy;
  }
  return field.allowedInSell;
}

export function resolveOrderedFlowFields(
  fields: MarketFieldDefinition[],
  flow: MarketFlow
) {
  return fields
    .filter((field) => isFieldVisibleInFlow(field, flow))
    .sort(compareBySortOrder);
}

export function buildDependencyMaps(dependencies: MarketDependency[]) {
  const parentKeysByChild: Record<string, string[]> = {};
  const childKeysByParent: Record<string, string[]> = {};

  for (const dependency of dependencies) {
    if (!parentKeysByChild[dependency.fieldKey]) {
      parentKeysByChild[dependency.fieldKey] = [];
    }
    if (!parentKeysByChild[dependency.fieldKey].includes(dependency.dependsOnFieldKey)) {
      parentKeysByChild[dependency.fieldKey].push(dependency.dependsOnFieldKey);
    }

    if (!childKeysByParent[dependency.dependsOnFieldKey]) {
      childKeysByParent[dependency.dependsOnFieldKey] = [];
    }
    if (!childKeysByParent[dependency.dependsOnFieldKey].includes(dependency.fieldKey)) {
      childKeysByParent[dependency.dependsOnFieldKey].push(dependency.fieldKey);
    }
  }

  return {
    parentKeysByChild,
    childKeysByParent
  };
}

export function hasDependencyParentsSelected(
  fieldKey: string,
  selectedValues: Record<string, string>,
  parentKeysByChild: Record<string, string[]>
) {
  const parentKeys = parentKeysByChild[fieldKey] ?? [];
  return parentKeys.every((parentKey) => {
    const value = selectedValues[parentKey];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function dependencyQueryForField(
  fieldKey: string,
  selectedValues: Record<string, string>,
  parentKeysByChild: Record<string, string[]>
) {
  const parentKeys = parentKeysByChild[fieldKey] ?? [];
  const query: Record<string, string> = {};

  for (const parentKey of parentKeys) {
    const value = selectedValues[parentKey];
    if (typeof value === "string" && value.trim().length > 0) {
      query[parentKey] = value;
    }
  }

  return query;
}

export function resetDependentValues(
  changedFieldKey: string,
  selectedValues: Record<string, string>,
  childKeysByParent: Record<string, string[]>
) {
  const next = { ...selectedValues };
  const queue = [...(childKeysByParent[changedFieldKey] ?? [])];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const childKey = queue.shift()!;
    if (visited.has(childKey)) {
      continue;
    }
    visited.add(childKey);
    delete next[childKey];
    const nestedChildren = childKeysByParent[childKey] ?? [];
    for (const nested of nestedChildren) {
      if (!visited.has(nested)) {
        queue.push(nested);
      }
    }
  }

  return next;
}
