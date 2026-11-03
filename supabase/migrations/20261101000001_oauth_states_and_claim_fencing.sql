create table public.oauth_states (
  state_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from public, anon, authenticated;
grant select, insert, delete on public.oauth_states to service_role;
create index oauth_states_expiry on public.oauth_states(expires_at);

-- A returned attempt is a fencing token. Old workers cannot finish newer attempts.
create function public.claim_webhook_event_lease(p_event_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare claim_attempt integer;
begin
  if public.claim_webhook_event(p_event_id) then
    select attempts into claim_attempt from public.webhook_events where id = p_event_id;
  end if;
  return claim_attempt;
end;
$$;
revoke all on function public.claim_webhook_event_lease(uuid) from public, anon, authenticated;
grant execute on function public.claim_webhook_event_lease(uuid) to service_role;
