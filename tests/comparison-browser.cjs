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
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/signal-desk-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: 'test-results/signal-desk-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: comparison coverage, reordered import metadata, unchanged reading count, desktop/mobile');
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
