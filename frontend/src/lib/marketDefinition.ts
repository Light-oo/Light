import type { MarketCardTemplates } from "./marketForm";

export type MarketSummary = {
  key: string;
  label: string;
  active: boolean;
};

export type MarketDefinitionFieldResponse = {
  key: string;
  label?: string;
  label_es?: string;
  required?: boolean;
  requiredInBuy?: boolean;
  required_in_buy?: boolean;
  requiredInSell?: boolean;
  required_in_sell?: boolean;
  order?: number;
  sortOrder?: number;
  type?: string | null;
  inputType?: string;
  input_type?: string;
  allowedInBuy?: boolean;
  allowed_in_buy?: boolean;
  allowedInSell?: boolean;
  allowed_in_sell?: boolean;
};

export type MarketDefinitionDependencyResponse = {
  fieldKey?: string;
  field_key?: string;
  dependsOnFieldKey?: string;
  depends_on_field_key?: string;
  order?: number;
  sortOrder?: number;
};

export type MarketDefinitionResponse = {
  ok: true;
  data: {
    market: MarketSummary;
    cardTemplates?: MarketCardTemplates;
    fields: MarketDefinitionFieldResponse[];
    dependencies?: MarketDefinitionDependencyResponse[];
  };
};
