const test = require('node:test');
const assert = require('node:assert/strict');
const Plan = require('../src/review-plan');

const meter = (i, overrides = {}) => ({ id: String(i), address: `TESTVÄGEN ${i} TUMBA`,
  category: 'suspect_auto', priority: i % 70, latest: { ageDays: 0 }, series: [{}], codes: {},
  field: { state: 'check', blockers: [{ key: 'repeat' }] }, ...overrides });

test('Daily shortlist searches the whole stock, keeps independent locations and reserves customer-side checks', () => {
  const all = Array.from({ length: 3170 }, (_, i) => meter(i, {
    ...(i < 100 ? { address: 'SAMMA ADRESS', areaSignal: { id: 'cluster' }, priority: 100 } : {}),
  }));
  all[3169] = meter(3169, { category: 'dispatch', field: { state: 'ready' } });
  all[3168] = meter(3168, { category: 'customer_side', codes: { burst: true }, field: null });
  all[3167] = meter(3167, { latest: { ageDays: 10 }, priority: 1000 });
  all[3166] = meter(3166, { label: { hidden: true }, priority: 1000 });
  const plan = Plan.shortlist(all);
  assert.equal(plan.examined, 3170); assert.equal(plan.candidates, 3168);
  assert.equal(plan.meters.length, 24);
  assert.equal(plan.meters[0].id, '3169');
  assert.equal(plan.meters.filter(m => m.address === 'SAMMA ADRESS').length, 1);
  assert.ok(plan.meters.some(m => m.id === '3168'));
  assert.ok(plan.meters.every(m => !['3166','3167'].includes(m.id)));
});

test('Selection has no eight-meter ceiling; an empty daily shortlist needs no AI call', () => {
  const marked = Array.from({ length: 14 }, (_, i) => meter(i));
  assert.equal(Plan.shortlist(marked, 'selection').meters.length, 14);
  assert.equal(Plan.shortlist([meter(1, { category: 'stable_high', field: null })]).meters.length, 0);
  assert.equal(Plan.dayKey(new Date('2026-11-09T23:30:00Z')), '2026-11-10');
});

test('Current Kamstrup recommendations retain space alongside local and customer-side checks', () => {
  const local = Array.from({length:200},(_,i)=>meter(i,{priority:90}));
  const recommendations = Array.from({length:11},(_,i)=>meter(300+i,{priority:20,excel:{interestRank:i+1}}));
  const contact = meter(500,{category:'customer_side',field:null,codes:{burst:true}});
  const plan = Plan.shortlist([...local,...recommendations,contact]);
  assert.equal(plan.meters.length,24);assert.equal(plan.vendorSelected,8);
  assert.ok(recommendations.slice(0,8).every(m=>plan.meters.includes(m)));
  assert.ok(recommendations.slice(8).every(m=>!plan.meters.includes(m)));
  assert.ok(plan.meters.includes(contact));assert.ok(plan.meters.some(m=>local.includes(m)));
  const invalid = [
    meter(600,{excel:{interestRank:1},latest:{ageDays:10}}),
    meter(601,{excel:{interestRank:2},codes:{dry:true}}),
    meter(602,{excel:{interestRank:3}}),
  ];
  assert.equal(Plan.shortlist(invalid,'daily',{'602':{hidden:true}}).meters.length,0,'No stale, dry or hidden vendor recommendation is reserved');
  assert.ok(recommendations.every(m=>m.category==='suspect_auto'),'Vendor rank does not confirm a leak or create a field decision');
});

test('Repeated area evidence includes modest rises in the daily plan without changing manual or individual classifications', () => {
  const areaSignal = {id:'a',stage:'repeated',broad:false};
  const quiet = [1,2,3].map(i=>meter(i,{category:'normal',priority:0,field:null,areaSignal}));
  assert.ok(quiet.every(m=>Plan.fieldCheck(m)));
  const other=Array.from({length:60},(_,i)=>meter(i+10));
  const plan=Plan.shortlist([...other,...quiet]);
  assert.deepEqual(plan.meters.slice(0,3).map(m=>m.id),['1','2','3']);
  assert.ok(quiet.every(m=>m.category==='normal'&&m.field===null));
  assert.equal(Plan.fieldCheck({...quiet[0],label:{hidden:true}}),false);
  for(const category of ['confirmed','repaired','ignored','noise','seasonal','customer_side','stale_contact']){
    assert.equal(Plan.fieldCheck({...quiet[0],category}),false,category);
  }
});

test('Five first checks cover independent areas before returning to the same group or address', () => {
  const cluster = Array.from({length:8}, (_, i) => meter(i, {priority:100, areaSignal:{id:'same-area',stage:'repeated'}}));
  const independent = [20,21,22,23].map(i => meter(i, {priority:1}));
  const all = [...cluster, ...independent], original = [...all];
  const preview = Plan.fieldPreview(all);
  assert.equal(preview.length, 5);
  assert.equal(preview.filter(m => m.areaSignal?.id === 'same-area').length, 1);
  assert.ok(independent.every(m => preview.includes(m)));
  assert.deepEqual(all, original, 'Preview does not reorder the workspace');
  assert.equal(Plan.fieldPreview(cluster).length, 5, 'Remaining slots are still useful when only one area exists');
  const sameAddress = [meter(1,{address:'  TESTVÄGEN   1 TUMBA  '}),meter(2,{address:'testvägen 1 tumba'})];
  assert.equal(Plan.fieldPreview([...sameAddress,...independent]).filter(m=>sameAddress.includes(m)).length,1);
});

test('A visibility-only decision is excluded from daily AI even when the analysed label is absent or cached', () => {
  const m = meter(1, {label:null});
  assert.equal(Plan.shortlist([m], 'daily', {'1':{hidden:true}}).meters.length,0);
  assert.equal(Plan.shortlist([{...m,label:{hidden:true}}], 'daily', {'1':{hidden:false}}).meters.length,1);
  assert.equal(Plan.shortlist([m], 'selection', {'1':{hidden:true}}).meters.length,1,'Explicit selection can still be reviewed');
});

test('A saved review identity changes when evidence changes despite the same latest export time', () => {
  const latestExport = new Date('2026-11-09T08:00:00Z');
  const a = meter(1, {series:[{date:new Date('2026-11-08'),value:8},{date:new Date('2026-11-09'),value:14}],excel:{F:8}});
  const key = (meters, context={}) => Plan.contextKey(meters,{latestExport,...context});
  const baseline=key([a]);
  assert.notEqual(key([{...a,series:[{date:new Date('2026-11-08'),value:4},a.series[1]]}]),baseline,'A corrected older reading must not reuse the old plan');
  assert.notEqual(key([{...a,excel:{F:4}}]),baseline,'Updated metadata from the same export matters');
  assert.notEqual(key([a],{labels:{'1':{hidden:true}}}),baseline);
  assert.notEqual(key([a],{labels:{'1':{type:'leak',lineType:'AV',confirmedDate:'2026-11-08'}}}),baseline);
  assert.notEqual(key([a],{coordinatesKey:'new verified coordinates'}),baseline);
  assert.equal(key([a],{labels:{'1':{comment:'New field note'}}}),baseline,'Comments do not change AI evidence');
  const b=meter(2,{series:a.series});
  assert.equal(key([a,b]),key([b,a]),'UI order must not invalidate a saved plan');
  assert.equal(key([a]),key(JSON.parse(JSON.stringify([a]))),'Reloading the same data retains the identity');
});

test('Review identity includes the full AI history before a manual reset, and area support', () => {
  const m=meter(1,{series:[{date:'2026-11-09',value:14}],areaSignal:{id:'g',stage:'repeated',stats:{medianDelta:5},neighborhood:{rising:3,total:5}}});
  const context={latestExport:new Date('2026-11-09'),histories:new Map([['1',{series:[{date:'2026-11-08',value:5},...m.series]}]])};
  const key=Plan.contextKey([m],context);
  assert.notEqual(Plan.contextKey([m],{...context,histories:new Map([['1',{series:[{date:'2026-11-08',value:7},...m.series]}]])}),key);
  assert.notEqual(Plan.contextKey([{...m,areaSignal:{...m.areaSignal,neighborhood:{rising:3,total:20}}}],context),key);
});

test('Worklist batch respects AI order and skips missing, hidden, repaired or untraceable cases', () => {
  const order = Array.from({length:10}, (_, i) => 'm' + i);
  const links = new Map(order.map(id => [id, { id }]));
  const byId = new Map(order.slice(1).map(id => [id, { id, category: id === 'm3' ? 'repaired' : 'normal' }]));
  const cases = order.map(id => ({caseId:id,evidenceIds:id === 'm4' ? [] : [id + ':e1']}));
  assert.deepEqual(Plan.actionable({order,cases}, links, byId, {m2:{hidden:true}}), ['m1','m5','m6','m7','m8']);
});
