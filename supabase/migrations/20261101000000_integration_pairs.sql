-- No inferred/backfilled pair: an operator must explicitly authorize routing.
create table public.integration_pairs (
  id uuid primary key default gen_random_uuid(),
  wix_connection_id uuid not null unique references public.provider_connections(id),
  hubspot_connection_id uuid not null unique references public.provider_connections(id),
  created_at timestamptz not null default now(),
  unique (wix_connection_id, hubspot_connection_id),
  check (wix_connection_id <> hubspot_connection_id)
);
alter table public.integration_pairs enable row level security;
revoke all on public.integration_pairs from public, anon, authenticated;
grant select, insert, update, delete on public.integration_pairs to service_role;

create function public.validate_integration_pair()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.provider_connections where id = new.wix_connection_id and provider = 'wix' and disconnected_at is null)
     or not exists (select 1 from public.provider_connections where id = new.hubspot_connection_id and provider = 'hubspot' and disconnected_at is null) then
    raise exception 'Active Wix and HubSpot connections are required';
  end if;
  if exists (select 1 from public.contact_links where
      (wix_connection_id = new.wix_connection_id and hubspot_connection_id <> new.hubspot_connection_id)
      or (hubspot_connection_id = new.hubspot_connection_id and wix_connection_id <> new.wix_connection_id))
     or exists (select 1 from public.field_mappings where
      (wix_connection_id = new.wix_connection_id and hubspot_connection_id <> new.hubspot_connection_id)
      or (hubspot_connection_id = new.hubspot_connection_id and wix_connection_id <> new.wix_connection_id)) then
    raise exception 'Existing links or mappings belong to another pair; reconcile before pairing';
  end if;
  return new;
end;
$$;
create trigger validate_integration_pair before insert or update on public.integration_pairs
for each row execute function public.validate_integration_pair();
revoke all on function public.validate_integration_pair() from public, anon, authenticated;
