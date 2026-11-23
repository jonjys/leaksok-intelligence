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

test('area: screenshot-like simultaneous rise on Broängsvägen warns with daily Excel snapshots', () => {
  // Approximate synthetic values reproduce the shape of the supplied screenshot,
  // not its original measurements or a confirmed leak.
  const cases = [
    { address: 'BROÄNGSVÄGEN 33 TUMBA 14732', base: 15, high: 130 },
    { address: 'BROÄNGSVÄGEN 35 TUMBA 14732', base: 5, high: 45 },
    { address: 'BROÄNGSVÄGEN 36 TUMBA 14732', base: 5, high: 45 },
    { address: 'BROÄNGSVÄGEN 37 TUMBA 14732', base: 25, high: 60 },
    { address: 'BROÄNGSVÄGEN 34 A TUMBA 14732', base: 90, high: 150 },
    { address: 'KÄRRVÄGEN 2 TUMBA 14732', base: 15, high: 290 },
  ];
  for (const days of [5, 31]) {
    const rows = cases.map(c => ({ ...c, values: Array.from({ length: days }, (_, i) => i < days - 1 ? c.base : c.high) }));
    const result = Engine.analyzeAll(filesFor(rows, days));
    assert.ok(result.meters.every(m => m.category === 'suspect_auto'), 'Every sharp rise is flagged even with short own history');
    assert.ok(result.meters.every(m => m.changePrev.delta > 0));
    const group = result.areaSignals.find(a => a.members.some(m => m.address.startsWith('BROÄNGSVÄGEN')));
    assert.ok(group, 'Simultaneous neighbouring rises produce an area warning without GPS');
    assert.equal(group.basis, 'address');
    assert.equal(group.stage, 'early', 'One elevated daily reading is preliminary');
    assert.ok(group.count >= 4);
    assert.ok(result.meters.every(m => m.category !== 'confirmed'), 'Pattern does not confirm a leak');
  }
  const repeated = cases.map(c => ({ ...c, values: [c.base, c.base, c.base, c.high, c.high] }));
  const result = Engine.analyzeAll(filesFor(repeated, 5));
  assert.ok(result.areaSignals.some(a => a.stage === 'repeated'));
});
test('area: small simultaneous rises can be visible before individual signal thresholds',()=>{
  const r=analyze(specs(3,{base:9,high:12,onset:11}));
  assert.equal(r.areaSignals.length,1);assert.equal(r.areaSignals[0].stage,'early');
  assert.ok(r.areaSignals[0].members.every(m=>m.readings===1));
  for(const m of r.meters)assert.notEqual(m.category,'dispatch');
});

test('area: 5–10 level units at quiet meters retain both the small delta and large own-reference percentage', () => {
  const r = analyze([ {base:5,high:10}, {base:8,high:14}, {base:10,high:20} ]);
  const a = r.areaSignals[0];
  assert.equal(a.buildingCount, 3);
  assert.equal(a.stats.medianDelta, 6);
  assert.equal(a.stats.medianPct, 1);
  assert.equal(a.stats.simultaneousDays, 2);
  assert.deepEqual(a.neighborhood, {rising:3,total:3});
  assert.ok(a.notes.some(n => /inte ljudenergi/.test(n)));
});

test('area: a middle dip is tolerated, a returned or unsupported signal is rejected', () => {
  const values = [...Array(7).fill(8),13,14,8,14,14];
  const r = analyze(specs(3,{values}));
  assert.equal(r.areaSignals.length, 1);
  assert.equal(r.areaSignals[0].stage, 'repeated');
  assert.equal(r.areaSignals[0].stats.simultaneousDays, 4);
  assert.equal(r.areaSignals[0].stats.support, 0.8);
  assert.ok(r.areaSignals[0].members.every(m => m.readings === 4 && m.observedReadings === 5));
  for (const tail of [[13,8,8,14,14],[13,14,14,14,8],[13,14,14,8,14]]) {
    assert.equal(analyze(specs(3,{values:[...Array(7).fill(8),...tail]})).areaSignals.length, 0, JSON.stringify(tail));
  }
});

test('area: modest repeated changes can form a group while individual categories remain normal', () => {
  const r = analyze(specs(3,{values:[...Array(9).fill(35),40,40,40]}));
  const a = r.areaSignals[0];
  assert.ok(a?.subtle); assert.equal(a.stage, 'repeated');
  assert.equal(a.stats.medianDelta,5); assert.ok(Math.abs(a.stats.medianPct - 5/35) < 1e-10);
  assert.ok(r.meters.every(m=>m.category==='normal'));
  assert.equal(analyze(specs(3,{values:[...Array(10).fill(35),40,40]})).areaSignals.length,0, 'Two days do not establish the weaker relative increase');
  assert.equal(analyze(specs(3,{values:[...Array(9).fill(100),105,105,105]})).areaSignals.length,0, 'A tiny relative change is insufficient');
});

test('area: a newer neighbouring spike cannot erase an already repeated modest group', () => {
  const steady = specs(3,{values:[...Array(9).fill(35),40,40,40]});
  const latest = {address:'TESTVÄGEN 0 TUMBA 14730',values:[...Array(11).fill(8),14]};
  const r = analyze([...steady,latest]);
  const a = r.areaSignals.find(a=>a.subtle);
  assert.equal(a.buildingCount,3);assert.equal(a.stats.simultaneousDays,3);
  assert.ok(!a.members.some(m=>m.address===latest.address));
});

test('area: nearby stable addresses are counted without inventing more rising addresses', () => {
  const r = analyze([...specs(3,{base:8,high:14}), ...specs(2,{base:8,high:8})]);
  assert.deepEqual(r.areaSignals[0].neighborhood,{rising:3,total:5});
  const coordinates = new Map(Array.from({length:5},(_,i)=>[String(i),{lat:59.2+i*.0002,lng:17.8}]));
  const located = analyze([...specs(3,{base:8,high:14}), ...specs(2,{base:8,high:8})],{coordinates});
  assert.equal(located.areaSignals[0].basis,'position');
  assert.deepEqual(located.areaSignals[0].neighborhood,{rising:3,total:5});
});

test('area: variation is estimated before the event, not inflated by later event fluctuations', () => {
  const values = [8,8,8,8,8,8,8,13,17,13,17,13];
  const r = analyze(specs(3,{values}));
  assert.equal(r.areaSignals.length,1); assert.equal(r.areaSignals[0].members[0].baseline,8);
  const noisy = [5,35,5,35,5,35,5,40,40,40,40,40];
  assert.equal(analyze(specs(3,{values:noisy})).areaSignals.length,0, 'A noisy reference must not become a small-change signal');
});

test('area: zero references remain finite and independent buildings determine support', () => {
  const r = analyze(specs(3,{base:0,high:5}));
  assert.equal(r.areaSignals[0].stats.medianPct,null);
  assert.equal(r.areaSignals[0].stats.medianDelta,5);
  assert.doesNotMatch(JSON.stringify(r.areaSignals), /Infinity|NaN/);
  const duplicated = [1,1,3,3].map(n=>({address:`TESTVÄGEN ${n} TUMBA 14730`,base:8,high:14}));
  assert.equal(analyze(duplicated).areaSignals.length,0);
});

test('area: two baseline days allow only a stronger, explicitly preliminary neighbourhood warning', () => {
  const strong = specs(3, { values: [6, 7, 52, 59] });
  const r = Engine.analyzeAll(filesFor(strong, 4));
  assert.equal(r.areaSignals.length, 1);
  assert.equal(r.areaSignals[0].stage, 'early');
  assert.equal(r.areaSignals[0].shortBaseline, true);
  assert.ok(r.areaSignals[0].notes.some(n => /två tidigare/.test(n)));
  assert.equal(Engine.analyzeAll(filesFor(specs(3, { values: [9, 9, 12, 12] }), 4)).areaSignals.length, 0, 'Weak change with two reference days is not promoted');
  assert.equal(Engine.analyzeAll(filesFor(specs(3, { values: [6, 25, 52, 59] }), 4)).areaSignals.length, 0, 'Unstable two-day reference is not enough');
  assert.equal(Engine.analyzeAll(filesFor(specs(3, { values: [6, 52] }), 2)).areaSignals.length, 0, 'One baseline day is not enough');
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
  assert.equal(analyze(specs(3,{onset:1})).areaSignals.length,0);
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
  assert.match(wb.sheets[0].rows[0].action,/Kontrollera först gemensam drift/);
  assert.match(wb.sheets[1].rows[0].explanations,/inte fastställda/);
});


test('A sustained modest increase warrants field inspection only with independent spatial support', () => {
  const files = filesFor(specs(3, {base:20, high:30, onset:24}), 32);
  const coordinates = new Map([0,1,2].map(j => [String(j), {lat:59.2+j*.0002,lng:17.8}]));
  const run = (data, positions) => Engine.analyzeAll(data, {}, {coordinates:positions});
  const local = run(files);
  assert.ok(local.meters.every(m => m.category === 'suspect_auto' && m.field.blockers.some(b => b.key === 'size')));
  assert.ok(run(files, coordinates).meters.every(m => m.category === 'dispatch'));
  assert.ok(run(files.slice(0, 26), coordinates).meters.every(m => m.category !== 'dispatch'));
  const sameBuilding = new Map([0,1,2].map(j => [String(j),{lat:59.2,lng:17.8}]));
  assert.ok(run(files, sameBuilding).meters.every(m => m.category !== 'dispatch'));
});
