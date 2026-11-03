-- Persisting the event and applying its lifecycle effect are separate requests.
-- This transaction makes retries safe even if the first receiver dies in between.
create function public.apply_wix_removal(p_event_id uuid, p_instance_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform id from public.webhook_events where id = p_event_id and provider = 'wix'
    and event_type = 'AppRemoved' and status <> 'succeeded' for update;
  if not found then return; end if;
  insert into public.provider_connections(provider,external_account_id,disconnected_at)
    values ('wix',p_instance_id,now())
    on conflict (provider,external_account_id) do update set
      disconnected_at = now(), encrypted_access_token = null,
      encrypted_refresh_token = null, updated_at = now();
  update public.webhook_events set status='succeeded', processed_at=now(),
    processing_started_at=null, next_attempt_at=null where id=p_event_id;
end;
$$;
revoke all on function public.apply_wix_removal(uuid,text) from public, anon, authenticated;
grant execute on function public.apply_wix_removal(uuid,text) to service_role;
