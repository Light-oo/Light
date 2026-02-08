import { listingRepository } from '../db/listingRepository';

const cache = new Map<string, { expiresAt: number; value: unknown }>();
const TTL_MS = 60_000;

const getCached = async <T>(key: string, loader: () => Promise<T>): Promise<T> => {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
  const value = await loader();
  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value;
};

export const catalogService = {
  async getMarkets(activeOnly: boolean) {
    return getCached(`markets:${activeOnly}`, () => listingRepository.getMarkets(activeOnly));
  },
  async getItemTypes(marketId: string | null, activeOnly: boolean) {
    return getCached(`itemTypes:${marketId ?? 'all'}:${activeOnly}`, () =>
      listingRepository.getItemTypes(marketId, activeOnly)
    );
  },
  async getItemTypeRules(itemTypeId: string) {
    return getCached(`itemTypeRules:${itemTypeId}`, () =>
      listingRepository.getItemTypeRules(itemTypeId)
    );
  },
  async getBrands(activeOnly: boolean) {
    return getCached(`brands:${activeOnly}`, () => listingRepository.getBrands(activeOnly));
  },
  async getModels(brandId: string | null, activeOnly: boolean) {
    return getCached(`models:${brandId ?? 'all'}:${activeOnly}`, () =>
      listingRepository.getModels(brandId, activeOnly)
    );
  },
  async getSides(activeOnly: boolean) {
    return getCached(`sides:${activeOnly}`, () => listingRepository.getSides(activeOnly));
  },
  async getPositions(activeOnly: boolean) {
    return getCached(`positions:${activeOnly}`, () => listingRepository.getPositions(activeOnly));
  },
  async getYearOptions(activeOnly: boolean) {
    return getCached(`yearOptions:${activeOnly}`, () => listingRepository.getYearOptions(activeOnly));
  },
  async getPartOptions(itemTypeId: string, activeOnly: boolean) {
    return getCached(`partOptions:${itemTypeId}:${activeOnly}`, () =>
      listingRepository.getPartOptions(itemTypeId, activeOnly)
    );
  }
};
