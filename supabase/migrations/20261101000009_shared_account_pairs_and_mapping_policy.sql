-- A pair is the routing/identity boundary. An account may participate in several
-- explicitly configured pairs; no routing is inferred from connection order.
alter table public.integration_pairs drop constraint integration_pairs_wix_connection_id_key;
alter table public.integration_pairs drop constraint integration_pairs_hubspot_connection_id_key;
create index integration_pairs_hubspot on public.integration_pairs(hubspot_connection_id);
create or replace function public.validate_integration_pair()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op='UPDATE' and (new.wix_connection_id<>old.wix_connection_id or new.hubspot_connection_id<>old.hubspot_connection_id) then
    raise exception 'Pair endpoints are immutable';
  end if;
  if not exists (select 1 from public.provider_connections where id=new.wix_connection_id and provider='wix' and disconnected_at is null)
     or not exists (select 1 from public.provider_connections where id=new.hubspot_connection_id and provider='hubspot' and disconnected_at is null) then
    raise exception 'Active Wix and HubSpot connections are required';
  end if;
  return new;
end;
$$;

alter table public.contact_links drop constraint contact_links_wix_connection_id_wix_contact_id_key;
alter table public.contact_links drop constraint contact_links_hubspot_connection_id_hubspot_contact_id_key;
alter table public.contact_links add constraint contact_links_pair_wix_unique unique(wix_connection_id,hubspot_connection_id,wix_contact_id);
alter table public.contact_links add constraint contact_links_pair_hubspot_unique unique(wix_connection_id,hubspot_connection_id,hubspot_contact_id);
-- NOT VALID preserves historical unpaired rows. New writes are always checked;
-- validate historical data after the operator configures the original pairs.
alter table public.contact_links add constraint contact_links_pair_fk foreign key(wix_connection_id,hubspot_connection_id)
  references public.integration_pairs(wix_connection_id,hubspot_connection_id) not valid;
alter table public.field_mappings add constraint field_mappings_pair_fk foreign key(wix_connection_id,hubspot_connection_id)
  references public.integration_pairs(wix_connection_id,hubspot_connection_id) not valid;

alter table public.field_mappings add column allow_empty boolean not null default false;
create or replace function public.replace_field_mappings(p_wix_id uuid,p_hubspot_id uuid,p_mappings jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform id from public.integration_pairs where wix_connection_id=p_wix_id and hubspot_connection_id=p_hubspot_id for update;
  if not found then raise exception 'Integration pair not found'; end if;
  if p_mappings is null or jsonb_typeof(p_mappings)<>'array' or jsonb_array_length(p_mappings)>100 then raise exception 'Invalid mapping batch'; end if;
  delete from public.field_mappings where wix_connection_id=p_wix_id and hubspot_connection_id=p_hubspot_id;
  insert into public.field_mappings(wix_connection_id,hubspot_connection_id,wix_field,hubspot_property,sync_direction,transform,enabled,allow_empty)
    select p_wix_id,p_hubspot_id,m->>'wixField',m->>'hubspotProperty',m->>'direction',coalesce(m->>'transform','none'),
      coalesce((m->>'enabled')::boolean,true),coalesce((m->>'allowEmpty')::boolean,false) from jsonb_array_elements(p_mappings) m;
  update public.integration_pairs set use_default_mappings=false where wix_connection_id=p_wix_id and hubspot_connection_id=p_hubspot_id;
end;
$$;
