'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let checks = 0;
const base = { country: 'NZ', place: 'Waitomo Glowworm Caves', status: 'verified',
  adventure_title: 'Float under the glowworms in the Waitomo Caves',
  match_note: 'Guided visit includes the underground boat ride.',
  match_type: 'exact', product_code: '3930P3',
  viator_url: 'https://www.viator.com/tours/Waitomo/Waitomo-Glowworm-Caves-Guided-Tour/d27469-3930P3' };
const adventure = {id: 529, country: 'NZ', place: base.place, title: base.adventure_title};
function context(change = {}, config = {}, flags = {}) {
  const c = { URL, window: null, OAA_CONFIG: { partners: {
    viatorEnabled: true, viatorPartnerId: 'P00321485', ...config } },
    VIATOR_BOOKING_LINKS: {'529': {...base, ...change}},
    isLocked: () => !!flags.locked, advisoryFor: () => flags.avoid ? {level:'avoid'} : null };
  c.window = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync('partners.js','utf8'),c); return c;
}
function link(c, a = adventure) { c.a = a; return vm.runInContext('bookingLink(a)',c); }
function absent(c,a) { assert.equal(link(c,a),null); checks++; }
const good = link(context());
const u = new URL(good.url);
assert.equal(u.search, '?pid=P00321485&mcid=42383&medium=link&campaign=wayfinder'); checks++;
assert.equal(u.pathname, new URL(base.viator_url).pathname); checks++;
assert.equal(good.label, 'View experience on Viator'); checks++;
assert.match(link(context({match_type:'guided_option'})).note,/Check the itinerary and options/); checks++;
absent(context({}, {viatorEnabled:false}));
absent(context({}, {viatorPartnerId:''}));
absent(context({}, {viatorPartnerId:'P12&email=person@example.test'}));
absent(context({}, {}, {locked:true}));
absent(context({}, {}, {avoid:true}));
absent(context(), {...adventure, availability:{status:'unavailable'}});
absent(context(), {...adventure,id:12345});
absent(context(), {...adventure,country:'AU'});
absent(context(), {...adventure,place:'Different cave'});
absent(context(), {...adventure,title:'A different activity at the same cave'});
assert.equal(good.details,base.match_note); checks++;
absent(context({status:'pending'}));
absent(context({match_type:'search'}));
absent(context({product_code:'other'}));
for (const viator_url of [
 'javascript:alert(1)', 'http://www.viator.com/tours/A/B/d1-3930P3',
 'https://www.viator.com.evil.test/tours/A/B/d1-3930P3',
 'https://user:password@www.viator.com/tours/A/B/d1-3930P3',
 'https://www.viator.com:444/tours/A/B/d1-3930P3',
 'https://www.viator.com/searchResults/all?text=Waitomo',
 base.viator_url+'?account=private', base.viator_url+'#private',
]) absent(context({viator_url}));
const noRegistry = context(); delete noRegistry.VIATOR_BOOKING_LINKS; absent(noRegistry);
const app = fs.readFileSync('app.js','utf8');
assert.match(app,/rel="noopener noreferrer nofollow sponsored"/); checks++;
assert.ok(app.indexOf('${esc(book.label)}') > app.indexOf('data-act="short"'));
assert.ok(app.indexOf('${esc(book.label)}') < app.indexOf('data-act="share"')); checks++;
assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(fs.readFileSync('partners.js','utf8'))); checks++;
console.log(`${checks} booking link boundary and disclosure checks passed`);
