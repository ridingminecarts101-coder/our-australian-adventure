'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element(tag) {
  return {
    tag, children: [], textContent: '', href: '', target: '', rel: '', style: {},
    attributes: {}, removed: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    remove() { this.removed = true; },
  };
}

function guardHarness(framed) {
  const listeners = new Map();
  const head = element('head'), body = element('body');
  body.append(element('private-app-markup'));
  const context = {
    console,
    document: {
      readyState: 'loading', head, body,
      createElement: tag => element(tag),
      addEventListener: (name, callback) => listeners.set(name, callback),
    },
    location: { href: 'https://example.test/wayfinder/' },
  };
  context.window = context;
  context.self = context;
  context.top = framed ? {} : context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('frame-guard.js', 'utf8'), context, { filename: 'frame-guard.js' });
  return { context, listeners, head, body };
}

{
  const h = guardHarness(false);
  assert.equal(h.context.__WAYFINDER_FRAMED__, undefined);
  assert.equal(h.head.children.length, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.body.children[0].tag, 'private-app-markup');
}

{
  const h = guardHarness(true);
  assert.equal(h.context.__WAYFINDER_FRAMED__, true);
  assert.match(h.head.children[0].textContent, /visibility:hidden/);
  assert.equal(h.body.children[0].tag, 'private-app-markup');
  h.listeners.get('DOMContentLoaded')();
  assert.equal(h.body.children.length, 1);
  const main = h.body.children[0];
  assert.equal(main.attributes.role, 'alert');
  assert.equal(main.children[0].textContent, 'Open Wayfinder directly');
  assert.equal(main.children[2].href, 'https://example.test/wayfinder/');
  assert.equal(main.children[2].rel, 'noopener noreferrer');
  assert.equal(h.head.children[0].removed, true);
}

{
  let localReads = 0;
  const context = {
    window: { __WAYFINDER_FRAMED__: true },
    localStorage: { getItem() { localReads++; throw new Error('private storage read'); } },
  };
  vm.createContext(context);
  assert.throws(() => vm.runInContext(fs.readFileSync('app.js', 'utf8'), context, { filename: 'app.js' }),
    /refused to start inside a frame/);
  assert.equal(localReads, 0, 'framed startup must abort before local account data is read');
}

const index = fs.readFileSync('index.html', 'utf8');
assert.ok(index.indexOf('src="frame-guard.js"') < index.indexOf('src="config.js"'));
assert.match(fs.readFileSync('sw.js', 'utf8'), /'\.\/frame-guard\.js'/);
assert.match(fs.readFileSync('tools/stage.mjs', 'utf8'), /'frame-guard\.js'/);

console.log('PASS: top-level startup is unchanged; framed startup paints only a refusal and reads no private state');
