import type { MarketOptionRow } from "./supabaseData";

export type Option = { id: string; label: string };

function uniqueById(options: Option[]): Option[] {
  const map = new Map<string, Option>();
  for (const option of options) {
    if (!map.has(option.id)) {
      map.set(option.id, option);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export function extractBrandOptions(rows: MarketOptionRow[]): Option[] {
  return uniqueById(rows.map((row) => ({ id: row.brand_id, label: row.brand_label_es })));
}

export function extractModelOptions(rows: MarketOptionRow[], brandId: string): Option[] {
  return uniqueById(
    rows
      .filter((row) => row.brand_id === brandId)
      .map((row) => ({ id: row.model_id, label: row.model_label_es }))
  );
}

export function extractYearOptions(rows: MarketOptionRow[], brandId: string, modelId: string): Option[] {
  const map = new Map<string, Option>();
  for (const row of rows) {
    if (row.brand_id !== brandId || row.model_id !== modelId) {
      continue;
    }
    if (!map.has(row.year_id)) {
      map.set(row.year_id, { id: row.year_id, label: String(row.year) });
    }
  }

  return Array.from(map.values()).sort((a, b) => Number(b.label) - Number(a.label));
}

export function extractItemTypeOptions(
  rows: MarketOptionRow[],
  brandId: string,
  modelId: string,
  yearId: string
): Option[] {
  return uniqueById(
    rows
      .filter((row) => row.brand_id === brandId && row.model_id === modelId && row.year_id === yearId)
      .map((row) => ({ id: row.item_type_id, label: row.item_type_label_es }))
  );
}

export function labelForId(rows: MarketOptionRow[], kind: "brand" | "model" | "year" | "itemType" | "part", id: string | undefined) {
  if (!id) {
    return "-";
  }

  const row = rows.find((item) => {
    if (kind === "brand") return item.brand_id === id;
    if (kind === "model") return item.model_id === id;
    if (kind === "year") return item.year_id === id;
    if (kind === "itemType") return item.item_type_id === id;
    return item.part_id === id;
  });

  if (!row) {
    return id;
  }

  if (kind === "brand") return row.brand_label_es;
  if (kind === "model") return row.model_label_es;
  if (kind === "year") return String(row.year);
  if (kind === "itemType") return row.item_type_label_es;
  return row.part_label_es;
}
