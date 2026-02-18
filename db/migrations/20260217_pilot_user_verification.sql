-- Pilot user verification schema additions.
-- Apply in Supabase SQL editor or migration runner.

alter table public.profiles
  add column if not exists whatsapp_verify_code text,
  add column if not exists whatsapp_verify_expires_at timestamptz,
  add column if not exists whatsapp_verified_at timestamptz;

create unique index if not exists profiles_whatsapp_e164_unique
  on public.profiles (whatsapp_e164)
  where whatsapp_e164 is not null;

create unique index if not exists profiles_whatsapp_e164_unique_normalized
  on public.profiles (
    (regexp_replace(whatsapp_e164, '[^0-9]+', '', 'g'))
  )
  where whatsapp_e164 is not null;

