const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let request,transaction;
const db={close(){},transaction(){
  transaction={objectStore:()=>({put(){request={};return request;}})};
  return transaction;
}};
const root={indexedDB:{open(){
  const open={};queueMicrotask(()=>{open.result=db;open.onsuccess();});return open;
}}};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/storage'),'utf8'),{window:root,structuredClone,Promise,Error});
(async()=>{
  let complete=false;
  const write=root.LeakStorage.save('test',{labels:{a:{type:'leak'}}}).then(()=>complete=true);
  await new Promise(setImmediate);
  request.onsuccess();
  await Promise.resolve();
  assert.equal(complete,false,'Request success is not transaction success');
  transaction.oncomplete();
  await write;
  assert.equal(complete,true);
  const failed=root.LeakStorage.save('test',{});const rejected=assert.rejects(failed,/avbröts/);
  await new Promise(setImmediate);
  request.onsuccess();transaction.onabort();
  await rejected;
  console.log('storage: transaction completion and abort verified');
})().catch(e=>{console.error(e);process.exitCode=1;});
