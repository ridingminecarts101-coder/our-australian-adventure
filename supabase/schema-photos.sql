-- Our Australian Adventure — photos add-on
-- Run this whole file once in the Supabase SQL Editor, after schema.sql.
-- Safe to re-run.

-- ---------------------------------------------------------------
-- 1. The photos table
-- ---------------------------------------------------------------
-- One row per uploaded photo. The image itself lives in Storage;
-- this table holds where it is and when it was actually taken.

create table if not exists public.photos (
  id              uuid         primary key default gen_random_uuid(),
  adventure_id    integer      not null,
  storage_path    text         not null unique,
  taken_at        timestamptz,
  taken_at_source text,          -- 'exif' | 'file' | 'completed' | 'upload'
  width           integer,
  height          integer,
  bytes           integer,
  caption         text,
  uploaded_by     text,
  created_at      timestamptz  not null default now()
);

comment on column public.photos.taken_at_source is
  'Where taken_at came from. exif = the camera''s own timestamp (trustworthy); '
  'file = filesystem modified date (changes when copied); '
  'completed = the date the adventure was ticked off; upload = today.';

create index if not exists photos_adventure_idx on public.photos (adventure_id);
create index if not exists photos_taken_at_idx  on public.photos (taken_at desc);

-- ---------------------------------------------------------------
-- 2. Row Level Security on the table
-- ---------------------------------------------------------------
alter table public.photos enable row level security;

drop policy if exists "signed in can read photos"   on public.photos;
drop policy if exists "signed in can insert photos" on public.photos;
drop policy if exists "signed in can update photos" on public.photos;
drop policy if exists "signed in can delete photos" on public.photos;

create policy "signed in can read photos"
  on public.photos for select to authenticated using (true);
create policy "signed in can insert photos"
  on public.photos for insert to authenticated with check (true);
create policy "signed in can update photos"
  on public.photos for update to authenticated using (true) with check (true);
create policy "signed in can delete photos"
  on public.photos for delete to authenticated using (true);

-- ---------------------------------------------------------------
-- 3. The storage bucket
-- ---------------------------------------------------------------
-- PRIVATE on purpose. These are your personal photos, so they are not
-- readable by URL - the app mints short-lived signed links instead.
-- 10 MB per file is a generous ceiling; the app resizes everything to
-- roughly 300-500 KB before it uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memories', 'memories', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------
-- 4. Row Level Security on the stored files
-- ---------------------------------------------------------------
drop policy if exists "signed in can read memory files"   on storage.objects;
drop policy if exists "signed in can upload memory files" on storage.objects;
drop policy if exists "signed in can delete memory files" on storage.objects;

create policy "signed in can read memory files"
  on storage.objects for select to authenticated
  using (bucket_id = 'memories');

create policy "signed in can upload memory files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'memories');

create policy "signed in can delete memory files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'memories');

-- ---------------------------------------------------------------
-- 5. Realtime, so a photo added on one phone appears on the other
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'photos'
  ) then
    alter publication supabase_realtime add table public.photos;
  end if;
end
$$;

alter table public.photos replica identity full;

-- ---------------------------------------------------------------
-- Check it worked:
--   select * from public.photos;                          -- empty, no error
--   select id, public from storage.buckets where id = 'memories';
--                                                         -- one row, public = false
-- ---------------------------------------------------------------
