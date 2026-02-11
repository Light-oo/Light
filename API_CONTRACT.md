# Backend API Contract (Pilot)

## GET /search/demands

Pilot-scoped SELL browse demands endpoint (filters optional).

### Auth

- Required: `Authorization: Bearer <jwt>`

### Query Params (strict)

- Optional UUIDs only:
  - `brandId`
  - `modelId`
  - `yearId`
  - `itemTypeId`
  - `partId`
- Unknown query params are rejected as `400 invalid_request`.

### Success Response

- `200 OK`
- Body:

```json
{
  "ok": true,
  "data": [
    {
      "id": "string",
      "requester_user_id": "string",
      "status": "open",
      "brand_id": "string",
      "model_id": "string",
      "year_id": "string",
      "item_type_id": "string",
      "part_id": "string",
      "details_text": "string|null",
      "created_at": "ISO-8601"
    }
  ]
}
```

### Error Matrix

- `400` -> `{ "ok": false, "error": "invalid_request" }` (with `issues` for validation failures)
- `401` -> `{ "ok": false, "error": "unauthorized" }`
- `500` -> `{ "ok": false, "error": "unexpected_error" }`

