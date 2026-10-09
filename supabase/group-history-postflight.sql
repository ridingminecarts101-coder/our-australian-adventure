-- Read-only, counts-only postflight after schema-group-history.sql.
-- Run in Supabase SQL Editor after the migration; share only these aggregate
-- values. The initial retained count may be zero until someone leaves.
select
  count(*)::bigint as retained_rows,
  count(*) filter (where source_is_personal)::bigint as named_rows,
  count(*) filter (where not source_is_personal)::bigint as anonymous_rows,
  count(*) filter (where feedback_shared)::bigint as feedback_rows,
  count(*) filter (
    where not source_is_personal and
      (completed_at is not null or completed_on is not null or
       completed_by is not null or source_updated_at is not null or
       rating is not null or memory is not null or feedback_shared)
  )::bigint as invalid_anonymous_rows,
  count(*) filter (
    where not feedback_shared and (rating is not null or memory is not null)
  )::bigint as unconsented_feedback_rows,
  count(*) filter (
    where not exists (select 1 from auth.users u where u.id = s.shared_by_id)
  )::bigint as missing_account_rows,
  count(*) filter (
    where not exists (select 1 from public.groups g where g.id = s.group_id)
  )::bigint as missing_group_rows,
  count(*) filter (
    where not exists (select 1 from public.group_members gm
                       where gm.group_id = s.group_id)
  )::bigint as ownerless_group_rows
from public.group_departed_memories s;

select
  to_regprocedure('public.list_my_retained_group_history()') is not null
    as owner_list_rpc_present,
  to_regprocedure('public.erase_my_group_history(uuid)') is not null
    as owner_erase_rpc_present,
  not has_table_privilege('authenticated',
    'public.group_departed_memories', 'SELECT') as archive_not_directly_readable,
  not has_function_privilege('anon',
    'public.group_completion_feed(uuid)', 'EXECUTE') as completion_feed_denies_anon,
  not has_function_privilege('anon',
    'public.group_completion_feedback_feed(uuid)', 'EXECUTE')
    as feedback_feed_denies_anon,
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public'
            and tablename = 'group_members')
    as member_invalidation_published;
