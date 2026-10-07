const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const kit = require('./browser-kit.cjs');
const { buildDailyExports, toCsv } = require('./fixtures/synthetic-exports.js');

(async () => {
  const files = buildDailyExports({ meters: 61, days: 10, includeScenarios: false });
  files.forEach(f => f.rows.slice(1).forEach((r, i) => { r[1] = `${i < 60 ? 'FALKVÄGEN' : 'ANNANVÄGEN'} ${i + 1} TUMBA 14730`; r[2] = 'TUMBA'; }));
  const server = await kit.startServer(4182);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await kit.routeExternal(page);
    await page.addInitScript(() => {
      const cache = {};
      for (let i = 0; i < 61; i++) cache[`${i < 60 ? 'falkvagen' : 'annanvagen'} ${i + 1}, 14730 tumba, sverige`] = { lat: 59.18 + i * .00002, lng: 17.8 + i * .00002, at: Date.now() };
      localStorage.setItem('leaksok_geocode_v2_exact', JSON.stringify(cache));
    });
    await page.goto('http://127.0.0.1:4182/');
    await page.evaluate(() => {
      const original = L.Map.prototype.setView;
      L.Map.prototype.setView = function (...args) { window.testMap = this; return original.apply(this, args); };
    });
    await kit.unlock(page);
    await kit.importFiles(page, files.map(f => ({ name: f.name, text: toCsv(f.rows) })));
    await page.evaluate(() => { state.excluded.clear(); LeakApp.render(); });
    await page.locator('#rail [data-list="all"]').click();
    await page.locator('button[data-view="map"]').click();
    await page.locator('#search').fill('falkvägen');
    await page.waitForFunction(() => document.querySelector('#mapStatus').textContent.startsWith('60 av 60'));
    const read = () => page.evaluate(() => {
      const dots = []; testMap.eachLayer(l => { if (l instanceof L.CircleMarker) dots.push(l); });
      return { count: dots.length, inView: dots.every(l => testMap.getBounds().contains(l.getLatLng())), colors: [...new Set(dots.map(l => l.options.fillColor))] };
    });
    assert.equal((await read()).count, 60, 'Every street result is shown beyond the first page');
    const id = await page.locator('#rows tr.row').first().getAttribute('data-id');
    await page.locator('#rows tr.row').first().locator('.addr').click();
    await page.waitForFunction(id => state.focusId === id, id);
    await page.locator('#rows tr.row').nth(1).locator('[data-mark]').check();
    await page.waitForFunction(() => document.querySelector('#mapStatus').textContent.startsWith('60 av 60'));
    await page.locator('[data-map-action="results"]').click();
    assert.equal((await read()).count, 60, 'Opening a chart and marking a meter preserves all street markers');
    assert.equal((await read()).inView, true, 'Street markers fit within the map');
    await page.evaluate(() => {
      const ids = state.visible.slice(0, 3).map(m => m.id);
      state.labels[ids[0]] = { type: 'manual_dispatch' };
      state.labels[ids[1]] = { type: 'interesting' };
      state.labels[ids[2]] = { type: 'repaired', repairedDate: '2026-09-29' };
      LeakApp.reanalyze();
    });
    await page.waitForFunction(() => {
      const colors = []; testMap.eachLayer(l => { if (l instanceof L.CircleMarker) colors.push(l.options.fillColor); });
      return ['#c62828', '#2f6fd6', '#2e7d4f'].every(c => colors.includes(c));
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'Phone has no horizontal overflow');
    console.log('Map search PASS: 60 results, persistent markers, warning colors, fitted bounds and mobile width.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
