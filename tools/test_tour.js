'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const begin = source.indexOf("const TOUR_DEVICE_SEEN_KEY = 'oaa.tour.v1.device-dismissed';");
const end = source.indexOf('function wireUI() {', begin);
assert(begin >= 0 && end > begin);

for (const id of ['tourInvite', 'tourInviteStart', 'tourInviteDismiss', 'tourReplayBtn',
  'tourDialog', 'tourTarget', 'tourCard', 'tourTitle', 'tourDescription',
  'tourBack', 'tourNext', 'tourSkip', 'supportBtn', 'privacyBtn',
  'accountPanel', 'exportPhotosBtn', 'deleteAccountBtn', 'groupPanel']) {
  assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} appears once`);
}
assert.match(html, /id="tourDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(html, /id="tourInvite"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(html, /id="tourInvite"[^>]*aria-labelledby="tourWelcomeTitle"[^>]*aria-describedby="tourWelcomeDescription"/);
assert.match(html, /id="tourInviteDismiss"[^>]*>No thanks<\/button>/);
for (const id of ['tourWelcomeTitle', 'tourWelcomeDescription', 'worldSearchBtn', 'progressViewBtn']) {
  assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} appears once`);
}
assert.equal((html.match(/id="hereBtn"/g) || []).length, 0, 'tour has no retired location target');
for (const title of ['Your numbers', 'Paid collections', 'Account &amp; display name',
  'Photos &amp; backups', 'Reminders &amp; syncing', 'About Wayfinder']) {
  assert.match(html, new RegExp(`<details class="me-fold">\\s*<summary>${title}</summary>`));
}

function element(rect = { left: 10, top: 700, width: 65, height: 48 }, hidden = false) {
  const classes = new Set(hidden ? ['hidden'] : []);
  return {
    style: {}, textContent: '', rect, scrolled: 0, focused: 0,
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, value) => value ? classes.add(name) : classes.delete(name),
    },
    getBoundingClientRect() { return this.rect; },
    scrollIntoView() { this.scrolled++; },
    focus() { this.focused++; },
  };
}

const elements = new Map();
for (const tab of ['list', 'passport', 'memories', 'community', 'me']) {
  elements.set(`.tab[data-tab="tab-${tab}"]`, element());
}
for (const id of ['tourInvite', 'tourTarget', 'tourCard', 'tourTitle',
  'tourStepCount', 'tourDescription', 'tourBack', 'tourNext', 'tourSkip',
  'tourDialog', 'tourInviteStart', 'supportBtn', 'app', 'worldSearchBtn',
  'progressViewBtn']) elements.set(`#${id}`, element());
elements.set('.topbar-actions', element({ left: 280, top: 30, width: 94, height: 44 }));
elements.get('#tourInvite').classList.add('hidden');
elements.get('#tourDialog').classList.add('hidden');
elements.get('#tourCard').rect = { left: 0, top: 0, width: 340, height: 190 };
elements.get('#supportBtn').rect = { left: 100, top: 140, width: 140, height: 44 };

const stored = new Map(), tabs = [], shownDialogs = [];
const context = {
  userId: 'first-account',
  $: selector => elements.get(selector),
  readLS: (key, fallback) => stored.has(key) ? stored.get(key) : fallback,
  writeLS: (key, value) => stored.set(key, value),
  window: { innerWidth: 390, innerHeight: 800 },
  document: { documentElement: { clientWidth: 390, clientHeight: 800 } },
  requestAnimationFrame: callback => callback(),
  activeGroupId: null,
  managedDialog: null,
  pendingGroupInvite: null,
  pendingGroupInviteBusy: false,
  pendingTripDeepLink: null,
  nav: { level: 'world', continent: null, country: null, admin1: null },
  goTo: () => { throw new Error('the tour should already be at the world screen'); },
  readPendingGroupInvite: () => context.pendingGroupInvite,
  activeManagedDialog: () => context.managedDialog,
  activateAppTab: tab => {
    tabs.push(tab);
    elements.set('.tab.active', tab);
  },
  showManagedDialog: selector => {
    const dialog = elements.get(selector);
    shownDialogs.push(selector);
    context.managedDialog = dialog;
    dialog.classList.remove('hidden');
    (selector === '#tourInvite' ? elements.get('#tourInviteStart') : dialog).focus();
  },
  hideManagedDialog: selector => {
    const dialog = elements.get(selector);
    dialog.classList.add('hidden');
    if (context.managedDialog === dialog) context.managedDialog = null;
  },
};
vm.createContext(context);
vm.runInContext(source.slice(begin, end), context);

const invite = elements.get('#tourInvite');
context.updateTourInvite();
assert.equal(invite.classList.contains('hidden'), false, 'first sign-in automatically opens the welcome dialog');
assert.equal(shownDialogs.at(-1), '#tourInvite', 'welcome uses the managed-dialog lifecycle');
assert.equal(elements.get('#tourInviteStart').focused, 1, 'managed welcome places focus on its first action');
context.startTour();
assert.equal(invite.classList.contains('hidden'), true);
assert.equal(elements.get('#tourDialog').classList.contains('hidden'), false);
assert.equal(stored.has('oaa.tour.v1.device-dismissed'), false,
  'starting the tour does not mark the installation as finished');
assert.equal(elements.get('#tourTitle').textContent, 'Adventures');
assert.equal(elements.get('#tourBack').classList.contains('hidden'), true);
assert.equal(tabs.at(-1), elements.get('.tab[data-tab="tab-list"]'));
assert.match(elements.get('#tourTarget').style.top, /px$/, 'a visible target is highlighted');

context.advanceTour(1);
assert.equal(elements.get('#tourTitle').textContent, 'Me / Group view');
assert.match(elements.get('#tourDescription').textContent, /After you join a group from Me/,
  'people without a group are still taught where the Me / Group switch will appear');
assert.equal(elements.get('#tourTarget').style.left, '274px',
  'the nonmember step highlights the persistent top-bar actions instead of a hidden switch');
context.advanceTour(1);
assert.equal(elements.get('#tourTitle').textContent, 'Search anywhere');

for (let step = 3; step < 8; step++) context.advanceTour(1);
assert.equal(elements.get('#tourTitle').textContent, 'Help & support');
assert.equal(elements.get('#supportBtn').scrolled, 1, 'support is brought into view');
assert.equal(elements.get('#tourNext').textContent, 'Finish');
context.advanceTour(1);
assert.equal(elements.get('#tourDialog').classList.contains('hidden'), true);
assert.equal(stored.get('oaa.tour.v1.first-account'), true);
assert.equal(stored.get('oaa.tour.v1.device-dismissed'), true);
assert.equal(invite.classList.contains('hidden'), true);
assert.equal(elements.get('.tab.active').focused, 1, 'focus goes to the visible section');

context.startTour();
context.advanceTour(1);
context.advanceTour(-1);
assert.equal(elements.get('#tourTitle').textContent, 'Adventures', 'Back returns to the prior step');
context.closeTour();
assert.equal(elements.get('#tourDialog').classList.contains('hidden'), true, 'Skip closes the tour');

context.userId = 'second-account';
context.updateTourInvite();
assert.equal(invite.classList.contains('hidden'), true,
  'another account on the same installation is not prompted again');
assert.equal(stored.get('oaa.tour.v1.first-account'), true);

stored.clear();
context.userId = 'legacy-account';
stored.set('oaa.tour.v1.legacy-account', true);
context.updateTourInvite();
assert.equal(invite.classList.contains('hidden'), true,
  'the old account-scoped flag prevents an upgrade from nagging an existing traveller');
assert.equal(stored.get('oaa.tour.v1.device-dismissed'), true,
  'an old account-scoped flag migrates to the once-per-device flag');

stored.clear();
context.userId = 'fresh-account';
elements.get('#app').classList.add('hidden');
context.updateTourInvite();
assert.equal(invite.classList.contains('hidden'), true, 'welcome waits until the app is visible');
elements.get('#app').classList.remove('hidden');
context.updateTourInvite();
assert.equal(invite.classList.contains('hidden'), false, 'a fresh visible installation gets one welcome');
const visibleTab = elements.get('.tab.active');
const focusBeforeDismiss = visibleTab.focused;
context.dismissTourInvite();
assert.equal(stored.get('oaa.tour.v1.fresh-account'), true);
assert.equal(stored.get('oaa.tour.v1.device-dismissed'), true);
assert.equal(visibleTab.focused, focusBeforeDismiss + 1,
  'dismissing the automatic welcome returns focus to the visible tab');

stored.clear();
context.userId = 'pending-dialog-account';
const pendingDialog = element();
context.managedDialog = pendingDialog;
context.updateTourInvite();
assert.equal(invite.classList.contains('hidden'), true,
  'a pending managed dialog takes priority over the first-use welcome');
assert.equal(stored.has('oaa.tour.v1.device-dismissed'), false,
  'deferring behind another dialog is read-only and does not consume the welcome');
context.managedDialog = null;
context.updateTourInvite();
assert.equal(invite.classList.contains('hidden'), false,
  'the welcome remains available once the pending dialog closes');

function assertDeferredUntilCleared(label, setPending, clearPending) {
  stored.clear();
  context.userId = `pending-${label}`;
  context.hideManagedDialog('#tourInvite', false);
  setPending();
  context.updateTourInvite();
  assert.equal(invite.classList.contains('hidden'), true,
    `${label} takes priority over the first-use welcome`);
  assert.equal(stored.has('oaa.tour.v1.device-dismissed'), false,
    `${label} deferral does not consume the welcome`);
  clearPending();
  context.updateTourInvite();
  assert.equal(invite.classList.contains('hidden'), false,
    `the welcome is offered after ${label} clears`);
}

assertDeferredUntilCleared('stored group invite',
  () => { context.pendingGroupInvite = { code: 'ABC123' }; },
  () => { context.pendingGroupInvite = null; });
assertDeferredUntilCleared('active group join',
  () => { context.pendingGroupInviteBusy = true; },
  () => { context.pendingGroupInviteBusy = false; });
assertDeferredUntilCleared('pending trip link',
  () => { context.pendingTripDeepLink = { id: 'trip-id' }; },
  () => { context.pendingTripDeepLink = null; });
console.log('PASS: once-per-device welcome, legacy no-nag, eight live tour targets, nonmember Group teaching, Back, Skip and replay');
