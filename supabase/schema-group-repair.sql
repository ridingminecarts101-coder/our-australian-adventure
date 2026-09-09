-- ═══════════════════════════════════════════════════════════════════
--  Group repair — run once, after schema-cutover.sql
-- ═══════════════════════════════════════════════════════════════════
--
--  Three things the cutover left behind, found by a live three-phone test:
--
--  1. A NAME THAT WOULD NOT DIE.
--     The cutover added progress.completed_by_id so that a rename updates
--     everything a person has ever ticked. It never backfilled it. Every row
--     ticked before that day has completed_by_id = null and a completed_by
--     string frozen at the moment of the tick, so the app falls back to the
--     old name and no rename can ever reach it. Renaming "Elli" to "Elena"
--     produced two people: Elena, and a ghost holding the old ticks.
--
--  2. DELETES THAT NEVER ARRIVED.
--     Realtime sends the old row on a DELETE, but by default "the old row" is
--     only the primary key. The app needs adventure_id to know what to remove
--     from the list, and since the cutover the primary key is a synthetic id -
--     so unticking something on one phone left it ticked on the other until a
--     reload. replica identity full sends the whole row.
--
--  3. TABLES NOBODY WAS LISTENING TO.
--     postgres_changes only fires for tables in the realtime publication.
--     groups and group_members are added here idempotently, so a rename or
--     somebody joining reaches the other phones without waiting for the poll.
--
--  Safe to run more than once. It changes no policy and drops nothing.


-- ───────────────────────────────────────────────────────────────────
--  1. Give the old rows an owner
-- ───────────────────────────────────────────────────────────────────
--  user_id is the best answer available and it is a truthful one: it is the
--  account that owns the row, which for anything ticked since the cutover is
--  the account that ticked it. Rows from the shared-passphrase era all belong
--  to the one account everybody signed in as, and no amount of SQL can now
--  separate those - but attributing them to that account is still better than
--  leaving a name the app can never update.

update public.progress
   set completed_by_id = user_id
 where completed_by_id is null
   and user_id is not null
   and completed = true;


-- ───────────────────────────────────────────────────────────────────
--  2. Send the whole row on a delete
-- ───────────────────────────────────────────────────────────────────
alter table public.progress       replica identity full;
alter table public.group_members  replica identity full;
alter table public.groups         replica identity full;


-- ───────────────────────────────────────────────────────────────────
--  3. Publish the group tables for realtime
-- ───────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['progress', 'photos', 'trips', 'groups', 'group_members'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added public.% to the realtime publication', t;
    end if;
  end loop;
end $$;


-- ───────────────────────────────────────────────────────────────────
--  4. What that did
-- ───────────────────────────────────────────────────────────────────
do $$
declare
  attributed  int;
  orphaned    int;
  published   int;
begin
  select count(*) into attributed
    from public.progress where completed and completed_by_id is not null;
  select count(*) into orphaned
    from public.progress where completed and completed_by_id is null;
  select count(*) into published
    from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public';

  raise notice ' ';
  raise notice 'Completed ticks with an owner:      %', attributed;
  raise notice 'Completed ticks still unattributed: %', orphaned;
  raise notice 'Tables publishing realtime:         %', published;
  raise notice ' ';
  if orphaned > 0 then
    raise notice 'The unattributed ones have no user_id at all. They will keep';
    raise notice 'showing whatever name was frozen onto them, which is the only';
    raise notice 'honest thing left to do with them.';
  else
    raise notice 'Every completed tick can now be renamed with its owner.';
  end if;
end $$;
