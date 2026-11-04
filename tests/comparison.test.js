const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/comparison');
const series = values => values.map((value, i) => ({ date: new Date(2026, 9, i + 1, 6), value }));
test('compares independent periods with daily medians and real coverage', () => {
  const result = C.windows(series([...Array(30).fill(10), 20, 20, 20]));
  assert.equal(result.current.level, 20);
  assert.equal(result.periods[0].reference, 10);
  assert.equal(result.periods[0].percent, 100);
  assert.equal(result.periods[1].reliable, true);
  assert.equal(result.periods[2].reliable, false);
});
test('one spike cannot dominate the current median', () => {
  const result = C.windows(series([...Array(30).fill(10), 10, 10, 100]));
  assert.equal(result.current.level, 10);
  assert.equal(result.periods[0].delta, 0);
});
test('zero baseline never gives an infinite percentage', () => {
  const result = C.windows(series([...Array(30).fill(0), 10, 10, 10]));
  assert.equal(result.periods[0].percent, null);
  assert.equal(result.periods[0].delta, 10);
});
test('reexports, gaps and stale data cannot create reliable comparisons', () => {
  const sparse = series([5, 5, 5, 10, 10, 10]).filter((p, i) => i % 2 === 0);
  assert.equal(C.windows([...sparse, ...sparse]).current.n, 2);
  assert.equal(C.windows(sparse).periods[0].reliable, false);
  const complete = series(Array(40).fill(10));
  assert.equal(C.windows(complete, new Date(2026, 11, 1)).periods[0].reliable, false);
  assert.equal(C.windows([{ date: 'bad', value: 3 }, { date: new Date(), value: null }]), null);
});
test('calendar windows stay correct across daylight saving', () => {
  const result = C.windows(series(Array(30).fill(10)));
  assert.equal(result.periods[0].n, 7);
  assert.equal(result.current.n, 3);
});
test('duplicate exports can be reordered without patching the wrong meter', () => {
  const a = [{ id: 'a', current: 5, readAt: new Date(2026, 9, 1), infoCode: '' }, { id: 'b', current: 10, readAt: new Date(2026, 9, 1), infoCode: '' }];
  const b = [{ ...a[1], infoCode: 'LEAK' }, { ...a[0], interestRank: 1 }];
  assert.equal(C.fingerprint(a), C.fingerprint(b));
  const merged = C.mergeRows(a, b);
  assert.equal(merged[0].id, 'a'); assert.equal(merged[0].interestRank, 1);
  assert.equal(merged[1].infoCode, 'LEAK');
  assert.equal(a[1].infoCode, '');
});
