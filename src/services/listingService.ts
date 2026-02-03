import { listingRepository } from '../db/listingRepository';
import { ListingBundle, Listing } from '../domain/types';
import { badRequest, notFound } from '../utils/errors';
import { normalizeElSalvadorPhone } from '../utils/phone';
import { UpdateDraftInput } from '../validation/schemas';
import { validatePublish } from './publishValidator';

const buildBundle = async (listingId: string): Promise<ListingBundle> => {
  const listing = await listingRepository.getListingById(listingId);
  const [itemSpec, pricing, location] = await Promise.all([
    listingRepository.getItemSpec(listingId),
    listingRepository.getPricing(listingId),
    listingRepository.getLocation(listingId)
  ]);

  const seller = listing.seller_id ? await listingRepository.getSellerById(listing.seller_id) : null;
  const itemType = itemSpec?.item_type_id
    ? await listingRepository.getItemType(itemSpec.item_type_id)
    : null;
  const itemTypeRule = itemSpec?.item_type_id
    ? await listingRepository.getItemTypeRule(itemSpec.item_type_id)
    : null;

  return {
    listing,
    itemSpec,
    pricing,
    location,
    seller,
    itemType,
    itemTypeRule
  };
};

export const listingService = {
  async createDraft(payload: { marketId?: string; source?: string }) {
    const listing = await listingRepository.createDraftListing({
      market_id: payload.marketId ?? null,
      source: payload.source ?? null
    });
    return listing;
  },

  async updateDraft(listingId: string, payload: UpdateDraftInput) {
    const listing = await listingRepository.getListingById(listingId);
    if (!listing) {
      throw notFound('Listing not found');
    }

    if (payload.what) {
      await listingRepository.upsertItemSpec({
        listing_id: listingId,
        item_type_id: payload.what.itemTypeId ?? null,
        brand: payload.what.brand ?? null,
        model: payload.what.model ?? null,
        year_from: payload.what.yearFrom ?? null,
        year_to: payload.what.yearTo ?? null,
        side: payload.what.side ?? null,
        position: payload.what.position ?? null
      });
    }

    if (payload.howMuch) {
      await listingRepository.upsertPricing({
        listing_id: listingId,
        price_type: payload.howMuch.priceType ?? null,
        price_amount: payload.howMuch.priceAmount ?? null,
        currency: payload.howMuch.currency ?? null
      });
    }

    if (payload.location) {
      await listingRepository.upsertLocation({
        listing_id: listingId,
        department: payload.location.department ?? null,
        municipality: payload.location.municipality ?? null
      });
    }

    if (payload.contact) {
      if (!payload.contact.whatsapp) {
        throw badRequest('Whatsapp is required');
      }
      const whatsappE164 = normalizeElSalvadorPhone(payload.contact.whatsapp);
      const seller = await listingRepository.upsertSellerByWhatsapp({
        whatsapp_e164: whatsappE164,
        name: payload.contact.contactName ?? null,
        seller_type: payload.contact.sellerType ?? null
      });
      await listingRepository.updateListing(listingId, {
        seller_id: seller.id
      });
    }

    const updated = await listingRepository.updateListing(listingId, {
      updated_at: new Date().toISOString()
    });

    return updated;
  },

  async publish(listingId: string) {
    const bundle = await buildBundle(listingId);
    if (!bundle.listing) {
      throw notFound('Listing not found');
    }
    const issues = validatePublish(bundle);
    if (issues.length > 0) {
      throw badRequest('Listing is incomplete', issues);
    }

    const itemTypeKey = bundle.itemType?.key ?? '';
    const fingerprint = [
      bundle.itemSpec?.brand,
      bundle.itemSpec?.model,
      `${bundle.itemSpec?.year_from}-${bundle.itemSpec?.year_to}`,
      itemTypeKey,
      bundle.itemSpec?.side,
      bundle.itemSpec?.position
    ]
      .filter((value) => value && String(value).length > 0)
      .join('|')
      .toLowerCase();

    const qualityScore = computeQualityScore(bundle);

    const updated = await listingRepository.updateListing(listingId, {
      status: 'active',
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      what_fingerprint: fingerprint,
      quality_score: qualityScore
    });

    return {
      listing: updated,
      itemSpec: bundle.itemSpec,
      pricing: bundle.pricing,
      location: bundle.location
    };
  },

  async revealContact(listingId: string, payload: { requesterUserId: string; tokenCost: number }) {
    const listing = await listingRepository.getListingById(listingId);
    if (!listing || listing.status !== 'active') {
      throw badRequest('Listing is not active');
    }
    if (!listing.seller_id) {
      throw badRequest('Listing has no seller');
    }
    const seller = await listingRepository.getSellerById(listing.seller_id);
    if (!seller || !seller.whatsapp_e164) {
      throw badRequest('Seller contact unavailable');
    }

    await listingRepository.createContactAccess({
      listing_id: listingId,
      requester_user_id: payload.requesterUserId,
      token_cost: payload.tokenCost,
      paid_at: new Date().toISOString(),
      revealed_at: new Date().toISOString(),
      channel: 'whatsapp'
    });

    return {
      whatsapp_e164: seller.whatsapp_e164,
      contact_name: seller.name
    };
  }
};

const computeQualityScore = (bundle: ListingBundle): number => {
  let score = 0;
  if (bundle.itemSpec?.brand) score += 20;
  if (bundle.itemSpec?.model) score += 20;
  if (bundle.itemSpec?.year_from && bundle.itemSpec?.year_to) score += 20;
  if (bundle.pricing?.price_type) score += 20;
  if (bundle.location?.department && bundle.location?.municipality) score += 20;
  return score;
};
