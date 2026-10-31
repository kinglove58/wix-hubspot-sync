create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('wix','hubspot')),
  external_account_id text,
  account_label text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_account_id)
);

create table if not exists public.field_mappings (
  id uuid primary key default gen_random_uuid(),
  wix_connection_id uuid references public.provider_connections(id) on delete cascade,
  hubspot_connection_id uuid references public.provider_connections(id) on delete cascade,
  wix_field text not null,
  hubspot_property text not null,
  sync_direction text not null check (sync_direction in ('wix_to_hubspot','hubspot_to_wix','bidirectional')),
  transform text not null default 'none' check (transform in ('none','trim','lowercase','uppercase')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wix_connection_id, hubspot_connection_id, wix_field, hubspot_property)
);

create table if not exists public.contact_links (
  id uuid primary key default gen_random_uuid(),
  wix_connection_id uuid not null references public.provider_connections(id) on delete cascade,
  hubspot_connection_id uuid not null references public.provider_connections(id) on delete cascade,
  wix_contact_id text not null,
  hubspot_contact_id text not null,
  last_synced_at timestamptz,
  last_source text check (last_source in ('wix','hubspot')),
  wix_updated_at timestamptz,
  hubspot_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wix_connection_id, wix_contact_id),
  unique (hubspot_connection_id, hubspot_contact_id)
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('wix','hubspot')),
  provider_event_id text,
  event_type text not null,
  correlation_id text,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','succeeded','failed','ignored')),
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_audit_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('wix','hubspot','system')),
  action text not null,
  outcome text not null check (outcome in ('succeeded','failed','skipped')),
  correlation_id text,
  wix_contact_id text,
  hubspot_contact_id text,
  safe_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_field_mappings_enabled on public.field_mappings(enabled);
create index if not exists idx_contact_links_wix on public.contact_links(wix_connection_id, wix_contact_id);
create index if not exists idx_contact_links_hubspot on public.contact_links(hubspot_connection_id, hubspot_contact_id);
create index if not exists idx_webhook_events_status_received on public.webhook_events(status, received_at);
create index if not exists idx_sync_audit_logs_created on public.sync_audit_logs(created_at desc);

alter table public.provider_connections enable row level security;
alter table public.field_mappings enable row level security;
alter table public.contact_links enable row level security;
alter table public.webhook_events enable row level security;
alter table public.sync_audit_logs enable row level security;
