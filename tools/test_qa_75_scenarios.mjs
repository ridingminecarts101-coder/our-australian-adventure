// Independent, read-only QA matrix. Each marker is emitted only after the
// underlying scenario assertion has passed. This runner does not touch live data.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const target = process.argv[2] || process.cwd();
const numbered = (file, numbers, prefix = 'PASS ') => ({ file, markers: numbers.map(n => new RegExp('^' + prefix + n + ': .+$', 'm')) });
const phrase = (file, marker) => ({ file, markers: [marker] });

const suites = [
  { file: 'tools/test_group_join_choice.mjs', markers: [
    'PASS: existing consent stays unchanged; new short code is displayed',
    'PASS: old invite link joins privately and direct consent write is blocked',
    'PASS: one legacy choice governs tick and written feedback together',
    'PASS: repeated invite applies its fresh explicit answer atomically',
    'PASS: personal memory is visible in every consented group',
    'PASS: ambiguous historical note remains private until owner confirmation',
    'PASS: leaving keeps only the person-owned tick and other-group consent',
    'PASS: rotation expires old long and short codes',
    'PASS: repeated guesses are limited per account without locking out others',
    'PASS: replay preserves choices and code; anonymous RPC access is denied',
  ] },
  numbered('tools/test_personal_ownership.mjs', [1,2,3,4,5,8,9,10,11,19,24,34,40,41,42,44]),
  numbered('tools/test_group_feedback.mjs', [5,27,33,36,42,48,53,61,65,66,67,68,73,78,79,83,87,94,98,100,101,102,103,106,107,152,155,159]),
  numbered('tools/test_group_administration.mjs', [2,3,4,12,13,21,27,49,50,57]),
  phrase('tools/test_group_trip_boundaries.js', 'PASS: stale create/join/sharing, private invite consent and lifecycle submission lock'),
  phrase('tools/test_group_feedback.js', 'PASS: opt-in group feedback, read-only owner boundary, ephemeral cache and response ordering'),
  phrase('tools/test_group_memories.js', 'PASS: Group Memories and owner-scoped older personal progress confirmation'),
  phrase('tools/test_group_invite.mjs', 'Group invite: branded selected-code URL, authenticated continuation, account guard, trusted native URL, invalid-code landing and site CSP passed.'),
  phrase('tools/test_completion_dates.js', 'PASS: date boundaries, group ownership, offline sync, stamp order and untick'),
  phrase('tools/test_local_photos.js', 'PASS: 27 device-local photo, deletion, native transaction, privacy and account-scope checks'),
  phrase('tools/test_photo_gallery.js', 'PASS: Photos export zero, batch, queued, denial, partial, account switch and unsupported platform'),
  phrase('tools/test_photo_transfer.js', 'PASS: photo import deduplication, collision preflight, quota rollback, account switching and truthful partial cleanup'),
  phrase('tools/test_sync_races.js', 'sync races: newer edits, account switches, pulls and cross-tab sign-out passed'),
  phrase('tools/test_group_administration.js', 'PASS: admin failures, duplicate submits, account switches and disposal preserve personal state'),
  phrase('tools/test_device_local_photo_policy.mjs', 'device-local server boundary: 9 policy checks passed'),
];

assert.equal(suites.reduce((sum, suite) => sum + suite.markers.length, 0), 75);
let pass = 0;
let fail = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [suite.file], { cwd: target, encoding: 'utf8' });
  const output = (result.stdout || '') + '\n' + (result.stderr || '');
  const errors = [];
  for (const marker of suite.markers) {
    const found = typeof marker === 'string' ? output.includes(marker) : marker.test(output);
    if (result.status === 0 && found) pass++;
    else { fail++; errors.push(typeof marker === 'string' ? marker : marker.source); }
  }
  const state = errors.length ? 'FAIL' : 'PASS';
  console.log(state + ' ' + suite.file + ' (' + (suite.markers.length - errors.length) + '/' + suite.markers.length + ')');
  if (errors.length) {
    console.error('Missing or failed markers: ' + errors.join(' | '));
    console.error(output.slice(-2500));
  }
}
console.log('Independent QA scenarios: ' + pass + ' passed, ' + fail + ' failed, 75 selected.');
if (fail) process.exitCode = 1;
