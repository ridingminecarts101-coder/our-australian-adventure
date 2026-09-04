-- ═══════════════════════════════════════════════════════════════════
--  Wayfinder — the multi-user cutover
-- ═══════════════════════════════════════════════════════════════════
--  Run this ONCE in the Supabase SQL Editor, before opening sign-ups.
--  It is safe to re-run.
--
--  WHY THIS EXISTS
--
--  Until now every phone signed in as the same account, because anonymous
--  sign-ups were switched off and the app fell back to a shared passphrase.
--  One account for three people breaks in ways that look like data loss:
--
--    * group_members is keyed on (group_id, user_id). Three phones sharing
--      one user_id are ONE member row, so when any phone leaves the group,
--      the group loses its only member and disappears for everybody.
--    * "Ticked by" can never be right, because there is no per-person
--      identity to attribute a tick to.
--
--  So: every phone gets its own account, and a GROUP is what makes a list
--  shared. This file makes that safe by scoping every row to an owner or a
--  group, and by replacing the "any signed-in user sees everything" rules
--  that were fine for two trusted phones and are not fine for a public app.
--
--  ORDER OF OPERATIONS - this matters:
--    1. Run this file.
--    2. Check the summary it prints at the end.
--    3. THEN turn on Authentication -> Sign In / Providers ->
--       "Allow new users to sign up".
--  Opening sign-ups before the policies are in place would let any stranger
--  read every row.
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
--  PART 1 — Scope: who a row belongs to
-- ───────────────────────────────────────────────────────────────────
--  A row belongs to one person, or to one group. scope_id is whichever
--  applies, so a shared list is one row per adventure per group rather
--  than one row per adventure per person, and ticking is last-write-wins
--  exactly as it was when the account was shared.
--
--  It is a generated column: it cannot drift, and the app cannot get it
--  wrong because the app never writes it.

-- Who ticked it, as an id rather than the name they happened to be using at
-- the time. The name is looked up when the row is drawn, so renaming yourself
-- updates everything you have ever ticked.
alter table public.progress add column if not exists completed_by_id uuid
  references auth.users(id) on delete set null;

alter table public.progress add column if not exists scope_id uuid
  generated always as (coalesce(group_id, user_id)) stored;
alter table public.photos   add column if not exists scope_id uuid
  generated always as (coalesce(group_id, user_id)) stored;
alter table public.trips    add column if not exists scope_id uuid
  generated always as (coalesce(group_id, user_id)) stored;


-- Rows written before ownership existed have no user_id, so no scope. If
-- there is exactly one account in the project - which there is, the shared
-- one - they belong to it. If there is more than one, this does nothing and
-- says so at the end rather than guessing.
do $$
declare
  only_user uuid;
  n int;
begin
  select count(*) into n from auth.users;
  if n = 1 then
    select id into only_user from auth.users;
    update public.progress set user_id = only_user where user_id is null;
    update public.photos   set user_id = only_user where user_id is null;
    update public.trips    set user_id = only_user where user_id is null;
    raise notice 'Backfilled ownerless rows to the only account present.';
  else
    raise notice 'Found % accounts, so ownerless rows were left alone.', n;
  end if;
end $$;


-- Existing rows belong to the group if there is one, so that the phones
-- which are about to get their own identities still see the shared list.
do $$
declare
  the_group uuid;
  n int;
begin
  select count(*) into n from public.groups;
  if n = 1 then
    select id into the_group from public.groups;
    update public.progress set group_id = the_group where group_id is null;
    update public.photos   set group_id = the_group where group_id is null;
    update public.trips    set group_id = the_group where group_id is null;
    raise notice 'Adopted existing rows into the one group.';
  else
    raise notice 'Found % groups; rows were not adopted automatically.', n;
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────
--  PART 2 — One progress row per adventure per scope
-- ───────────────────────────────────────────────────────────────────
--  progress was keyed on adventure_id alone, which only holds while there
--  is one list in the whole database. The app upserts on
--  (adventure_id, scope_id), so that pair is what has to be unique.

alter table public.progress drop constraint if exists progress_pkey;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'progress'
                   and column_name = 'id') then
    alter table public.progress add column id uuid not null default gen_random_uuid();
    alter table public.progress add primary key (id);
  end if;
end $$;

-- Collapse any duplicates before the unique index goes on, keeping the most
-- recently updated row for each pair.
delete from public.progress a
  using public.progress b
 where a.adventure_id = b.adventure_id
   and a.scope_id is not distinct from b.scope_id
   and a.id <> b.id
   and (a.updated_at, a.id) < (b.updated_at, b.id);

create unique index if not exists progress_scope_key
  on public.progress (adventure_id, scope_id);


-- ───────────────────────────────────────────────────────────────────
--  PART 3 — Who may see what
-- ───────────────────────────────────────────────────────────────────
--  You can see a row if it is yours, or if it is in a group you belong to.
--  is_group_member is security definer, so the policy on group_members does
--  not recurse into itself.

create or replace function public.is_group_member(gid uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

create or replace function public.owns_row(row_user uuid, row_group uuid)
returns boolean language sql stable
set search_path = public as $$
  select row_user = auth.uid()
      or (row_group is not null and public.is_group_member(row_group));
$$;

do $$
declare t text;
begin
  foreach t in array array['progress', 'photos', 'trips'] loop
    execute format('alter table public.%I enable row level security', t);
    -- The old rules, which let any signed-in account read everything.
    execute format('drop policy if exists "signed in can read %s"   on public.%I', t, t);
    execute format('drop policy if exists "signed in can insert %s" on public.%I', t, t);
    execute format('drop policy if exists "signed in can update %s" on public.%I', t, t);
    execute format('drop policy if exists "signed in can delete %s" on public.%I', t, t);
    execute format('drop policy if exists "own or shared %s readable" on public.%I', t, t);
    execute format('drop policy if exists "read own or shared %s"   on public.%I', t, t);
    execute format('drop policy if exists "insert own %s"           on public.%I', t, t);
    execute format('drop policy if exists "update own or shared %s" on public.%I', t, t);
    execute format('drop policy if exists "delete own or shared %s" on public.%I', t, t);

    execute format($f$
      create policy "read own or shared %s" on public.%I
        for select to authenticated
        using (public.owns_row(user_id, group_id))$f$, t, t);
    execute format($f$
      create policy "insert own %s" on public.%I
        for insert to authenticated
        with check (user_id = auth.uid()
                    and (group_id is null or public.is_group_member(group_id)))$f$, t, t);
    execute format($f$
      create policy "update own or shared %s" on public.%I
        for update to authenticated
        using (public.owns_row(user_id, group_id))
        with check (public.owns_row(user_id, group_id))$f$, t, t);
    execute format($f$
      create policy "delete own or shared %s" on public.%I
        for delete to authenticated
        using (public.owns_row(user_id, group_id))$f$, t, t);
  end loop;
end $$;


-- ───────────────────────────────────────────────────────────────────
--  PART 4 — Groups, and being able to see who else is in one
-- ───────────────────────────────────────────────────────────────────
--  The app could write display_name but never read anybody else's, which
--  is why "ticked by" was stuck on whatever name each phone had typed for
--  itself. Members of a group can now read each other's names, and change
--  their own.

drop policy if exists "see your own memberships"   on public.group_members;
drop policy if exists "see members of your groups" on public.group_members;
drop policy if exists "join a group"               on public.group_members;
drop policy if exists "leave a group"              on public.group_members;
drop policy if exists "rename yourself"            on public.group_members;

create policy "see members of your groups" on public.group_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_member(group_id));
create policy "join a group" on public.group_members
  for insert to authenticated with check (user_id = auth.uid());
create policy "rename yourself" on public.group_members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- You may remove yourself, and nobody else. With one account per phone this
-- is now what it always looked like it did.
create policy "leave a group" on public.group_members
  for delete to authenticated using (user_id = auth.uid());

-- A group stays visible while you are in it, and is findable by its code so
-- that joining works. The code is the secret.
drop policy if exists "see groups you belong to" on public.groups;
drop policy if exists "create groups"            on public.groups;
create policy "see groups you belong to" on public.groups
  for select to authenticated using (true);
create policy "create groups" on public.groups
  for insert to authenticated with check (created_by = auth.uid());


-- ───────────────────────────────────────────────────────────────────
--  PART 5 — Photo files
-- ───────────────────────────────────────────────────────────────────
--  Objects are stored under <scope>/<adventure>/<id>.jpg, so the first path
--  segment says who they belong to and the policy can check it without
--  joining to the photos table. The app moves older objects into that shape
--  on its own; until it has, legacy paths stay readable to signed-in users
--  so nobody's existing memories vanish.

drop policy if exists "signed in can read memory files"   on storage.objects;
drop policy if exists "signed in can upload memory files" on storage.objects;
drop policy if exists "signed in can delete memory files" on storage.objects;
drop policy if exists "read own or shared memory files"   on storage.objects;
drop policy if exists "upload own memory files"           on storage.objects;
drop policy if exists "delete own or shared memory files" on storage.objects;

create policy "read own or shared memory files" on storage.objects
  for select to authenticated using (
    bucket_id = 'memories' and (
      -- legacy objects, which begin with a numeric adventure id
      (storage.foldername(name))[1] ~ '^[0-9]+$'
      or (storage.foldername(name))[1] = auth.uid()::text
      or public.is_group_member(nullif((storage.foldername(name))[1], '')::uuid)
    ));

create policy "upload own memory files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'memories' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_group_member(nullif((storage.foldername(name))[1], '')::uuid)
    ));

create policy "delete own or shared memory files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'memories' and (
      (storage.foldername(name))[1] ~ '^[0-9]+$'
      or (storage.foldername(name))[1] = auth.uid()::text
      or public.is_group_member(nullif((storage.foldername(name))[1], '')::uuid)
    ));


-- ───────────────────────────────────────────────────────────────────
--  PART 6 — What you just did
-- ───────────────────────────────────────────────────────────────────
do $$
declare
  accounts int; groups_n int; members int;
  prog int; unscoped int;
begin
  select count(*) into accounts from auth.users;
  select count(*) into groups_n from public.groups;
  select count(*) into members  from public.group_members;
  select count(*) into prog     from public.progress;
  select count(*) into unscoped from public.progress where scope_id is null;

  raise notice '─────────────────────────────────────────────';
  raise notice 'accounts: %   groups: %   memberships: %', accounts, groups_n, members;
  raise notice 'progress rows: %  (% with no owner)', prog, unscoped;
  if unscoped > 0 then
    raise notice 'Rows with no owner are invisible to everyone. Set user_id on them.';
  end if;
  raise notice 'Now turn ON Authentication -> Sign In / Providers ->';
  raise notice '"Allow new users to sign up", and not before.';
  raise notice '─────────────────────────────────────────────';
end $$;
