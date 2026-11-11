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
