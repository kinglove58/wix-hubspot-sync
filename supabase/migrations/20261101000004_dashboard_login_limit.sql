-- The shared operator account has a global budget, independent of spoofable
-- forwarding headers. Also apply per-source rate limiting at the trusted ingress.
create table public.auth_rate_limits (
  bucket text primary key,
  attempts integer not null,
  resets_at timestamptz not null
);
alter table public.auth_rate_limits enable row level security;
revoke all on public.auth_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.auth_rate_limits to service_role;
create function public.allow_dashboard_login()
returns boolean language plpgsql security definer set search_path = public as $$
declare total integer;
begin
  insert into public.auth_rate_limits(bucket, attempts, resets_at)
    values ('dashboard',1,now()+interval '15 minutes')
    on conflict (bucket) do update
      set attempts = case when auth_rate_limits.resets_at <= now() then 1 else auth_rate_limits.attempts + 1 end,
          resets_at = case when auth_rate_limits.resets_at <= now() then excluded.resets_at else auth_rate_limits.resets_at end
    returning attempts into total;
  return total <= 10;
end;
$$;
revoke all on function public.allow_dashboard_login() from public, anon, authenticated;
grant execute on function public.allow_dashboard_login() to service_role;
