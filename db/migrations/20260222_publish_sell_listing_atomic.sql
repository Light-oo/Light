-- Atomic SELL publish for pilot.
-- Ensures listings + dependent rows are created in a single transaction (RPC call boundary).
-- Restores the RPC signature expected by the backend/PostgREST schema cache.

drop function if exists public.publish_sell_listing_atomic(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  text,
  text,
  text
);

create or replace function public.publish_sell_listing_atomic(
  p_brand_id uuid,
  p_currency text,
  p_department text,
  p_intention_signature text,
  p_item_type_id uuid,
  p_listing_id uuid,
  p_model_id uuid,
  p_municipality text,
  p_part_id uuid,
  p_price_amount numeric,
  p_price_type text,
  p_seller_profile_id uuid,
  p_year_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id uuid;
  v_listing_status text;
  v_listing_signature text;
  v_item_specs_listing_id uuid;
  v_pricing_listing_id uuid;
  v_location_listing_id uuid;
begin
  if p_department is null and p_municipality is not null then
    raise exception using errcode = 'P0001', message = 'invalid_location_payload';
  end if;

  if p_department is not null and p_municipality is null then
    raise exception using errcode = 'P0001', message = 'invalid_location_payload';
  end if;

  insert into public.listings (
    id,
    listing_type,
    status,
    seller_profile_id,
    intention_signature
  )
  values (
    p_listing_id,
    'sell',
    'active',
    p_seller_profile_id,
    p_intention_signature
  )
  returning id, status, intention_signature
  into v_listing_id, v_listing_status, v_listing_signature;

  if v_listing_id is null or v_listing_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'publish_atomic_failed_listings';
  end if;

  if v_listing_signature is null or v_listing_signature = '' then
    raise exception using errcode = 'P0001', message = 'publish_atomic_missing_intention_signature';
  end if;

  insert into public.item_specs (
    listing_id,
    brand_id,
    model_id,
    year_id,
    item_type_id,
    part_id
  )
  values (
    p_listing_id,
    p_brand_id,
    p_model_id,
    p_year_id,
    p_item_type_id,
    p_part_id
  )
  returning listing_id into v_item_specs_listing_id;

  if v_item_specs_listing_id is distinct from p_listing_id then
    raise exception using errcode = 'P0001', message = 'publish_atomic_failed_item_specs';
  end if;

  insert into public.pricing (
    listing_id,
    price_amount,
    price_type,
    currency
  )
  values (
    p_listing_id,
    p_price_amount,
    p_price_type,
    p_currency
  )
  returning listing_id into v_pricing_listing_id;

  if v_pricing_listing_id is distinct from p_listing_id then
    raise exception using errcode = 'P0001', message = 'publish_atomic_failed_pricing';
  end if;

  if p_department is not null and p_municipality is not null then
    insert into public.listing_locations (
      listing_id,
      department,
      municipality
    )
    values (
      p_listing_id,
      p_department,
      p_municipality
    )
    returning listing_id into v_location_listing_id;

    if v_location_listing_id is distinct from p_listing_id then
      raise exception using errcode = 'P0001', message = 'publish_atomic_failed_listing_locations';
    end if;
  end if;

  return p_listing_id;
end;
$$;

grant execute on function public.publish_sell_listing_atomic(
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
) to authenticated;
