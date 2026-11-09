const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const kit = require('./browser-kit.cjs');
const { buildDailyExports, toCsv } = require('./fixtures/synthetic-exports');
(async () => {
  const server = await kit.startServer(4191), browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Europe/Stockholm' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); await kit.routeExternal(page);
    await page.goto('http://127.0.0.1:4191/'); await kit.unlock(page, 'Comparison', '1234');
    const exports = buildDailyExports({ meters: 80, days: 40 });
    await kit.importFiles(page, exports.map(f => ({ name: f.name, text: toCsv(f.rows) })));
    await page.locator('#rows tr[data-id="90000002"] [data-act="focus"]').click();
    await page.waitForSelector('#meterSummary .comparison-panel');
    assert.equal(await page.locator('#meterSummary .comparison-cell').count(), 3);
    assert.match(await page.locator('#meterSummary').innerText(), /7\/7 dagar · jämförbart/);
    assert.match(await page.locator('#meterSummary').innerText(), /90 dagar/);
    assert.match(await page.locator('#meterSummary .comparison-cell').first().innerText(), /140 %/);
    // A sorted re-export carries updated LEAK metadata but no new observations.
    const last = exports.at(-1), rows = [last.rows[0], ...last.rows.slice(1).map(r => r[0] === '90000002' ? r.map((v, i) => i === 7 ? 'LEAK' : v) : r).reverse()];
    const readings = await page.evaluate(() => state.byId.get('90000002').series.length);
    const xlsx = await page.evaluate(rows => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Mätare');
      return Array.from(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })));
    }, rows);
    await kit.importFiles(page, [{ name: last.name.replace(/\.csv$/, '.xlsx'), buffer: Buffer.from(xlsx), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }]);
    assert.equal(await page.evaluate(() => state.files.length), 40);
    assert.equal(await page.evaluate(() => state.byId.get('90000002').series.length), readings);
    assert.equal(await page.evaluate(() => state.byId.get('90000002').codes.leak), true);
    assert.equal(await page.evaluate(() => state.byId.get('90000001').codes.leak), false);
    // The Excel P formula is calculated from E and F, independently of the history median.
    assert.equal(await page.locator('#sort').inputValue(), 'suspicion');
    await kit.chooseSort(page, 'excelP');
    const exact = [last.rows[0],
      ['p-double', 'FORMELTEST 1 TUMBA 14730', 'TUMBA', '2026-11-05 04:00', 20, 10, 20, '', '', ''],
      ['p-down', 'FORMELTEST 2 TUMBA 14730', 'TUMBA', '2026-11-05 04:00', 5, 10, 5, '', '', ''],
      ['p-zero', 'FORMELTEST 3 TUMBA 14730', 'TUMBA', '2026-11-05 04:00', 20, 0, 20, '', '', '']];
    const bytes = await page.evaluate(rows => {
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Mätare');
      return Array.from(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })));
    }, exact);
    await kit.importFiles(page, [{ name: 'Filtrerade mätare 2026-11-05 06-30.xlsx', buffer: Buffer.from(bytes) }]);
    await page.locator('#search').fill('FORMELTEST');
    await page.waitForFunction(() => state.visible.length === 3);
    assert.deepEqual(await page.evaluate(() => state.visible.map(m => m.id)), ['p-double', 'p-down', 'p-zero']);
    assert.equal(await page.locator('#rows tr[data-id="p-double"] .excel-p strong').innerText(), '+100 %');
    assert.equal(await page.locator('#rows tr[data-id="p-down"] .excel-p strong').innerText(), '−50 %');
    assert.match(await page.locator('#rows tr[data-id="p-zero"] .excel-p').innerText(), /F = 0/);
    await page.locator('#search').fill('');
    await page.evaluate(() => LeakApp.setFocus('90000002', { scroll: false }));
    const card = page.locator('#rows tr.row').first();
    const badge = await card.locator('.c-status .pill').boundingBox();
    const value = await card.locator('.c-latest .val').boundingBox();
    assert.ok(value.y >= badge.y + badge.height - 1, 'Value and status remain on separate readable lines');
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/signal-desk-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: 'test-results/signal-desk-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: comparison coverage, reordered import metadata, unchanged reading count, desktop/mobile');
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
