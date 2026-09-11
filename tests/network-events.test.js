const assert = require('assert');
const engine = require('../src/network-events.js');

const point = (date, value, exported = date + 'T08:00:00') => ({
  readAt: date + 'T06:00:00', date: exported, current: value,
});
const meter = (id, number, values) => ({
  id, address: `TESTVÄGEN ${number} TULLINGE 14600`, area: 'TULLINGE',
  points: values.map(([date,value,exported]) => point(date,value,exported)),
});

const simultaneous = engine.detect([
  meter('a', 1, [['2026-09-08',7],['2026-09-09',7],['2026-09-10',13]]),
  meter('b', 2, [['2026-09-08',6],['2026-09-09',6],['2026-09-10',10]]),
]);
assert.strictEqual(simultaneous.length, 1);
assert.deepStrictEqual(simultaneous[0].members.map(x => x.id), ['a','b']);

assert.strictEqual(engine.detect([
  meter('a', 1, [['2026-09-08',7],['2026-09-09',7],['2026-09-10',13]]),
  meter('b', 2, [['2026-09-08',6],['2026-09-09',6],['2026-09-10',7]]),
]).length, 0, 'one rising meter is not a network event');

assert.strictEqual(engine.detect([
  meter('a', 1, [['2026-09-08',7],['2026-09-09',7],['2026-09-10',13,'2026-09-10T08:00:00'],['2026-09-10',13,'2026-09-10T12:00:00']]),
  meter('b', 2, [['2026-09-08',6],['2026-09-09',6],['2026-09-10',10]]),
])[0].members.length, 2, 'same reading exported twice counts once');

assert.strictEqual(engine.detect([
  meter('a', 1, [['2026-09-08',7],['2026-09-09',7],['2026-09-10',13],['2026-09-11',7]]),
  meter('b', 2, [['2026-09-08',6],['2026-09-09',6],['2026-09-10',10],['2026-09-11',6]]),
]).length, 0, 'a reverted transient is not an active event');

console.log('network-events: ok');
