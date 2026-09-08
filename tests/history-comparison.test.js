const assert = require('node:assert/strict');
const { compare } = require('../src/history-comparison.js');
const rows = [
  {date:'2025-09-08',current:4},
  {date:'2026-08-08',current:5},
  {date:'2026-09-01',current:8},
  {date:'2026-09-07',current:9},
  {date:'2026-09-08',current:10},
];
assert.equal(compare(rows).reference.value,9);
assert.equal(compare(rows,'7').percent,25);
assert.equal(compare(rows,'30').percent,100);
assert.equal(compare(rows,'365').percent,150);
assert.equal(compare(rows,'90').reference,null); // No invented/interpolated history.
assert.equal(compare([...rows].reverse(),'7').percent,25);
assert.equal(compare([{date:'2026-09-07',current:0},rows.at(-1)]).percent,null);
assert.equal(compare([rows.at(-1)]).reference,null);
assert.equal(compare([...rows,{date:'2026-09-09',current:null}]).latest.value,10);
assert.equal(compare([{date:'bad',current:99}]).latest,null);
// Export date must not move the actual comparison date forward.
assert.equal(compare(rows.map(p=>({...p,readingDate:p.date,date:'2026-09-10'})),'7').percent,25);
console.log('history comparison tests: ok');
