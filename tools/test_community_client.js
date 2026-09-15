'use strict';
// Execute the real client against disposable identities and delayed local responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };
const turn = () => new Promise(r=>setImmediate(r));
function harness() {
  const values=new Map(), elements=new Map(), calls=[], effects=[];
  const el=key=>{
    if(!elements.has(key)) elements.set(key,{innerHTML:'',textContent:'',value:key==='#recSource'?'':'Valid fixture',checked:key==='#recReviewConsent',
      classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){}});
    return elements.get(key);
  };
  let response=()=>Promise.resolve({data:[],error:null});
  const context={console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,queueMicrotask,
    crypto:require('node:crypto').webcrypto,URL,URLSearchParams,
    location:{hostname:'localhost',origin:'http://localhost',pathname:'/',search:''},
    navigator:{onLine:true,userAgent:'',platform:'',maxTouchPoints:0},history:{replaceState(){}},
    document:{querySelector:el,querySelectorAll:()=>[],createElement:()=>el('new')},
    localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},
    addEventListener(){},confirm:()=>true,prompt:()=> 'Fixture reason',Notification:{permission:'denied'},
    OAA_CONFIG:{revenueCat:{}},CONTINENT_ORDER:[],countryName:c=>c,countryFlag:()=>'',effects,
    from(table){
      const call={table,filters:{}};
      const q={eq(k,v){call.filters[k]=v;return q;},order(){return q;},limit(){return q;},
        then(ok,bad){calls.push(call);return response(call).then(ok,bad);}};
      for(const method of ['select','upsert','insert','update','delete']) q[method]=row=>{call.method=method;call.row=row;return q;};
      return q;
    }};
  context.window=context;
  context.Capacitor={isNativePlatform:()=>false,getPlatform:()=> 'web',Plugins:{}};
  vm.createContext(context);
  for(const file of ['store.js','app.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
  const run=code=>vm.runInContext(code,context);
  run('globalThis.actualPullRecommendations=pullRecommendations;');
  run("userId='owner-a'; accountUser={id:userId}; authGeneration=1; who='Fixture'; sb={from}; online=true; toast=t=>effects.push(t); renderRecs=()=>effects.push('render'); pullRecommendations=async()=>effects.push('pull'); closeRecSheet=()=>effects.push('close'); recs=[{id:'post',created_by:'author',author_name:'<Fixture>',up_votes:0,down_votes:0}];");
  return {run,context,values,elements,calls,effects,response:fn=>response=fn};
}
const operations=["voteRec('post',1)","starRec('post',4)","reportRec('post')",
  "blockAuthor('author')","unblockAuthor('author')","deleteRec('post')","saveRec('post')","saveRec(null)"];
async function main(){
  for(const operation of operations){
    const h=harness(), gate=deferred();h.response(()=>gate.promise);
    const pending=h.run(operation);await turn();assert.equal(h.calls.length,1,operation);
    h.run("userId='owner-b';authGeneration++;myVotes=new Map();recs=[];");
    gate.resolve({data:[],error:null});await pending;
    assert.equal(h.run('myVotes.size'),0,operation+' must not change B votes');
    assert.equal(h.effects.length,0,operation+' must not change B UI');
    assert.equal(h.values.size,0,operation+' must not write B labels');
    const blocked=harness();blocked.run('accountDeletionInProgress=true;');await blocked.run(operation);
    assert.equal(blocked.calls.length,0,operation+' must not dispatch during deletion');
    const beforeDispatch=harness();const early=beforeDispatch.run(operation);
    beforeDispatch.run("userId='owner-b';authGeneration++;");await early;
    assert.equal(beforeDispatch.calls.length,0,operation+' must guard dispatch microtask');
  }
  {
    const h=harness(), gate=deferred();h.response(()=>gate.promise);
    const vote=h.run("voteRec('post',1)");await turn();
    await h.run("starRec('post',5)");assert.equal(h.calls.length,1,'concurrent feedback must not overwrite the other field');
    gate.resolve({error:null});await vote;
    assert.equal(h.run("myVotes.get('post').vote"),1);
    h.response(()=>Promise.resolve({error:null}));await h.run("starRec('post',5)");
    assert.equal(h.calls[1].row.vote,1);assert.equal(h.run("myVotes.get('post').stars"),5);
  }
  {
    const h=harness();h.response(()=>Promise.resolve({error:{message:'offline'}}));
    await h.run("saveRec(null)");assert(!h.effects.includes('close'),'failed post retains form');
    h.response(()=>Promise.resolve({error:null}));await h.run("saveRec(null)");
    assert(h.effects.includes('close'),'failed post permits retry');
  }
  {
    const h=harness();await h.run("blockAuthor('author')");
    assert.equal(JSON.parse(h.values.get('oaa.block-labels.owner-a')).author,'<Fixture>');
    h.run("recSort='blocked';");
    h.response(()=>Promise.resolve({data:[{blocked_id:'author',blocked_at:'2026-09-14T00:00:00Z'}],error:null}));
    await h.run('pullBlockedPeople()');
    assert(h.elements.get('#recList').innerHTML.includes('&lt;Fixture&gt;'));
    assert(h.elements.get('#recList').innerHTML.includes('data-recunblock="author"'));
    h.response(()=>Promise.resolve({error:null}));await h.run("unblockAuthor('author')");
    const deletion=h.calls.find(c=>c.method==='delete');
    assert.deepEqual(deletion.filters,{user_id:'owner-a',blocked_id:'author'});
    assert.equal(JSON.parse(h.values.get('oaa.block-labels.owner-a')).author,undefined);
    h.run("userId='owner-b';authGeneration++;renderBlockedPeople();");
    assert(!h.elements.get('#recList').innerHTML.includes('author'),'A blocked people stay hidden from B');
  }
  {
    const h=harness(),gate=deferred();h.response(()=>gate.promise);h.run("recSort='blocked';");
    const pending=h.run('pullBlockedPeople()');await turn();
    h.run("userId='owner-b';authGeneration++;");
    gate.resolve({data:[{blocked_id:'author',blocked_at:'2026-09-14'}],error:null});await pending;
    assert.equal(h.run('blockedPeopleOwner'),null,'stale block list cannot become B state');
  }
  for(const mode of ['primary','secondary','blocked']){
    const h=harness();
    if(mode==='blocked')h.run("recSort='blocked';");
    h.run("myVotes=new Map([['kept',{vote:1}]]);");
    h.response(call=>call.table==='recommendations'&&mode==='secondary'
      ?Promise.resolve({data:[{id:'post'}],error:null}):Promise.reject(new Error('transport down')));
    await h.run('actualPullRecommendations()');
    assert.equal(h.run('recBusy'),false,mode+' failure clears loading');
    assert(h.run('recError.length>0'),mode+' failure is visible');
    assert.equal(h.run("myVotes.get('kept').vote"),1,'failed refresh preserves known votes');
    h.response(()=>Promise.resolve({data:[],error:null}));await h.run('actualPullRecommendations()');
    assert.equal(h.run('recError'),'','successful retry clears error');
  }
  {
    const h=harness(),gate=deferred();h.response(()=>gate.promise);
    const old=h.run('actualPullRecommendations()');await turn();
    h.response(()=>Promise.resolve({data:[],error:null}));await h.run('actualPullRecommendations()');
    gate.resolve({data:[{id:'obsolete'}],error:null});await old;
    assert.equal(h.run('recs.length'),0,'an older refresh cannot replace newer results');
  }
  for(const fromBlocked of [false,true]){
    const h=harness(),gate=deferred();h.response(()=>gate.promise);
    if(fromBlocked)h.run("recSort='blocked';");
    const pending=h.run('actualPullRecommendations()');await turn();
    h.run("online=false;recSort='top';");await h.run('actualPullRecommendations()');
    assert.equal(h.run('recBusy'),false,'offline navigation clears pending spinner');
    gate.resolve({data:[{id:'late',blocked_id:'late'}],error:null});await pending;
    assert(h.run("recError.includes('Reconnect')"),'late network result cannot erase offline status');
    assert.equal(h.run("recs.some(r=>r.id==='late')"),false);
  }
  {
    const h=harness();
    const pending=h.run(`recCard({id:'pending',created_by:'owner-a',title:'Fixture recommendation',
      place:'Fixture reserve',country:'AU',up_votes:0,down_votes:0,stars_count:0,
      moderation_status:'pending',hidden:true})`);
    assert(pending.includes('Awaiting review. Only you can see it.'));
    assert(!pending.includes('Hidden after reports.'));
    const held=h.run(`recCard({id:'held',created_by:'owner-a',title:'Fixture recommendation',
      place:'Fixture reserve',country:'AU',up_votes:0,down_votes:0,stars_count:0,
      moderation_status:'approved',hidden:true})`);
    assert(held.includes('Hidden after reports or operator review.'));
    h.response(()=>Promise.resolve({error:null}));await h.run('saveRec(null)');
    assert(h.effects.includes('Sent for review. Check Community → Mine for the result.'));
  }
  {
    const h=harness();
    h.context.COUNTRY_NAME={AU:'Australia'};h.context.COUNTRY_FLAG={AU:'AU'};
    h.run('showManagedDialog=()=>{};openRecSheet(null);');
    const form=h.elements.get('#recBody').innerHTML;
    assert(form.includes('id="recReviewConsent" type="checkbox">'),'fresh consent starts unchecked');
    assert(form.includes('OpenAI, Gmail and Resend'),'named review services disclosed before sending');
    assert(form.includes('memory photos never join a submission'));
    assert(!form.includes('type="file"'),'Community has no image or file input');
  }
  {
    const h=harness();
    h.run("$('#recReviewConsent').checked=false;");
    await h.run('saveRec(null)');
    assert.equal(h.calls.length,0,'no consent must send no submission');
    assert(!h.effects.includes('close'),'no consent preserves the form');
    h.run("$('#recReviewConsent').checked=true; $('#recSource').value='javascript:alert(1)';");
    await h.run('saveRec(null)');
    assert.equal(h.calls.length,0,'unsafe source sends no submission');
    h.run("$('#recSource').value='https://www.nationalparks.nsw.gov.au/';");
    await h.run('saveRec(null)');
    const first=h.calls[0].row;
    assert.equal(first.moderation_consent_version,'community-ai-2026-09-15');
    assert.equal(first.source_url,'https://www.nationalparks.nsw.gov.au/');
    assert.match(first.moderation_consent_nonce,/^[a-f0-9-]{36}$/);
    assert(!Object.keys(first).some(k=>/photo|image|email|approved|reason/.test(k)), 'no photo, email or decision fields sent');
    await h.run("saveRec('post')");
    assert.notEqual(h.calls[1].row.moderation_consent_nonce,first.moderation_consent_nonce,'edit requires a fresh consent assertion');
    assert.equal(h.run('recSort'),'mine','author is taken to their review results');
    for(const bad of ['http://example.com','https://u:p@example.com','https://127.0.0.1/','https://10.0.0.1/','https://[::1]/','https://localhost/','https://a.local/','https://a.internal/','https://example.com:9999/','https://example.com:443/','https://a-.com/','https://a.xn--bad-/','data:text/html,bad']) {
      assert.equal(h.context.communitySourceUrl(bad),'',bad+' rejected');
    }
    assert.equal(h.context.communitySourceUrl('https://example.org/path?q=walk'),'https://example.org/path?q=walk');
    assert.equal(h.context.communitySourceUrl('https://xn--e1afmkfd.xn--p1ai/'),'https://xn--e1afmkfd.xn--p1ai/');
    const rejected=h.run(`recCard({id:'rejected',created_by:'owner-a',title:'Fixture recommendation',
      place:'Fixture reserve',country:'AU',up_votes:0,down_votes:0,stars_count:0,
      moderation_status:'rejected',hidden:true,moderation_reason:'Please remove <script>bad</script>',
      source_url:'javascript:alert(1)'})`);
    assert(rejected.includes('Not published.'));
    assert(rejected.includes('&lt;script&gt;bad&lt;/script&gt;'));
    assert(!rejected.includes('javascript:'));
    assert(!rejected.includes('Awaiting review.'));
    assert(rejected.includes('ask the studio to review this decision'));
    const outsider=h.run(`recCard({id:'rejected',created_by:'owner-b',title:'Fixture',place:'Reserve',country:'AU',
      up_votes:0,down_votes:0,stars_count:0,moderation_status:'rejected',hidden:true,moderation_reason:'Private reason'})`);
    assert(!outsider.includes('Private reason'),'private denial reason is author-only even if a stale client row exists');
  }
  for(const [message,expected] of [
    ['Community review limit: try again later (3 per hour)','several requests recently'],
    ['Community review limit: try again later (20 per day)','several requests recently'],
    ['Confirm Community email/AI review before submitting','Reopen the recommendation'],
    ['Confirm Community email/AI review for each edit','Reopen the recommendation'],
  ]) {
    const h=harness();h.response(()=>Promise.resolve({error:{message}}));
    await h.run('saveRec(null)');
    assert(h.effects.some(t=>t.includes(expected)),'database boundary has useful feedback');
    assert(!h.effects.includes('close'),'rejected request keeps form text');
  }
  {
    const h=harness();h.context.confirm=()=>false;
    h.run(`locate=async()=>{effects.push('geolocation');return {lat:0,lon:0}};
      whereAmI=async()=>{effects.push('vendor');return {continent:null}};`);
    await h.run('jumpToHere()');
    assert(!h.effects.includes('geolocation'),'cancel must avoid device location');
    assert(!h.effects.includes('vendor'),'cancel must avoid BigDataCloud request');
    assert.equal(h.elements.get('#hereBtn'),undefined,'cancel must leave UI untouched');
    h.context.confirm=()=>true;
    await h.run('jumpToHere()');
    assert(h.effects.includes('geolocation'),'allow starts location request');
    assert(h.effects.includes('vendor'),'allow reaches vendor lookup');
  }
  console.log('PASS: eight Community mutation boundaries, deletion guard, feedback serialization, retry and owner-scoped block/unblock');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
