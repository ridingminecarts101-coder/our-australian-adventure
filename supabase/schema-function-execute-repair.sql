-- Wayfinder function EXECUTE privilege repair.
-- Apply after the six reviewed production migrations. This is additive and
-- replay-safe; it changes function ACLs only.
begin;

-- Client RPCs and RLS helpers: authenticated only. Revoking from PUBLIC does
-- not remove a historical grant made directly to anon, so both are explicit.
revoke all on function public.is_group_member(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.can_read_progress(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.can_read_photo(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.can_read_trip(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.can_read_memory_object(text) from PUBLIC, anon, authenticated;
revoke all on function public.can_manage_memory_object(text) from PUBLIC, anon, authenticated;
revoke all on function public.create_group(text, text) from PUBLIC, anon, authenticated;
revoke all on function public.join_group_by_code(text, text) from PUBLIC, anon, authenticated;
revoke all on function public.leave_group(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.share_personal_progress(uuid, uuid[]) from PUBLIC, anon, authenticated;
revoke all on function public.unshare_personal_progress(uuid, uuid[]) from PUBLIC, anon, authenticated;
revoke all on function public.set_group_completion_sharing(uuid, boolean) from PUBLIC, anon, authenticated;
revoke all on function public.group_completion_feed(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.delete_my_account() from PUBLIC, anon, authenticated;
revoke all on function public.rotate_group_invite(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.revoke_group_invite(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.remove_group_member(uuid, uuid) from PUBLIC, anon, authenticated;
revoke all on function public.transfer_group_ownership(uuid, uuid) from PUBLIC, anon, authenticated;
revoke all on function public.delete_group(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.has_verified_email_account() from PUBLIC, anon, authenticated;

grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.can_read_progress(uuid) to authenticated;
grant execute on function public.can_read_photo(uuid) to authenticated;
grant execute on function public.can_read_trip(uuid) to authenticated;
grant execute on function public.can_read_memory_object(text) to authenticated;
grant execute on function public.can_manage_memory_object(text) to authenticated;
grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group_by_code(text, text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.share_personal_progress(uuid, uuid[]) to authenticated;
grant execute on function public.unshare_personal_progress(uuid, uuid[]) to authenticated;
grant execute on function public.set_group_completion_sharing(uuid, boolean) to authenticated;
grant execute on function public.group_completion_feed(uuid) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.rotate_group_invite(uuid) to authenticated;
grant execute on function public.revoke_group_invite(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
grant execute on function public.has_verified_email_account() to authenticated;

-- Queue operations are worker-only.
revoke all on function public.claim_revenuecat_deletions(integer, integer) from PUBLIC, anon, authenticated, service_role;
revoke all on function public.acknowledge_revenuecat_deletion(uuid, uuid, integer) from PUBLIC, anon, authenticated, service_role;
revoke all on function public.retry_revenuecat_deletion(uuid, uuid, text, integer, integer) from PUBLIC, anon, authenticated, service_role;
grant execute on function public.claim_revenuecat_deletions(integer, integer) to service_role;
grant execute on function public.acknowledge_revenuecat_deletion(uuid, uuid, integer) to service_role;
grant execute on function public.retry_revenuecat_deletion(uuid, uuid, text, integer, integer) to service_role;

-- Trigger and internal helpers are not client RPCs. Trigger invocation does not
-- require the calling role to hold EXECUTE on the trigger function.
revoke all on function public.guard_membership_identity() from PUBLIC, anon, authenticated;
revoke all on function public.guard_personal_record_identity() from PUBLIC, anon, authenticated;
revoke all on function public.guard_photo_storage_path() from PUBLIC, anon, authenticated;
revoke all on function public.attribute_personal_completion() from PUBLIC, anon, authenticated;
revoke all on function public.sync_completion_projections() from PUBLIC, anon, authenticated;
revoke all on function public.new_group_join_code() from PUBLIC, anon, authenticated;
revoke all on function public.stabilize_group_after_member_delete() from PUBLIC, anon, authenticated;
revoke all on function public.guard_recommendation_vote_identity() from PUBLIC, anon, authenticated;
revoke all on function public.guard_recommendation_report_identity() from PUBLIC, anon, authenticated;
revoke all on function public.recount_votes() from PUBLIC, anon, authenticated;
revoke all on function public.recount_reports() from PUBLIC, anon, authenticated;
revoke all on function public.require_verified_group_participant() from PUBLIC, anon, authenticated;

commit;
