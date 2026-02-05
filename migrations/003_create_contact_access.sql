CREATE TABLE IF NOT EXISTS contact_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  requester_user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token_cost INTEGER NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel TEXT,
  CONSTRAINT contact_access_unique_requester UNIQUE (listing_id, requester_user_id)
);
