create function public.replace_field_mappings(p_wix_id uuid, p_hubspot_id uuid, p_mappings jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Serialize configuration updates with the pair row; all replacement writes
  -- roll back together if validation or an insert fails.
  perform id from public.integration_pairs
    where wix_connection_id = p_wix_id and hubspot_connection_id = p_hubspot_id for update;
  if not found then raise exception 'Integration pair not found'; end if;
  if jsonb_typeof(p_mappings) <> 'array' or jsonb_array_length(p_mappings) > 100 then
    raise exception 'Invalid mapping batch';
  end if;
  delete from public.field_mappings where wix_connection_id = p_wix_id and hubspot_connection_id = p_hubspot_id;
  insert into public.field_mappings(wix_connection_id, hubspot_connection_id, wix_field, hubspot_property, sync_direction, transform, enabled)
    select p_wix_id, p_hubspot_id, m->>'wixField', m->>'hubspotProperty', m->>'direction',
      coalesce(m->>'transform', 'none'), coalesce((m->>'enabled')::boolean, true)
    from jsonb_array_elements(p_mappings) m;
end;
$$;
revoke all on function public.replace_field_mappings(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_field_mappings(uuid, uuid, jsonb) to service_role;
