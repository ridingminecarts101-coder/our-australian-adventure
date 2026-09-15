'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { crypto: require('node:crypto').webcrypto, Blob, console };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('photo-transfer.js', 'utf8'), context);
const apply = context.WayfinderPhotoTransfer.importPhotos;
const photo = (id, content = 'jpeg bytes', adventure = 1) => ({ id, adventure_id: adventure, blob: new Blob([content], {type:'image/jpeg'}) });
function harness(initial = []) {
  const stored = new Map(initial.map(p => [p.id, p])), changes = [];
  const storage = {
    list: async () => [...stored.values()], read: async p => p.blob,
    save: async p => { assert(!stored.has(p.id)); stored.set(p.id, p); changes.push('save:'+p.id); return p; },
    remove: async p => { stored.delete(p.id); changes.push('remove:'+p.id); },
  };
  return {storage, stored, changes};
}
async function main() {
  {
    const h = harness([photo('kept')]);
    const r = await apply([photo('kept'), photo('new')], h.storage, () => true);
    assert.equal(r.imported,1); assert.equal(r.skipped,1);
    assert.deepEqual(h.changes,['save:new']);
    const again = await apply([photo('kept'),photo('new')],h.storage,()=>true);
    assert.equal(again.imported,0); assert.equal(h.stored.size,2);
  }
  for (const conflict of [photo('kept','changed bytes'), photo('kept','jpeg bytes',2)]) {
    const h=harness([photo('kept')]);
    await assert.rejects(apply([photo('new'),conflict],h.storage,()=>true),/conflicts/);
    assert.equal(h.changes.length,0,'preflight detects later collision before any writes');
  }
  {
    const h=harness([photo('original')]), save=h.storage.save;
    h.storage.save=async p=>{if(p.id==='quota')throw Error('Quota');return save(p);};
    await assert.rejects(apply([photo('first'),photo('quota')],h.storage,()=>true),/Quota/);
    assert.deepEqual([...h.stored.keys()],['original']);
    assert.deepEqual(h.changes,['save:first','remove:first']);
  }
  {
    const h=harness();let current=true;
    h.storage.list=async()=>{current=false;return [];};
    await assert.rejects(apply([photo('new')],h.storage,()=>current),/account changed/);
    assert.equal(h.changes.length,0);
  }
  {
    const h=harness(),save=h.storage.save;let current=true;
    h.storage.save=async p=>{const r=await save(p);current=false;return r;};
    await assert.rejects(apply([photo('new')],h.storage,()=>current),/account changed/);
    assert.equal(h.stored.size,0,'late old-owner save rolls back only its new import');
  }
  {
    const h=harness([photo('old')]);let current=true;
    h.storage.read=async p=>{current=false;return p.blob;};
    await assert.rejects(apply([photo('old')],h.storage,()=>current),/account changed/);
    assert.equal(h.changes.length,0);
  }
  {
    const h=harness(),save=h.storage.save;
    h.storage.save=async p=>{if(p.id==='fail')throw Error('Full');return save(p);};
    h.storage.remove=async()=>{throw Error('Busy');};
    await assert.rejects(apply([photo('retained'),photo('fail')],h.storage,()=>true),/1 new photos could not be rolled back/);
    assert(h.stored.has('retained'),'partial cleanup is reported, never a false no-change claim');
  }
  for (const duplicate of [false,true]) {
    const elements=new Map(),el=id=>{
      if(!elements.has(id)) elements.set(id,{value:'',textContent:'',files:[],disabled:false,classList:{toggle(){}}});
      return elements.get(id);
    };
    context.document={querySelector:el};
    let n=0;
    context.WayfinderPhotoBackup={MAX_FILE_BYTES:1024,MAX_PARTS:512,openPart:async()=>{
      n++;return {exportId:'one-set',partIndex:duplicate?1:n,partCount:n===1||duplicate?2:3,photos:[photo('part-'+n)]};
    }};
    const h=harness(),ui=context.WayfinderPhotoTransfer;
    ui.mount({session:()=>({owner:'owner',generation:1,deleting:false}),list:h.storage.list,
      read:h.storage.read,save:h.storage.save,remove:h.storage.remove,refresh:async()=>{},
      show(){},hide(){},toast(){}});
    el('#importPhotosBtn').onclick();
    el('#photoBackupPassword').value='synthetic-password';
    el('#photoBackupFiles').files=[{size:10},{size:10}];
    await el('#photoBackupStart').onclick();
    assert.equal(h.stored.size,1,'invalid later part does not create another photo');
    assert.match(el('#photoBackupStatus').textContent,/1 earlier backup files were imported successfully/);
    assert.match(el('#photoBackupStatus').textContent,/repeat a part or disagree/);
    assert(!el('#photoBackupStatus').textContent.includes('All selected sets are complete'));
    ui.close(true);
  }
  console.log('PASS: photo import deduplication, collision preflight, quota rollback, account switching and truthful partial cleanup');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
