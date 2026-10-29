-- Wix ↔ HubSpot sync: initial durable state schema.
-- Apply through the Supabase SQL editor or your migration workflow.
-- Provider credentials must be encrypted before storage; do not store plaintext tokens.

create extension if not exists pgcrypto;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('wix', 'hubspot')),
  external_account_id text not null,
  display_name text,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error', 'reauthorization_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_account_id)
);

create table if not exists public.field_mappings (
  id uuid primary key default gen_random_uuid(),
  wix_field text not null,
  hubspot_property text not null,
  sync_direction text not null check (sync_direction in ('wix_to_hubspot', 'hubspot_to_wix', 'bidirectional')),
  transform text check (transform in ('trim', 'lowercase', 'uppercase', 'none') or transform is null),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wix_field, hubspot_property)
);

create table if not exists public.contact_links (
  id uuid primary key default gen_random_uuid(),
  wix_contact_id text not null,
  hubspot_contact_id text not null,
  wix_updated_at timestamptz,
  hubspot_updated_at timestamptz,
  last_synced_at timestamptz,
  last_synced_hash text,
  last_sync_source text check (last_sync_source in ('wix', 'hubspot', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wix_contact_id),
  unique (hubspot_contact_id)
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('wix', 'hubspot')),
  provider_event_id text,
  dedupe_key text not null,
  event_type text not null,
  external_account_id text,
  correlation_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'ignored', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, dedupe_key)
);

create index if not exists webhook_events_pending_idx
  on public.webhook_events (received_at)
  where status in ('pending', 'failed');

create index if not exists contact_links_wix_updated_idx
  on public.contact_links (wix_updated_at);

create index if not exists contact_links_hubspot_updated_idx
  on public.contact_links (hubspot_updated_at);

-- OAuth state values are short-lived and one-time-use.
create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('wix', 'hubspot')),
  state_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- This initial schema intentionally does not enable browser access. Keep all tables
-- server-only until an authenticated tenant/user model and RLS policies are added.
alter table public.integration_connections enable row level security;
alter table public.field_mappings enable row level security;
alter table public.contact_links enable row level security;
alter table public.webhook_events enable row level security;
alter table public.oauth_states enable row level security;
