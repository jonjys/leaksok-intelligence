const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const kit = require('./browser-kit.cjs');
const { sparseExports } = require('./fixtures/sparse-history');
const { toCsv } = require('./fixtures/synthetic-exports');
const stamp = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} 04:00`;

(async () => {
  const server = await kit.startServer(4183), browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Stockholm' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await kit.routeExternal(page);
    await page.goto('http://127.0.0.1:4183/'); await kit.unlock(page);
    const files = sparseExports();
    await kit.importFiles(page, files.map(f => ({ name: f.name, text: toCsv([
      ['Serienummer', 'Adress', 'Senaste avläsning', 'Senaste värde', 'Genomsnittsvärde', 'Maxvärde'],
      ...f.rows.map(r => [r.id, r.address, stamp(r.readAt), r.current, r.average, r.max]),
    ]) })));
    await page.waitForFunction(() => state.byId.get('99000999')?.category === 'sparse_history');
    const m = await page.evaluate(() => {
      const m=state.byId.get('99000999');return { readings: m.series.length, median:m.finding.ref.level, confidence:m.confidence, summary:m.summary, exportRows:m.history.exportRows };
    });
    assert.equal(m.readings, 9); assert.equal(m.median, 384); assert.equal(m.exportRows, files.length); assert.equal(m.confidence, 'tunt');
    await page.locator('#rows [data-act="chart"]').first().click();
    await page.locator('#chartDialog [data-period="all"]').click();
    assert.match(await page.locator('#chartDialog .ch-coverage').textContent(), /9 avläsningsdagar.*Kamstrup kan ha fler.*Median 384.*inte mellanliggande avläsningar/);
    assert.equal(await page.locator('#chartDialog .ch-dot').count(), 9);
    const lines = await page.locator('#chartDialog .ch-ref').evaluateAll(nodes => nodes.map(n => +n.getAttribute('x2') - +n.getAttribute('x1')));
    assert.ok(lines.length === 9 && lines.every(width => width <= 4.1));
    await page.locator('#chartDialog .import-trace summary').click();
    assert.equal(await page.locator('#chartDialog .import-trace tbody tr').count(), 9);
    assert.match(await page.locator('#chartDialog .import-trace').textContent(), /306 exportrader.*Appen använder avläsningsdatum/);
    assert.doesNotMatch(await page.locator('#chartDialog').textContent(), /Stabilt hög|Ingen ny förändring|Oförändrad nivå/);
    await page.locator('#chartDialog .import-trace summary').click();
    fs.mkdirSync('test-results', { recursive: true });
    await page.locator('#chartDialog').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: 'test-results/sparse-history-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await page.locator('#chartDialog').evaluate(el => { el.scrollTop = 0; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    assert.equal(await page.locator('#chartDialog .ch-coverage').isVisible(), true);
    await page.screenshot({ path: 'test-results/sparse-history-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Sparse history PASS: 306 daily exports -> 9 actual days, uncertain status, split median, import trace and mobile caption.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
