// Anonymised numeric/date patterns from the five supplied October exports.
// No municipal addresses, serial numbers or original workbooks are committed.
const test = require('node:test');
const assert = require('node:assert/strict');
const Parse = require('../src/parse');
const Engine = require('../src/engine');

function dailyExports() {
  const exports = ['2026-10-07 16-17', '2026-10-08 06-27', '2026-10-09 06-15', '2026-10-09 20-15', '2026-10-12 06-34'];
  const specs = [
    { house: '33', values: [13, 15, 106, 110, 131], average: 15 },
    { house: '35', values: [6, 7, 54, 52, 59], average: 6, rank: 2 },
    { house: '36 A', values: [7, 7, 66, 68, 69], average: 6 },
    { house: '37', values: [23, 26, 59, 59, 63], average: 26 },
    { house: '2', street: 'ANNAN PROVVÄG', values: [6, 6, 229, 229, 297], average: 10 },
    { house: '36', values: [6, 6, 6, 6, 46], average: 5, readDates: ['2026-09-24', '2026-09-24', '2026-09-24', '2026-09-24', '2026-10-12'] },
  ];
  const header = ['Mätare av intresse', 'Adress', 'Serienummer', 'Senaste avläsning', 'Senaste värde', 'Genomsnittsvärde', 'Maxvärde', 'Minimiflöde', 'Minimum flödesdatum', 'Infokod', 'Aktiva händelser', 'Stängda händelser', 'Ignorera', 'Följ'];
  return exports.map((stamp, i) => {
    const name = `Filtrerade mätare ${stamp}.xlsx`;
    const rows = specs.map((s, j) => [i === 4 ? s.rank || '' : '', `${s.street || 'PROVVÄGEN'} ${s.house} TUMBA 14732`, `9900020${j}`,
      `${s.readDates?.[i] || `2026-10-${String((s.readDays || [6, 8, 9, 9, 12])[i]).padStart(2, '0')}`} ${i === 3 && !s.readDates ? '16:00' : '02:00'}`, s.values[i], s.average, Math.max(...s.values), '', '', '', '', '', false, false]);
    return { name, ...Parse.parseTable([[], [], [], [], [], header, ...rows], { name }, { now: new Date('2026-10-13T00:00:00') }) };
  });
}

test('Five October Excel snapshots flag the real-shaped rise without counting re-exports as readings', () => {
  const r = Engine.analyzeAll(dailyExports());
  assert.equal(r.meters.length, 6);
  assert.ok(r.meters.every(m => m.category === 'suspect_auto'));
  const group = r.areaSignals.find(a => a.anchorAddress.startsWith('PROVVÄGEN'));
  assert.equal(group.count, 4);
  assert.equal(group.stage, 'early');
  assert.equal(group.shortBaseline, true);
  assert.ok(group.members.every(m => m.beforeReadings === 2 && m.readings === 2));
  assert.equal(r.meters.find(m => m.id === '99000201').excel.interestRank, 2);
  for (const m of r.meters.slice(0, 5)) {
    assert.equal(m.history.readings, 4);
    assert.equal(m.history.conflicts, 0);
    assert.equal(m.excel.minimumFlow, null);
    assert.ok(m.missing.some(n => n.includes('Minimiflöde saknas')));
  }
  assert.deepEqual(r.meters.find(m => m.id === '99000201').series.map(p => p.value), [6, 7, 52, 59], 'Two same-day readings use the daily minimum');
  const sparse = r.meters.find(m => m.id === '99000205');
  assert.equal(sparse.finding.type, 'new_signal');
  assert.equal(sparse.areaSignal, undefined, 'Old September reading cannot prove a shared October onset');
});

test('Reversed imports and importing the same five exports twice preserve all warnings and reference counts', () => {
  const files = dailyExports();
  const summary = r => ({ meters: r.meters.map(m => [m.id, m.category, m.latest.value, m.history.readings, m.summary]), groups: r.areaSignals.map(a => [a.id, a.stage, a.count]) });
  const baseline = summary(Engine.analyzeAll(files));
  assert.deepEqual(summary(Engine.analyzeAll([...files].reverse())), baseline);
  assert.deepEqual(summary(Engine.analyzeAll([...files, ...files])), baseline);
});
