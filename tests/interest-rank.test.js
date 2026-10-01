// Anonymized four-day pattern: export history starts high. No invented baseline.
const test = require('node:test');
const assert = require('node:assert/strict');
const Parse = require('../src/parse');
const Engine = require('../src/engine');
const FieldExport = require('../src/field-export');
const Xlsx = require('../src/xlsx-writer');
const { unzip, cells } = require('./xlsx-inspect.cjs');
const HEADER = ['Mätare av intresse', 'Adress', 'Serienummer', 'Senaste avläsning', 'Senaste värde', 'Genomsnittsvärde', 'Infokod', 'Följ'];
function file(day, value, rank, opts = {}) {
  const date = `2026-${day}`;
  const name = `Prov ${date} ${opts.time || '07-00'}.csv`;
  const row = [rank, 'PROVVÄGEN 1 TUMBA', '99000001', opts.readAt === undefined ? `${date} 04:00` : opts.readAt, value, 244, opts.code || '', ''];
  return { name, ...Parse.parseTable([HEADER, row], { name }, { now: new Date('2026-10-02T12:00:00') }) };
}
const files = (rank = 1) => [file('09-09', '', '' , { readAt: '' }), file('09-11', 226, ''), file('09-14', 218, ''), file('09-30', 234, rank), file('09-30', 241, rank, { time: '13-00', readAt: '2026-09-30 12:00' }), file('10-01', 292, rank)];
const run = (input, labels = {}) => Engine.analyzeAll(input, labels).meters.find(m => m.id === '99000001');

test('Kamstrup ranks are positive integers, distinct from Follow and absent columns', () => {
  for (const rank of [1, '2', 3, 19]) assert.equal(file('10-01', 60, rank).rows[0].interestRank, Number(rank));
  for (const rank of ['', null, undefined, 0, -1, 1.5, true, 'yes', '1st', '1 dB', '99999999999999999']) assert.equal(file('10-01', 60, rank).rows[0].interestRank, null);
  const english = Parse.mapColumns(['Meters of interest ranking', 'Address', 'Latest value']);
  assert.equal(english.interestRank, 0);
  assert.equal(english.serial, -1, 'Interest column is never mistaken for meter serial');
  const without = Parse.parseTable([['Serienummer', 'Adress', 'Senaste värde'], ['1', 'PROVVÄGEN', 60]], { name: '2026-10-01.csv' });
  assert.equal(without.rows[0].interestRank, undefined);
  assert.equal(file('10-01', 60, 2).rows[0].follow, false);
});

test('ranked stable-high meter appears in Misstänk without fabricating rise, score or area evidence', () => {
  const before = run(files(null));
  assert.equal(before.category, 'stable_high');
  for (const rank of [1, 2, 3]) {
    const m = run(files(rank));
    assert.equal(m.category, 'suspect_auto');
    assert.equal(m.excel.interestRank, rank);
    assert.equal(m.kamstrupInterest, true);
    assert.equal(m.finding.type, before.finding.type);
    assert.equal(m.upFinding, null);
    assert.equal(m.priority, before.priority, 'No invented points or probability from external rank');
    assert.equal(m.isNewToday, false, 'Existing recommendation is not a new rise every day');
    assert.ok(!m.areaSignal);
    assert.deepEqual(m.series.map(p => p.value), [226, 218, 234, 292], 'Blanks excluded, minimum used for duplicate day');
    assert.match(m.summary, new RegExp(`Kamstrup läckförslag · rang ${rank}`));
    assert.match(m.action, /Kamstrups läckförslag/);
    const reversed = run(files(rank).reverse());
    assert.equal(reversed.category, m.category);
    assert.deepEqual(reversed.series, m.series);
  }
});

test('latest blank clears old rank; stale, missing, DRY and customer-side readings are not promoted by rank', () => {
  assert.equal(run([...files(), file('10-01', 292, '', { time: '13-00' })]).category, 'stable_high');
  const missingLatestExport = [...files().slice(0, -1), { name: 'Other.csv', exportDate: new Date('2026-10-01T07:00:00'), rows: [] }];
  assert.equal(run(missingLatestExport).kamstrupInterest, false);
  for (const opts of [{ code: 'DRY' }, { readAt: '2026-09-14 04:00' }, { readAt: '' }]) {
    const baseline = run([...files().slice(0, -1), file('10-01', 292, null, opts)]);
    const ranked = run([...files().slice(0, -1), file('10-01', 292, 1, opts)]);
    assert.equal(ranked.kamstrupInterest, false);
    assert.equal(ranked.category, baseline.category);
  }
  const blankValue = run([...files().slice(0, -1), file('10-01', '', 1)]);
  assert.equal(blankValue.kamstrupInterest, false);
  for (const code of ['LEAK', 'BURST']) assert.equal(run([...files().slice(0, -1), file('10-01', 292, 1, { code })]).category, 'customer_side');
});

test('rank never replaces manual decisions or revives observations before reset', () => {
  const cases = { leak: 'confirmed', repaired: 'repaired', manual_dispatch: 'dispatch', watch: 'watch', interesting: 'watch', customer_contact: 'customer_side', ignored: 'ignored', seasonal: 'seasonal', known_noise: 'noise', new_install: 'learning' };
  for (const [type, category] of Object.entries(cases)) {
    assert.equal(run(files(), { '99000001': { type, at: '2026-10-01T08:00:00', repairedDate: '2026-10-01' } }).category, category, type);
  }
  const reset = run(files(), { '99000001': { type: 'reset_baseline', resetAfter: '2026-10-01T08:00:00' } });
  assert.equal(reset.category, 'normal');
  assert.equal(reset.kamstrupInterest, false);
});

test('rank and explanation survive downloadable XLSX as numeric data', async () => {
  const m = run(files(2));
  const bytes = await Xlsx.write(FieldExport.buildWorkbook([m]));
  const parts = unzip(bytes);
  const analysis = cells(parts['xl/worksheets/sheet2.xml']);
  const column = Object.keys(analysis).find(k => /^[A-Z]+1$/.test(k) && analysis[k] === 'Kamstrup intresserang').slice(0, -1);
  assert.equal(analysis[`${column}2`], 2);
  assert.match(parts['xl/worksheets/sheet1.xml'], /Kamstrup läckförslag/);
  assert.match(parts['xl/worksheets/sheet3.xml'], /inte en procentsats/);
});
