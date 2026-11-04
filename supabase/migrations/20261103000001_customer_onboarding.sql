create table public.customer_oauth_states (
  state_hash text primary key check (length(state_hash)=64),
  browser_nonce_hash text not null check (length(browser_nonce_hash)=64),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  encrypted_user_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index customer_oauth_states_expiry on public.customer_oauth_states(expires_at);
create index customer_oauth_states_browser on public.customer_oauth_states(browser_nonce_hash);
alter table public.customer_oauth_states enable row level security;
revoke all on public.customer_oauth_states from public, anon, authenticated;
grant all on public.customer_oauth_states to service_role;

-- Invoked only after the server verifies the provider proof and customer user.
-- It rechecks membership inside the same transaction as the ownership claim.
create function public.save_customer_connection(
  p_tenant_id uuid,p_user_id uuid,p_provider text,p_account_id text,
  p_label text,p_access_token text,p_refresh_token text,p_expires_at timestamptz,p_scopes jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare connection_id uuid; existing_tenant uuid;
begin
  perform 1 from public.tenants where id=p_tenant_id and disabled_at is null for share;
  if not found then raise exception 'Tenant access denied'; end if;
  perform 1 from public.tenant_memberships where tenant_id=p_tenant_id and user_id=p_user_id and role in ('owner','admin') for share;
  if not found then raise exception 'Tenant access denied'; end if;
  if p_provider not in ('wix','hubspot') or p_account_id is null or length(p_account_id) not between 1 and 512
     or p_access_token is null or p_access_token not like 'v1.%'
     or p_refresh_token is not null and p_refresh_token not like 'v1.%' then
    raise exception 'Invalid provider connection';
  end if;
  insert into public.provider_connections(provider,external_account_id,tenant_id)
    values(p_provider,p_account_id,p_tenant_id) on conflict(provider,external_account_id) do nothing;
  select id,tenant_id into connection_id,existing_tenant from public.provider_connections
    where provider=p_provider and external_account_id=p_account_id for update;
  if existing_tenant is not null and existing_tenant<>p_tenant_id then
    raise exception 'Provider account already belongs to another tenant';
  end if;
  update public.provider_connections set tenant_id=p_tenant_id,account_label=p_label,
    encrypted_access_token=p_access_token,encrypted_refresh_token=p_refresh_token,
    token_expires_at=p_expires_at,scopes=array(select jsonb_array_elements_text(coalesce(p_scopes,'[]'::jsonb))),
    connected_at=now(),disconnected_at=null,updated_at=now() where id=connection_id;
  return connection_id;
end;
$$;
revoke all on function public.save_customer_connection(uuid,uuid,text,text,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.save_customer_connection(uuid,uuid,text,text,text,text,text,timestamptz,jsonb) to service_role;
