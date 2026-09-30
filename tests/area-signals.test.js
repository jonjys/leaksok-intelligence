const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/engine');
const Export = require('../src/field-export');

function filesFor(specs, days = 12) {
  return Array.from({length: days}, (_, i) => ({
    name: `test-${i}.csv`, exportDate: new Date(2026,8,i+1,8),
    rows: specs.map((s,j) => ({id:String(j), serial:String(j), address:s.address || `TESTVÄGEN ${1+j*2} TUMBA 14730`, area:s.area || 'TUMBA',
      readAt: new Date(2026,8,(s.stale ? 1 : i+1),4), current:s.values ? s.values[i] : (i < (s.onset ?? 10) ? (s.base ?? 9) : (s.high ?? 23)),
      infoCode:s.info || '', average:s.average ?? null}))
  }));
}
const specs = (n=3, patch={}) => Array.from({length:n},()=>({...patch}));
const analyze = (s=specs(), options={}) => Engine.analyzeAll(filesFor(s), options.labels || {}, options);

test('area: 9 → 23 across three addresses creates a repeated area signal',()=>{
  const r=analyze();assert.equal(r.areaSignals.length,1);
  const a=r.areaSignals[0];assert.equal(a.count,3);assert.equal(a.buildingCount,3);assert.equal(a.stage,'repeated');
  assert.equal(a.anchorAddress,'TESTVÄGEN 3 TUMBA 14730');assert.equal(a.basis,'address');assert.equal(a.diameterMeters,null);
  assert.ok(a.members.every(m=>Math.abs(m.pct-(23/9-1))<1e-10));
  assert.match(a.action,/Läcksök området runt/);assert.ok(a.notes.some(n=>n.includes('huvudledning')));
  assert.ok(a.notes.some(n=>n.includes('inte fastställda')));
  for(const m of r.meters)assert.equal(m.areaSignal.id,a.id);
});
test('area: small simultaneous rises can be visible before individual signal thresholds',()=>{
  const r=analyze(specs(3,{base:9,high:12,onset:11}));
  assert.equal(r.areaSignals.length,1);assert.equal(r.areaSignals[0].stage,'early');
  assert.ok(r.areaSignals[0].members.every(m=>m.readings===1));
  for(const m of r.meters)assert.notEqual(m.category,'dispatch');
});
test('area: one or two meters, a single building and distant house numbers do not qualify',()=>{
  assert.equal(analyze(specs(2)).areaSignals.length,0);
  assert.equal(analyze(specs(4,{address:'TESTVÄGEN 1 TUMBA 14730'})).areaSignals.length,0);
  assert.equal(analyze([{}, {address:'TESTVÄGEN 101 TUMBA 14730'}, {address:'TESTVÄGEN 201 TUMBA 14730'}]).areaSignals.length,0);
  assert.equal(analyze([{}, {}, {area:'TULLINGE'}]).areaSignals.length,0);
});
test('area: measured distance connects adjacent streets but rejects distant points and co-location',()=>{
  const coordinates=new Map([['0',{lat:59.2,lng:17.8}],['1',{lat:59.2005,lng:17.8}],['2',{lat:59.201,lng:17.8}]]);
  const s=[{}, {address:'ANNANVÄGEN 5 TUMBA 14730'},{}];
  const r=analyze(s,{coordinates});assert.equal(r.areaSignals.length,1);assert.equal(r.areaSignals[0].basis,'position');assert.ok(r.areaSignals[0].diameterMeters<250);
  coordinates.set('2',{lat:59.25,lng:17.8});assert.equal(analyze(specs(),{coordinates}).areaSignals.length,0);
  coordinates.set('2',{lat:59.2,lng:17.8});coordinates.set('1',{lat:59.2,lng:17.8});assert.equal(analyze(specs(),{coordinates}).areaSignals.length,0);
});
test('area: no spatial or time chains, stale readings, returned spikes or thin baselines',()=>{
  assert.equal(analyze([{}, {onset:6}, {onset:10}]).areaSignals.length,0);
  assert.equal(analyze([{}, {}, {stale:true}]).areaSignals.length,0);
  assert.equal(analyze(specs(3,{values:[9,9,9,9,9,9,9,9,9,23,9,9]})).areaSignals.length,0);
  assert.equal(analyze(specs(3,{onset:2})).areaSignals.length,0);
  const files=filesFor(specs()).filter((_,i)=>i<5 || i>=10);
  assert.equal(Engine.analyzeAll(files).areaSignals.length,0,'Gap before rise gives uncertain onset');
  const chain=analyze([1,19,37].map(n=>({address:`TESTVÄGEN ${n} TUMBA 14730`})));
  assert.equal(chain.areaSignals.length,0);
});
test('area: hidden, ignored, repaired, reset and customer-side signals cannot form a group',()=>{
  for(const label of [{hidden:true},{type:'ignored'},{type:'repaired',repairedDate:'2026-09-12'},{type:'reset_baseline',resetAfter:'2026-09-10T23:59:59'}]){
    assert.equal(analyze(specs(),{labels:{'2':label}}).areaSignals.length,0,JSON.stringify(label));
  }
  for(const info of ['LEAK','BURST','DRY'])assert.equal(analyze([{}, {}, {info}]).areaSignals.length,0,info);
});
test('area: individual results and manual decisions stay intact, cache and import order stay stable',()=>{
  const files=filesFor(specs()), prepared=Engine.prepare(files), cache=new Map();
  const labels={'0':{type:'interesting'},'1':{type:'leak',confirmedDate:'2026-09-12'}};
  const first=Engine.analyzePrepared(prepared,labels,{cache}), again=Engine.analyzePrepared(prepared,labels,{cache});
  assert.deepEqual(first,again,'No accumulated notes or mutation of cached base results');
  for(const m of first.meters){
    const base=Engine.analyzeMeter(prepared.histories.get(m.id),{label:labels[m.id],latestExport:prepared.latestExport,exportDays:prepared.exportDays});
    assert.equal(m.category,base.category);assert.equal(m.summary,base.summary);assert.equal(m.action,base.action);
  }
  assert.deepEqual(Engine.analyzeAll([...files].reverse(),labels),Engine.analyzeAll(files,labels));
  assert.deepEqual(Engine.analyzeAll([...files,...files],labels).areaSignals,first.areaSignals);
  assert.equal(Engine.analyzePrepared(prepared,{...labels,'2':{hidden:true}},{cache}).areaSignals.length,0);
});
test('area: two timestamps on one day are only one supporting day',()=>{
  const files=filesFor(specs(3,{onset:11}));
  const extra={...files.at(-1),name:'later.csv',exportDate:new Date(2026,8,12,18),rows:files.at(-1).rows.map(r=>({...r,readAt:new Date(2026,8,12,16)}))};
  const a=Engine.analyzeAll([...files,extra]).areaSignals[0];
  assert.equal(a.stage,'early');assert.ok(a.members.every(m=>m.readings===1));
});
test('area: broad simultaneous changes carry a drift/season caveat, export preserves exact subset',()=>{
  const r=analyze(specs(12));assert.ok(r.areaSignals.length);
  assert.ok(r.areaSignals.every(a=>a.broad && a.notes.some(n=>n.includes('importerade urvalet'))));
  const wb=Export.buildWorkbook([r.meters[0]]);
  assert.equal(wb.sheets[0].rows.length,1);
  assert.equal(wb.sheets[1].rows.length,1);
  assert.equal(wb.sheets[0].rows[0].id,r.meters[0].id);
  assert.match(wb.sheets[0].rows[0].summary,/Områdessignal/);
  assert.match(wb.sheets[0].rows[0].action,/Läcksök området runt/);
  assert.match(wb.sheets[1].rows[0].explanations,/inte fastställda/);
});
