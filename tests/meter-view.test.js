const test = require('node:test');
const assert = require('node:assert/strict');
const { comparator, mapRevision, statuses } = require('../src/meter-view.js');
const order = (rows, sort, reverse = false) => [...rows].sort(comparator(sort, reverse)).map(m => m.id);

test('House numbers sort naturally in both directions and preserve letter suffixes', () => {
  const rows = ['10', '9C', '9', '9A', '2'].map(id => ({ id, address: `SOLTORPSVÄGEN ${id} TUMBA`, sortRank: 1 }));
  assert.deepEqual(order(rows, 'address'), ['2', '9', '9A', '9C', '10']);
  assert.deepEqual(order(rows, 'address', true), ['10', '9C', '9A', '9', '2']);
});

test('Percent sort and absolute change sort answer different questions; zero reference is not 0%', () => {
  const rows = [
    { id: 'small', changePrev: { pct: 400, delta: 4 } },
    { id: 'large', changePrev: { pct: 40, delta: 40 } },
    { id: 'from-zero', changePrev: { pct: null, delta: 80 } },
    { id: 'missing' },
  ];
  assert.deepEqual(order(rows, 'change'), ['small', 'large', 'from-zero', 'missing']);
  assert.deepEqual(order(rows, 'change', true), ['large', 'small', 'from-zero', 'missing']);
  assert.deepEqual(order(rows, 'changeAbs'), ['from-zero', 'large', 'small', 'missing']);
});

test('Missing values remain last in both directions, including NaN', () => {
  for (const sort of ['value', 'baseline', 'lastRead']) {
    const rows = [
      { id: 'high', latest: { value: 10, date: new Date('2026-11-02') }, finding: { pct: 10 } },
      { id: 'missing' },
      { id: 'invalid', latest: { value: NaN, date: new Date('invalid') }, finding: { pct: NaN } },
      { id: 'low', latest: { value: 0, date: new Date('2026-11-01') }, finding: { pct: 0 } },
    ];
    assert.deepEqual(order(rows, sort).slice(0, 2), ['high', 'low']);
    assert.deepEqual(order(rows, sort, true).slice(0, 2), ['low', 'high']);
  }
});

test('New readings and corrected maximums change the map revision without changing status', () => {
  const meter = { id: 'm', address: 'PROVVÄGEN 1 TUMBA', category: 'suspect_auto', latest: { value: 20, date: new Date('2026-11-01') }, series: [{ value: 20 }] };
  const before = JSON.stringify(mapRevision(meter));
  meter.latest = { value: 21, date: new Date('2026-11-02') };
  assert.notEqual(JSON.stringify(mapRevision(meter)), before);
  const after = JSON.stringify(mapRevision(meter));
  meter.series = [{ value: 30 }];
  assert.notEqual(JSON.stringify(mapRevision(meter)), after);
});

test('Normal and stale pins have neutral colours; warnings, follow-up and repaired remain distinct', () => {
  assert.notEqual(statuses.normal.color, statuses.watch.color);
  assert.notEqual(statuses.normal.color, statuses.stale_contact.color);
  assert.equal(new Set(['dispatch', 'confirmed', 'suspect_auto', 'watch', 'customer_side', 'stable_high', 'repaired'].map(k => statuses[k].color)).size, 7);
});
