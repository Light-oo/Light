import { z } from 'zod';

export const USER_ROLES = ['buyer', 'seller', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LISTING_STATUSES = ['draft', 'active', 'inactive'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const PRICE_TYPES = ['fixed', 'negotiable', 'unknown'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const SIDES = ['left', 'right', 'none'] as const;
export type Side = (typeof SIDES)[number];

export const POSITIONS = ['front', 'rear', 'none'] as const;
export type Position = (typeof POSITIONS)[number];

export const SEARCH_SORTS = ['newest', 'price_asc', 'price_desc', 'quality', 'relevance'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SELLER_TYPES = ['individual', 'business'] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

export const listingStatusSchema = z.enum(LISTING_STATUSES);
export const priceTypeSchema = z.enum(PRICE_TYPES);
export const sideSchema = z.enum(SIDES);
export const positionSchema = z.enum(POSITIONS);
export const searchSortSchema = z.enum(SEARCH_SORTS);
export const sellerTypeSchema = z.enum(SELLER_TYPES);
export const userRoleSchema = z.enum(USER_ROLES);
