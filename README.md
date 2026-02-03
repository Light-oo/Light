# Light Orchestrator API

Node.js orchestration layer for the information-broker marketplace. The API enforces business rules at the boundary while Supabase/Postgres remains the source of truth.

## Requirements

- Node.js 18+
- Supabase project with tables matching the expected schema

## Environment Variables

```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PORT=3000
```

## Run Locally

```bash
npm install
npm run dev
```

## Build & Run

```bash
npm run build
npm start
```

## API Endpoints

### Catalog

```bash
curl "http://localhost:3000/catalog/markets?active=true"
curl "http://localhost:3000/catalog/item-types?marketId=MARKET_ID&active=true"
curl "http://localhost:3000/catalog/item-type-rules?itemTypeId=ITEM_TYPE_ID"
```

### Drafts

```bash
curl -X POST http://localhost:3000/listings/draft \
  -H "Content-Type: application/json" \
  -d '{"marketId":"MARKET_ID","source":"web"}'

curl -X PATCH http://localhost:3000/listings/LISTING_ID/draft \
  -H "Content-Type: application/json" \
  -d '{
    "what": {"itemTypeId":"ITEM_TYPE_ID","brand":"Toyota","model":"Corolla","yearFrom":2010,"yearTo":2012,"side":"left","position":"front"},
    "howMuch": {"priceType":"fixed","priceAmount":100,"currency":"USD"},
    "location": {"department":"San Salvador","municipality":"San Salvador"},
    "contact": {"sellerType":"individual","contactName":"Juan","whatsapp":"7123-4567"}
  }'
```

### Publish Listing

```bash
curl -X POST http://localhost:3000/listings/LISTING_ID/publish
```

### Reveal Contact

```bash
curl -X POST http://localhost:3000/listings/LISTING_ID/reveal-contact \
  -H "Content-Type: application/json" \
  -d '{"requesterUserId":"USER_ID","tokenCost":3}'
```

## Publish Validation Rules

The publish flow loads the listing and related bucket records (WHAT, HOW_MUCH, LOCATION, CONTACT) and enforces:

- WHAT: item type, brand, model, year range required; year_to must be >= year_from; side/position required and validated against catalog rules when configured.
- HOW_MUCH: price_type required; price_amount required unless price_type is `unknown`.
- LOCATION: department + municipality required.
- CONTACT: seller link exists and seller has whatsapp_e164 + name.
- Catalog integrity: item type must be active and belong to the listing market.

If validation fails the API returns `{ error: { code: "VALIDATION_ERROR", message, details } }` with per-field details.

## Search API

### Endpoint

`GET /search/listings`

### Example requests

```bash
curl "http://localhost:3000/search/listings?itemTypeId=ITEM_TYPE_ID&brand=Toyota&model=Corolla&year=2014"

curl "http://localhost:3000/search/listings?department=San%20Salvador&municipality=San%20Salvador&priceMin=50&priceMax=150"

curl "http://localhost:3000/search/listings?sort=newest&pageSize=20&cursor=BASE64_CURSOR"
```

### Example response

```json
{
  "page": 1,
  "pageSize": 20,
  "nextCursor": "...",
  "results": [
    {
      "listingId": "...",
      "marketId": "...",
      "itemType": { "id": "...", "key": "bumper", "label_es": "Bumper" },
      "what": { "brand": "Toyota", "model": "Corolla", "year_from": 2014, "year_to": 2016, "side": "right", "position": "front" },
      "how_much": { "price_type": "negotiable", "price_amount": 85, "currency": "USD" },
      "location": { "department": "San Salvador", "municipality": "San Salvador" },
      "audit": { "published_at": "2024-05-01T00:00:00Z", "updated_at": "2024-05-01T00:00:00Z" },
      "quality_score": 70
    }
  ]
}
```

### Year filter behavior

- `year=YYYY` returns listings where `year_from <= year <= year_to`.
- `yearFrom` + `yearTo` returns listings whose ranges overlap with the query range.

### Pagination stability

Cursor pagination encodes the last `(published_at, listing_id)` pair (plus price/quality fields for those sorts). This prevents duplicates or missing records when new listings arrive mid-pagination.

### Index recommendations

- `listings(status, published_at DESC, id)`
- `item_specs(listing_id)`
- `item_specs(item_type_id)`
- `item_specs(brand)`
- `item_specs(model)`
- `item_specs(year_from, year_to)` (consider a GiST index on `int4range(year_from, year_to)`)
- `pricing(listing_id)`
- `pricing(price_amount)`
- `listing_locations(listing_id)`
- `listing_locations(department, municipality)`

### Suggested search view

Consider creating a view for simplified queries:

```sql
CREATE VIEW listing_search_view AS
SELECT
  l.id AS listing_id,
  l.status,
  l.market_id,
  l.published_at,
  l.updated_at,
  l.quality_score,
  ispec.item_type_id,
  it.key AS item_type_key,
  it.label_es AS item_type_label_es,
  ispec.brand,
  ispec.model,
  ispec.year_from,
  ispec.year_to,
  ispec.side,
  ispec.position,
  pr.price_type,
  pr.price_amount,
  pr.currency,
  loc.department,
  loc.municipality,
  CASE WHEN pr.price_type = 'unknown' THEN 1 ELSE 0 END AS price_unknown_last,
  COALESCE(l.quality_score, 0) AS quality_score_sort
FROM listings l
JOIN item_specs ispec ON ispec.listing_id = l.id
JOIN item_types it ON it.id = ispec.item_type_id
LEFT JOIN pricing pr ON pr.listing_id = l.id
LEFT JOIN listing_locations loc ON loc.listing_id = l.id;
```
