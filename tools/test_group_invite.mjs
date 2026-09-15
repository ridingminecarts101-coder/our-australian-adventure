import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile('app.js', 'utf8');
const config = await readFile('config.js', 'utf8');
const site = await readFile('business-site/public/wayfinder/invite/index.html', 'utf8');
const script = await readFile('business-site/public/assets/wayfinder-invite.js', 'utf8');
const headers = await readFile('business-site/public/_headers', 'utf8');

assert.match(config, /inviteBase: 'https:\/\/rlapplications\.com\/wayfinder\/invite\/'/);
assert.match(app, /const url = groupInviteLink\(g\.join_code\)/);
assert.match(app, /App\.getLaunchUrl\(\)/);
assert.match(site, /script src="\/assets\/wayfinder-invite\.js"/);
assert.doesNotMatch(site, /github\.io|testflight\.apple\.com/i);
assert.match(headers, /\/wayfinder\/invite\/\*\s+! Content-Security-Policy\s+Content-Security-Policy: [^\n]*script-src 'self'/);
assert.match(headers, /\/\*\s+Content-Security-Policy: [^\n]*script-src 'none'/);

const stores = new Map();
const storage = {
  getItem: key => stores.get(key) ?? null,
  setItem: (key, value) => stores.set(key, value),
  removeItem: key => stores.delete(key),
};
let accepted = true;
const joins = [];
const opened = [];
const ctx = vm.createContext({
  localStorage: storage, Date, URL, userId: null, sb: {}, online: true,
  pendingGroupInviteBusy: false, confirm: () => accepted,
  lastExternalDeepLink: null, lastExternalDeepLinkAt: 0,
  toast: () => {}, joinGroup: async code => joins.push(code),
  openDeepLink: search => opened.push(search),
  OAA_CONFIG: { inviteBase: 'https://rlapplications.com/wayfinder/invite/' },
  window: { OAA_CONFIG: { inviteBase: 'https://rlapplications.com/wayfinder/invite/' } },
});
const helper = app.slice(app.indexOf('function readPendingGroupInvite()'), app.indexOf('function tidyDeepLinkQuery()'));
const linkHelper = app.slice(app.indexOf('function groupInviteLink('), app.indexOf('/* One plugin lookup'));
assert.ok(helper.startsWith('function readPendingGroupInvite()'));
assert.ok(linkHelper.startsWith('function groupInviteLink('));
vm.runInContext(`const PENDING_GROUP_INVITE_KEY = 'wayfinder.pending-group-invite';
const PENDING_GROUP_INVITE_MAX_AGE = 30 * 60 * 1000;
${helper}\n${linkHelper}`, ctx);
const api = vm.runInContext('({ queueGroupInvite, resumePendingGroupInvite, openExternalDeepLink, groupInviteLink })', ctx);

assert.equal(api.groupInviteLink('ABCD12'), 'https://rlapplications.com/wayfinder/invite/?join=ABCD12');
assert.equal(api.queueGroupInvite('AbCd12'), true);
assert.equal(joins.length, 0, 'cold invite waits for authenticated account');
ctx.userId = 'recipient';
await api.resumePendingGroupInvite();
assert.deepEqual(joins, ['ABCD12']);
assert.equal(stores.size, 0, 'consumed invite does not replay');

assert.equal(api.queueGroupInvite('BEEF99'), true);
accepted = false;
await api.resumePendingGroupInvite();
assert.deepEqual(joins, ['ABCD12'], 'declined invite does not join');
assert.equal(stores.size, 0);
assert.equal(api.queueGroupInvite('ABC-12'), false);
assert.equal(stores.size, 0, 'invalid external code is not saved');

ctx.userId = 'sender';
assert.equal(api.queueGroupInvite('OWNER1'), true);
ctx.userId = 'other-account';
accepted = true;
await api.resumePendingGroupInvite();
assert.deepEqual(joins, ['ABCD12'], 'account transition cannot consume another account’s invite');
assert.equal(stores.size, 0);

api.openExternalDeepLink('https://evil.example/?join=EVIL12');
assert.equal(opened.length, 0, 'untrusted HTTPS host ignored');
api.openExternalDeepLink('wayfinder://invite?join=GROUP1');
assert.deepEqual(opened, ['?join=GROUP1']);
api.openExternalDeepLink('wayfinder://invite?join=GROUP1');
assert.deepEqual(opened, ['?join=GROUP1'], 'launch URL and native event do not double-prompt');

function checkLanding(search) {
  const elements = Object.fromEntries(['inviteStatus', 'inviteActions', 'inviteCode',
    'openInstalledApp', 'copyInviteCode'].map(id => [id, {
      textContent: '', value: '', href: '', hidden: true, addEventListener: () => {},
    }]));
  vm.runInNewContext(script, {
    document: { getElementById: id => elements[id] },
    location: { search }, URLSearchParams, encodeURIComponent,
    navigator: { clipboard: { writeText: async () => {} } },
  });
  return elements;
}
const valid = checkLanding('?join=AbCd12');
assert.equal(valid.inviteActions.hidden, false);
assert.equal(valid.inviteCode.value, 'ABCD12');
assert.equal(valid.openInstalledApp.href, 'wayfinder://invite?join=ABCD12');
for (const search of ['', '?join=ABC-12', '?join=%3Cscript%3E', '?join=ABCDEF&join=GHIJKL']) {
  const invalid = checkLanding(search);
  assert.equal(invalid.inviteActions.hidden, true);
  assert.equal(invalid.openInstalledApp.href, '');
}

console.log('Group invite: branded selected-code URL, authenticated continuation, account guard, trusted native URL, invalid-code landing and site CSP passed.');
