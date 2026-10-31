alter table public.webhook_events
  add column if not exists next_attempt_at timestamptz,
  add column if not exists processing_started_at timestamptz;

create index if not exists idx_webhook_events_due
  on public.webhook_events(status, next_attempt_at, received_at);

create index if not exists idx_webhook_events_processing_started
  on public.webhook_events(status, processing_started_at);

create or replace function public.claim_next_webhook_events(p_limit integer default 10)
returns table(event_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
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

revoke all on function public.claim_next_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.claim_next_webhook_events(integer) to service_role;
