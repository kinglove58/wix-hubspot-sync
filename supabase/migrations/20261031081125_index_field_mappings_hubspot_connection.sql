-- Cover the HubSpot-side foreign key used when loading mappings for a provider pair.
create index if not exists idx_field_mappings_hubspot_connection
  on public.field_mappings(hubspot_connection_id);
