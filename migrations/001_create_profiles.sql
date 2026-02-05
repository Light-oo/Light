CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'buyer',
  whatsapp_e164 TEXT,
  contact_url TEXT,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_role_valid CHECK (role IN ('buyer', 'seller', 'admin')),
  CONSTRAINT profiles_contact_required CHECK (
    role <> 'seller' OR whatsapp_e164 IS NOT NULL OR contact_url IS NOT NULL
  )
);
