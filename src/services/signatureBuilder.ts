import { createSupabaseServiceRole } from "../lib/supabase";
import {
  type ResolvedMarket,
  type ResolvedMarketField,
  type ResolvedMarketRule,
  resolveMarketConfiguration
} from "./marketResolution";

type RawRecord = Record<string, unknown>;

export class SignatureBuilderError extends Error {
  code: string;
  status: number;
  missingFields: string[];

  constructor(
    code: string,
    message: string,
    status = 400,
    missingFields: string[] = []
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.missingFields = missingFields;
  }
}

export type BuildIntentionSignatureInput = {
  marketKey: string;
  normalizedPayload: Record<string, unknown>;
  resolvedMarket?: ResolvedMarket;
  supabase?: ReturnType<typeof createSupabaseServiceRole>;
};

function toBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on", "active", "enabled"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off", "inactive", "disabled"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function readRuleBoolean(ruleMap: Map<string, unknown>, key: string, defaultValue = false): boolean {
  const value = ruleMap.get(key.toLowerCase());
  if (value === undefined) {
    return defaultValue;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as RawRecord;
    if (row.value !== undefined) {
      return toBoolean(row.value, defaultValue);
    }
    if (row.enabled !== undefined) {
      return toBoolean(row.enabled, defaultValue);
    }
    if (row.allow !== undefined) {
      return toBoolean(row.allow, defaultValue);
    }
  }

  return toBoolean(value, defaultValue);
}

function normalizeScalar(value: unknown): string {
  return String(value).trim().toLowerCase();
}

function normalizePayload(payload: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) {
      continue;
    }
    const normalizedValue = normalizeScalar(value);
    if (normalizedValue.length === 0) {
      continue;
    }
    out[key.trim().toLowerCase()] = normalizedValue;
  }
  return out;
}

function buildFieldRuleMap(field: ResolvedMarketField, rules: ResolvedMarketRule[]) {
  const out = new Map<string, unknown>();

  for (const [rawKey, rawValue] of Object.entries(field.raw)) {
    out.set(rawKey.toLowerCase(), rawValue);
  }

  for (const rule of rules) {
    if ((rule.fieldKey ?? "").toLowerCase() !== field.key.toLowerCase()) {
      continue;
    }
    out.set(rule.ruleKey.toLowerCase(), rule.ruleValue);
  }

  return out;
}

export async function buildIntentionSignature(
  input: BuildIntentionSignatureInput
): Promise<string> {
  const marketKey = input.marketKey.trim().toLowerCase();
  if (marketKey.length === 0) {
    throw new SignatureBuilderError("INVALID_MARKET_KEY", "Market key is required.");
  }

  const payload = normalizePayload(input.normalizedPayload ?? {});
  const supabase = input.supabase ?? createSupabaseServiceRole();
  const resolvedMarket =
    input.resolvedMarket ??
    (await resolveMarketConfiguration(marketKey, { supabase }));

  const signatureFields = resolvedMarket.fields
    .map((field) => {
      const ruleMap = buildFieldRuleMap(field, resolvedMarket.rules);
      const signatureComponent = readRuleBoolean(ruleMap, "signature_component", false);
      const required = readRuleBoolean(ruleMap, "required", field.required);
      return {
        field,
        signatureComponent,
        required
      };
    })
    .filter((entry) => entry.signatureComponent)
    .sort((left, right) => left.field.order - right.field.order);

  if (signatureFields.length === 0) {
    throw new SignatureBuilderError(
      "SIGNATURE_COMPONENTS_NOT_CONFIGURED",
      `No signature components configured for market "${resolvedMarket.market.key}".`,
      500
    );
  }

  const missingRequiredComponents: string[] = [];
  const parts: string[] = [resolvedMarket.market.key.toLowerCase()];

  for (const entry of signatureFields) {
    const fieldKey = entry.field.key.toLowerCase();
    const value = payload[fieldKey];

    if (!value) {
      if (entry.required) {
        missingRequiredComponents.push(fieldKey);
      }
      continue;
    }

    parts.push(`${fieldKey}=${value}`);
  }

  if (missingRequiredComponents.length > 0) {
    throw new SignatureBuilderError(
      "MISSING_SIGNATURE_COMPONENTS",
      `Missing required signature components: ${missingRequiredComponents.join(", ")}.`,
      400,
      missingRequiredComponents
    );
  }

  return parts.join("|");
}
