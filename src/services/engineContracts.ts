export type EngineContractErrorDetail =
  | {
      type: "validation";
      errors: Array<{ fieldKey: string; code: string; message: string }>;
    }
  | {
      type: "generic";
      context?: Record<string, unknown>;
    };

export type EngineContractError = {
  code: string;
  message: string;
  detail?: EngineContractErrorDetail;
};

export type EngineContractSuccess<TData, TMeta extends Record<string, unknown> | undefined = undefined> =
  {
    ok: true;
    data: TData;
    meta?: TMeta;
  };

export type EngineContractFailure = {
  ok: false;
  error: EngineContractError;
};

export type EngineContractResponse<
  TData,
  TMeta extends Record<string, unknown> | undefined = undefined
> = EngineContractSuccess<TData, TMeta> | EngineContractFailure;

export function engineOk<TData, TMeta extends Record<string, unknown> | undefined = undefined>(
  data: TData,
  meta?: TMeta
): EngineContractSuccess<TData, TMeta> {
  if (meta) {
    return { ok: true, data, meta };
  }
  return { ok: true, data };
}

export function engineError(params: {
  code: string;
  message: string;
  detail?: EngineContractErrorDetail;
}): EngineContractFailure {
  return {
    ok: false,
    error: {
      code: params.code,
      message: params.message,
      detail: params.detail
    }
  };
}

export type EnginePaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
};

export type EngineMarketDescriptor = {
  id: string | null;
  key: string;
  label: string;
  active: boolean;
};
