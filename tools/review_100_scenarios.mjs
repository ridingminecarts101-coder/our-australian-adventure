// Exactly 100 distinct material checks of the candidate app. This is a local
// review matrix, not a claim that live services or physical devices were used.
// Run: node tools/review_100_scenarios.mjs [--report path/to/SCENARIOS.md]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const row = (domain, scenario, file, marker = null, method = 'automated') =>
  ({ domain, scenario, file: `tools/${file}`, marker, method });
const r = row;
const cases = [
  // Identity, recovery, and account destruction.
  r('Account', 'Invalid sign-in links recover with the exact return route', 'test_auth_configuration.js', 'Auth configuration: invalid-link recovery, exact redirects, resend, deduplication, verified same-owner resume, failures and account boundaries passed', 'synthetic client'),
  r('Account', 'Anonymous upgrade verifies email before assigning a password', 'test_auth_upgrade.js', 'auth upgrade: sequencing, failures, account switch, local data and schema fallback passed', 'synthetic client'),
  r('Account', 'Failed startup shows recovery controls and preserves saved data', 'test_startup.js', 'startup/auth failures: visible recovery, catalogue fallback, retries and saved data passed', 'synthetic client'),
  r('Account', 'Password recovery keeps the original owner state after stale responses', 'test_startup.js', 'password recovery: automatic screen, failures, stale account guard and owner-state preservation passed', 'synthetic client'),
  r('Account', 'Confirmed permanent identity is accepted by shared-content rules', 'test_verified_community_access.mjs', 'PASS 1: confirmed permanent email is accepted', 'PGlite'),
  r('Account', 'Unconfirmed permanent identity cannot enter shared-content rules', 'test_verified_community_access.mjs', 'PASS 3: permanent but unconfirmed email is rejected', 'PGlite'),
  r('Account', 'Legacy anonymous owner can still read personal data', 'test_verified_community_access.mjs', 'PASS 16: anonymous legacy owner retains personal-data read', 'PGlite'),
  r('Account', 'Storage objects block account deletion before partial erasure', 'test_personal_ownership.mjs', 'PASS 45: account deletion stops while an owned Storage object remains', 'PGlite'),
  r('Account', 'Account deletion cascades personal progress', 'test_personal_ownership.mjs', 'PASS 47: account deletion cascades personal progress', 'PGlite'),
  r('Account', 'Account deletion removes the authentication identity', 'test_personal_ownership.mjs', 'PASS 48: account deletion removes the auth identity', 'PGlite'),

  // Offline operation and ordering.
  r('Sync/offline', 'Late sync responses cannot overwrite newer edits or another account', 'test_sync_races.js', '  sync races: newer edits, account switches, pulls and cross-tab sign-out passed', 'synthetic client'),
  r('Sync/offline', 'Offline completion-date edits sync without shifting day', 'test_completion_dates.js', 'PASS: date boundaries, group ownership, offline sync, stamp order and untick', 'synthetic client'),
  r('Sync/offline', 'Service-worker install reloads critical shell assets', 'test_service_worker.js', 'PASS testInstallBypassesHttpCache', 'service-worker simulation'),
  r('Sync/offline', 'Failed shell install leaves the previous worker active', 'test_service_worker.js', 'PASS testFailedInstallKeepsOldWorker', 'service-worker simulation'),
  r('Sync/offline', 'Worker activation preserves unrelated app caches', 'test_service_worker.js', 'PASS testActivationPreservesOtherApps', 'service-worker simulation'),
  r('Sync/offline', 'Background refresh waits for cache write to finish', 'test_service_worker.js', 'PASS testRuntimeRefreshWaitsForCacheWrite', 'service-worker simulation'),
  r('Sync/offline', 'Cached app content remains usable offline', 'test_service_worker.js', 'PASS testCachedOfflineResponse', 'service-worker simulation'),
  r('Sync/offline', 'Offline deep link serves shell or an explicit 503', 'test_service_worker.js', 'PASS testOfflineNavigationFallbackAnd503', 'service-worker simulation'),

  // Personal and group progress, historical provenance, leave/delete.
  r('Progress/groups', 'A new group starts with private completion sharing', 'test_personal_ownership.mjs', 'PASS 1: new group begins with private completion sharing', 'PGlite'),
  r('Progress/groups', 'Completion attribution is bound to its owner', 'test_personal_ownership.mjs', 'PASS 9: completion attribution is forced to owner', 'PGlite'),
  r('Progress/groups', 'Member cannot select another owner private progress row', 'test_personal_ownership.mjs', 'PASS 10: group member cannot select another owner private progress row', 'PGlite'),
  r('Progress/groups', 'Explicit completion consent exposes a tick', 'test_personal_ownership.mjs', 'PASS 19: explicit consent exposes the completion', 'PGlite'),
  r('Progress/groups', 'Revoking completion sharing removes the projection', 'test_personal_ownership.mjs', 'PASS 34: revocation removes the projection', 'PGlite'),
  r('Progress/groups', 'Stale device cannot re-share after server revocation', 'test_personal_ownership.mjs', 'PASS 35: stale device cannot re-share after server-side revocation', 'PGlite'),
  r('Progress/groups', 'Unticking clears an edited calendar date for older clients', 'test_personal_ownership.mjs', 'PASS 37: unticking clears an edited calendar date even for an older client', 'PGlite'),
  r('Progress/groups', 'Rejoining does not silently share earlier completions', 'test_personal_ownership.mjs', 'PASS 44: rejoining does not silently share earlier personal completions', 'PGlite'),
  r('Progress/groups', 'Unconfirmed older completion remains an aggregate tick', 'test_group_feedback.mjs', 'PASS 33: unconfirmed historical completion keeps only an aggregate tick', 'PGlite'),
  r('Progress/groups', 'Only owner can confirm an ambiguous older completion', 'test_group_feedback.mjs', 'PASS 48: another member cannot confirm the owner candidate', 'PGlite'),
  r('Progress/groups', 'Unconfirmed ambiguous note remains private despite consent', 'test_group_feedback.mjs', 'PASS 152: pre-migration ambiguous orphan note remains private despite consent', 'PGlite'),
  r('Progress/groups', 'Consented rating reaches another current member', 'test_group_feedback.mjs', 'PASS 65: consented rating is visible to another current member', 'PGlite'),
  r('Progress/groups', 'Consented written memory reaches another current member', 'test_group_feedback.mjs', 'PASS 66: consented note is visible to another current member', 'PGlite'),
  r('Progress/groups', 'Explicit reconfirmation names an older personal tick', 'test_group_feedback.mjs', 'PASS 67: explicit reconfirmation changes old tick to safely named personal', 'PGlite'),
  r('Progress/groups', 'Consent in one group leaves the other group private', 'test_group_feedback.mjs', 'PASS 78: consent to one group leaves another group private', 'PGlite'),
  r('Progress/groups', 'Feedback withdrawal removes the server feed entry', 'test_group_feedback.mjs', 'PASS 87: revocation immediately removes feedback from the server feed', 'PGlite'),
  r('Progress/groups', 'Legacy group duplicate does not double-count a personal tick', 'test_group_feedback.mjs', 'PASS 106: duplicate group-scoped note is excluded', 'PGlite'),
  r('Progress/groups', 'Deleting a leaver account erases archived group history', 'test_group_history.mjs', 'PASS: retained group history, legacy privacy, RLS, rejoin, erase and deletion', 'PGlite'),
  r('Progress/groups', 'One legacy sharing answer controls ticks and notes', 'test_group_join_choice.mjs', 'PASS: one legacy choice governs tick and written feedback together', 'PGlite'),
  r('Progress/groups', 'Repeat invite applies the fresh choice atomically', 'test_group_join_choice.mjs', 'PASS: repeated invite applies its fresh explicit answer atomically', 'PGlite'),
  r('Progress/groups', 'Six-character invitation replaces old visible code', 'test_group_join_choice.mjs', 'PASS: existing consent stays unchanged; new short code is displayed', 'PGlite'),
  r('Progress/groups', 'Archived group shell persists while owned legacy sources exist', 'test_group_join_choice.mjs', 'PASS: retired shell remains until the final progress, photo or trip source is deleted', 'PGlite'),
  r('Progress/groups', 'Leaver retains their own tick and written memory', 'review_retained_group_history.mjs', 'REVIEW 1 PASS: leaver keeps own completed tick and note', 'PGlite acceptance'),
  r('Progress/groups', 'Group retains the leaver’s name, date, tick and note', 'review_retained_group_history.mjs', 'REVIEW 2 PASS: group retains leaver name, date, tick and note', 'PGlite acceptance'),
  r('Progress/groups', 'Last-member empty group is disposed when nobody can administer it', 'review_retained_group_history.mjs', 'REVIEW 3 PASS: last-member empty group is disposed when nobody can administer it', 'PGlite acceptance'),

  // Memory display, device-local images, encrypted transfer.
  r('Memories/photos', 'Group Memories displays member entries without sharing photos', 'test_group_memories.js', 'PASS: Group Memories and owner-scoped older personal progress confirmation', 'synthetic UI'),
  r('Memories/photos', 'Photo metadata and bytes remain bound to the account/device', 'test_local_photos.js', 'PASS: 27 device-local photo, deletion, native transaction, privacy and account-scope checks', 'synthetic client'),
  r('Memories/photos', 'Camera/library picker accepts the same file again', 'test_photo_picker_handlers.js', 'PASS: library and camera handlers snapshot live FileLists and allow same-file re-picks', 'synthetic UI'),
  r('Memories/photos', 'Native photo paths and JPEG backup exclusions hold', 'test_photo_files.js', 'native photo files: paths, JPEGs, failures and Android/iOS backup exclusion passed', 'mock native'),
  r('Memories/photos', 'Encrypted backup round-trips real JPEG bytes', 'test_photo_backup.js', 'PASS 2: real JPEG bytes and memory references round-trip; envelope exposes no owner/content', 'unit'),
  r('Memories/photos', 'Wrong passphrase or account rejects a photo archive', 'test_photo_backup.js', 'PASS 3: wrong passphrase and wrong signed-in owner fail closed', 'unit'),
  r('Memories/photos', 'Tampered photo archive rejects before import', 'test_photo_backup.js', 'PASS 4: tampering, unknown version and extra sensitive envelope fields reject', 'unit'),
  r('Memories/photos', 'Malicious metadata or corrupt JPEG rejects on import', 'test_photo_backup.js', 'PASS 5: validly encrypted malicious metadata, duplicate IDs, checksum and JPEG fail import validation', 'unit'),
  r('Memories/photos', 'Backup enforces passphrase and numbered-part limits', 'test_photo_backup.js', 'PASS 7: passphrase strength and part numbering are enforced', 'unit'),
  r('Memories/photos', 'Backup accounts for every photo in bounded parts', 'test_photo_backup.js', 'PASS 8: all photos receive a numbered bounded part; oversize/duplicate items cannot be silently omitted', 'unit'),
  r('Memories/photos', 'Oversized archive rejects before parsing or key derivation', 'test_photo_backup.js', 'PASS 9: input archive size is rejected before parsing or key derivation', 'unit'),
  r('Memories/photos', 'Duplicate imported photo cannot replace existing bytes', 'test_photo_import_adapter.js', 'PASS 2: atomic add reservation rejects duplicate photo ID without replacing existing bytes', 'mock native'),
  r('Memories/photos', 'Mismatched orphan file remains untouched on import', 'test_photo_import_adapter.js', 'PASS 5: mismatched native orphan is preserved, with no metadata claim or overwrite', 'mock native'),
  r('Memories/photos', 'Import handles quota rollback and account switch', 'test_photo_transfer.js', 'PASS: photo import deduplication, collision preflight, quota rollback, account switching and truthful partial cleanup', 'synthetic client'),
  r('Memories/photos', 'iOS Photos export reports denial and partial writes honestly', 'test_photo_gallery.js', 'PASS: Photos export zero, batch, queued, denial, partial, account switch and unsupported platform', 'mock native'),
  r('Memories/photos', 'Older clients cannot insert cloud photo metadata', 'test_device_local_photo_policy.mjs', 'PASS: old client photo metadata INSERT is denied', 'PGlite'),

  // Trips and member/owner boundary.
  r('Trips', 'Trip deletion remains durable across retry and stale pull', 'test_group_trip_boundaries.js', 'PASS: durable trip deletion, retry, stale pull, keyset pagination and pending edits', 'synthetic client'),
  r('Trips', 'Shared-trip reads are scoped and read-only for members', 'test_group_trip_boundaries.js', 'PASS: shared-trip RLS-result filtering, read-only view, personal cache isolation and stale group/account boundaries', 'synthetic client'),
  r('Trips', 'Realtime trip deletion does not cross owner or account', 'test_group_trip_boundaries.js', 'PASS: key-only realtime owner deletes, pending edits, member cache isolation and stale subscriptions', 'synthetic client'),
  r('Trips', 'Share/unshare writes a scoped trip projection', 'test_group_trip_boundaries.js', 'PASS: explicit share/unshare writes a scoped projection and preserves personal ownership', 'synthetic client'),
  r('Trips', 'Itinerary redraw preserves only owner’s draft', 'test_group_trip_boundaries.js', 'PASS: itinerary redraw keeps the owner draft without crossing accounts', 'synthetic UI'),
  r('Trips', 'Another group member cannot edit an owner’s trip', 'test_group_administration.mjs', 'PASS 38: a group member cannot edit another person’s trip', 'PGlite'),
  r('Trips', 'Unsharing immediately revokes group trip visibility', 'test_group_administration.mjs', 'PASS 45: unsharing immediately revokes group trip visibility', 'PGlite'),

  // Purchases, restore, locked access and provider deletion.
  r('Purchases', 'Mock native purchase/cancel/restore follows account identity', 'test_billing.js', '  billing behaviour: 8 mock IAPs, cancelled sale, restore, identity, native guard and sign-out passed', 'mock native'),
  r('Purchases', 'Locked packs and Antarctica entitlement gate content', 'test_bundle_access.js', 'bundle access: passed (classic, Antarctic gem, regional gem, counters and locked views)', 'synthetic client'),
  r('Purchases', 'Billing release guard checks prices and blank native keys', 'check_billing.py', '  billing/release guard: static and mocked checks passed', 'static/mock'),
  r('Purchases', 'Account deletion queues one durable provider-erasure intent', 'test_revenuecat_deletion.mjs', 'PASS: Auth deletion commits with one durable provider intent and cascades personal rows', 'PGlite'),
  r('Purchases', 'Provider 200 and absent 404 are acknowledged without identity leakage', 'test_revenuecat_deletion_worker.mjs', 'PASS: RevenueCat queued 200 and retry-safe absent 404 are acknowledged without UUID output', 'mock HTTP'),
  r('Purchases', 'Provider auth/rate/network failures remain retryable', 'test_revenuecat_deletion_worker.mjs', 'PASS: provider auth, rate-limit and network failures remain visible and retryable', 'mock HTTP'),

  // Community content, RLS, review and reporting.
  r('Community', 'Anonymous identity cannot post a recommendation', 'test_verified_community_access.mjs', 'PASS 9: anonymous Auth user cannot post', 'PGlite'),
  r('Community', 'Author can edit own moderated recommendation', 'test_community_security.mjs', 'PASS 4: author can edit text on own moderated post', 'PGlite'),
  r('Community', 'Another account cannot edit author recommendation', 'test_community_security.mjs', 'PASS 13: another user cannot edit the author post', 'PGlite'),
  r('Community', 'Voting totals are assigned by server trigger', 'test_community_security.mjs', 'PASS 14: valid feedback updates totals through the server trigger', 'PGlite'),
  r('Community', 'Three distinct reports hide a post', 'test_community_security.mjs', 'PASS 22: three separate reporters hide the post from other readers', 'PGlite'),
  r('Community', 'New recommendation starts in pending review', 'test_community_premoderation.mjs', 'PASS 2: new content always starts pending', 'PGlite'),
  r('Community', 'Operator approval exposes a post to others', 'test_community_premoderation.mjs', 'PASS 6: operator approval exposes post to other travellers', 'PGlite'),
  r('Community', 'Author edit returns approved post to review queue', 'test_community_premoderation.mjs', 'PASS 8: public author edit returns to private operator queue', 'PGlite'),
  r('Community', 'Consented review queues metadata-only current revision', 'test_community_email_review.mjs', 'PASS 5: consented post queues metadata-only current revision', 'PGlite'),
  r('Community', 'Stale moderation email cannot publish changed content', 'test_community_email_review.mjs', 'PASS 10: stale email and client/worker decisions cannot publish', 'PGlite'),

  // Navigation, catalogue, availability and reviewed booking links.
  r('Discovery/booking', 'Map dots handle world/continent/country windows and dateline', 'test_map_geometry.js', 'PASS: world/continent/country dot maps, dateline wrapping, product geography and small-country markers', 'synthetic UI'),
  r('Discovery/booking', 'Deep links, Back, subdivisions and exhausted lists navigate', 'test_navigation.js', 'PASS: sourced subdivision threshold, direct country routes, history, Back, trip links, counts, search and exhaustion', 'synthetic UI'),
  r('Discovery/booking', 'Avoided/advised experiences show explicit warnings', 'test_advisory_behavior.js', 'advisory behavior: 15 passed', 'synthetic UI'),
  r('Discovery/booking', 'Paused listings preserve history but leave discovery counts', 'test_availability.js', 'availability behavior: historic ID/tick retained; discovery, targets and paid counts excluded', 'synthetic client'),
  r('Discovery/booking', 'Unknown prices and schedules remain explicitly unknown', 'test_unknown_cost.js', 'unknown cost and schedule UI: 24 passed', 'synthetic UI'),
  r('Discovery/booking', 'Booking buttons require reviewed matching and disclosure', 'test_booking_links.js', '38 booking link boundary and disclosure checks passed', 'synthetic client'),
  r('Discovery/booking', 'Product registry excludes inactive/unverified matches', 'test_booking_registry.py', '9 booking-registry checks passed: ACTIVE product, current/future schedule, dated evidence and intact affiliate URL required', 'static/unit'),
  r('Discovery/booking', 'Adventure sheet places paid link with disabled state correctly', 'test_booking_render.js', 'Real adventure-sheet rendering, link placement, disclosure, trip details and disabled-state checks passed', 'synthetic UI'),
  r('Discovery/booking', 'Catalogue coverage math and pack counts remain consistent', 'test_content_inventory.py', null, 'static/unit'),
  r('Discovery/booking', 'Every uncovered country fails unless an explicit do-not-travel safety hold applies', 'check_quality.py', null, 'static content'),

  // Policy, accessibility, native release structure.
  r('Policy/access/native', 'Cards and dialogs support keyboard/focus semantics', 'test_accessibility.js', 'PASS: keyboard card activation, selection semantics and six-dialog focus lifecycle', 'synthetic UI'),
  r('Policy/access/native', 'Guided tour is opt-in, scoped and replayable', 'test_tour.js', 'PASS: optional account-scoped tour, six live targets, support, Back, Skip and replay', 'synthetic UI'),
  r('Policy/access/native', 'Framed app refuses to expose private state', 'test_frame_guard.js', 'PASS: top-level startup is unchanged; framed startup paints only a refusal and reads no private state', 'synthetic client'),
  r('Policy/access/native', 'Bundled privacy manifests match archive collection claims', 'test_archive_privacy.py', null, 'static/unit'),
  r('Policy/access/native', 'Historical cloud photo objects remain closed to group members', 'test_group_feedback.mjs', 'PASS 15: group member cannot read historical cloud photo object', 'PGlite'),
  r('Policy/access/native', 'Android/iOS permissions and product IDs match source', 'check_parity.py', '  Native parity checks passed.', 'static'),
  r('Policy/access/native', 'iOS release preparation guards key injection and delivery', 'test_ios_release_prep.mjs', '  iOS release preparation: public-key injection and guarded delivery workflow passed', 'static/mock'),
  r('Policy/access/native', 'App and public policies explain retained history and last-member disposal', 'review_history_copy.mjs', 'PASS: app and bundled/public policy copy explain retained history and last-member disposal', 'static copy'),
];

if (cases.length !== 100) throw new Error(`review matrix has ${cases.length}, expected 100`);
const scriptRepo = resolve(import.meta.dirname, '..');
const targetOption = process.argv.indexOf('--target');
const repo = targetOption >= 0 ? resolve(process.argv[targetOption + 1]) : scriptRepo;
const head = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repo, encoding: 'utf8',
}).stdout?.trim() || 'unavailable';
const commands = new Map();
for (const c of cases) {
  if (commands.has(c.file)) continue;
  const executable = c.file.endsWith('.py')
    ? (process.platform === 'win32' ? 'python' : 'python3') : process.execPath;
  const script = c.file.includes('review_')
    ? fileURLToPath(new URL(`./${c.file.split('/').at(-1)}`, import.meta.url))
    : c.file;
  const result = spawnSync(executable, [script], {
    cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, REVIEW_TARGET: repo },
  });
  commands.set(c.file, {
    status: result.status,
    lines: `${result.stdout || ''}\n${result.stderr || ''}`.split(/\r?\n/).map(s => s.trim()),
    error: result.error?.message,
  });
}

const result = cases.map((c, index) => {
  const command = commands.get(c.file);
  const passed = c.marker === null
    ? command.status === 0
    : command.lines.includes(c.marker.trim())
      && (command.status === 0 || c.file.endsWith('review_retained_group_history.mjs'));
  return { id: index + 1, ...c, status: passed ? 'PASS' : 'FAIL',
    evidence: c.marker || `exit ${command.status}` };
});
const passed = result.filter(c => c.status === 'PASS').length;
const failed = result.length - passed;
for (const c of result) {
  console.log(`${String(c.id).padStart(3, '0')} ${c.status} [${c.domain}] ${c.scenario}`);
}
console.log(`100-scenario local review: ${passed} PASS, ${failed} FAIL, 100 total.`);
for (const [file, command] of commands) {
  if (command.error) console.error(`${file}: ${command.error}`);
}

const reportOption = process.argv.indexOf('--report');
if (reportOption >= 0) {
  const out = resolve(scriptRepo, process.argv[reportOption + 1] || 'review-2026-10-05/SCENARIOS.md');
  const escape = s => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const markdown = [
    '# Whole-app 100-scenario local review',
    '',
    `Candidate source: \`${head}\`.`,
    `Result: **${passed} pass, ${failed} fail, 100 reviewed**.`,
    '',
    'PASS means the cited local check ran and met its specific assertion. It does not measure live-service or physical-device reliability.',
    '',
    '| # | Area | Distinct scenario | Result | Method | Evidence |',
    '|---:|---|---|---|---|---|',
    ...result.map(c => `| ${c.id} | ${escape(c.domain)} | ${escape(c.scenario)} | ${c.status} | ${escape(c.method)} | ${escape(c.file)}: ${escape(c.evidence)} |`),
    '',
  ].join('\n');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markdown);
  console.log(`Wrote ${out}`);
}
if (failed) process.exitCode = 1;
