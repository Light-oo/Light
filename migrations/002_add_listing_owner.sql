ALTER TABLE listings
ADD COLUMN IF NOT EXISTS seller_profile_id UUID REFERENCES profiles (id);
