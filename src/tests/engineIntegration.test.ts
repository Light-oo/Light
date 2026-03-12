import assert from "assert";
import { resolveMarketConfiguration, MarketResolutionError } from "../services/marketResolution";
import { loadFieldVocabulary } from "../services/marketVocabulary";
import { validateMarketPayload, validateMarketPayloadContract } from "../services/dynamicValidation";
import { buildIntentionSignature } from "../services/signatureBuilder";
import {
  createMarketAwareSellListing,
  createMarketAwareSellListingContract,
  MarketListingCreationError
} from "../services/marketListingCreation";
import { createOrReuseOpenMarketDemand } from "../services/marketDemandCreation";
import {
  searchBuyListingsByMarket,
  searchBuyListingsByMarketContract,
  searchSellDemandsByMarket
} from "../services/marketSearchEngine";
import {
  getMarketDefinitionContract,
  getMarketFieldOptionsContract,
  getMarketVocabularySnapshotContract
} from "../services/marketCatalog";
import { mapEngineResponseToHttpStatus } from "../services/engineErrorAdapter";
import { InMemorySupabase } from "./helpers/inMemorySupabase";

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

type SeedRow = Record<string, unknown>;

const VALID_AUTOMOTIVE_PAYLOAD = {
  brand: "toyota",
  model: "corolla",
  year: "2000",
  item_type: "motor",
  part: "alternador"
};

const VALID_HOME_SERVICES_PAYLOAD = {
  category: "electricidad",
  service: "instalacion_electrica"
};

const EXPECTED_SIGNATURE =
  "automotive|brand=toyota|model=corolla|year=2000|item_type=motor|part=alternador";

function createSeedData(): Record<string, SeedRow[]> {
  const fields = [
    { id: "f-brand", key: "brand", label_es: "Marca", sort_order: 1, option_source_ref: "catalog_options" },
    { id: "f-model", key: "model", label_es: "Modelo", sort_order: 2, option_source_ref: "catalog_options" },
    {
      id: "f-year",
      key: "year",
      label_es: "Año",
      sort_order: 3,
      option_source_ref: "catalog_options"
    },
    {
      id: "f-item-type",
      key: "item_type",
      label_es: "Sistema",
      sort_order: 4,
      option_source_ref: "catalog_options"
    },
    { id: "f-part", key: "part", label_es: "Pieza", sort_order: 5, option_source_ref: "catalog_options" }
  ].map((field) => ({
    ...field,
    market_key: "automotive",
    required: true,
    active: true,
    option_source_type: "catalog_field"
  }));

  const baseRules = fields.flatMap((field) => [
    {
      id: `r-required-${field.key}`,
      market_key: "automotive",
      field_key: field.key,
      rule_key: "required",
      rule_value: true,
      sort_order: 1,
      active: true
    },
    {
      id: `r-buy-${field.key}`,
      market_key: "automotive",
      field_key: field.key,
      rule_key: "allowed_in_buy",
      rule_value: true,
      sort_order: 2,
      active: true
    },
    {
      id: `r-sell-${field.key}`,
      market_key: "automotive",
      field_key: field.key,
      rule_key: "allowed_in_sell",
      rule_value: true,
      sort_order: 3,
      active: true
    },
    {
      id: `r-catalog-${field.key}`,
      market_key: "automotive",
      field_key: field.key,
      rule_key: "catalog_only",
      rule_value: true,
      sort_order: 4,
      active: true
    },
    {
      id: `r-signature-${field.key}`,
      market_key: "automotive",
      field_key: field.key,
      rule_key: "signature_component",
      rule_value: true,
      sort_order: 5,
      active: true
    }
  ]);

  return {
    markets: [
      { id: "mkt-automotive", key: "automotive", label: "Automotive", active: true },
      { id: "mkt-home-services", key: "home_services", label: "Home Services", active: true },
      { id: "mkt-electronics", key: "electronics", label: "Electronics", active: true },
      { id: "mkt-disabled", key: "inactive-market", label: "Inactive", active: false }
    ],
    market_fields: [
      ...fields,
      {
        id: "f-home-category",
        market_key: "home_services",
        key: "category",
        label_es: "Categoria",
        sort_order: 1,
        required: true,
        active: true,
        option_source_type: "catalog_field",
        option_source_ref: "catalog_options",
        item_specs_column: "item_type_id",
        demand_column: "item_type_id"
      },
      {
        id: "f-home-service",
        market_key: "home_services",
        key: "service",
        label_es: "Servicio",
        sort_order: 2,
        required: true,
        active: true,
        option_source_type: "catalog_field",
        option_source_ref: "catalog_options",
        item_specs_column: "part_id",
        demand_column: "part_id"
      }
    ],
    market_field_dependencies: [
      {
        id: "dep-model-brand",
        market_key: "automotive",
        field_key: "model",
        depends_on_field_key: "brand",
        active: true,
        sort_order: 1
      },
      {
        id: "dep-part-item-type",
        market_key: "automotive",
        field_key: "part",
        depends_on_field_key: "item_type",
        active: true,
        sort_order: 2
      },
      {
        id: "dep-home-service-category",
        market_key: "home_services",
        field_key: "service",
        depends_on_field_key: "category",
        active: true,
        sort_order: 1
      }
    ],
    market_field_rules: [
      ...baseRules,
      {
        id: "r-home-required-category",
        market_key: "home_services",
        field_key: "category",
        rule_key: "required",
        rule_value: true,
        sort_order: 1,
        active: true
      },
      {
        id: "r-home-buy-category",
        market_key: "home_services",
        field_key: "category",
        rule_key: "allowed_in_buy",
        rule_value: true,
        sort_order: 2,
        active: true
      },
      {
        id: "r-home-sell-category",
        market_key: "home_services",
        field_key: "category",
        rule_key: "allowed_in_sell",
        rule_value: true,
        sort_order: 3,
        active: true
      },
      {
        id: "r-home-catalog-category",
        market_key: "home_services",
        field_key: "category",
        rule_key: "catalog_only",
        rule_value: true,
        sort_order: 4,
        active: true
      },
      {
        id: "r-home-signature-category",
        market_key: "home_services",
        field_key: "category",
        rule_key: "signature_component",
        rule_value: true,
        sort_order: 5,
        active: true
      },
      {
        id: "r-home-required-service",
        market_key: "home_services",
        field_key: "service",
        rule_key: "required",
        rule_value: true,
        sort_order: 1,
        active: true
      },
      {
        id: "r-home-buy-service",
        market_key: "home_services",
        field_key: "service",
        rule_key: "allowed_in_buy",
        rule_value: true,
        sort_order: 2,
        active: true
      },
      {
        id: "r-home-sell-service",
        market_key: "home_services",
        field_key: "service",
        rule_key: "allowed_in_sell",
        rule_value: true,
        sort_order: 3,
        active: true
      },
      {
        id: "r-home-catalog-service",
        market_key: "home_services",
        field_key: "service",
        rule_key: "catalog_only",
        rule_value: true,
        sort_order: 4,
        active: true
      },
      {
        id: "r-home-signature-service",
        market_key: "home_services",
        field_key: "service",
        rule_key: "signature_component",
        rule_value: true,
        sort_order: 5,
        active: true
      }
    ],
    catalog_options: [
      { id: "opt-brand-honda", market_key: "automotive", field_key: "brand", option_key: "honda", label: "Honda", sort_order: 1, active: true, parent_option_id: null },
      { id: "opt-brand-toyota", market_key: "automotive", field_key: "brand", option_key: "toyota", label: "Toyota", sort_order: 2, active: true, parent_option_id: null },
      { id: "opt-model-corolla", market_key: "automotive", field_key: "model", option_key: "corolla", label: "Corolla", sort_order: 1, active: true, parent_option_id: "opt-brand-toyota" },
      { id: "opt-model-yaris", market_key: "automotive", field_key: "model", option_key: "yaris", label: "Yaris", sort_order: 2, active: true, parent_option_id: "opt-brand-toyota" },
      { id: "opt-model-civic", market_key: "automotive", field_key: "model", option_key: "civic", label: "Civic", sort_order: 3, active: true, parent_option_id: "opt-brand-honda" },
      { id: "opt-year-2000", market_key: "automotive", field_key: "year", option_key: "2000", label: "2000", sort_order: 1, active: true, parent_option_id: null },
      { id: "opt-year-2010", market_key: "automotive", field_key: "year", option_key: "2010", label: "2010", sort_order: 2, active: true, parent_option_id: null },
      { id: "opt-system-motor", market_key: "automotive", field_key: "item_type", option_key: "motor", label: "Motor", sort_order: 1, active: true, parent_option_id: null },
      { id: "opt-system-electrico", market_key: "automotive", field_key: "item_type", option_key: "electrico", label: "Electrico", sort_order: 2, active: true, parent_option_id: null },
      { id: "opt-part-alternador", market_key: "automotive", field_key: "part", option_key: "alternador", label: "Alternador", sort_order: 1, active: true, parent_option_id: "opt-system-motor" },
      { id: "opt-part-bomba", market_key: "automotive", field_key: "part", option_key: "bomba", label: "Bomba", sort_order: 2, active: true, parent_option_id: "opt-system-motor" },
      { id: "opt-part-bateria", market_key: "automotive", field_key: "part", option_key: "bateria", label: "Bateria", sort_order: 3, active: true, parent_option_id: "opt-system-electrico" },
      { id: "opt-home-category-electricidad", market_key: "home_services", field_key: "category", option_key: "electricidad", label: "Electricidad", sort_order: 1, active: true, parent_option_id: null },
      { id: "opt-home-service-instalacion", market_key: "home_services", field_key: "service", option_key: "instalacion_electrica", label: "Instalacion electrica", sort_order: 1, active: true, parent_option_id: "opt-home-category-electricidad" },
      { id: "opt-home-service-reparacion", market_key: "home_services", field_key: "service", option_key: "reparacion_electrica", label: "Reparacion electrica", sort_order: 2, active: true, parent_option_id: "opt-home-category-electricidad" }
    ],
    brands: [
      { id: "brand-toyota", label_es: "Toyota", active: true },
      { id: "brand-honda", label_es: "Honda", active: true }
    ],
    models: [
      {
        id: "model-corolla",
        label_es: "Corolla",
        brand_key: "toyota",
        active: true
      },
      {
        id: "model-yaris",
        label_es: "Yaris",
        brand_key: "toyota",
        active: true
      },
      {
        id: "model-civic",
        label_es: "Civic",
        brand_key: "honda",
        active: true
      }
    ],
    year_options: [
      { id: "year-2000", year: 2000, active: true, sort_order: 1 },
      { id: "year-2010", year: 2010, active: true, sort_order: 2 }
    ],
    item_types: [
      { id: "item-motor", key: "motor", label_es: "Motor", market_key: "automotive", active: true },
      {
        id: "item-electrico",
        key: "electrico",
        label_es: "Electrico",
        market_key: "automotive",
        active: true
      },
      {
        id: "item-electricidad",
        key: "electricidad",
        label_es: "Electricidad",
        market_key: "home_services",
        active: true
      }
    ],
    parts: [
      {
        id: "part-alternador",
        key: "alternador",
        label_es: "Alternador",
        item_type_key: "motor",
        item_type_id: "item-motor",
        market_key: "automotive",
        active: true
      },
      {
        id: "part-bomba",
        key: "bomba",
        label_es: "Bomba",
        item_type_key: "motor",
        item_type_id: "item-motor",
        market_key: "automotive",
        active: true
      },
      {
        id: "part-bateria",
        key: "bateria",
        label_es: "Bateria",
        item_type_key: "electrico",
        item_type_id: "item-electrico",
        market_key: "automotive",
        active: true
      },
      {
        id: "part-home-instalacion-electrica",
        key: "instalacion_electrica",
        label_es: "Instalacion electrica",
        item_type_id: "item-electricidad",
        market_key: "home_services",
        active: true
      },
      {
        id: "part-home-reparacion-electrica",
        key: "reparacion_electrica",
        label_es: "Reparacion electrica",
        item_type_id: "item-electricidad",
        market_key: "home_services",
        active: true
      }
    ],
    listings: [],
    item_specs: [],
    pricing: [],
    listing_locations: [],
    demands: []
  };
}

function createContext() {
  return {
    marketKey: "automotive",
    supabase: new InMemorySupabase(createSeedData())
  };
}

const tests: TestCase[] = [
  {
    name: "market resolution: automotive resolves and unknown market fails",
    run: async () => {
      const ctx = createContext();
      const resolved = await resolveMarketConfiguration(ctx.marketKey, {
        supabase: ctx.supabase as any
      });
      assert.equal(resolved.market.key, "automotive");
      assert.equal(resolved.fields.length, 5);

      let notFound = false;
      try {
        await resolveMarketConfiguration("unknown-market", { supabase: ctx.supabase as any });
      } catch (error) {
        notFound = error instanceof MarketResolutionError && error.code === "MARKET_NOT_FOUND";
      }
      assert.equal(notFound, true);
    }
  },
  {
    name: "vocabulary loading: base and dependency filtered options",
    run: async () => {
      const ctx = createContext();
      const brands = await loadFieldVocabulary({
        marketKey: ctx.marketKey,
        fieldKey: "brand",
        selectedValues: {},
        supabase: ctx.supabase as any
      });
      assert.deepEqual(brands.options.map((option) => option.key), ["honda", "toyota"]);

      const modelsToyota = await loadFieldVocabulary({
        marketKey: ctx.marketKey,
        fieldKey: "model",
        selectedValues: { brand: "toyota" },
        supabase: ctx.supabase as any
      });
      assert.deepEqual(modelsToyota.options.map((option) => option.key), ["corolla", "yaris"]);

      const years = await loadFieldVocabulary({
        marketKey: ctx.marketKey,
        fieldKey: "year",
        selectedValues: {},
        supabase: ctx.supabase as any
      });
      assert.deepEqual(years.options.map((option) => option.key), ["2000", "2010"]);

      const partsMotor = await loadFieldVocabulary({
        marketKey: ctx.marketKey,
        fieldKey: "part",
        selectedValues: { item_type: "motor" },
        supabase: ctx.supabase as any
      });
      assert.deepEqual(partsMotor.options.map((option) => option.key), ["alternador", "bomba"]);
    }
  },
  {
    name: "dynamic validation: valid, required, catalog and dependency checks",
    run: async () => {
      const ctx = createContext();
      const valid = await validateMarketPayload({
        marketKey: ctx.marketKey,
        flow: "BUY",
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        supabase: ctx.supabase as any
      });
      assert.equal(valid.ok, true);
      if (valid.ok) {
        assert.equal(valid.signature, EXPECTED_SIGNATURE);
      }

      const missingRequired = await validateMarketPayload({
        marketKey: ctx.marketKey,
        flow: "BUY",
        payload: { ...VALID_AUTOMOTIVE_PAYLOAD, part: undefined },
        supabase: ctx.supabase as any
      });
      assert.equal(missingRequired.ok, false);
      if (!missingRequired.ok) {
        assert.ok(missingRequired.errors.some((item) => item.code === "required_field_missing"));
      }

      const invalidCatalog = await validateMarketPayload({
        marketKey: ctx.marketKey,
        flow: "BUY",
        payload: { ...VALID_AUTOMOTIVE_PAYLOAD, part: "pieza-fake" },
        supabase: ctx.supabase as any
      });
      assert.equal(invalidCatalog.ok, false);
      if (!invalidCatalog.ok) {
        assert.ok(invalidCatalog.errors.some((item) => item.code === "invalid_catalog_value"));
      }

      const dependencyViolation = await validateMarketPayload({
        marketKey: ctx.marketKey,
        flow: "BUY",
        payload: { model: "corolla" },
        allowPartial: true,
        buildSignature: false,
        supabase: ctx.supabase as any
      });
      assert.equal(dependencyViolation.ok, false);
      if (!dependencyViolation.ok) {
        assert.ok(
          dependencyViolation.errors.some((item) => item.code === "dependency_missing_parent")
        );
      }
    }
  },
  {
    name: "signature builder: canonical and deterministic output",
    run: async () => {
      const ctx = createContext();
      const normalized = {
        brand: "toyota",
        model: "corolla",
        year: "2000",
        item_type: "motor",
        part: "alternador"
      };

      const first = await buildIntentionSignature({
        marketKey: ctx.marketKey,
        normalizedPayload: normalized,
        supabase: ctx.supabase as any
      });
      const second = await buildIntentionSignature({
        marketKey: ctx.marketKey,
        normalizedPayload: normalized,
        supabase: ctx.supabase as any
      });

      assert.equal(first, EXPECTED_SIGNATURE);
      assert.equal(second, EXPECTED_SIGNATURE);
    }
  },
  {
    name: "market-aware listing creation: created + duplicate error",
    run: async () => {
      const ctx = createContext();
      const created = await createMarketAwareSellListing({
        accessToken: "token-seller-a",
        userId: "seller-a",
        marketKey: ctx.marketKey,
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        priceAmount: 75,
        priceType: "fixed",
        supabase: ctx.supabase as any
      });

      assert.equal(created.marketKey, "automotive");
      assert.equal(created.signature, EXPECTED_SIGNATURE);
      assert.equal(ctx.supabase.snapshot("listings").length, 1);

      let duplicateError = false;
      try {
        await createMarketAwareSellListing({
          accessToken: "token-seller-a",
          userId: "seller-a",
          marketKey: ctx.marketKey,
          payload: VALID_AUTOMOTIVE_PAYLOAD,
          priceAmount: 80,
          priceType: "fixed",
          supabase: ctx.supabase as any
        });
      } catch (error) {
        duplicateError =
          error instanceof MarketListingCreationError && error.code === "duplicate_listing";
      }
      assert.equal(duplicateError, true);
    }
  },
  {
    name: "market-aware listing creation: home services stores signature and item_specs mapping",
    run: async () => {
      const ctx = createContext();

      const created = await createMarketAwareSellListing({
        accessToken: "token-seller-home",
        userId: "seller-home",
        marketKey: "home_services",
        payload: VALID_HOME_SERVICES_PAYLOAD,
        priceAmount: 55,
        priceType: "fixed",
        supabase: ctx.supabase as any
      });

      assert.equal(created.marketKey, "home_services");
      assert.equal(
        created.signature,
        "home_services|category=electricidad|service=instalacion_electrica"
      );

      const listings = ctx.supabase.snapshot("listings");
      assert.equal(listings.length, 1);
      assert.equal(listings[0].intention_signature, created.signature);

      const itemSpecs = ctx.supabase.snapshot("item_specs");
      assert.equal(itemSpecs.length, 1);
      assert.equal(itemSpecs[0].item_type_id, "opt-home-category-electricidad");
      assert.equal(itemSpecs[0].part_id, "opt-home-service-instalacion");
      assert.equal(itemSpecs[0].category_id, undefined);
      assert.equal(itemSpecs[0].service_id, undefined);

      let duplicateError = false;
      try {
        await createMarketAwareSellListing({
          accessToken: "token-seller-home",
          userId: "seller-home",
          marketKey: "home_services",
          payload: VALID_HOME_SERVICES_PAYLOAD,
          priceAmount: 60,
          priceType: "fixed",
          supabase: ctx.supabase as any
        });
      } catch (error) {
        duplicateError =
          error instanceof MarketListingCreationError && error.code === "duplicate_listing";
      }
      assert.equal(duplicateError, true);
    }
  },
  {
    name: "market-aware demand creation: created and duplicate update path",
    run: async () => {
      const ctx = createContext();
      const first = await createOrReuseOpenMarketDemand({
        accessToken: "token-buyer-a",
        userId: "buyer-a",
        marketKey: ctx.marketKey,
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        detailsText: "detalle a",
        supabase: ctx.supabase as any
      });

      assert.equal(first.action, "created");

      const second = await createOrReuseOpenMarketDemand({
        accessToken: "token-buyer-a",
        userId: "buyer-a",
        marketKey: ctx.marketKey,
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        detailsText: "detalle b",
        supabase: ctx.supabase as any
      });

      assert.equal(second.action, "updated");
      assert.equal(first.demandId, second.demandId);
      const demandRows = ctx.supabase.snapshot("demands");
      assert.equal(demandRows.length, 1);
      assert.equal(demandRows[0].details_text, "detalle b");
    }
  },
  {
    name: "market-aware search: BUY by signature, SELL demand browse, market scoping",
    run: async () => {
      const ctx = createContext();

      await createMarketAwareSellListing({
        accessToken: "token-seller-a",
        userId: "seller-a",
        marketKey: ctx.marketKey,
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        priceAmount: 120,
        priceType: "fixed",
        supabase: ctx.supabase as any
      });

      await createOrReuseOpenMarketDemand({
        accessToken: "token-buyer-a",
        userId: "buyer-a",
        marketKey: ctx.marketKey,
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        detailsText: "compro urgente",
        supabase: ctx.supabase as any
      });

      await (ctx.supabase as any).from("listings").insert({
        id: "listing-electronics",
        listing_type: "sell",
        status: "active",
        seller_profile_id: "seller-z",
        intention_signature: EXPECTED_SIGNATURE,
        market_key: "electronics"
      });

      const buySearch = await searchBuyListingsByMarket({
        marketKey: ctx.marketKey,
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        requesterUserId: "buyer-a",
        accessToken: "token-buyer-a",
        supabase: ctx.supabase as any
      });

      assert.equal(buySearch.ok, true);
      if (buySearch.ok) {
        assert.equal(buySearch.signature, EXPECTED_SIGNATURE);
        assert.equal(buySearch.results.length, 1);
        assert.ok(buySearch.results.every((row) => row.id !== "listing-electronics"));
      }

      const sellDemandBrowse = await searchSellDemandsByMarket({
        marketKey: ctx.marketKey,
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        accessToken: "token-seller-a",
        supabase: ctx.supabase as any
      });
      assert.equal(sellDemandBrowse.ok, true);
      if (sellDemandBrowse.ok) {
        assert.equal(sellDemandBrowse.results.length, 1);
        assert.ok(sellDemandBrowse.results.every((row) => row.status === "open"));
      }
    }
  },
  {
    name: "contracts and error adaptation: standardized shapes and status mapping",
    run: async () => {
      const ctx = createContext();

      const definition = await getMarketDefinitionContract({
        marketKey: "automotive",
        supabase: ctx.supabase as any
      });
      assert.equal(definition.ok, true);
      if (definition.ok) {
        assert.equal(definition.data.market.key, "automotive");
        assert.equal(definition.data.fields.length, 5);
      }
      assert.equal(mapEngineResponseToHttpStatus(definition), 200);

      const unknownDefinition = await getMarketDefinitionContract({
        marketKey: "unknown-market",
        supabase: ctx.supabase as any
      });
      assert.equal(unknownDefinition.ok, false);
      if (!unknownDefinition.ok) {
        assert.equal(unknownDefinition.error.code, "market_not_found");
      }
      assert.equal(mapEngineResponseToHttpStatus(unknownDefinition), 404);

      const options = await getMarketFieldOptionsContract({
        marketKey: "automotive",
        fieldKey: "model",
        selectedValues: { brand: "toyota" },
        supabase: ctx.supabase as any
      });
      assert.equal(options.ok, true);
      if (options.ok) {
        assert.deepEqual(options.data.options.map((option) => option.key), ["corolla", "yaris"]);
      }

      const brandOptions = await getMarketFieldOptionsContract({
        marketKey: "automotive",
        fieldKey: "brand",
        supabase: ctx.supabase as any
      });
      assert.equal(brandOptions.ok, true);
      if (brandOptions.ok) {
        assert.deepEqual(brandOptions.data.options.map((option) => option.key), ["honda", "toyota"]);
      }

      const snapshot = await getMarketVocabularySnapshotContract({
        marketKey: "automotive",
        selectedValues: { brand: "toyota", item_type: "motor" },
        supabase: ctx.supabase as any
      });
      assert.equal(snapshot.ok, true);

      const validationContract = await validateMarketPayloadContract({
        marketKey: "automotive",
        flow: "BUY",
        payload: { brand: "toyota" },
        supabase: ctx.supabase as any
      });
      assert.equal(validationContract.ok, false);
      if (!validationContract.ok) {
        assert.equal(validationContract.error.code, "validation_failed");
      }
      assert.equal(mapEngineResponseToHttpStatus(validationContract), 400);

      const listingContract = await createMarketAwareSellListingContract({
        accessToken: "token-seller-a",
        userId: "seller-a",
        marketKey: "automotive",
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        priceAmount: 100,
        priceType: "fixed",
        supabase: ctx.supabase as any
      });
      assert.equal(listingContract.ok, true);

      const buyContract = await searchBuyListingsByMarketContract({
        marketKey: "automotive",
        payload: VALID_AUTOMOTIVE_PAYLOAD,
        requesterUserId: "buyer-x",
        accessToken: "token-buyer-x",
        supabase: ctx.supabase as any
      });
      assert.equal(buyContract.ok, true);
      if (buyContract.ok) {
        assert.equal(buyContract.data.mode, "BUY");
        assert.equal(buyContract.meta?.page, 1);
      }
    }
  }
];

async function run() {
  const failures: Array<{ name: string; error: unknown }> = [];

  for (const test of tests) {
    try {
      await test.run();
      console.log(`[PASS] ${test.name}`);
    } catch (error) {
      failures.push({ name: test.name, error });
      console.error(`[FAIL] ${test.name}`);
      console.error(error);
    }
  }

  console.log(`\nEngine integration: ${tests.length - failures.length}/${tests.length} passed`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

void run();
