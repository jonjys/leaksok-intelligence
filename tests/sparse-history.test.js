const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/engine');
const History = require('../src/history');
const Chart = require('../src/chart');
const FieldExport = require('../src/field-export');
const { sparseExports } = require('./fixtures/sparse-history');
const meter = (files, labels = {}) => Engine.analyzeAll(files, labels).meters[0];

test('Nine sparse reading days from daily exports are uncertain, never year-long stable high', () => {
  const files = sparseExports(), m = meter(files);
  assert.equal(m.latest.value, 394);
  assert.equal(m.latest.ageDays, 5);
  assert.equal(m.finding.ref.level, 384);
  assert.equal(m.history.assessedReadings, 9);
  assert.equal(m.history.exportRows, files.length);
  assert.equal(m.category, 'sparse_history');
  assert.equal(m.confidence, 'tunt');
  assert.ok(m.sampling.all.coverage < .03);
  assert.equal(m.sampling.referenceReliable, false);
  assert.equal(m.finding.delta, null, 'Comparing the same sparse median to itself is not observed zero change');
  assert.equal(m.finding.pct, null);
  assert.match(m.summary, /Hög nivå: median 384 från 9 avläsningsdagar/i);
  assert.match(m.action, /Kamstrup/);
  assert.doesNotMatch([m.summary, ...m.observations, m.action].join(' '), /stabilt hög|ingen ny förändring|mätarens normala variation/i);
  assert.ok(m.dataQuality.some(s => /9 av .* kalenderdagar/.test(s)));
  assert.ok(m.dataQuality.some(s => /Kamstrup.*fler historiska värden/.test(s)));
  assert.deepEqual(meter([...files].reverse()).series, m.series);
  assert.deepEqual(meter([...files, ...files]).series.map(p => [p.date, p.value]), m.series.map(p => [p.date, p.value]));
});

test('Reference medians and reading paths never bridge even one missing calendar day', () => {
  const m = meter(sparseExports()), built = Chart.buildSvg(m, { width: 1600, height: 340 });
  assert.equal(built.points.length, 9);
  assert.equal(built.coverage.readingDays, 9);
  assert.ok(built.coverage.missingDays > 300);
  const path = built.svg.match(/<path d="([^"]*)" class="ch-line"/)[1];
  assert.equal(path.includes('L'), false, 'The nine readings all have missing intervening days');
  const refs = [...built.svg.matchAll(/<line x1="([\d.]+)" x2="([\d.]+)"[^>]*class="ch-ref"/g)];
  assert.equal(refs.length, 9);
  assert.ok(refs.every(r => +r[2] - +r[1] <= 4.1), 'No horizontal annual median line through unknown time');
  assert.match(built.svg, /saknas i importen/);
  assert.match(built.svg, /median 384/);
  assert.doesNotMatch(built.svg, /NaN|Infinity|undefined/);
});

test('Two or three day intervals break both the large chart and sparkline', () => {
  const base = sparseExports()[0];
  const rows = [1, 3, 6].map(day => ({ ...base, exportDate: new Date(2026, 8, day, 6), rows: [{ ...base.rows[0], current: 8, readAt: new Date(2026, 8, day, 4) }] }));
  const m = meter(rows);
  assert.equal(Chart.buildSvg(m).svg.match(/<path d="([^"]*)" class="ch-line"/)[1].includes('L'), false);
  assert.equal(Chart.sparkline(m).match(/<path d="([^"]*)" class="sp-line"/)[1].includes('L'), false);
});

test('Coverage uses unique calendar days including DST and reports no invented readings in an empty period', () => {
  const points = [new Date(2026, 9, 24, 4), new Date(2026, 9, 24, 10), new Date(2026, 9, 26, 4)].map(date => ({ date, value: 7 }));
  const c = History.coverage(points);
  assert.equal(c.readingDays, 2);
  assert.equal(c.expectedDays, 3);
  assert.equal(c.missingDays, 1);
  assert.equal(c.coverage, 2 / 3);
  const m = meter(sparseExports());
  m.excel.exportDate = new Date('2027-02-01T06:30:00');
  const built = Chart.buildSvg(m, { period: '30' });
  assert.equal(built.points.length, 0);
  assert.equal(built.coverage.readingDays, 0);
  assert.doesNotMatch(built.svg, /NaN|Infinity|undefined/);
});

test('Fresh dense readings after old gaps can establish a recent level, not stability since the first old point', () => {
  const files = sparseExports(), last = files.at(-1).rows[0];
  for (let day = 3; day <= 23; day++) files.push({ name: `November ${day}`, exportDate: new Date(2026, 10, day, 6), rows: [{ ...last, readAt: new Date(2026, 10, day, 4), current: 384 }] });
  const m = meter(files);
  assert.equal(m.category, 'stable_high');
  assert.equal(m.sampling.referenceReliable, true);
  assert.match(m.summary, /3 nov–23 nov/);
  assert.doesNotMatch(m.summary, /2025|ingen ny förändring/);
});

test('Sparse baseline never becomes automatic dispatch; an observed rise and manual decisions are retained', () => {
  const identity = sparseExports()[0].rows[0];
  const days = ['2026-07-01', '2026-08-01', '2026-09-01', ...Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)];
  const files = days.map((d, i) => ({ name: d, exportDate: new Date(`${d}T06:30:00`), rows: [{ ...identity, readAt: new Date(`${d}T04:00:00`), current: i < 3 ? 5 : 100, average: null }] }));
  const m = meter(files);
  assert.equal(m.upFinding.type, 'level_shift');
  assert.equal(m.category, 'suspect_auto');
  assert.equal(m.confidence, 'tunt');
  for (const [type, category] of [['leak', 'confirmed'], ['manual_dispatch', 'dispatch'], ['repaired', 'repaired']]) {
    assert.equal(meter(sparseExports(), { '99000999': { type, at: '2026-11-02', repairedDate: '2026-11-02' } }).category, category);
  }
});

test('Excel evidence describes sparse observations without claiming an unchanged level', () => {
  const m = meter(sparseExports());
  const workbook = FieldExport.buildWorkbook([m]);
  const json = JSON.stringify(workbook);
  assert.match(json, /Glest underlag/);
  assert.doesNotMatch(json, /Oförändrad nivå|Ingen ny förändring/);
});

test('A dense baseline does not make two widely separated higher points reliable persistence', () => {
  const identity = sparseExports()[0].rows[0];
  const dates = [...Array.from({ length: 7 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`), '2026-08-01', '2026-10-31'];
  const files = dates.map((day, i) => ({ name: day, exportDate: new Date(`${day}T06:30:00`), rows: [{ ...identity, current: i < 7 ? 5 : 100, average: null, readAt: new Date(`${day}T04:00:00`) }] }));
  const m = meter(files);
  assert.equal(m.upFinding.type, 'level_shift');
  assert.equal(m.sampling.referenceReliable, true);
  assert.equal(m.confidence, 'tunt');
  assert.equal(m.category, 'suspect_auto');
});
