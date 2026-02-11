# Backend API Contract (Pilot)

This document reflects current backend runtime behavior on `rewrite/light-backend`.

## Global Response Conventions

- Success envelope: `{ "ok": true, ... }`
- Error envelope:
  - Validation errors: `{ "ok": false, "error": "invalid_request", "issues": [...] }`
  - Malformed JSON parse errors: `{ "ok": false, "error": "invalid_request" }`
  - Unauthorized: `{ "ok": false, "error": "unauthorized" }`
  - Business errors: `{ "ok": false, "error": "<business_code>" }`
  - Unexpected/system errors: `{ "ok": false, "error": "unexpected_error" }`

## POST /contact-access

### Auth

- Required: `Authorization: Bearer <jwt>`

### Request Schema

- JSON body:
  - `listingId` (required UUID string)

### Success Envelope

- `200 OK`
- Body:

```json
{
  "ok": true,
  "data": {
    "listingId": "uuid",
    "whatsappUrl": "https://wa.me/...",
    "didConsume": true
  }
}
```

### Error Matrix

- `400`:
  - `{ "ok": false, "error": "invalid_request", "issues": [...] }` for schema validation errors
  - `{ "ok": false, "error": "invalid_request" }` for malformed JSON
  - `{ "ok": false, "error": "listing_has_no_contact" }` business outcome
- `401`: `{ "ok": false, "error": "unauthorized" }`
- `402`: `{ "ok": false, "error": "insufficient_tokens" }`
- `500`: `{ "ok": false, "error": "unexpected_error" }` for system/RPC failures

### Pilot Deviation Notes vs LOGIC 4

- None for this endpoint contract. Idempotency/decrement behavior is delegated to RPC `consume_token_and_get_whatsapp`.

## GET /auth/ping

### Auth

- Required: `Authorization: Bearer <jwt>`

### Request Schema

- No body.
- No query params.

### Success Envelope

- `200 OK`

```json
{
  "ok": true,
  "userId": "uuid"
}
```

### Error Matrix

- `401`: `{ "ok": false, "error": "unauthorized" }`
- `500`: `{ "ok": false, "error": "unexpected_error" }` for auth infrastructure failures

### Pilot Deviation Notes vs LOGIC 4

- None documented for this endpoint.

## GET /health

### Auth

- Not required.

### Request Schema

- No body.
- No query params.

### Success Envelope

- `200 OK`

```json
{
  "ok": true
}
```

### Error Matrix

- No application-level error mapping is defined for this endpoint.

### Pilot Deviation Notes vs LOGIC 4

- Not applicable.

## GET /search/listings (BUY mode only)

### Auth

- Required: `Authorization: Bearer <jwt>`

### Request Schema

- Query params:
  - `mode` (required literal `"BUY"`)
  - `brandId` (required UUID)
  - `modelId` (required UUID)
  - `yearId` (required UUID)
  - `itemTypeId` (required UUID)
  - `partId` (required UUID)
  - `detailsText` (optional string)
  - `page` (optional integer >= 1, default `1`)
  - `pageSize` (optional integer `1..50`, default `20`)
- Query object is not strict; unknown query params are currently ignored.

### Success Envelope

- `200 OK`

```json
{
  "ok": true,
  "results": [
    {
      "cardType": "sell",
      "listingId": "uuid",
      "what": {
        "brandId": "uuid",
        "brandLabelEs": "string",
        "modelId": "uuid",
        "modelLabelEs": "string",
        "yearId": "uuid",
        "year": 2020,
        "itemTypeId": "uuid",
        "itemTypeLabelEs": "string",
        "partId": "uuid",
        "partLabelEs": "string"
      },
      "price": {
        "amount": 100,
        "type": "fixed",
        "currency": "USD"
      },
      "location": {
        "department": "string",
        "municipality": "string"
      },
      "audit": {
        "createdAt": "ISO-8601"
      }
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

### Error Matrix

- `400`: `{ "ok": false, "error": "invalid_request", "issues": [...] }` for query validation failures
- `401`: `{ "ok": false, "error": "unauthorized" }`
- `500`: `{ "ok": false, "error": "unexpected_error" }`

### Pilot Deviation Notes vs LOGIC 4

- Endpoint auto-creates `public.demands` when search results are empty.
- BUY-demand dedupe is not enforced during this insert path in pilot.
- Capability-state gating (WhatsApp/BROWSE_ONLY restrictions) is not enforced in route-level API behavior.

## GET /search/demands

Pilot-scoped SELL browse demands endpoint (filters optional).

### Auth

- Required: `Authorization: Bearer <jwt>`

### Request Schema

- Query params (strict):
  - `brandId` (optional UUID)
  - `modelId` (optional UUID)
  - `yearId` (optional UUID)
  - `itemTypeId` (optional UUID)
  - `partId` (optional UUID)
- Unknown query params are rejected.
- No price query fields.

### Success Envelope

- `200 OK`

```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "requester_user_id": "uuid",
      "status": "open",
      "brand_id": "uuid",
      "model_id": "uuid",
      "year_id": "uuid",
      "item_type_id": "uuid",
      "part_id": "uuid",
      "details_text": "string|null",
      "created_at": "ISO-8601"
    }
  ]
}
```

### Error Matrix

- `400`: `{ "ok": false, "error": "invalid_request", "issues": [...] }` for query validation failures
- `401`: `{ "ok": false, "error": "unauthorized" }`
- `500`: `{ "ok": false, "error": "unexpected_error" }`

### Pilot Deviation Notes vs LOGIC 4

- Filters are optional in pilot for this endpoint (required-fields enforcement deferred).

## Pilot Scope Overrides vs LOGIC 4

- SELL demand browse (`GET /search/demands`) uses optional filters in pilot.
- Capability-state gating (WhatsApp-linked `BROWSE_ONLY` enforcement) is not enforced in pilot API routes.
- BUY-demand dedupe on empty-result auto-create path is not enforced in pilot.
