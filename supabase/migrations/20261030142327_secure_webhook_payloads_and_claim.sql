-- Store provider webhook bodies encrypted at rest. Existing events remain
-- readable as metadata but cannot be replayed because their payload was not stored.
alter table public.webhook_events
  add column if not exists payload_encrypted text;

-- Atomic claim: only one worker can move a pending event into processing.
-- Increment attempts in the same statement to preserve accurate retry counts.
create or replace function public.claim_webhook_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  update public.webhook_events
     set status = 'processing',
         attempts = attempts + 1,
         error_code = null
   where id = p_event_id
     and status = 'pending'
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;

revoke all on function public.claim_webhook_event(uuid) from public, anon, authenticated;
grant execute on function public.claim_webhook_event(uuid) to service_role;
