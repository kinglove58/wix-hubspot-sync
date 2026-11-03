-- Fencing identity must be independent from the retry budget: lock contention
-- can safely return an event to pending without reusing an old worker's token.
alter table public.webhook_events add column lease_version integer not null default 0;
create or replace function public.claim_webhook_event_lease(p_event_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare claimed_version integer;
begin
  if public.claim_webhook_event(p_event_id) then
    update public.webhook_events set lease_version=lease_version+1 where id=p_event_id
      returning lease_version into claimed_version;
  end if;
  return claimed_version;
end;
$$;
revoke all on function public.claim_webhook_event_lease(uuid) from public, anon, authenticated;
grant execute on function public.claim_webhook_event_lease(uuid) to service_role;
