-- Staging-only operational setup: xrdmxvkcewlqmufrwtfm.
-- Prerequisite: pg_cron enabled; existing CRON_SECRET saved through Vault UI as
-- wix_hubspot_staging_cron. Never place its value in SQL or Git.
-- Uses synchronous http: pg_net temporarily persists plaintext request headers
-- in a queue that this platform grants to browser DB roles.
BEGIN;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.provider_connections WHERE provider='wix'
      AND external_account_id='04ffe45c-f4bf-4999-aadb-90120b49e18a')
    OR NOT EXISTS (SELECT 1 FROM public.provider_connections WHERE provider='hubspot'
      AND external_account_id='149697146') THEN
    RAISE EXCEPTION 'Expected isolated QA connections are absent';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets
      WHERE name='wix_hubspot_staging_cron' AND decrypted_secret ~ '^[a-fA-F0-9]{64}$') <> 1 THEN
    RAISE EXCEPTION 'Exactly one valid approved staging worker Vault secret is required';
  END IF;
END $$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC, anon, authenticated;
-- Do not alter supabase_admin-owned internal Vault crypto helpers.
DO $$ BEGIN
  IF has_schema_privilege('anon','vault','USAGE')
    OR has_schema_privilege('authenticated','vault','USAGE')
    OR has_table_privilege('anon','vault.decrypted_secrets','SELECT')
    OR has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') THEN
    RAISE EXCEPTION 'Vault must not be accessible to browser roles';
  END IF;
END $$;
SELECT cron.schedule('wix-hubspot-staging-dispatch','* * * * *',$job$
DO $dispatch$
DECLARE
  worker_response extensions.http_response;
  worker_body jsonb;
BEGIN
  PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','10000');
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','280000');
  SELECT * INTO STRICT worker_response FROM extensions.http(ROW(
    'POST',
    'https://wix-hubspot-sync-staging.vercel.app/api/worker/dispatch',
    ARRAY[extensions.http_header('Authorization','Bearer ' ||
      (SELECT decrypted_secret FROM vault.decrypted_secrets
       WHERE name='wix_hubspot_staging_cron'))],
    'application/json','{}'
  )::extensions.http_request);
  IF worker_response.status IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'Staging worker returned HTTP %',worker_response.status;
  END IF;
  worker_body := worker_response.content::jsonb;
  IF COALESCE((worker_body->>'failed')::integer,-1) <> 0
    OR COALESCE((worker_body->>'deferred')::integer,-1) <> 0 THEN
    RAISE EXCEPTION 'Staging worker requires investigation';
  END IF;
  RAISE LOG 'staging_worker_dispatch status=200 requested=% attempted=% failed=0',
    worker_body->>'requested',worker_body->>'attempted';
END;
$dispatch$;
$job$);
SELECT cron.alter_job(jobid,active:=true) FROM cron.job
WHERE jobname='wix-hubspot-staging-dispatch';
COMMIT;
-- Cron success now requires actual HTTP 200 and zero failed/deferred counts.
-- Verify consecutive runs with scripts/staging-scheduler-verify.sql.
-- Stop only this job: SELECT cron.unschedule('wix-hubspot-staging-dispatch');
