-- The application accesses these tables only from trusted server code via the
-- Supabase service-role key. Keep browser-facing roles unable to access them,
-- even if a future RLS policy is accidentally introduced.
revoke all privileges on table
  public.provider_connections,
  public.field_mappings,
  public.contact_links,
  public.webhook_events,
  public.sync_audit_logs
from anon, authenticated;

grant select, insert, update, delete on table
  public.provider_connections,
  public.field_mappings,
  public.contact_links,
  public.webhook_events,
  public.sync_audit_logs
to service_role;
