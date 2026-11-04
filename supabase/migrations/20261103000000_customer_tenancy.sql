-- Additive customer ownership. Legacy records remain unassigned and accessible
-- only through the existing privileged operator path until explicitly reconciled.
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner','admin','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id,user_id)
);
create index tenant_memberships_user on public.tenant_memberships(user_id,tenant_id);
alter table public.provider_connections add column tenant_id uuid references public.tenants(id) on delete restrict;
create index provider_connections_tenant on public.provider_connections(tenant_id,provider);
alter table public.webhook_events add column external_account_id text;
create index webhook_events_account_received on public.webhook_events(provider,external_account_id,received_at desc);

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
revoke all on public.tenants, public.tenant_memberships from public, anon, authenticated;
grant all on public.tenants, public.tenant_memberships to service_role;
-- Customer browser sessions can use Supabase Auth, never the service role or
-- integration tables directly. Server APIs verify Auth users and memberships.

create function public.create_customer_tenant(p_user_id uuid,p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare tenant uuid;
begin
  if p_user_id is null then raise exception 'A verified user is required'; end if;
  insert into public.tenants(name,created_by) values (btrim(p_name),p_user_id) returning id into tenant;
  insert into public.tenant_memberships(tenant_id,user_id,role) values (tenant,p_user_id,'owner');
  return tenant;
end;
$$;
revoke all on function public.create_customer_tenant(uuid,text) from public, anon, authenticated;
grant execute on function public.create_customer_tenant(uuid,text) to service_role;

-- Ownership transfers require an explicit administrative reconciliation; ordinary
-- connection updates, refreshes and OAuth reconnections may not move a tenant.
create function public.guard_connection_tenant()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.tenant_id is not null and new.tenant_id is distinct from old.tenant_id then
    raise exception 'Connection tenant ownership is immutable';
  end if;
  -- Concurrent ownership claims must not both observe an unassigned opposite
  -- endpoint. Row locks serialize claims; PostgreSQL aborts a deadlock safely.
  perform other.id from public.integration_pairs p
    join public.provider_connections other on other.id=case when p.wix_connection_id=new.id then p.hubspot_connection_id else p.wix_connection_id end
    where p.wix_connection_id=new.id or p.hubspot_connection_id=new.id
    order by other.id for update of other;
  if new.tenant_id is not null and exists (
    select 1 from public.integration_pairs p
    join public.provider_connections other on other.id=case when p.wix_connection_id=new.id then p.hubspot_connection_id else p.wix_connection_id end
    where (p.wix_connection_id=new.id or p.hubspot_connection_id=new.id)
      and other.tenant_id is not null and other.tenant_id<>new.tenant_id
  ) then raise exception 'Paired connections must belong to the same tenant'; end if;
  return new;
end;
$$;
create trigger guard_connection_tenant before update of tenant_id on public.provider_connections
  for each row execute function public.guard_connection_tenant();

create or replace function public.validate_integration_pair()
returns trigger language plpgsql set search_path = public as $$
declare wix_tenant uuid; hubspot_tenant uuid;
begin
  if tg_op='UPDATE' and (new.wix_connection_id<>old.wix_connection_id or new.hubspot_connection_id<>old.hubspot_connection_id) then
    raise exception 'Pair endpoints are immutable';
  end if;
  select tenant_id into wix_tenant from public.provider_connections where id=new.wix_connection_id and provider='wix' and disconnected_at is null for share;
  if not found then raise exception 'Active Wix and HubSpot connections are required'; end if;
  select tenant_id into hubspot_tenant from public.provider_connections where id=new.hubspot_connection_id and provider='hubspot' and disconnected_at is null for share;
  if not found then raise exception 'Active Wix and HubSpot connections are required'; end if;
  if wix_tenant is distinct from hubspot_tenant then raise exception 'Paired connections must belong to the same tenant'; end if;
  return new;
end;
$$;
