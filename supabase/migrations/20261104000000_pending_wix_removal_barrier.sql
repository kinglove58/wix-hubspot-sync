-- A durable, unfinished removal must take precedence over token regeneration or
-- reconnection. Never discard an uninstall based on JWT issuance/arrival ordering.
create index webhook_pending_wix_removals on public.webhook_events(external_account_id)
  where provider='wix' and event_type='AppRemoved' and status not in ('succeeded','ignored');

create function public.wix_removal_is_pending(p_instance_id text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.webhook_events
    where provider='wix' and event_type='AppRemoved' and status not in ('succeeded','ignored')
      and (external_account_id=p_instance_id or external_account_id is null)
  );
$$;
revoke all on function public.wix_removal_is_pending(text) from public, anon, authenticated;
grant execute on function public.wix_removal_is_pending(text) to service_role;

create function public.guard_pending_wix_removal()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.provider='wix' and new.disconnected_at is null and new.encrypted_access_token is not null
    and public.wix_removal_is_pending(new.external_account_id) then
    raise exception 'Pending Wix removal must complete before connection activation';
  end if;
  return new;
end;
$$;
create trigger guard_pending_wix_removal before insert or update of encrypted_access_token,disconnected_at
  on public.provider_connections for each row execute function public.guard_pending_wix_removal();

-- Bind lifecycle effects to verified ingress metadata as well as the decrypted
-- payload. Legacy events predate that column and retain their trusted worker path.
create or replace function public.apply_wix_removal(p_event_id uuid, p_instance_id text)
returns void language plpgsql security definer set search_path=public as $$
declare account_id text;
begin
  select external_account_id into account_id from public.webhook_events
    where id=p_event_id and provider='wix' and event_type='AppRemoved' and status not in ('succeeded','ignored') for update;
  if not found then return; end if;
  if account_id is not null and account_id<>p_instance_id then
    raise exception 'Wix removal account identity mismatch';
  end if;
  insert into public.provider_connections(provider,external_account_id,disconnected_at)
    values ('wix',p_instance_id,now())
    on conflict (provider,external_account_id) do update set
      disconnected_at=now(),encrypted_access_token=null,encrypted_refresh_token=null,updated_at=now();
  update public.webhook_events set status='succeeded',processed_at=now(),
    processing_started_at=null,next_attempt_at=null where id=p_event_id;
end;
$$;
revoke all on function public.apply_wix_removal(uuid,text) from public, anon, authenticated;
grant execute on function public.apply_wix_removal(uuid,text) to service_role;
