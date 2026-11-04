-- Operational staging setup, not an application schema migration.
-- Run only in xrdmxvkcewlqmufrwtfm after approving the Vault destination.
-- Prerequisites: enable pg_cron and pg_net in the staging dashboard; create
-- a Vault secret named wix_hubspot_staging_cron containing existing CRON_SECRET.
-- Never paste the value into this script or commit it. No contact rows changed.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.provider_connections WHERE provider='wix'
      AND external_account_id='04ffe45c-f4bf-4999-aadb-90120b49e18a')
    OR NOT EXISTS (SELECT 1 FROM public.provider_connections WHERE provider='hubspot'
      AND external_account_id='149697146') THEN
    RAISE EXCEPTION 'Expected isolated QA connections are absent';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name='wix_hubspot_staging_cron') <> 1 THEN
    RAISE EXCEPTION 'Exactly one approved staging worker Vault secret is required';
  END IF;
END $$;
-- pg_net temporarily queues decrypted authorization headers. Deny browser roles.
REVOKE ALL ON SCHEMA net FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA net FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA vault FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vault FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('wix-hubspot-staging-dispatch', '* * * * *', $job$
  SELECT net.http_post(
    url := 'https://wix-hubspot-sync-staging.vercel.app/api/worker/dispatch',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name='wix_hubspot_staging_cron')),
    body := '{}'::jsonb,
    timeout_milliseconds := 290000
  );
$job$);
COMMIT;
-- Verify consecutive actual HTTP responses, not merely cron command success:
-- SELECT status_code, timed_out, error_msg, created FROM net._http_response
-- ORDER BY created DESC LIMIT 5;
-- Inspect response content privately for failed/deferred counts; never log headers.
-- Stop only this job: SELECT cron.unschedule('wix-hubspot-staging-dispatch');
