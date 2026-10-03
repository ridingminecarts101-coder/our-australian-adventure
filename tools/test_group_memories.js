'use strict';
// Group Memories shows only the active group's consented text feedback. The
// device photo library and the signed-in person's private editor stay separate.
// Older ambiguous personal rows need an owner confirmation before sharing.
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
      {id:19,title:'Photo walk',place:'Creek',country:'AU',category:'Hiking'},
      {id:20,title:'Earlier group walk',place:'Gully',country:'AU',category:'Hiking'}
    ];
    progress=new Map([
      [17,{adventure_id:17,completed:true,completed_by_id:'bob',completed_at:'2026-10-01T00:00:00Z'}],
      [18,{adventure_id:18,completed:true,completed_by_id:'charlie'}],
      [20,{adventure_id:20,completed:true,completed_by_id:'charlie'}]
    ]);
    groupCompletions=indexGroupCompletions([
      {adventure_id:17,completed:true,completed_by_id:'bob',completed_on:'2026-09-20',
        source_is_personal:true,source_user_id:'bob',shared_by_id:'bob'},
      {adventure_id:17,completed:true,completed_by_id:'charlie',completed_on:'2026-10-01',
        source_is_personal:true,source_user_id:'charlie',shared_by_id:'charlie'},
      {adventure_id:18,completed:true,completed_by_id:'bob',
        source_is_personal:true,source_user_id:'bob',shared_by_id:'bob'}
    ]);
    groupLegacyCompletions=indexLegacyGroupCompletions([
      {adventure_id:20,completed:true,completed_by_id:'charlie',
        source_is_personal:false,source_user_id:'bob',shared_by_id:'bob'}
    ]);
    personalProgress=new Map([[17,{adventure_id:17,completed:false,rating:5,memory:'Alice private note'}]]);
    groupFeedback=indexGroupFeedback([
      {adventure_id:17,completed_by_id:'bob',rating:4,memory:'Climbed <together> & laughed'},
      {adventure_id:17,completed_by_id:'charlie',rating:3,memory:'Great views'},
      {adventure_id:18,completed_by_id:'bob',rating:5,memory:null}
    ]);
    groupFeedbackScope={ownerId:userId,groupId:activeGroupId};
    groupFeedbackAvailable=true;
    hydrateThumbs=()=>{}; photoSrc=()=>'';`);
  return { run, html, heading };
}

const h = harness();
h.run('renderMemories()');
let card = h.html();
assert.equal(h.heading(), 'Group memories');
assert.match(card, /Shared walk/, 'a group completion appears even if the viewer has not completed it');
assert.match(card, /Completed in this group/, 'the card represents shared group completion');
assert.match(card, /Bob.*completed 20 Sep 2026.*aria-label="4 stars".*Climbed &lt;together&gt; &amp; laughed/);
assert.match(card, /Charlie.*completed 1 Oct 2026.*aria-label="3 stars".*Great views/);
assert.ok(card.indexOf('Bob') < card.indexOf('Charlie'), 'members are listed by name');
assert.doesNotMatch(card, /Alice private note/, 'the private personal note is absent in Group view');
assert.match(card, /Unwritten walk/);
assert.match(card, /aria-label="5 stars"/);
assert.match(card, /No memory written yet/, 'a rating without any written note retains the empty text');
assert.match(card, /Earlier group walk/);
assert.match(card, /earlier shared completion without verified personal attribution/);
assert.doesNotMatch(card, /Earlier group walk[\s\S]*Charlie.*completed/,
  'a historical group row cannot be credited to a different member');
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
  groupCompletions=indexGroupCompletions([
    {adventure_id:17,completed:true,completed_by_id:'charlie',
      source_is_personal:true,source_user_id:'charlie',shared_by_id:'charlie'}
  ]);
  groupLegacyCompletions=new Map();
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

const edit = harness();
edit.run(`personalCacheReady=true; renderAll=()=>{}; flushOutbox=()=>{}; toast=()=>{};
  applyPatch(17,{memory:'Alice draft in group view'})`);
assert.equal(edit.run('progress.get(17).completed_by_id'), 'bob',
  'a personal note edit must not replace another member\'s shared completion');
assert.equal(edit.run('progress.get(17).completed'), true);
assert.equal(edit.run('personalProgress.get(17).memory'), 'Alice draft in group view');
edit.run('renderMemories()');
assert.match(edit.html(), /Shared walk/, 'the group card survives a private note edit');

const unavailable = harness();
unavailable.run('groupFeedbackAvailable=false; renderMemories()');
assert.match(unavailable.html(), /ratings and memories are temporarily unavailable/);
assert.doesNotMatch(unavailable.html(), /No memory written yet/,
  'a failed feedback refresh must not look like an empty memory');

function confirmationHarness() {
  const h = harness();
  h.run(`progressView='personal'; online=true;
    personalProgress.set(17, {
      id:'legacy-alice-17', adventure_id:17, user_id:'alice', completed:true,
      completed_on:'2026-09-20', rating:5, memory:'Alice older note'
    });
    progress=new Map(personalProgress);
    unconfirmedPersonalProgress=new Set(['legacy-alice-17']);
    unconfirmedPersonalScope='alice';
    rpcCalls=[]; toastMessages=[]; renderedSheetId=null; confirmCalls=0;
    window.confirm=()=>{ confirmCalls++; return true; };
    toast=message=>toastMessages.push(message);
    renderSheet=id=>{ renderedSheetId=id; };
    sb={rpc:async(name,args)=>{
      rpcCalls.push([name,args.p_progress_id]); return {error:null};
    }};`);
  return h;
}

async function testPersonalConfirmation() {
  const ui = confirmationHarness();
  const confirmation = () => ui.run('personalConfirmationHTML(personalProgress.get(17))');
  assert.match(confirmation(), /older entry may count as an unnamed group tick/);
  assert.match(confirmation(), /name, date, rating and note stay private/);
  assert.match(confirmation(), /data-act="confirmPersonal"/);
  assert.doesNotMatch(confirmation(), /data-act="confirmPersonal" disabled/);
  ui.run(`progressView='group'`);
  assert.equal(confirmation(), '', 'Group view never offers personal reconfirmation');
  await ui.run('confirmPersonalProgress(17)');
  assert.equal(ui.run('rpcCalls.length'), 0, 'Group view cannot invoke the confirmation RPC');
  ui.run(`progressView='personal'; online=false`);
  assert.match(confirmation(), /data-act="confirmPersonal" disabled/,
    'the older entry stays explained offline, but its button is disabled');
  await ui.run('confirmPersonalProgress(17)');
  assert.equal(ui.run('rpcCalls.length'), 0, 'offline confirmation cannot call the server');
  ui.run(`online=true; unconfirmedPersonalScope='bob'`);
  assert.equal(confirmation(), '', 'a confirmation list from another account is hidden');
  await ui.run('confirmPersonalProgress(17)');
  assert.equal(ui.run('rpcCalls.length'), 0);
  ui.run(`unconfirmedPersonalScope='alice'; personalProgress.get(17).user_id='bob'`);
  assert.equal(confirmation(), '', 'an unowned row cannot offer an owner confirmation');
  await ui.run('confirmPersonalProgress(17)');
  assert.equal(ui.run('rpcCalls.length'), 0, 'an unowned row cannot invoke the RPC');
  ui.run(`personalProgress.get(17).user_id='alice'; personalProgress.get(17).owner_id='bob'`);
  assert.equal(confirmation(), '', 'conflicting ownership metadata fails closed');
  await ui.run('confirmPersonalProgress(17)');
  assert.equal(ui.run('rpcCalls.length'), 0);
  ui.run(`personalProgress.get(17).owner_id='alice'; personalProgress.get(17).completed=false`);
  assert.equal(confirmation(), '', 'only completed older personal entries need reconfirmation');

  const listing = confirmationHarness();
  listing.run(`clearPersonalConfirmations(); renderAll=()=>{};
    fetchAllPersonalProgress=async(owner)=>{
      queriedOwner=owner;
      return {data:[{id:'legacy-alice-17',adventure_id:17,user_id:'alice',
        completed:true,rating:5,memory:'Alice older note'}],error:null};
    };
    sb.rpc=async(name)=>{
      listedRpc=name; return {data:[{progress_id:'legacy-alice-17'}],error:null};
    }`);
  await listing.run('pullProgress()');
  assert.equal(listing.run('queriedOwner'), 'alice', 'the Personal pull requests this owner only');
  assert.equal(listing.run('listedRpc'), 'list_unconfirmed_personal_progress');
  assert.equal(listing.run('unconfirmedPersonalScope'), 'alice');
  assert.match(listing.run('personalConfirmationHTML(personalProgress.get(17))'),
    /data-act="confirmPersonal"/);
  listing.run(`sb.rpc=async()=>({data:null,error:{message:'cannot list'}})`);
  await listing.run('pullProgress()');
  assert.equal(listing.run('unconfirmedPersonalScope'), null,
    'a failed list refresh cannot keep offering confirmation from stale data');
  assert.equal(listing.run('personalConfirmationHTML(personalProgress.get(17))'), '');

  const success = confirmationHarness();
  success.run('openId=17');
  await success.run('confirmPersonalProgress(17)');
  assert.equal(success.run('confirmCalls'), 1, 'the owner reviews the sharing consequences');
  assert.equal(success.run('JSON.stringify(rpcCalls)'),
    '[["revalidate_personal_progress","legacy-alice-17"]]');
  assert.equal(success.run("unconfirmedPersonalProgress.has('legacy-alice-17')"), false);
  assert.equal(success.run('renderedSheetId'), 17, 'the open sheet loses its confirmation button');
  assert.match(success.run('toastMessages.join(" ")'), /ready for your chosen group sharing/);

  const cancelled = confirmationHarness();
  cancelled.run('window.confirm=()=>false');
  await cancelled.run('confirmPersonalProgress(17)');
  assert.equal(cancelled.run('rpcCalls.length'), 0, 'declining confirmation leaves the row private');
  assert.equal(cancelled.run("unconfirmedPersonalProgress.has('legacy-alice-17')"), true);

  const failed = confirmationHarness();
  failed.run(`sb.rpc=async(name,args)=>{
    rpcCalls.push([name,args.p_progress_id]); return {error:{message:'server refused'}};
  }`);
  await failed.run('confirmPersonalProgress(17)');
  assert.equal(failed.run("unconfirmedPersonalProgress.has('legacy-alice-17')"), true,
    'a failed RPC must leave the confirmation pending');
  assert.match(failed.run('toastMessages.join(" ")'), /Could not confirm/);
  assert.match(failed.run('personalConfirmationHTML(personalProgress.get(17))'), /data-act="confirmPersonal"/);

  const queued = confirmationHarness();
  queued.run(`writeLS(LS.outbox,[{owner_id:'alice',adventure_id:17,queue_rev:'pending'}]);
    flushOutbox=async()=>{ flushCalls=(flushCalls||0)+1; writeLS(LS.outbox,[]); };
    flushCalls=0`);
  await queued.run('confirmPersonalProgress(17)');
  assert.equal(queued.run('flushCalls'), 1, 'queued edits sync before the old row is confirmed');
  assert.equal(queued.run('rpcCalls.length'), 1);

  const stuck = confirmationHarness();
  stuck.run(`writeLS(LS.outbox,[{owner_id:'alice',adventure_id:17,queue_rev:'pending'}]);
    flushOutbox=async()=>{ flushCalls=(flushCalls||0)+1; }; flushCalls=0`);
  await stuck.run('confirmPersonalProgress(17)');
  assert.equal(stuck.run('flushCalls'), 1);
  assert.equal(stuck.run('rpcCalls.length'), 0, 'an unsynced edit cannot be overwritten by confirmation');
  assert.equal(stuck.run("unconfirmedPersonalProgress.has('legacy-alice-17')"), true);
  assert.match(stuck.run('toastMessages.join(" ")'), /Finish syncing this adventure/);

  const switchedDuringFlush = confirmationHarness();
  switchedDuringFlush.run(`writeLS(LS.outbox,[{owner_id:'alice',adventure_id:17,queue_rev:'pending'}]);
    flushOutbox=async()=>{ userId='bob'; authGeneration++; writeLS(LS.outbox,[]); }`);
  await switchedDuringFlush.run('confirmPersonalProgress(17)');
  assert.equal(switchedDuringFlush.run('rpcCalls.length'), 0,
    'an account switch while flushing cancels the confirmation RPC');

  const switchedDuringRpc = confirmationHarness();
  switchedDuringRpc.run(`sb.rpc=(name,args)=>{
    rpcCalls.push([name,args.p_progress_id]);
    return new Promise(resolve=>{ resolveRpc=resolve; });
  }; openId=17`);
  const pending = switchedDuringRpc.run('confirmPersonalProgress(17)');
  switchedDuringRpc.run(`userId='bob'; authGeneration++; resolveRpc({error:null})`);
  await pending;
  assert.equal(switchedDuringRpc.run("unconfirmedPersonalProgress.has('legacy-alice-17')"), true,
    'a response for the former owner cannot change current confirmation state');
  assert.equal(switchedDuringRpc.run('renderedSheetId'), null);
  assert.equal(switchedDuringRpc.run('toastMessages.length'), 0);
}

testPersonalConfirmation().then(() => {
  console.log('PASS: Group Memories and owner-scoped older personal progress confirmation');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
