# Group join choice migration

`schema-group-join-choice.sql` is a proposed production migration. Apply it only after `schema-group-feedback.sql` and `schema-group-administration.sql`, and before a client that calls the new RPCs is published. The local PGlite test is `node tools/test_group_join_choice.mjs`. These files have not been applied to production by this work.

The new client calls `create_group_with_sharing(p_name, p_display_name, p_share_memories)` or `join_group_with_sharing(p_join_code, p_display_name, p_share_memories)`. A yes answer shares completion ticks, dates, ratings, and written memories from safely attributable personal rows; a no answer joins privately. Both return the same `(group_id, group_name, join_code)` columns as the older RPCs. Photos remain on the originating device. Repeating an invite while already a member applies the newly answered choice. The old two-argument RPCs remain callable for the public iOS client and continue to create private memberships.

Existing memberships retain their current completion and feedback choices. Their `sharing_choice_made_at` is NULL until they answer the combined prompt once through `choose_group_sharing(p_group_id, p_share_memories)`. This prevents previously private feedback from becoming visible without consent. `list_unconfirmed_personal_progress` and `revalidate_personal_progress` still govern ambiguous old notes. A combined yes answer alone never confirms an uncertain historical row.

If a released client later uses an older separate sharing control, the migration clears `sharing_choice_made_at` while retaining that client's chosen flags. The new client then explains the split state and offers the combined choice again, so it never labels shared ticks as private. A group membership created through the old two-argument RPC also has a NULL marker until the new client asks.

Some older groups still own canonical progress, photo or trip rows. A last-member leave or owner deletion now clears all memberships and projections while retaining an inert group row when one of those source rows exists. That row has no owner, active invite or member visibility. It preserves old source attribution and avoids rewriting a member's personal record or colliding with a same-adventure personal row. Groups without those historical source rows are deleted normally.

The migration gives every group a six-character uppercase code using digits and letters that avoid visually confusable symbols. Existing long codes are stored in a private alias table so already sent links continue to work. The alias expires on invite rotation, revocation, owner succession, or group deletion. All invite RPC calls are limited to 20 attempts per account per hour; a failed lookup returns no row so the attempt remains recorded. The new client should show the same “No group with that code” response for invalid or rate-limited codes. Existing members can still open their own group without using an invite.

Read-only postflight checks in the Supabase SQL editor, after applying the migration:

```sql
select count(*) filter (
         where join_code !~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$'
       ) as invalid_six_character_codes,
       count(*) as groups
  from public.groups;

select count(*) as old_invite_aliases from public.group_legacy_invites;

select count(*) filter (where sharing_choice_made_at is null) as legacy_memberships_awaiting_choice,
       count(*) filter (
         where sharing_choice_made_at is not null
           and share_completions is distinct from share_feedback
       ) as inconsistent_new_choices,
       count(*) as memberships
  from public.group_members;

select to_regprocedure('public.create_group_with_sharing(text,text,boolean)') is not null
         as create_rpc_ready,
       to_regprocedure('public.join_group_with_sharing(text,text,boolean)') is not null
         as join_rpc_ready,
       to_regprocedure('public.choose_group_sharing(uuid,boolean)') is not null
         as legacy_choice_rpc_ready;
```

Expected values: `invalid_six_character_codes = 0`, `inconsistent_new_choices = 0`, and all three RPC booleans true. `legacy_memberships_awaiting_choice` may be nonzero and should decrease only when those members answer. `old_invite_aliases` is bounded by groups that had a long code at migration time. No postflight query reads invite codes, names, memory text, or customer identifiers.
