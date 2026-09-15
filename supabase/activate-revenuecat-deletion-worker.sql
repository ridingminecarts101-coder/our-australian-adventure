-- OPERATOR-RUN ACTIVATION (not an application migration).
-- Prerequisites:
--   1. Deploy revenuecat-deletion-worker with JWT verification disabled.
--   2. Set Edge Function secrets REVENUECAT_SECRET_API_KEY and
--      REVENUECAT_PROJECT_ID and REVENUECAT_DELETION_WORKER_TOKEN. The API v2
--      key needs only customer_information:customers:read_write. Supabase
--      supplies its server key.
--   3. Store these Vault values (values are never committed):
--      revenuecat_deletion_worker_url   full .../functions/v1/... URL
--      revenuecat_deletion_worker_token same high-entropy worker token
-- The block fails closed unless both Vault values exist exactly once.

begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $activation$
declare
  worker_url text;
  worker_token text;
  existing_job bigint;
begin
  select decrypted_secret into strict worker_url
    from vault.decrypted_secrets where name = 'revenuecat_deletion_worker_url';
  select decrypted_secret into strict worker_token
    from vault.decrypted_secrets where name = 'revenuecat_deletion_worker_token';
  if worker_url <> 'https://ajyuozqoukigeeyhvuqc.supabase.co/functions/v1/revenuecat-deletion-worker'
     or length(worker_token) < 32 then
    raise exception 'invalid RevenueCat deletion worker activation secrets';
  end if;

  select jobid into existing_job from cron.job
   where jobname = 'wayfinder-revenuecat-deletion-worker';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;

  perform cron.schedule(
    'wayfinder-revenuecat-deletion-worker',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := 'https://ajyuozqoukigeeyhvuqc.supabase.co/functions/v1/revenuecat-deletion-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret
            from vault.decrypted_secrets where name = 'revenuecat_deletion_worker_token')
        ),
        body := '{}'::jsonb
      );
    $job$
  );
end
$activation$;
commit;
