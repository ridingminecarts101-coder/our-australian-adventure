'use strict';
// Group Memories shows only the active group's consented text feedback. The
// device photo library and the signed-in person's private editor stay separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const values = new Map(), elements = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key, { innerHTML: '', dataset: {} });
    return elements.get(key);
  };
  const context = {
    console, setTimeout, clearTimeout, queueMicrotask,
    crypto: require('node:crypto').webcrypto, URL, URLSearchParams,
    location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
    navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 },
    history: { replaceState() {} },
    document: { querySelector: element, querySelectorAll: () => [] },
    localStorage: { getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    addEventListener() {}, Notification: { permission: 'denied' },
    OAA_CONFIG: { revenueCat: {} }, countryName: x => x, countryFlag: () => '',
    CONTINENT_ORDER: ['Oceania'],
  };
  context.window = context;
  context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
  vm.createContext(context);
  for (const file of ['store.js', 'app.js'])
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const run = code => vm.runInContext(code, context);
  const html = () => elements.get('#memList').innerHTML;
  const heading = () => elements.get('#tab-memories h2').textContent;
  run(`userId='alice'; who='Alice'; online=true; progressView='group'; activeGroupId='group-a';
    members=new Map([['alice','Alice'],['bob','Bob'],['charlie','Charlie']]);
    ADV=[
      {id:17,title:'Shared walk',place:'Track',country:'AU',category:'Hiking'},
      {id:18,title:'Unwritten walk',place:'Ridge',country:'AU',category:'Hiking'},
      {id:19,title:'Photo walk',place:'Creek',country:'AU',category:'Hiking'}
    ];
    progress=new Map([
      [17,{adventure_id:17,completed:true,completed_by_id:'bob',completed_at:'2026-10-01T00:00:00Z'}],
      [18,{adventure_id:18,completed:true,completed_by_id:'charlie'}]
    ]);
    personalProgress=new Map([[17,{adventure_id:17,completed:false,rating:5,memory:'Alice private note'}]]);
    groupFeedback=indexGroupFeedback([
      {adventure_id:17,completed_by_id:'bob',rating:4,memory:'Climbed <together> & laughed'},
      {adventure_id:17,completed_by_id:'charlie',rating:3,memory:'Great views'},
      {adventure_id:18,completed_by_id:'bob',rating:5,memory:null}
    ]);
    groupFeedbackScope={ownerId:userId,groupId:activeGroupId};
    hydrateThumbs=()=>{}; photoSrc=()=>'';`);
  return { run, html, heading };
}

const h = harness();
h.run('renderMemories()');
let card = h.html();
assert.equal(h.heading(), 'Group memories');
assert.match(card, /Shared walk/, 'a group completion appears even if the viewer has not completed it');
assert.match(card, /Completed in this group/, 'a merged group tick does not credit only one member');
assert.doesNotMatch(card, /Ticked by Bob/, 'the aggregate is not presented as a single-member tick');
assert.match(card, /Bob.*aria-label="4 stars".*Climbed &lt;together&gt; &amp; laughed/);
assert.match(card, /Charlie.*aria-label="3 stars".*Great views/);
assert.ok(card.indexOf('Bob') < card.indexOf('Charlie'), 'members are listed by name');
assert.doesNotMatch(card, /Alice private note/, 'the private personal note is absent in Group view');
assert.match(card, /Unwritten walk/);
assert.match(card, /aria-label="5 stars"/);
assert.match(card, /No memory written yet/, 'a rating without any written note retains the empty text');
h.run(`members.set('bob','<Bob & team>'); renderMemories()`);
assert.match(h.html(), /&lt;Bob &amp; team&gt;/, 'member names are escaped like their notes');
assert.doesNotMatch(h.html(), /<Bob & team>/);
h.run(`members.set('bob','Bob')`);

h.run(`groupFeedback=indexGroupFeedback([]); renderMemories()`);
assert.match(h.html(), /Shared walk/);
assert.match(h.html(), /No memory written yet/, 'group ticks remain visible without feedback consent');
assert.doesNotMatch(h.html(), /Climbed|Great views|Alice private note/);

h.run(`groupFeedback=indexGroupFeedback([
  {adventure_id:17,completed_by_id:'bob',rating:4,memory:'Group A secret'}
]); groupFeedbackScope={ownerId:'alice',groupId:'group-a'};
activeGroupId='group-b'; renderMemories()`);
assert.doesNotMatch(h.html(), /Group A secret/, 'switching groups never displays the previous feedback');
h.run(`activeGroupId='group-a'; userId='other-account'; renderMemories()`);
assert.doesNotMatch(h.html(), /Group A secret/, 'switching accounts never displays the previous feedback');
h.run(`userId='alice'; online=false; renderMemories()`);
assert.doesNotMatch(h.html(), /Group A secret/, 'cached group feedback is hidden offline');

h.run(`online=true; activeGroupId='group-b';
  progress=new Map([[17,{adventure_id:17,completed:true,completed_by_id:'charlie'}]]);
  groupFeedback=indexGroupFeedback([
    {adventure_id:17,completed_by_id:'charlie',rating:2,memory:'Group B memory'}
  ]);
  groupFeedbackScope={ownerId:'alice',groupId:'group-b'};
  renderMemories()`);
assert.match(h.html(), /Group B memory/);
assert.doesNotMatch(h.html(), /Group A secret/);

h.run(`progressView='personal'; progress=new Map(personalProgress); renderMemories()`);
assert.equal(h.heading(), 'Your memories');
assert.doesNotMatch(h.html(), /Group B memory/, 'personal view never displays another member note');
h.run(`personalProgress.set(17,{adventure_id:17,completed:true,rating:5,memory:'Alice private note'});
  progress=new Map(personalProgress); renderMemories()`);
assert.match(h.html(), /Alice private note/, 'personal view keeps the viewer own memory');

h.run(`progressView='group'; activeGroupId='group-b';
  photos=[
    {id:'completed-photo',adventure_id:17,taken_at:'2026-09-01T00:00:00Z',local:true},
    {id:'photo-only',adventure_id:19,taken_at:'2026-09-02T00:00:00Z',local:true}
  ];
  renderMemories()`);
assert.match(h.html(), /Shared walk/, 'the group-completed adventure remains visible');
assert.doesNotMatch(h.html(), /Photo walk/, 'photo-only adventures stay out of Group Adventure view');
assert.doesNotMatch(h.html(), /on this device|class="strip"|data-photo=/,
  'Group Adventure cards never include photo counts or thumbnails');
h.run(`progressView='personal'; progress=new Map(personalProgress); renderMemories()`);
assert.match(h.html(), /Photo walk/, 'the viewer still sees a photo-only adventure in Personal view');
assert.match(h.html(), /1 on this device/);
assert.match(h.html(), /class="strip"/);
h.run(`progressView='group'; renderMemories()`);
assert.doesNotMatch(h.html(), /class="strip"/);
h.run(`memoryGrouping='month'; renderMemories()`);
assert.equal(h.heading(), 'Your memories');
assert.match(h.html(), /Photos on this device/);
assert.match(h.html(), /data-photo="completed-photo"|data-photo="photo-only"/,
  'device photo groupings remain available alongside Group progress');
assert.doesNotMatch(h.html(), /Group B memory/, 'photo grouping does not imply shared group photos');
h.run(`photos=[]; renderMemories()`);
assert.match(h.html(), /No photos on this device yet/);

console.log('PASS: Group Memories multi-member feedback, empty notes, scope, and device photos');
