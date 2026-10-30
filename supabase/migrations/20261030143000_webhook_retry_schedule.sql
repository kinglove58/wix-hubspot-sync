-- Add bounded retry scheduling for transient webhook processing failures.
alter table public.webhook_events
  add column if not exists next_attempt_at timestamptz,
  add column if not exists processing_started_at timestamptz;

update public.webhook_events set processing_started_at = coalesce(processing_started_at, received_at) where status = 'processing';

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
         error_code = null,
         next_attempt_at = null,
         processing_started_at = now()
   where id = p_event_id
     and attempts < 5
     and (
       (status in ('pending', 'failed') and (next_attempt_at is null or next_attempt_at <= now()))
       or (status = 'processing' and processing_started_at < now() - interval '10 minutes')
     )
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;

revoke all on function public.claim_webhook_event(uuid) from public, anon, authenticated;
grant execute on function public.claim_webhook_event(uuid) to service_role;


create or replace function public.claim_next_webhook_events(p_limit integer default 10)
returns table(event_id uuid)
language sql security definer set search_path = public as $$
  with candidates as (
    select id from public.webhook_events
    where attempts < 5 and (
      (status in ('pending','failed') and (next_attempt_at is null or next_attempt_at <= now()))
      or (status = 'processing' and processing_started_at < now() - interval '10 minutes')
    )
    order by received_at asc for update skip locked
    limit least(greatest(coalesce(p_limit,10),1),20)
  ), claimed as (
    update public.webhook_events e set status='processing', attempts=e.attempts+1,
      error_code=null, next_attempt_at=null, processing_started_at=now()
    from candidates where e.id=candidates.id returning e.id
  ) select claimed.id as event_id from claimed;
$$;
revoke all on function public.claim_next_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.claim_next_webhook_events(integer) to service_role;
