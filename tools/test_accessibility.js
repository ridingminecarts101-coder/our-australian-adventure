'use strict';

// Exercises the real card, selection-state and modal-focus helpers without a
// browser profile, network, account or persisted user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `could not extract ${start}`);
  return source.slice(from, to);
}

class Classes {
  constructor(...names) { this.names = new Set(names); }
  add(...names) { names.forEach(name => this.names.add(name)); }
  remove(...names) { names.forEach(name => this.names.delete(name)); }
  contains(name) { return this.names.has(name); }
}

function node(document, id = '') {
  const attributes = new Map();
  return {
    id, disabled: false, connected: true, classList: new Classes(), controls: [],
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    hasAttribute(name) { return attributes.has(name); },
    querySelectorAll() { return this.controls; },
    focus() { document.activeElement = this; },
    blur() { if (document.activeElement === this) document.activeElement = null; },
    closest() { return null; },
  };
}

async function modalBehavior() {
  const bySelector = new Map(), document = { activeElement: null };
  document.contains = element => element.connected;
  document.getElementById = id => bySelector.get(`#${id}`) || null;
  document.querySelector = selector => bySelector.get(selector) || null;
  const opener = node(document); opener.setAttribute('data-open', '7');
  const replacement = node(document); replacement.setAttribute('data-open', '7');
  const dialogs = {};
  for (const id of ['sheet', 'tripSheet', 'recSheet', 'lightbox', 'photoBackupSheet']) {
    const dialog = node(document, id); dialog.classList.add('hidden');
    dialog.controls = [node(document, `${id}-close`), node(document, `${id}-last`)];
    bySelector.set(`#${id}`, dialog); dialogs[id] = dialog;
  }
  document.activeElement = opener;

  const closed = [];
  const context = {
    document, CSS: { escape: value => value }, queueMicrotask,
    $: selector => bySelector.get(selector) || null,
    lightbox: { list: [{id:'one'}, {id:'two'}], index: 0 },
    showLightbox() {},
  };
  vm.createContext(context);
  context.window = { WayfinderPhotoTransfer: { close: () => {
    closed.push('photoBackupSheet'); context.hideManagedDialog('#photoBackupSheet');
  } } };
  vm.runInContext(section('const DIALOG_CONTROLS', 'async function openLightbox'), context);
  for (const [id, fn] of [['sheet','closeSheet'], ['tripSheet','closeTripSheet'],
    ['recSheet','closeRecSheet'], ['lightbox','closeLightbox']]) {
    context[fn] = () => { closed.push(id); context.hideManagedDialog(`#${id}`); };
  }

  context.showManagedDialog('#sheet');
  await Promise.resolve();
  assert.equal(document.activeElement, dialogs.sheet.controls[0], 'opening focuses the first dialog control');

  let prevented = 0;
  const key = (value, shiftKey = false) => ({key:value,shiftKey,preventDefault(){prevented++;}});
  context.handleDialogKeydown(key('Tab'));
  assert.equal(document.activeElement, dialogs.sheet.controls[1]);
  context.handleDialogKeydown(key('Tab'));
  assert.equal(document.activeElement, dialogs.sheet.controls[0], 'Tab wraps inside the dialog');
  context.handleDialogKeydown(key('Tab', true));
  assert.equal(document.activeElement, dialogs.sheet.controls[1], 'Shift+Tab wraps inside the dialog');

  opener.connected = false;
  bySelector.set('[data-open="7"]', replacement);
  context.handleDialogKeydown(key('Escape'));
  await Promise.resolve();
  assert(dialogs.sheet.classList.contains('hidden'));
  assert.equal(document.activeElement, replacement, 'focus returns to the replacement card after a re-render');

  for (const id of ['tripSheet', 'recSheet', 'lightbox', 'photoBackupSheet']) {
    document.activeElement = replacement;
    context.showManagedDialog(`#${id}`);
    await Promise.resolve();
    context.handleDialogKeydown(key('Escape'));
    await Promise.resolve();
  }
  assert.deepEqual(closed, ['sheet', 'tripSheet', 'recSheet', 'lightbox', 'photoBackupSheet']);
  assert(prevented >= 7);
}

function cardAndSelectionBehavior() {
  const context = {
    row: () => ({completed:false,shortlisted:false}), isLocked: () => false,
    isUnavailable: () => false, progressView: 'personal', personalProgress: new Map(),
    esc: value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;'),
    lockedTitle: () => 'Locked adventure', lockNote: () => '', metaLine: () => 'Place',
  };
  vm.createContext(context);
  vm.runInContext(section('function cardHTML(a)', 'function renderList()'), context);
  const card = context.cardHTML({id:7,title:'Walk & look',category:'Nature',difficulty:2,cost:0,
    dog_friendly:'no',hidden_gem:false,bundle_only:false});
  assert.match(card, /<button type="button" class="card-body card-detail" data-open="7"/);
  assert.match(card, /aria-label="Open details for Walk &amp; look"/);
  assert.equal((card.match(/data-open=/g) || []).length, 1, 'one native button owns detail activation');
  assert.match(card, /<span class="card-open" aria-hidden="true">/);

  vm.runInContext(section('function setPressedSelection', 'function wireUI()'), context);
  const makeControl = () => ({attrs:{},setAttribute(name,value){this.attrs[name]=value;}});
  const controls = [makeControl(), makeControl(), makeControl()];
  context.setPressedSelection(controls, controls[1]);
  assert.deepEqual(controls.map(x => x.attrs['aria-pressed']), ['false','true','false']);
  context.setCurrentTab(controls, controls[2]);
  assert.deepEqual(controls.map(x => x.attrs['aria-current']), ['false','false','page']);

  assert.match(html, /id="search"[^>]*aria-label="Search adventures"/);
  for (const id of ['sheet','tripSheet','recSheet','lightbox']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*tabindex="-1"`));
  }
}

(async () => {
  cardAndSelectionBehavior();
  await modalBehavior();
  console.log('PASS: keyboard card activation, selection semantics and five-dialog focus lifecycle');
})().catch(error => { console.error(error); process.exitCode = 1; });
