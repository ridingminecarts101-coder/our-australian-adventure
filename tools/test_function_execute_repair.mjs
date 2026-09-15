import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;');

const authenticated = [
  ['is_group_member', 'uuid'], ['can_read_progress', 'uuid'], ['can_read_photo', 'uuid'],
  ['can_read_trip', 'uuid'], ['can_read_memory_object', 'text'], ['can_manage_memory_object', 'text'],
  ['create_group', 'text, text'], ['join_group_by_code', 'text, text'], ['leave_group', 'uuid'],
  ['share_personal_progress', 'uuid, uuid[]'], ['unshare_personal_progress', 'uuid, uuid[]'],
  ['set_group_completion_sharing', 'uuid, boolean'], ['group_completion_feed', 'uuid'],
  ['delete_my_account', ''], ['rotate_group_invite', 'uuid'], ['revoke_group_invite', 'uuid'],
  ['remove_group_member', 'uuid, uuid'], ['transfer_group_ownership', 'uuid, uuid'],
  ['delete_group', 'uuid'], ['has_verified_email_account', ''],
];
const service = [
  ['claim_revenuecat_deletions', 'integer, integer'],
  ['acknowledge_revenuecat_deletion', 'uuid, uuid, integer'],
  ['retry_revenuecat_deletion', 'uuid, uuid, text, integer, integer'],
];
const internal = [
  ['guard_membership_identity', ''], ['guard_personal_record_identity', ''],
  ['guard_photo_storage_path', ''], ['attribute_personal_completion', ''],
  ['sync_completion_projections', ''], ['new_group_join_code', ''],
  ['stabilize_group_after_member_delete', ''], ['guard_recommendation_vote_identity', ''],
  ['guard_recommendation_report_identity', ''], ['recount_votes', ''], ['recount_reports', ''],
  ['require_verified_group_participant', ''],
];

for (const [name, args] of [...authenticated, ...service, ...internal]) {
  await db.exec(`create function public.${name}(${args}) returns boolean language sql as $$ select true $$;`);
}

// Reproduce the production failure: an explicit anon ACL survives a PUBLIC-only
// revoke. Give every function PUBLIC's default too, exercising both paths.
await db.exec(`
  grant execute on function public.group_completion_feed(uuid) to anon;
  grant execute on function public.set_group_completion_sharing(uuid, boolean) to anon;
  grant execute on function public.guard_membership_identity() to anon, authenticated;
`);

const repair = await readFile(new URL('../supabase/schema-function-execute-repair.sql', import.meta.url), 'utf8');

async function can(role, name, args) {
  const signature = `public.${name}(${args})`;
  const result = await db.query("select has_function_privilege($1, $2, 'EXECUTE') allowed", [role, signature]);
  return result.rows[0].allowed;
}

async function verify() {
  for (const [name, args] of authenticated) {
    assert.equal(await can('authenticated', name, args), true, `${name} must remain authenticated`);
    assert.equal(await can('anon', name, args), false, `${name} must deny anon`);
  }
  for (const [name, args] of service) {
    assert.equal(await can('service_role', name, args), true, `${name} must remain service-only`);
    assert.equal(await can('authenticated', name, args), false, `${name} must deny authenticated clients`);
    assert.equal(await can('anon', name, args), false, `${name} must deny anon`);
  }
  for (const [name, args] of internal) {
    assert.equal(await can('authenticated', name, args), false, `${name} must be internal`);
    assert.equal(await can('anon', name, args), false, `${name} must deny anon`);
  }
}

await db.exec(repair);
await verify();
console.log('PASS: explicit anon and PUBLIC EXECUTE paths are removed from reviewed functions');

await db.exec(repair);
await verify();
console.log('PASS: function EXECUTE repair is replay-safe and preserves intended grants');

await db.exec('grant execute on function public.group_completion_feed(uuid) to anon;');
assert.equal(await can('anon', 'group_completion_feed', 'uuid'), true);
await db.exec(repair);
assert.equal(await can('anon', 'group_completion_feed', 'uuid'), false);
console.log('PASS: repair removes a later explicit anonymous RPC grant');
