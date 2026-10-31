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
     set status = 'failed',
         error_code = 'MAX_ATTEMPTS_EXCEEDED',
         processed_at = now(),
         processing_started_at = null,
         next_attempt_at = null
   where id = p_event_id
     and status = 'processing'
     and attempts >= 5
     and processing_started_at < now() - interval '10 minutes';

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

create or replace function public.claim_next_webhook_events(p_limit integer default 10)
returns table(event_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.webhook_events
     set status = 'failed',
         error_code = 'MAX_ATTEMPTS_EXCEEDED',
         processed_at = now(),
         processing_started_at = null,
         next_attempt_at = null
   where status = 'processing'
     and attempts >= 5
     and processing_started_at < now() - interval '10 minutes';

  return query
  with candidates as (
    select id
      from public.webhook_events
     where attempts < 5
       and (
         (status in ('pending','failed') and (next_attempt_at is null or next_attempt_at <= now()))
         or (status = 'processing' and processing_started_at < now() - interval '10 minutes')
       )
     order by received_at asc
     limit least(greatest(coalesce(p_limit,10),1),20)
     for update skip locked
  ), claimed as (
    update public.webhook_events e
       set status = 'processing',
           attempts = e.attempts + 1,
           error_code = null,
           next_attempt_at = null,
           processing_started_at = now()
      from candidates
     where e.id = candidates.id
    returning e.id
  )
  select claimed.id from claimed;
end;
$$;

revoke all on function public.claim_webhook_event(uuid) from public, anon, authenticated;
revoke all on function public.claim_next_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.claim_webhook_event(uuid) to service_role;
grant execute on function public.claim_next_webhook_events(integer) to service_role;
