import { engineError, type EngineContractFailure, type EngineContractResponse } from "./engineContracts";

type ValidationIssue = {
  fieldKey: string;
  code: string;
  message: string;
};

const CODE_ALIASES: Record<string, string> = {
  market_not_found: "market_not_found",
  market_inactive: "market_inactive",
  field_not_found: "field_not_found",
  field_option_source_missing: "option_source_missing",
  field_option_source_unsupported: "option_source_unsupported",
  field_option_query_failed: "option_source_query_failed",
  field_option_market_scope_required: "option_source_market_scope_required",
  market_fields_not_found: "market_fields_not_found",
  invalid_market_key: "invalid_request",
  invalid_field_key: "invalid_request",
  invalid_flow: "invalid_request",
  invalid_payload: "invalid_request",
  missing_signature_components: "missing_signature_components",
  signature_components_not_configured: "signature_not_configured",
  duplicate_listing: "duplicate_listing",
  open_demand_duplicate: "duplicate_demand",
  demand_duplicate_resolve_failed: "invalid_demand_state",
  demand_insert_verification_failed: "invalid_demand_state",
  market_scope_not_persisted: "market_scope_not_persisted",
  market_scope_unavailable: "market_scope_unavailable",
  market_scope_column_not_found: "market_scope_unavailable",
  market_search_query_failed: "operation_failed",
  market_match_query_failed: "operation_failed",
  market_metadata_query_failed: "metadata_resolution_failed",
  market_resolution_failed: "metadata_resolution_failed",
  validation_failed: "validation_failed",
  unexpected_error: "unexpected_error"
};

export function mapEngineFailureToHttpStatus(failure: EngineContractFailure) {
  const code = failure.error.code;
  if (code === "validation_failed" || code === "invalid_request") {
    return 400;
  }
  if (code === "market_not_found" || code === "field_not_found") {
    return 404;
  }
  if (code === "market_inactive") {
    return 409;
  }
  if (code === "duplicate_listing" || code === "duplicate_demand") {
    return 409;
  }
  if (code === "missing_signature_components") {
    return 400;
  }
  return 500;
}

function normalizeCode(code: string | undefined) {
  if (!code) {
    return "unexpected_error";
  }
  const normalized = code.trim().toLowerCase();
  return CODE_ALIASES[normalized] ?? normalized;
}

function toValidationIssuesFromIssues(issues: unknown): ValidationIssue[] {
  if (!Array.isArray(issues)) {
    return [];
  }
  return issues
    .map((item) => {
      const row = item as any;
      const fieldKey = String(row?.path ?? row?.fieldKey ?? "").trim();
      const code = String(row?.code ?? "invalid_request").trim();
      const message = String(row?.message ?? "Invalid value.").trim();
      if (!fieldKey) {
        return null;
      }
      return { fieldKey, code, message };
    })
    .filter((item): item is ValidationIssue => item !== null);
}

export function engineValidationFailure(
  errors: ValidationIssue[],
  message = "Payload validation failed."
): EngineContractFailure {
  return engineError({
    code: "validation_failed",
    message,
    detail: {
      type: "validation",
      errors
    }
  });
}

export function adaptEngineError(error: unknown, fallbackMessage: string): EngineContractFailure {
  const row = (error ?? {}) as any;
  const code = normalizeCode(row?.code);
  const message =
    typeof row?.message === "string" && row.message.trim().length > 0
      ? row.message
      : fallbackMessage;

  const validationIssues = toValidationIssuesFromIssues(row?.issues);
  if (validationIssues.length > 0) {
    return engineValidationFailure(validationIssues, message);
  }

  if (code === "validation_failed" && Array.isArray(row?.errors)) {
    const errors = (row.errors as any[]).map((item) => ({
      fieldKey: String(item?.fieldKey ?? ""),
      code: String(item?.code ?? "invalid_request"),
      message: String(item?.message ?? "Invalid value.")
    }));
    return engineValidationFailure(errors, message);
  }

  if (code === "invalid_request") {
    return engineError({
      code,
      message
    });
  }

  return engineError({
    code,
    message
  });
}

export function mapEngineResponseToHttpStatus<TData, TMeta extends Record<string, unknown> | undefined>(
  response: EngineContractResponse<TData, TMeta>
) {
  if (response.ok) {
    return 200;
  }
  return mapEngineFailureToHttpStatus(response);
}

export function toPublicEngineErrorPayload(
  failure: EngineContractFailure,
  options?: { marketKey?: string }
) {
  const payload: Record<string, unknown> = {
    ok: false,
    error: failure.error.code,
    message: failure.error.message
  };

  const marketKey = String(options?.marketKey ?? "").trim().toLowerCase();
  if (marketKey) {
    payload.marketKey = marketKey;
  }

  if (failure.error.detail?.type === "validation") {
    const issues = failure.error.detail.errors.map((issue) => ({
      path: issue.fieldKey,
      code: issue.code,
      message: issue.message
    }));
    if (issues.length > 0) {
      payload.issues = issues;
    }
  }

  return payload;
}
