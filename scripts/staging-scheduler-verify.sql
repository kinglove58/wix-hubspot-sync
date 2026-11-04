-- Read-only scheduler acceptance; do not read queued authorization headers.
SELECT jsonb_build_object(
 'job',(SELECT jsonb_agg(jsonb_build_object('id',jobid,'schedule',schedule,'active',active,
   'synchronousHttp',position('extensions.http(' IN command)>0,
   'checksActualHttpStatus',position('worker_response.status IS DISTINCT FROM 200' IN command)>0))
   FROM cron.job WHERE jobname='wix-hubspot-staging-dispatch'),
 'runs',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
   SELECT runid,status,return_message,start_time,end_time FROM cron.job_run_details
   WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname='wix-hubspot-staging-dispatch')
   ORDER BY start_time DESC LIMIT 5) t),'[]'::jsonb),
 'anonVaultDenied',NOT has_schema_privilege('anon','vault','USAGE'),
 'authenticatedVaultDenied',NOT has_schema_privilege('authenticated','vault','USAGE'),
 'anonSecretReadDenied',NOT has_table_privilege('anon','vault.decrypted_secrets','SELECT'),
 'authenticatedSecretReadDenied',NOT has_table_privilege('authenticated','vault.decrypted_secrets','SELECT')
) AS scheduler_verification;
