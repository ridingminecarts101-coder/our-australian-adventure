'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const begin = source.indexOf('const TOUR_STEPS = [');
const end = source.indexOf('function wireUI() {', begin);
assert(begin >= 0 && end > begin);

for (const id of ['tourInvite', 'tourInviteStart', 'tourInviteDismiss', 'tourReplayBtn',
  'tourDialog', 'tourTarget', 'tourCard', 'tourTitle', 'tourDescription',
  'tourBack', 'tourNext', 'tourSkip', 'supportBtn', 'privacyBtn',
  'accountPanel', 'exportPhotosBtn', 'deleteAccountBtn', 'groupPanel']) {
  assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} appears once`);
}
assert.match(html, /id="tourDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
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
  'tourDialog', 'supportBtn']) elements.set(`#${id}`, element());
elements.get('#tourInvite').classList.add('hidden');
elements.get('#tourDialog').classList.add('hidden');
elements.get('#tourCard').rect = { left: 0, top: 0, width: 340, height: 190 };
elements.get('#supportBtn').rect = { left: 100, top: 140, width: 140, height: 44 };

const stored = new Map(), tabs = [];
const context = {
  userId: 'first-account',
  $: selector => elements.get(selector),
  readLS: (key, fallback) => stored.has(key) ? stored.get(key) : fallback,
  writeLS: (key, value) => stored.set(key, value),
  window: { innerWidth: 390, innerHeight: 800 },
  document: { documentElement: { clientWidth: 390, clientHeight: 800 } },
  requestAnimationFrame: callback => callback(),
  activateAppTab: tab => {
    tabs.push(tab);
    elements.set('.tab.active', tab);
  },
  showManagedDialog: selector => elements.get(selector).classList.remove('hidden'),
  hideManagedDialog: selector => elements.get(selector).classList.add('hidden'),
};
vm.createContext(context);
vm.runInContext(source.slice(begin, end), context);

const invite = elements.get('#tourInvite');
context.updateTourInvite();
assert.equal(invite.classList.contains('hidden'), false, 'first sign-in offers a tour');
context.startTour();
assert.equal(invite.classList.contains('hidden'), true);
assert.equal(elements.get('#tourDialog').classList.contains('hidden'), false);
assert.equal(elements.get('#tourTitle').textContent, 'Adventures');
assert.equal(elements.get('#tourBack').classList.contains('hidden'), true);
assert.equal(tabs.at(-1), elements.get('.tab[data-tab="tab-list"]'));
assert.match(elements.get('#tourTarget').style.top, /px$/, 'a visible target is highlighted');

for (let step = 1; step < 6; step++) context.advanceTour(1);
assert.equal(elements.get('#tourTitle').textContent, 'Help & support');
assert.equal(elements.get('#supportBtn').scrolled, 1, 'support is brought into view');
assert.equal(elements.get('#tourNext').textContent, 'Finish');
context.advanceTour(1);
assert.equal(elements.get('#tourDialog').classList.contains('hidden'), true);
assert.equal(stored.get('oaa.tour.v1.first-account'), true);
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
assert.equal(invite.classList.contains('hidden'), false, 'another account sees its own prompt');
context.dismissTourInvite();
assert.equal(stored.get('oaa.tour.v1.second-account'), true);
assert.equal(stored.get('oaa.tour.v1.first-account'), true);
console.log('PASS: optional account-scoped tour, six live targets, support, Back, Skip and replay');
