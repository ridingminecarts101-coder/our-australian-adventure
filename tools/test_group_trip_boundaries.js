'use strict';
// Real client functions with disposable in-memory users and deferred responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function deferred() { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; }
function harness() {
  const values=new Map(), elements=new Map();
  const element=key=>{
    if(!elements.has(key)){
      const classes=new Set();
      elements.set(key,{innerHTML:'',textContent:'',value:'',disabled:false,
        classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),
          contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},
        addEventListener(){},setAttribute(){},querySelector:()=>element('nested')});
    }
    return elements.get(key);
  };
  const context={console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,queueMicrotask,
    crypto:require('node:crypto').webcrypto, URL,URLSearchParams,
    location:{hostname:'localhost',origin:'http://localhost',pathname:'/',search:''},
    navigator:{onLine:true,userAgent:'',platform:'',maxTouchPoints:0},history:{replaceState(){}},
    document:{querySelector:element,querySelectorAll:()=>[],createElement:()=>element('new')},
    localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},
    addEventListener(){},confirm:()=>true,prompt:()=>null,Notification:{permission:'denied'},
    fetch:async()=>{throw new Error('Unexpected network');},OAA_CONFIG:{revenueCat:{}},
    CONTINENT_ORDER:['Oceania'],countryName:c=>c,countryFlag:()=>'',};
  context.window=context;
  context.Capacitor={isNativePlatform:()=>false,getPlatform:()=> 'web',Plugins:{}};
  vm.createContext(context);
  for(const file of ['store.js','app.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
  const run=code=>vm.runInContext(code,context);
  run("userId='account-a'; accountUser={id:userId}; authGeneration=1; who='Fixture'; renderAll=()=>{}; renderMe=()=>{}; renderTrips=()=>{}; toast=()=>{};");
  return {context,run,values,elements};
}
async function turns(){await new Promise(r=>setImmediate(r));}
async function groupChecks(){
  for(const operation of ['create','join']){
    const h=harness(), gate=deferred(), calls=[];
    h.context.rpc=async(name,args)=>{calls.push([name,args]);return gate.promise;};
    h.run('sb={rpc};');
    const pending=h.run(operation==='create'?"createGroup('Fixture')":"joinGroup('ABCDEF12')");
    await turns();
    assert.equal(calls.length,1);
    h.run("userId='account-b'; accountUser={id:userId}; authGeneration++; activeGroupId='b-group'; myGroups=[{id:'b-group',share_completions:false}];");
    gate.resolve({data:[{group_id:'a-group',join_code:'ABCDEF12',group_name:'Fixture'}],error:null});
    await pending;
    assert.equal(calls.length,1,'stale response must not start another mutation');
    assert.equal(h.run('activeGroupId'),'b-group');
    assert.equal(h.run('myGroups[0].share_completions'),false);
  }
  {
    const h=harness(), calls=[];
    h.context.confirm=()=>false;
    h.context.rpc=async(name,args)=>{calls.push([name,args]);return {data:[{group_id:'g',group_name:'Fixture'}],error:null};};
    h.run("sb={rpc}; myGroups=[{id:'g',share_completions:true}]; loadGroups=async()=>{}; setProgressView=async()=>{}; pullPhotos=async()=>{}; pullTrips=async()=>{};");
    await h.run("joinGroup('ABCDEF12')");
    assert.equal(calls[1][0],'set_group_completion_sharing');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])),{p_group_id:'g',p_enabled:false});
    assert.equal(h.run('myGroups[0].share_completions'),false);
  }
  {
    const h=harness(), gate=deferred();h.context.rpc=()=>gate.promise;
    h.run("sb={rpc}; myGroups=[{id:'g',share_completions:false}]");
    const pending=h.run("setCompletionSharing('g',true)");
    h.run("userId='account-b'; authGeneration++; myGroups=[{id:'g',share_completions:false}]");
    gate.resolve({error:null});assert.equal(await pending,null);
    assert.equal(h.run('myGroups[0].share_completions'),false);
  }
  {
    const h=harness(), gates=[deferred(),deferred(),deferred()], calls=[];
    h.context.rpc=async(name,args)=>{const gate=gates[calls.length];calls.push([name,args]);return gate.promise;};
    h.run('sb={rpc};');
    const first=h.run("createGroup('First')");
    await turns();
    await h.run("createGroup('Duplicate')");
    assert.equal(calls.length,1,'same-account double submit must issue one lifecycle RPC');

    h.run("userId='account-b'; accountUser={id:userId}; authGeneration++;");
    const replacement=h.run("joinGroup('ABCDEF12')");
    await turns();
    assert.equal(calls.length,2,'a replacement account must not inherit the old busy lock');
    gates[0].resolve({data:null,error:{message:'stale failure'}});
    await first;
    assert.equal(h.run('groupLifecycleBusy.owner'),'account-b','stale cleanup must not release the newer lock');
    gates[1].resolve({data:null,error:{message:'join failure'}});
    await replacement;
    assert.equal(h.run('groupLifecycleBusy'),null,'a failed request must release its lock');

    const retry=h.run("createGroup('Retry')");
    await turns();
    assert.equal(calls.length,3,'a failed lifecycle request must remain retryable');
    gates[2].resolve({data:null,error:{message:'retry failure'}});
    await retry;
    assert.equal(h.run('groupLifecycleBusy'),null);
  }
  console.log('PASS: stale create/join/sharing, private invite consent and lifecycle submission lock');
}
async function tripChecks(){
  {
    const h=harness(), setItem=h.context.localStorage.setItem;
    const outboxKey=h.run('LS.tripOutbox');
    h.run("sb=null; online=false; trips=[{id:'trip-quota',name:'Must remain'}];");
    h.context.localStorage.setItem=(key,value)=>{
      if(key===outboxKey)throw new Error('quota');
      return setItem(key,value);
    };
    h.run("removeTrip('trip-quota')");
    assert.equal(h.run('trips.length'),1,'failed tombstone persistence must keep the trip visible');
    assert.equal(h.run('readLS(LS.tripOutbox,[]).length'),0);
  }
  const h=harness();let remote=[{id:'trip-1',name:'Remote'}], deleteError=true, readGate=null;
  const deleted=[];let mutateBetweenPages=false, pageReads=0;
  h.context.mockSb={from:table=>{
    assert.equal(table,'trips');let operation,filters={};
    const q={select(){operation='read';return q;},delete(){operation='delete';return q;},
      eq(key,value){filters[key]=value;return q;},order(){return q;},
      limit(value){filters.limit=value;return q;},gt(key,value){assert.equal(key,'id');filters.after=value;return q;},
      then(resolve,reject){
        if(operation==='read'){
          assert.equal(filters.user_id,'account-a');
          if(readGate)return readGate.promise.then(resolve,reject);
          const page=remote.filter(t=>filters.after==null||t.id>filters.after)
            .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,filters.limit);
          pageReads++;
          if(mutateBetweenPages&&pageReads===1)remote=remote.filter(t=>t.id!=='remote-0000');
          return Promise.resolve({data:page,error:null}).then(resolve,reject);
        }
        assert.equal(operation,'delete');deleted.push({...filters});
        return Promise.resolve({error:deleteError?{message:'retry'}:null}).then(resolve,reject);
      }};
    return q;
  }};
  h.run("sb=mockSb; online=false; trips=[{id:'trip-1',name:'Saved'}]; saveLocalTrips(); removeTrip('trip-1'); loadLocalTrips();");
  assert.equal(h.run('trips.length'),0);
  assert.equal(h.run('readLS(LS.tripOutbox,[])[0].deleted'),true);
  h.run('online=true');
  await h.run('pullTrips()');assert.equal(h.run('trips.length'),0);
  for(let n=0;n<13;n++)await h.run('flushTrips()');
  assert.equal(h.run('readLS(LS.tripOutbox,[]).length'),1,'failed deletion must retain its tombstone past retry limit');
  assert.deepEqual(deleted[0],{id:'trip-1',user_id:'account-a'});
  readGate=deferred();const stale=h.run('pullTrips()');
  deleteError=false;await h.run('flushTrips()');
  assert.equal(h.run('readLS(LS.tripOutbox,[]).length'),0);
  readGate.resolve({data:remote,error:null});await stale;
  assert.equal(h.run('trips.length'),0,'old pull cannot resurrect a just-acknowledged deletion');
  readGate=null;remote=Array.from({length:1001},(_,n)=>({id:`remote-${String(n).padStart(4,'0')}`,name:'Remote'}));
  h.run("trips=[{id:'removed-on-another-phone',name:'Old'}];");
  await h.run('pullTrips()');
  assert.equal(h.run('trips.length'),1001,'trip refresh must paginate and remove remotely deleted rows');
  assert.equal(h.run("trips.some(t=>t.id==='removed-on-another-phone')"),false);
  mutateBetweenPages=true;pageReads=0;
  await h.run('pullTrips()');
  assert.equal(h.run("trips.some(t=>t.id==='remote-0500')"),true,
    'a deletion before the page boundary must not skip the next surviving id');
  assert.equal(h.run("trips.some(t=>t.id==='remote-1000')"),true);
  mutateBetweenPages=false;pageReads=0;
  await h.run('pullTrips()');
  assert.equal(h.run("trips.some(t=>t.id==='remote-0000')"),false,
    'the next complete pull must remove the row deleted on another device');
  h.run("online=false; upsertTrip({id:'pending',name:'Unsynced'}); online=true;");
  await h.run('pullTrips()');assert.equal(h.run("trips.find(t=>t.id==='pending').name"),'Unsynced');
  console.log('PASS: durable trip deletion, retry, stale pull, keyset pagination and pending edits');
}
function passportChecks(){
  const h=harness();
  h.run(`ADV=[{id:1,country:'AU',continent:'Oceania'},
    {id:2,country:'NZ',continent:'Oceania'},
    {id:3,country:'AU',continent:'Oceania',availability:{status:'unavailable'}},
    {id:4,country:'WS',continent:'Oceania',availability:{status:'unavailable'}}];
    isLocked=()=>false; progressView='group'; personalProgress=new Map([[1,{completed:true,completed_at:'2026-01-01'}]]);
    progress=new Map([[1,{completed:true,completed_at:'2026-01-01'}],[2,{completed:true,completed_at:'2026-01-02'}]]); renderPassport();`);
  assert.match(h.elements.get('#passportTotals').innerHTML,/<b>1<\/b><span>adventures<\/span>/);
  const stamps=[...h.elements.get('#stampGrid').innerHTML.matchAll(/<button class="stamp ([^"]*)"[\s\S]*?<span class="stamp-name">([^<]+)<\/span>[\s\S]*?<\/button>/g)];
  assert(stamps.find(s=>s[2]==='AU')[1].includes('earned'));
  assert(stamps.find(s=>s[2]==='AU')[1].includes('complete'),
    'a paused adventure must not make a country impossible to complete');
  assert(!stamps.find(s=>s[2]==='NZ')[1].includes('earned'));
  assert.match(h.elements.get('#stampGrid').innerHTML,/<span class="stamp-count">1 \/ 1<\/span>/);
  assert.match(h.elements.get('#stampGrid').innerHTML,/<span class="stamp-count">0 \/ 0<\/span>/,
    'a paused-only country retains its blank card');
  assert.match(h.elements.get('#continentProgress').innerHTML,/1 \/ 2/);
  console.log('PASS: personal Passport stamps exclude paused targets and stay personal in Group view');
}
function tripDraftChecks(){
  const h=harness();
  h.run("ADV=[];trips=[{id:'trip-a',name:'Draft trip',adventure_ids:[],starts_on:'2026-10-01',notes:'Saved note'}];openTripId='trip-a';");
  h.context.document.querySelector('#tripNotes').dataset={ownerId:'account-a',tripId:'trip-a'};
  h.context.document.querySelector('#tripNotes').value='Unsaved itinerary note';
  h.context.document.querySelector('#tripStart').value='2026-11-01';
  h.context.document.querySelector('#tripEnd').value='2026-11-03';
  h.run("renderTripSheet('trip-a')");
  const current=h.elements.get('#tripBody').innerHTML;
  assert.match(current,/Unsaved itinerary note/);
  assert.match(current,/id="tripStart" value="2026-11-01"/);
  assert.match(current,/id="tripEnd" value="2026-11-03"/);
  h.run("userId='account-b';renderTripSheet('trip-a')");
  assert.doesNotMatch(h.elements.get('#tripBody').innerHTML,/Unsaved itinerary note/,
    'an unsaved trip draft must not cross account boundaries');
  console.log('PASS: itinerary redraw keeps the owner draft without crossing accounts');
}
(async()=>{await groupChecks();await tripChecks();passportChecks();tripDraftChecks();})().catch(e=>{console.error(e);process.exitCode=1;});
