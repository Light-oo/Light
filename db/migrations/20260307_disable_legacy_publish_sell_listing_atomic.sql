-- Disable legacy SELL publish RPC for authenticated callers.
-- Listing creation must go through the backend market-aware flow,
-- which builds canonical engine signatures (market-key + semantic keys).

revoke execute on function public.publish_sell_listing_atomic(
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  numeric,
  text,
  uuid,
  uuid
) from authenticated;

revoke execute on function public.publish_sell_listing_atomic(
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  numeric,
  text,
  uuid,
  uuid
) from anon;
