# Light Frontend Happy Path (QA/PM)

Use this account for all steps:

- Email: `testito@test.com`
- Password: `1234`

Base URL (local frontend):

- `http://localhost:5173`

## 0) Prerequisite (Backend must be up)

Before login, run backend and verify it is reachable:

1. In project root: `npm run dev`
2. Verify API health: open `http://localhost:3000/health`
3. Verify auth ping works with a valid JWT (`/auth/ping` returns `200`)

If backend is down, frontend session validation fails and app cannot enter Search/Publish/Account.

## 1) Login

1. Open `http://localhost:5173`.
2. On Sign In, enter:
   - Email: `testito@test.com`
   - Password: `1234`
3. Click **Sign in**.

Expected result:

- You are redirected to `/search`.
- Header is visible with:
  - Left: `LIGHT` logo text.
  - Center: BUY/SELL toggle control.
  - Right: round account icon.

## 2) BUY Flow (Search Listings)

1. Make sure header center shows **BUY**.
2. Fill required filters:
   - Brand
   - Model
   - Year
   - Item Type
   - Part
3. Optional: fill **Detail**.
4. Click **Search**.

Expected result when there are matches:

- Listing cards are shown.
- Each card shows What/Price/Location/Created.
- Each card has a **Reveal** button.

Expected result when there are zero matches:

- Empty state appears (`No results.`).
- Confirmation message appears:
  - `No results. Demand was registered for this signature.`

## 3) Reveal Contact (Token Consumption)

1. In BUY results, click **Reveal** on a listing card.

Expected on first reveal:

- WhatsApp link appears (`Open WhatsApp`).
- `didConsume` is shown and should be `true` on first successful reveal.

Expected when revealing same listing again:

- No extra token should be consumed for the same buyer/listing pair.
- `didConsume` should be `false` on re-reveal path.

Expected when tokens are insufficient:

- Reveal fails with user message for insufficient tokens.
- No WhatsApp link is shown.

## 4) SELL Flow (Publish Listing)

1. In header center control, switch to **SELL** (opens `/publish`).
2. Fill required fields:
   - Brand
   - Model
   - Year
   - Item Type
   - Part
   - Price Amount
3. Click **Publish**.

Expected result:

- Success message appears with listing ID:
  - `Listing published: <listingId>`
- Form resets.
- Searching the same signature in BUY should show the new listing.

Known constraints:

- Only seller profiles can publish.
- Profile must exist.
- Seller profile must have `whatsapp_e164`.
- Duplicate active signature for same seller returns duplicate listing error.

## 5) Account / Sign Out

1. Click the round account icon in the header (top-right).
2. Verify Account shows:
   - Email
   - WhatsApp
   - Role
   - Tokens
3. Optional: click **My Listings** to open seller listing management.
4. Click **Sign out**.

Expected result:

- Session is cleared.
- You are redirected to `/login`.
