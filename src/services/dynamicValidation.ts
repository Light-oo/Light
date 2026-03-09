import { createSupabaseServiceRole } from "../lib/supabase";
import {
  MarketResolutionError,
  type ResolvedMarket,
  type ResolvedMarketField,
  type ResolvedMarketRule,
  resolveMarketConfiguration
} from "./marketResolution";
import { loadFieldVocabulary } from "./marketVocabulary";
import { buildIntentionSignature, SignatureBuilderError } from "./signatureBuilder";
import { engineOk, type EngineContractResponse } from "./engineContracts";
import { adaptEngineError, engineValidationFailure } from "./engineErrorAdapter";

type RawRecord = Record<string, unknown>;

export type ValidationFlow = "BUY" | "SELL";

export type ValidationErrorItem = {
  fieldKey: string;
  code: string;
  message: string;
};

export type ValidationSuccess = {
  ok: true;
  normalizedPayload: Record<string, string>;
  signature: string;
};

export type ValidationFailure = {
  ok: false;
  errors: ValidationErrorItem[];
};

export type ValidationResult = ValidationSuccess | ValidationFailure;

export type ValidationContractData = {
  marketKey: string;
  flow: ValidationFlow;
  normalizedPayload: Record<string, string>;
  signature: string;
};

type ValidateMarketPayloadInput = {
  marketKey: string;
  flow: ValidationFlow;
  payload: Record<string, unknown>;
  allowPartial?: boolean;
  buildSignature?: boolean;
  resolvedMarket?: ResolvedMarket;
  supabase?: ReturnType<typeof createSupabaseServiceRole>;
};

type FieldRuleMap = Map<string, unknown>;

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function normalizeValue(value: unknown): string {
  return String(value).trim().toLowerCase();
}

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

function getFieldRuleMap(field: ResolvedMarketField, rules: ResolvedMarketRule[]): FieldRuleMap {
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

function readRuleBoolean(ruleMap: FieldRuleMap, key: string, defaultValue = false): boolean {
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

function pickPayloadValue(
  normalizedPayloadInput: Record<string, unknown>,
  fieldKey: string
): unknown {
  return normalizedPayloadInput[fieldKey.toLowerCase()];
}

function normalizeInputPayloadKeys(payload: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key.trim().toLowerCase()] = value;
  }
  return out;
}

export async function validateMarketPayload(
  input: ValidateMarketPayloadInput
): Promise<ValidationResult> {
  const flow = input.flow.toUpperCase() as ValidationFlow;
  if (flow !== "BUY" && flow !== "SELL") {
    return {
      ok: false,
      errors: [
        {
          fieldKey: "flow",
          code: "invalid_flow",
          message: "Flow must be BUY or SELL."
        }
      ]
    };
  }

  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    return {
      ok: false,
      errors: [
        {
          fieldKey: "payload",
          code: "invalid_payload",
          message: "Payload must be an object."
        }
      ]
    };
  }

  const allowPartial = input.allowPartial === true;
  const shouldBuildSignature = input.buildSignature !== false;

  const supabase = input.supabase ?? createSupabaseServiceRole();
  const resolvedMarket =
    input.resolvedMarket ??
    (await resolveMarketConfiguration(input.marketKey, { supabase }));

  const payloadByKey = normalizeInputPayloadKeys(input.payload);
  const knownFieldKeys = new Set(resolvedMarket.fields.map((field) => field.key.toLowerCase()));
  const errors: ValidationErrorItem[] = [];

  for (const incomingFieldKey of Object.keys(payloadByKey)) {
    if (!knownFieldKeys.has(incomingFieldKey)) {
      errors.push({
        fieldKey: incomingFieldKey,
        code: "unknown_field",
        message: `Field "${incomingFieldKey}" is not defined for market "${resolvedMarket.market.key}".`
      });
    }
  }

  const normalizedPayload: Record<string, string> = {};

  for (const field of resolvedMarket.fields) {
    const fieldKey = field.key.toLowerCase();
    const ruleMap = getFieldRuleMap(field, resolvedMarket.rules);
    const rawValue = pickPayloadValue(payloadByKey, fieldKey);
    const hasProvidedValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "";
    const required = readRuleBoolean(ruleMap, "required", field.required);
    const allowedInBuy = readRuleBoolean(ruleMap, "allowed_in_buy", true);
    const allowedInSell = readRuleBoolean(ruleMap, "allowed_in_sell", true);
    const catalogOnly = readRuleBoolean(ruleMap, "catalog_only", false);
    const allowedForFlow = flow === "BUY" ? allowedInBuy : allowedInSell;
    if (hasProvidedValue && !allowedForFlow) {
      errors.push({
        fieldKey,
        code: "field_not_allowed_in_flow",
        message: `Field "${fieldKey}" is not allowed in flow "${flow}".`
      });
      continue;
    }

    if (required && allowedForFlow && !hasProvidedValue && !allowPartial) {
      errors.push({
        fieldKey,
        code: "required_field_missing",
        message: `Field "${fieldKey}" is required.`
      });
      continue;
    }

    if (!hasProvidedValue) {
      continue;
    }

    const normalizedCandidate = normalizeValue(rawValue);
    normalizedPayload[fieldKey] = normalizedCandidate;

    const dependencies = resolvedMarket.dependencies.filter(
      (dependency) =>
        (dependency.fieldKey ?? "").toLowerCase() === fieldKey &&
        dependency.active
    );

    for (const dependency of dependencies) {
      const parentFieldKey = (dependency.dependsOnFieldKey ?? "").toLowerCase();
      if (!parentFieldKey) {
        continue;
      }
      const parentValue = normalizedPayload[parentFieldKey];
      if (parentValue === undefined) {
        errors.push({
          fieldKey,
          code: "dependency_missing_parent",
          message: `Field "${fieldKey}" depends on "${parentFieldKey}".`
        });
      }
    }

    if (!catalogOnly) {
      continue;
    }

    try {
      const vocabulary = await loadFieldVocabulary({
        marketKey: resolvedMarket.market.key,
        fieldKey,
        selectedValues: normalizedPayload,
        resolvedMarket,
        supabase
      });

      const matchedOption = vocabulary.options.find((option) => {
        const candidates = [
          option.key,
          option.label,
          option.id ?? ""
        ].map((value) => normalizeValue(value));
        return candidates.includes(normalizedCandidate);
      });

      if (!matchedOption) {
        errors.push({
          fieldKey,
          code: "invalid_catalog_value",
          message: `Field "${fieldKey}" has invalid value "${normalizedCandidate}".`
        });
        continue;
      }

      normalizedPayload[fieldKey] = normalizeValue(matchedOption.key);
    } catch (error) {
      if (error instanceof MarketResolutionError) {
        errors.push({
          fieldKey,
          code: error.code.toLowerCase(),
          message: error.message
        });
        continue;
      }
      throw error;
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors
    };
  }

  let signature = "";
  if (shouldBuildSignature) {
    try {
      signature = await buildIntentionSignature({
        marketKey: resolvedMarket.market.key,
        normalizedPayload,
        resolvedMarket,
        supabase
      });
    } catch (error) {
      if (error instanceof SignatureBuilderError) {
        return {
          ok: false,
          errors: error.missingFields.length
            ? error.missingFields.map((fieldKey) => ({
                fieldKey,
                code: error.code.toLowerCase(),
                message: error.message
              }))
            : [
                {
                  fieldKey: "signature",
                  code: error.code.toLowerCase(),
                  message: error.message
                }
              ]
        };
      }
      throw error;
    }
  }

  return {
    ok: true,
    normalizedPayload,
    signature
  };
}

export async function validateMarketPayloadContract(
  input: ValidateMarketPayloadInput
): Promise<EngineContractResponse<ValidationContractData>> {
  try {
    const result = await validateMarketPayload(input);
    if (!result.ok) {
      return engineValidationFailure(result.errors, "Payload validation failed.");
    }

    return engineOk({
      marketKey: input.marketKey.trim().toLowerCase(),
      flow: input.flow,
      normalizedPayload: result.normalizedPayload,
      signature: result.signature
    });
  } catch (error) {
    return adaptEngineError(error, "Unexpected validation engine error.");
  }
}
