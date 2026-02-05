CREATE TABLE IF NOT EXISTS reveal_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  requester_user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reveal_attempts_outcome_valid CHECK (outcome IN ('success', 'blocked', 'failed'))
);
