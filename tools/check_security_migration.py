"""Static review gates for the personal-ownership security migration.

This deliberately does not connect to Supabase. It proves the migration keeps
the source records intact and that the reviewed RLS/RPC invariants remain in
the checked-in SQL. PostgreSQL parsing and multi-account behaviour still need
an isolated database before production deployment.
"""
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "schema-personal-ownership.sql"
SQL = MIGRATION.read_text(encoding="utf-8")
NORMAL = re.sub(r"\s+", " ", SQL.lower())


def body(function_name: str) -> str:
    match = re.search(
        rf"create or replace function public\.{function_name}\b.*?\bas \$\$(.*?)\$\$;",
        SQL,
        flags=re.I | re.S,
    )
    if not match:
        raise AssertionError(f"missing function public.{function_name}")
    return re.sub(r"\s+", " ", match.group(1).lower())


def require(description: str, condition: bool) -> None:
    if not condition:
        raise AssertionError(description)


def main() -> int:
    checks = []

    def check(description: str, condition: bool) -> None:
        require(description, condition)
        checks.append(description)

    check("migration is transactional", "begin;" in NORMAL and NORMAL.rstrip().endswith("commit;"))
    check(
        "migration declares its prerequisite",
        "schema-cutover.sql must be applied first" in SQL,
    )
    check("legacy projection backfill has a durable replay marker",
          "personal-ownership-legacy-projections-v1" in NORMAL and
          "wayfinder_schema_migrations" in NORMAL)

    for table, source, source_id in (
        ("group_progress", "progress", "progress_id"),
        ("group_photos", "photos", "photo_id"),
        ("group_trips", "trips", "trip_id"),
    ):
        check(f"{table} exists", f"create table if not exists public.{table}" in NORMAL)
        check(
            f"{table} projection is tied to its owner",
            f"foreign key ({source_id}, shared_by_id) references public.{source}(id, user_id) on delete cascade"
            in NORMAL,
        )
        check(f"{table} is included in projection RLS", f"'{table}'" in NORMAL)

    check(
        "projection reads require membership",
        'create policy "members read projections" on public.%i for select to authenticated using (public.is_group_member(group_id))'
        in NORMAL,
    )

    # Backfill may copy references into projection tables, but source data must
    # never be moved, merged, deleted, or have ownership/group ids reassigned.
    pre_functions = NORMAL.split("create or replace function public.is_group_member", 1)[0]
    check("source progress is not deleted", "delete from public.progress" not in pre_functions)
    check("source photos are not deleted", "delete from public.photos" not in pre_functions)
    check("source trips are not deleted", "delete from public.trips" not in pre_functions)
    check("source rows are not reassigned", "update public.progress" not in pre_functions
          and "update public.photos" not in pre_functions
          and "update public.trips" not in pre_functions)

    check(
        "groups are visible only to members",
        'create policy "members can see their groups" on public.groups for select to authenticated using (public.is_group_member(id))'
        in NORMAL,
    )
    check(
        "membership table has no direct insert policy",
        not re.search(r"create policy .*? on public\.group_members\s+for insert", NORMAL),
    )
    check(
        "membership table has no direct delete policy",
        not re.search(r"create policy .*? on public\.group_members\s+for delete", NORMAL),
    )

    join = body("join_group_by_code")
    check("join RPC requires the caller identity", "caller uuid := auth.uid()" in join)
    check("join RPC inserts only the caller", "values (matched_group.id, caller, btrim(p_display_name))" in join)
    check("join RPC does not accept a user id", "p_user" not in join)
    check(
        "join RPC has a fixed search path",
        re.search(
            r"join_group_by_code\(.*?security definer\s+set search_path = pg_catalog, public",
            NORMAL,
        ) is not None,
    )

    guard = body("guard_membership_identity")
    check("membership updates cannot change group id", "new.group_id is distinct from old.group_id" in guard)
    check("membership updates cannot change user id", "new.user_id is distinct from old.user_id" in guard)
    check("direct membership update is limited to display name",
          "revoke update on public.group_members from public, anon, authenticated" in NORMAL and
          "grant update (display_name) on public.group_members to authenticated" in NORMAL and
          "grant update on public.group_members to authenticated" not in NORMAL)
    check("direct display names have the same server length bound as RPC names",
          "group_members_display_name_length" in NORMAL)
    check("table grants are reset before the minimum client grants",
          "revoke all on public.groups, public.group_members" in NORMAL and
          "from public, anon, authenticated" in NORMAL)

    leave = body("leave_group")
    check("leave removes caller projections", all(
        f"delete from public.{table}" in leave
        for table in ("group_progress", "group_photos", "group_trips")
    ))
    check("leave removes only the caller membership", "user_id = caller" in leave)
    check("leave preserves progress", "delete from public.progress" not in leave)
    check("leave preserves photos", "delete from public.photos" not in leave)
    check("leave preserves trips", "delete from public.trips" not in leave)

    delete_account = body("delete_my_account")
    check("account deletion targets only the caller", "delete from auth.users where id = caller" in delete_account)
    check("account deletion refuses to orphan owned Storage objects",
          "owned storage objects must be removed before account deletion" in delete_account and
          "from storage.objects" in delete_account)
    check(
        "account deletion has a fixed search path",
        re.search(r"delete_my_account\(\).*?security definer\s+set search_path = pg_catalog, public", NORMAL)
        is not None,
    )
    check("account deletion remains authenticated-only", "grant execute on function public.delete_my_account() to authenticated" in NORMAL)

    attribution = body("attribute_personal_completion")
    check("personal completions are attributed to their owner", "new.completed_by_id := new.user_id" in attribution)
    check("historical attribution cannot be forged", "historical completion attribution cannot be reassigned" in attribution)
    feed = body("group_completion_feed")
    check("group feed returns completion fields", "p.adventure_id" in feed and "p.completed_at" in feed)
    check("group feed does not return private progress fields", all(field not in feed for field in
          ("p.memory", "p.rating", "p.shortlisted")))
    sharing = body("set_group_completion_sharing")
    check("sharing preference is persisted on membership", "share_completions = p_enabled" in sharing)
    check("sharing revocation removes caller projections", "delete from public.group_progress" in sharing)
    check("future completions follow server consent", "progress_sync_completion_projections" in NORMAL and
          "gm.share_completions" in body("sync_completion_projections"))
    check("direct completion projection writes require consent",
          'create policy "owners add consented completion projections"' in NORMAL and
          "gm.share_completions" in NORMAL)
    check(
        "source mutation is owner-only",
        all(f'create policy "update owned {table}"' in NORMAL and "using (user_id = auth.uid())" in NORMAL
            for table in ("progress", "photos", "trips")),
    )

    memory_read = body("can_read_memory_object")
    memory_manage = body("can_manage_memory_object")
    check("shared photo files require an explicit projection", "join public.group_photos" in memory_read)
    check("shared photo files require current membership", "join public.group_members" in memory_read)
    check("photo file deletion is owner-only", "p.user_id = auth.uid()" in memory_manage)
    check("authenticated owner can move a legacy photo only under their UUID prefix",
          'create policy "move owned memory files"' in NORMAL and
          "public.can_manage_memory_object(name)" in NORMAL and
          "storage.foldername(name)" in NORMAL)
    check("Storage grants are explicit and signed-in only",
          "revoke select, insert, update, delete on storage.objects from public, anon" in NORMAL and
          "grant select, insert, update, delete on storage.objects to authenticated" in NORMAL)
    photo_path_guard = body("guard_photo_storage_path")
    check("photo metadata cannot alias another owner's Storage path",
          "storage.foldername(new.storage_path)" in photo_path_guard and
          "auth.uid()::text" in photo_path_guard and
          "photos_guard_storage_path" in NORMAL)
    check(
        "numeric legacy paths are no longer globally readable",
        "^[0-9]+$" not in NORMAL,
    )

    print(f"PASS: {len(checks)} security migration invariants")
    for description in checks:
        print(f"  - {description}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
