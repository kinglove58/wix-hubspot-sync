create table public.integration_leases (
  lease_key text primary key,
  owner uuid not null,
  expires_at timestamptz not null
);
alter table public.integration_leases enable row level security;
revoke all on public.integration_leases from public, anon, authenticated;
grant select, insert, update, delete on public.integration_leases to service_role;
create function public.acquire_integration_lease(p_key text, p_owner uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.integration_leases(lease_key, owner, expires_at)
    values (p_key, p_owner, now() + interval '10 minutes')
    on conflict (lease_key) do update set owner = excluded.owner, expires_at = excluded.expires_at
      where integration_leases.expires_at < now();
  return found;
end;
$$;
revoke all on function public.acquire_integration_lease(text,uuid) from public, anon, authenticated;
grant execute on function public.acquire_integration_lease(text,uuid) to service_role;

alter table public.sync_audit_logs
  add column wix_connection_id uuid references public.provider_connections(id),
  add column hubspot_connection_id uuid references public.provider_connections(id);
create index sync_audit_logs_pair_created on public.sync_audit_logs(wix_connection_id,hubspot_connection_id,created_at desc);
