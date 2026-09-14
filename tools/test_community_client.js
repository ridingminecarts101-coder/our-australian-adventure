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
    if(!elements.has(key)) elements.set(key,{innerHTML:'',textContent:'',value:'Valid fixture',
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
  console.log('PASS: eight Community mutation boundaries, deletion guard, feedback serialization, retry and owner-scoped block/unblock');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
