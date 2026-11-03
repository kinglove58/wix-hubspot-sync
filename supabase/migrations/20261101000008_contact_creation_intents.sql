create table public.contact_creation_intents (
  id uuid primary key default gen_random_uuid(),
  wix_connection_id uuid not null references public.provider_connections(id),
  hubspot_connection_id uuid not null references public.provider_connections(id),
  source_provider text not null check (source_provider in ('wix','hubspot')),
  source_contact_id text not null,
  encrypted_lookup_email text,
  destination_contact_id text,
  state text not null default 'reserved' check (state in ('reserved','creating','completed')),
  attempt_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(wix_connection_id,hubspot_connection_id,source_provider,source_contact_id),
  foreign key(wix_connection_id,hubspot_connection_id)
    references public.integration_pairs(wix_connection_id,hubspot_connection_id)
);
create index contact_creation_intents_hubspot on public.contact_creation_intents(hubspot_connection_id);
alter table public.contact_creation_intents enable row level security;
revoke all on public.contact_creation_intents from public, anon, authenticated;
grant select, insert, update, delete on public.contact_creation_intents to service_role;

create function public.remember_contact_creation(p_intent_id uuid, p_destination_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_destination_id is null or length(p_destination_id)=0 then raise exception 'Destination identity required'; end if;
  update public.contact_creation_intents set destination_contact_id=p_destination_id,
    state='completed',updated_at=now()
    where id=p_intent_id and (destination_contact_id is null or destination_contact_id=p_destination_id);
  if not found then raise exception 'Creation intent identity conflict'; end if;
end;
$$;
revoke all on function public.remember_contact_creation(uuid,text) from public, anon, authenticated;
grant execute on function public.remember_contact_creation(uuid,text) to service_role;
