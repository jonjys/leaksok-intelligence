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

test('Most suspicious sorts by analysis score independently of manual work order; no reading stays last', () => {
  const rows = [
    { id: 'dispatch', latest: {}, priority: 30, sortRank: 9030 },
    { id: 'signal', latest: {}, priority: 80, sortRank: 5080 },
    { id: 'unread', priority: 99 },
  ];
  assert.deepEqual(order(rows, 'suspicion'), ['signal', 'dispatch', 'unread']);
  assert.deepEqual(order(rows, 'suspicion', true), ['dispatch', 'signal', 'unread']);
  assert.deepEqual(order(rows, 'priority'), ['dispatch', 'signal', 'unread']);
});

test('Kamstrup rank 1 sorts first and missing export ranks stay last in either direction', () => {
  const rows = [1, 3, 0, null].map((rank, i) => ({ id: String(i), excel: { interestRank: rank } }));
  assert.deepEqual(order(rows, 'kamstrup'), ['0', '1', '2', '3']);
  assert.deepEqual(order(rows, 'kamstrup', true), ['1', '0', '2', '3']);
});

test('Signal duration, neighbourhood, evidence strength, onset and historical max have useful ordering', () => {
  const rows = [
    { id: 'high', upFinding: { persistence: { days: 20 }, onset: { at: new Date('2026-11-02') } }, areaSignal: { count: 5 }, confidence: 'starkt', series: [{ value: 8 }, { value: 90 }] },
    { id: 'low', upFinding: { persistence: { days: 1 }, onset: { at: new Date('2026-10-01') } }, areaSignal: { count: 2 }, confidence: 'tunt', series: [{ value: 10 }] },
    { id: 'missing' },
  ];
  for (const sort of ['persistence', 'neighbors', 'confidence', 'signalDate', 'maxValue']) {
    assert.deepEqual(order(rows, sort), ['high', 'low', 'missing'], sort);
    assert.deepEqual(order(rows, sort, true), ['low', 'high', 'missing'], sort);
  }
});
