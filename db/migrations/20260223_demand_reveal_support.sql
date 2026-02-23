-- Pilot demand reveal support (seller reveals buyer WhatsApp from open demands).
-- Adds a dedicated reveal-tracking table for demand reveals and an atomic token-consumption RPC.

create table if not exists public.demand_contact_access (
  requester_user_id uuid not null references public.profiles(id) on delete cascade,
  demand_id uuid not null references public.demands(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_user_id, demand_id)
);

create index if not exists demand_contact_access_demand_id_idx
  on public.demand_contact_access (demand_id);

drop function if exists public.consume_token_and_get_demand_whatsapp(uuid);

create or replace function public.consume_token_and_get_demand_whatsapp(
  p_demand_id uuid
)
returns table (
  whatsapp_e164 text,
  did_consume boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_user_id uuid;
  v_target_user_id uuid;
  v_target_whatsapp text;
  v_demand_status text;
  v_inserted_count integer;
  v_updated_count integer;
begin
  v_requester_user_id := auth.uid();

  if v_requester_user_id is null then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  select d.requester_user_id, d.status
  into v_target_user_id, v_demand_status
  from public.demands d
  where d.id = p_demand_id;

  if v_target_user_id is null or v_demand_status <> 'open' then
    raise exception using errcode = 'P0001', message = 'demand_not_active';
  end if;

  if v_target_user_id = v_requester_user_id then
    raise exception using errcode = 'P0001', message = 'own_demand_reveal_blocked';
  end if;

  select p.whatsapp_e164
  into v_target_whatsapp
  from public.profiles p
  where p.id = v_target_user_id;

  if v_target_whatsapp is null or btrim(v_target_whatsapp) = '' then
    raise exception using errcode = 'P0001', message = 'demand_has_no_contact';
  end if;

  insert into public.demand_contact_access (
    requester_user_id,
    demand_id,
    target_user_id
  )
  values (
    v_requester_user_id,
    p_demand_id,
    v_target_user_id
  )
  on conflict (requester_user_id, demand_id) do nothing;

  get diagnostics v_inserted_count = row_count;

  if v_inserted_count = 0 then
    return query
    select v_target_whatsapp, false;
    return;
  end if;

  update public.profiles
  set tokens = tokens - 1
  where id = v_requester_user_id
    and coalesce(tokens, 0) > 0;

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    delete from public.demand_contact_access
    where requester_user_id = v_requester_user_id
      and demand_id = p_demand_id;

    raise exception using errcode = 'P0001', message = 'insufficient_tokens';
  end if;

  return query
  select v_target_whatsapp, true;
end;
$$;

grant execute on function public.consume_token_and_get_demand_whatsapp(uuid) to authenticated;
