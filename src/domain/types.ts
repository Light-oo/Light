export type ListingStatus = 'draft' | 'active' | 'inactive';

export interface Listing {
  id: string;
  status: ListingStatus;
  source: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  market_id: string | null;
  seller_id: string | null;
  quality_score: number | null;
  what_fingerprint: string | null;
}

export interface ItemSpec {
  listing_id: string;
  item_type_id: string | null;
  brand: string | null;
  model: string | null;
  year_from: number | null;
  year_to: number | null;
  side: string | null;
  position: string | null;
}

export interface Pricing {
  listing_id: string;
  price_type: string | null;
  price_amount: number | null;
  currency: string | null;
}

export interface ListingLocation {
  listing_id: string;
  department: string | null;
  municipality: string | null;
}

export interface Seller {
  id: string;
  name: string | null;
  seller_type: string | null;
  whatsapp_e164: string | null;
  is_verified: boolean | null;
}

export interface Market {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

export interface ItemType {
  id: string;
  market_id: string;
  key: string;
  label_es: string;
  is_active: boolean;
  sort_order: number;
}

export interface ItemTypeRule {
  item_type_id: string;
  requires_side: boolean;
  requires_position: boolean;
  allowed_sides: string[] | null;
  allowed_positions: string[] | null;
}

export interface ContactAccess {
  id: string;
  listing_id: string;
  requester_user_id: string;
  token_cost: number;
  paid_at: string;
  revealed_at: string;
  channel: string | null;
}

export interface ListingBundle {
  listing: Listing;
  itemSpec: ItemSpec | null;
  pricing: Pricing | null;
  location: ListingLocation | null;
  seller: Seller | null;
  itemType: ItemType | null;
  itemTypeRule: ItemTypeRule | null;
}

export interface Profile {
  id: string;
  user_id: string;
  name: string | null;
  whatsapp_e164: string | null;
  contact_url: string | null;
  is_blocked: boolean;
  role: 'buyer' | 'seller' | 'admin';
  created_at: string;
}


