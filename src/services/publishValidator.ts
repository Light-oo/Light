import { ItemTypeRule, ListingBundle } from '../domain/types';

type ValidationIssue = {
  field: string;
  message: string;
};

const isValueAllowed = (value: string | null | undefined, allowed?: string[] | null) => {
  if (!value || !allowed) return true;
  return allowed.includes(value);
};

const ruleRequiresValue = (required: boolean | null | undefined, value?: string | null) =>
  Boolean(required) && (!value || value.trim().length === 0);

export const validatePublish = (bundle: ListingBundle) => {
  const issues: ValidationIssue[] = [];
  const { listing, itemSpec, pricing, location, seller, itemType, itemTypeRule } = bundle;

  if (!listing.market_id) {
    issues.push({ field: 'listing.market_id', message: 'Market is required' });
  }

  if (!itemSpec) {
    issues.push({ field: 'what', message: 'Item specification is required' });
  }

  if (itemSpec) {
    if (!itemSpec.item_type_id) {
      issues.push({ field: 'what.itemTypeId', message: 'Item type is required' });
    }
    if (!itemSpec.brand) {
      issues.push({ field: 'what.brand', message: 'Brand is required' });
    }
    if (!itemSpec.model) {
      issues.push({ field: 'what.model', message: 'Model is required' });
    }
    if (!itemSpec.year_from) {
      issues.push({ field: 'what.yearFrom', message: 'Year from is required' });
    }
    if (!itemSpec.year_to) {
      issues.push({ field: 'what.yearTo', message: 'Year to is required' });
    }
    if (itemSpec.year_from && itemSpec.year_to && itemSpec.year_to < itemSpec.year_from) {
      issues.push({ field: 'what.yearTo', message: 'Year to must be >= year from' });
    }
  }

  if (!pricing) {
    issues.push({ field: 'howMuch', message: 'Pricing is required' });
  }

  if (pricing) {
    if (!pricing.price_type) {
      issues.push({ field: 'howMuch.priceType', message: 'Price type is required' });
    }
    if (pricing.price_type && pricing.price_type !== 'unknown' && !pricing.price_amount) {
      issues.push({ field: 'howMuch.priceAmount', message: 'Price amount is required' });
    }
  }

  if (!location) {
    issues.push({ field: 'location', message: 'Location is required' });
  }

  if (location) {
    if (!location.department) {
      issues.push({ field: 'location.department', message: 'Department is required' });
    }
    if (!location.municipality) {
      issues.push({ field: 'location.municipality', message: 'Municipality is required' });
    }
  }

  if (!seller) {
    issues.push({ field: 'contact', message: 'Seller is required' });
  }

  if (seller) {
    if (!seller.whatsapp_e164) {
      issues.push({ field: 'contact.whatsapp', message: 'Whatsapp is required' });
    }
    if (!seller.name) {
      issues.push({ field: 'contact.contactName', message: 'Contact name is required' });
    }
  }

  if (!itemType) {
    issues.push({ field: 'what.itemTypeId', message: 'Item type must be valid' });
  }

  if (itemType && listing.market_id && itemType.market_id !== listing.market_id) {
    issues.push({ field: 'what.itemTypeId', message: 'Item type does not belong to market' });
  }

  if (itemType && !itemType.is_active) {
    issues.push({ field: 'what.itemTypeId', message: 'Item type is inactive' });
  }

  if (itemSpec && itemTypeRule) {
    applyItemTypeRule(issues, itemTypeRule, itemSpec.side, itemSpec.position);
  }

  return issues;
};

const applyItemTypeRule = (
  issues: { field: string; message: string }[],
  rule: ItemTypeRule,
  side: string | null,
  position: string | null
) => {
  if (ruleRequiresValue(rule.requires_side, side)) {
    issues.push({ field: 'what.side', message: 'Side is required' });
  }
  if (ruleRequiresValue(rule.requires_position, position)) {
    issues.push({ field: 'what.position', message: 'Position is required' });
  }
  if (side && rule.allowed_sides && !isValueAllowed(side, rule.allowed_sides)) {
    issues.push({ field: 'what.side', message: 'Side value is not allowed' });
  }
  if (position && rule.allowed_positions && !isValueAllowed(position, rule.allowed_positions)) {
    issues.push({ field: 'what.position', message: 'Position value is not allowed' });
  }
};
