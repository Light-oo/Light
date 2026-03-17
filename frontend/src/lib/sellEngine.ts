import { ApiError, type ApiErrorPayload } from "./apiClient";
import type { MarketFieldDefinition } from "./marketForm";

type SellPublishFailure =
  | { kind: "duplicate" }
  | { kind: "validation"; message: string }
  | { kind: "generic" };

type BuildSellPublishPayloadParams = {
  marketKey: string;
  fields: MarketFieldDefinition[];
  structuredValues: Record<string, string>;
  priceAmount?: string;
  includePrice?: boolean;
  locationDepartment?: string;
  locationMunicipality?: string;
};

const RESERVED_TOP_LEVEL_KEYS = new Set(["marketKey", "price", "location"]);

function extractErrorCode(payload: ApiErrorPayload | null) {
  if (typeof payload?.error === "string") {
    return payload.error;
  }
  if (typeof payload?.error?.code === "string") {
    return payload.error.code;
  }
  return "";
}

function extractValidationMessage(payload: ApiErrorPayload | null) {
  if (Array.isArray(payload?.issues) && payload.issues.length > 0) {
    const firstIssue = payload.issues[0];
    if (typeof firstIssue?.message === "string" && firstIssue.message.trim().length > 0) {
      return firstIssue.message.trim();
    }
  }

  const detail = (payload?.error as any)?.detail;
  if (
    detail &&
    typeof detail === "object" &&
    detail.type === "validation" &&
    Array.isArray(detail.errors) &&
    detail.errors.length > 0
  ) {
    const firstValidationError = detail.errors[0];
    const message = String(firstValidationError?.message ?? "").trim();
    if (message.length > 0) {
      return message;
    }
  }

  const errorMessage =
    typeof payload?.error === "object" ? String(payload.error?.message ?? "").trim() : "";
  if (errorMessage.length > 0) {
    return errorMessage;
  }

  return "Revise los campos del formulario.";
}

export function buildSellPublishPayload(params: BuildSellPublishPayloadParams) {
  const payload: Record<string, unknown> = {
    marketKey: params.marketKey
  };

  for (const field of params.fields) {
    const value = params.structuredValues[field.key];
    if (!value) {
      continue;
    }
    const payloadKey = field.key;
    if (RESERVED_TOP_LEVEL_KEYS.has(payloadKey)) {
      continue;
    }
    payload[payloadKey] = value;
  }

  const department = (params.locationDepartment ?? "").trim();
  const municipality = (params.locationMunicipality ?? "").trim();
  if (department && municipality) {
    payload.location = {
      department,
      municipality
    };
  }

  const includePrice = params.includePrice !== false;
  if (includePrice) {
    payload.price = {
      amount: Number(params.priceAmount ?? ""),
      type: "fixed"
    };
  }

  return payload;
}

export function normalizeSellPublishResponse(payload: unknown) {
  const row = payload as any;
  if (row?.ok !== true) {
    throw new Error("invalid_sell_publish_response");
  }

  if (typeof row?.data?.listingId === "string" && row.data.listingId.trim().length > 0) {
    return {
      listingId: row.data.listingId,
      isCertified: row.data.isCertified === true
    };
  }

  if (
    row?.data?.entity === "listing" &&
    typeof row?.data?.listingId === "string" &&
    row.data.listingId.trim().length > 0
  ) {
    return {
      listingId: row.data.listingId,
      isCertified: row.data.isCertified === true
    };
  }

  throw new Error("invalid_sell_publish_response");
}

export function resolveSellPublishFailure(error: unknown): SellPublishFailure {
  if (!(error instanceof ApiError)) {
    return { kind: "generic" };
  }

  const code = extractErrorCode(error.payload);
  if (code === "duplicate_listing" || code === "OFFER_ALREADY_EXISTS") {
    return { kind: "duplicate" };
  }

  if (code === "validation_failed" || code === "invalid_request") {
    return {
      kind: "validation",
      message: extractValidationMessage(error.payload)
    };
  }

  return { kind: "generic" };
}
