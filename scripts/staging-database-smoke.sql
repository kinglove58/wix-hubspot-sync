-- Run only in an explicitly designated isolated staging database after all 20
-- migrations. All synthetic changes are rolled back; any failed assertion aborts
-- the transaction. Require the final PASS result. Does not test PostgREST or
-- multi-session contention. Never substitute a production database for staging.
BEGIN;
DO $checks$
DECLARE event_id uuid; wix uuid; hubspot uuid; tenant_a uuid; tenant_b uuid; claim integer;
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>20 THEN RAISE EXCEPTION 'Migration ledger incomplete'; END IF;
 IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (NOT c.relrowsecurity OR has_table_privilege('anon',c.oid,'SELECT') OR has_table_privilege('authenticated',c.oid,'SELECT'))) THEN RAISE EXCEPTION 'Browser table access is not isolated'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN RAISE EXCEPTION 'Privileged RPC exposed'; END IF;
 tenant_a:=public.create_customer_tenant(gen_random_uuid(),'Synthetic staging smoke A');
 tenant_b:=public.create_customer_tenant(gen_random_uuid(),'Synthetic staging smoke B');
 INSERT INTO public.provider_connections(provider,external_account_id,tenant_id) VALUES('wix','synthetic-staging-site',tenant_a) RETURNING id INTO wix;
 INSERT INTO public.provider_connections(provider,external_account_id,tenant_id) VALUES('hubspot','synthetic-staging-portal',tenant_b) RETURNING id INTO hubspot;
 BEGIN
  INSERT INTO public.integration_pairs(wix_connection_id,hubspot_connection_id) VALUES(wix,hubspot);
  RAISE EXCEPTION 'Cross tenant pairing unexpectedly allowed';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'Paired connections must belong to the same tenant' THEN RAISE; END IF;
 END;
 INSERT INTO public.webhook_events(provider,event_type,idempotency_key) VALUES('wix','synthetic-staging-smoke','synthetic-staging-smoke') RETURNING id INTO event_id;
 claim:=public.claim_webhook_event_lease(event_id);
 IF claim IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Initial queue claim failed'; END IF;
 IF public.claim_webhook_event_lease(event_id) IS NOT NULL THEN RAISE EXCEPTION 'Double queue claim allowed'; END IF;
 UPDATE public.webhook_events SET processing_started_at=now()-interval '11 minutes' WHERE id=event_id;
 IF public.claim_webhook_event_lease(event_id) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Stale lease recovery failed'; END IF;
 UPDATE public.webhook_events SET attempts=5,processing_started_at=now()-interval '11 minutes' WHERE id=event_id;
 IF public.claim_webhook_event_lease(event_id) IS NOT NULL THEN RAISE EXCEPTION 'Retry exhaustion ignored'; END IF;
 IF NOT EXISTS(SELECT FROM public.webhook_events WHERE id=event_id AND status='failed' AND error_code='MAX_ATTEMPTS_EXCEEDED') THEN RAISE EXCEPTION 'Terminal queue state missing'; END IF;
END $checks$;
ROLLBACK;
SELECT 'PASS: migration ledger, RLS, browser grants, privileged RPC isolation, cross-tenant pair rejection, queue claim, duplicate claim rejection, stale lease recovery, retry exhaustion; synthetic rows rolled back' AS staging_database_smoke;
