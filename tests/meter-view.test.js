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
    { id: 'high', upFinding: { persistence: { n: 20, days: 20 }, onset: { at: new Date('2026-11-02') } }, areaSignal: { count: 5, buildingCount: 5 }, confidence: 'starkt', series: [{ value: 8 }, { value: 90 }] },
    { id: 'low', upFinding: { persistence: { n: 1, days: 1 }, onset: { at: new Date('2026-10-01') } }, areaSignal: { count: 2, buildingCount: 2 }, confidence: 'tunt', series: [{ value: 10 }] },
    { id: 'missing' },
  ];
  for (const sort of ['persistence', 'neighbors', 'confidence', 'signalDate', 'maxValue']) {
    assert.deepEqual(order(rows, sort), ['high', 'low', 'missing'], sort);
    assert.deepEqual(order(rows, sort, true), ['low', 'high', 'missing'], sort);
  }
});

test('Signal-day sorting counts observations rather than an unobserved calendar span', () => {
  const rows = [
    { id: 'sparse', upFinding: { persistence: { n: 2, days: 100 } } },
    { id: 'dense', upFinding: { persistence: { n: 5, days: 5 } } },
    { id: 'new', upFinding: { type: 'new_signal', now: { n: 1 } } },
    { id: 'quiet' },
  ];
  assert.deepEqual(order(rows, 'persistence'), ['dense', 'sparse', 'new', 'quiet']);
  assert.deepEqual(order(rows, 'persistence', true), ['new', 'sparse', 'dense', 'quiet']);
});

test('Neighbour sorting counts separate addresses, not repeated meters at the same house', () => {
  const rows = [
    { id: 'duplicate-meters', areaSignal: { count: 10, buildingCount: 2 } },
    { id: 'independent-addresses', areaSignal: { count: 5, buildingCount: 4 } },
    { id: 'no-signal' },
  ];
  assert.deepEqual(order(rows, 'neighbors'), ['independent-addresses', 'duplicate-meters', 'no-signal']);
  assert.deepEqual(order(rows, 'neighbors', true), ['duplicate-meters', 'independent-addresses', 'no-signal']);
});

test('A new one-reading signal has a date, while a trend retains the start of its period', () => {
  const rows = [
    { id: 'older-shift', upFinding: { onset: { at: new Date('2026-10-01') } } },
    { id: 'new-signal', upFinding: { type: 'new_signal', now: { from: new Date('2026-11-02') } } },
    { id: 'trend', upFinding: { type: 'trend', ref: { from: new Date('2026-09-01') }, now: { from: new Date('2026-11-03') } } },
    { id: 'quiet' },
  ];
  assert.deepEqual(order(rows, 'signalDate'), ['new-signal', 'older-shift', 'trend', 'quiet']);
});



test('P sorting uses E/F ratio, preserves negatives, and puts missing values last both ways', () => {
  const rows = [{ id: 'double', excel: { P: 1 } }, { id: 'half', excel: { P: -0.5 } }, { id: 'same', excel: { P: 0 } }, { id: 'zero-reference', excel: { P: null } }];
  assert.deepEqual(order(rows, 'excelP'), ['double', 'same', 'half', 'zero-reference']);
  assert.deepEqual(order(rows, 'excelP', true), ['half', 'same', 'double', 'zero-reference']);
});
