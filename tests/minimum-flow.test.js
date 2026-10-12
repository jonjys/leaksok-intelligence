const test = require('node:test');
const assert = require('node:assert/strict');
const Parse = require('../src/parse');
const Engine = require('../src/engine');
const FieldExport = require('../src/field-export');

const header = ['Mätare av intresse', 'Adress', 'Serienummer', 'Senaste avläsning', 'Senaste värde', 'Genomsnittsvärde', 'Maxvärde', 'Minimiflöde', 'Minimum flödesdatum', 'Infokod'];
function files(flow, flowDate = '2026-10-12 02:00') {
  return [7, 8, 9, 12].map((d, i) => {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    const row = [1, 'PROVVÄGEN 35 TUMBA 14732', '99000101', `${date} 02:00`, [6, 7, 52, 59][i], 6, 59, i === 3 ? flow : '', i === 3 ? flowDate : '', ''];
    return { name: `export ${date} 06-30.xlsx`, ...Parse.parseTable([header, row], { name: `export ${date} 06-30.xlsx` }, { now: new Date('2026-10-13T00:00:00') }) };
  });
}
const meter = (f, label) => Engine.analyzeAll(f, label || {}).meters[0];

test('Minimum-flow import preserves zero, blanks, dates and old export layouts', () => {
  for (const value of ['', null, 'N/A', -1]) assert.equal(meter(files(value)).excel.minimumFlow, null);
  const zero = meter(files('0'));
  assert.equal(zero.excel.minimumFlow, 0);
  assert.equal(zero.codes.minimumFlowContinuous, false);
  assert.equal(zero.category, 'suspect_auto');
  assert.ok(zero.observations.some(n => /utesluter inte en läcka före/.test(n)));
  const old = Parse.parseTable([['Serienummer', 'Adress', 'Senaste värde'], ['1', 'PROVVÄGEN 1', 10]], { name: '2026-10-12.xlsx' });
  assert.equal(old.rows[0].minimumFlow, undefined);
});

test('Dated current positive minimum flow suggests checking customer-side installations', () => {
  const m = meter(files('12,5'));
  assert.equal(m.excel.minimumFlow, 12.5);
  assert.equal(m.codes.minimumFlowContinuous, true);
  assert.equal(m.category, 'customer_side');
  assert.ok(m.summary.includes('Minimiflöde') || m.summary.includes('minimiflöde'));
  assert.ok(m.action.includes('fastighetsägaren'));
  const workbook = FieldExport.buildWorkbook([m]);
  assert.equal(workbook.sheets[1].rows[0].minimumFlow, 12.5);
});

test('Missing, stale or future flow dates do not suppress an acoustic warning', () => {
  for (const date of ['', '2026-10-01 02:00', '2026-10-13 02:00']) {
    const m = meter(files(12, date));
    assert.equal(m.codes.minimumFlowContinuous, false, date);
    assert.equal(m.category, 'suspect_auto', date);
  }
  const missing = meter(files(''));
  assert.ok(missing.missing.some(n => /Minimiflöde saknas/.test(n)));
  assert.equal(missing.excel.minimumFlow, null);
});

test('Positive minimum flow never overwrites a confirmed manual decision', () => {
  const m = meter(files(12), { '99000101': { type: 'leak', confirmedDate: '2026-10-12' } });
  assert.equal(m.category, 'confirmed');
});
