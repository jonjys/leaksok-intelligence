const assert = require('node:assert/strict');
const fs = require('node:fs');
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
    await page.waitForFunction(() => {
      const selected = state.byId.get(state.focusId);
      const pos = LeakMap.cachedPosition(selected);
      return pos && testMap.getZoom() === 17 && testMap.getCenter().distanceTo([pos.lat, pos.lng]) < 2;
    });
    assert.equal(await page.locator('.map-meter-tip b').textContent(), await page.evaluate(() => state.byId.get(state.focusId).address.replace(/\s+\d{3}\s?\d{2}$/, '')), 'Selected meter stays labeled on the map');
    await page.locator('[data-map-action="results"]').click();
    await page.waitForFunction(() => {
      const dots = []; testMap.eachLayer(l => { if (l instanceof L.CircleMarker) dots.push(l); });
      return dots.every(l => testMap.getBounds().contains(l.getLatLng()));
    });
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
    const marked = await page.evaluate(() => [...state.marked]);
    await page.locator('button[data-view="list"]').click();
    assert.equal(await page.locator('#focus').isVisible(), false, 'List mode hides both map and focus chart');
    await page.locator('#rows tr.row').first().locator('.addr').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#focus').isVisible(), true, 'Address click opens map from list view');
    assert.equal(await page.locator('#focusChart').isVisible(), true, 'Address click shows its compact graph');
    assert.equal(await page.locator('#chartDialog').isVisible(), false, 'Map and graph stay together in the workspace');
    assert.deepEqual(await page.evaluate(() => [...state.marked]), marked, 'Switching views keeps marked meters');
    await page.locator('button[data-view="list"]').click();
    await page.locator('thead [data-sort="value"]').click();
    let values = await page.evaluate(() => state.visible.map(m => m.latest?.value).filter(v => v != null));
    assert.deepEqual(values, [...values].sort((a, b) => b - a), 'Level header sorts highest first');
    await page.locator('thead [data-sort="value"]').click();
    values = await page.evaluate(() => state.visible.map(m => m.latest?.value).filter(v => v != null));
    assert.deepEqual(values, [...values].sort((a, b) => a - b), 'Second click sorts lowest first');
    await page.locator('button[data-view="map"]').click();
    assert.equal(await page.locator('#focus').isVisible(), true, 'Map mode restores the map and selected chart');
    await page.locator('#selectionBar .selection-menu summary').click();
    const menu = await page.locator('#selectionBar .menu-panel').boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= 1366, 'Selection menu fits within the viewport');
    await page.locator('#selectionBar .selection-menu summary').click();
    assert.equal(await page.locator('#selectionBar [data-sort="value"]').isVisible(), true, 'Map list keeps sorting controls');
    // With no chosen meter, a named list opens the map and fits its results.
    await page.locator('#search').fill('');
    await page.evaluate(() => {
      state.meters.forEach((m, i) => { m.category = i < 60 ? 'suspect_auto' : 'normal'; });
      LeakApp.render();
    });
    await page.locator('button[data-view="list"]').click();
    await page.evaluate(() => LeakApp.setFocus(''));
    await page.locator('#rail [data-list="suspect"]').click();
    await page.waitForFunction(() => state.view === 'map' && !state.focusId && document.querySelector('#mapStatus').textContent.startsWith('60 av 60'));
    // The previous map also had 60 markers: wait for the new list's bounds,
    // rather than mistaking its old status text for a completed map update.
    await page.waitForFunction(() => {
      const dots = []; testMap.eachLayer(l => { if (l instanceof L.CircleMarker) dots.push(l); });
      return dots.length === 60 && dots.every(l => testMap.getBounds().contains(l.getLatLng()));
    }).catch(async error => {
      console.log('Misstänk map diagnostics', await page.evaluate(() => {
        const dots = []; testMap.eachLayer(l => { if (l instanceof L.CircleMarker) dots.push(l); });
        return { count: dots.length, outside: dots.filter(l => !testMap.getBounds().contains(l.getLatLng())).map(l => l.getLatLng()), bounds: testMap.getBounds(), center: testMap.getCenter(), size: testMap.getSize(), focus: state.focusId, list: state.list, visible: state.visible.map(m => m.id), status: document.querySelector('#mapStatus').textContent };
      }));
      throw error;
    });
    assert.equal((await read()).count, 60, 'Misstänk shows exactly the selected list, beyond pagination');
    assert.equal((await read()).inView, true, 'Choosing Misstänk fits every list marker');
    await page.locator('#rows tr.row').first().locator('.addr').click();
    await page.waitForFunction(() => state.focusId && testMap.getZoom() === 17);
    assert.equal(await page.locator('#focusChart').isVisible(), true);
    await page.locator('[data-chart-action="close"]').click();
    await page.locator('#rows tr.row.is-focus .addr').click();
    await page.waitForFunction(() => !state.chartHidden);
    assert.equal(await page.locator('#focusChart').isVisible(), true, 'Clicking the same address restores its graph');
    assert.equal((await read()).count, 60, 'Focused marker keeps every list pin');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'Phone has no horizontal overflow');
    // Previously failing Excel addresses must work without a preloaded cache.
    const fresh = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await kit.routeExternal(fresh);
    await fresh.route('https://nominatim.openstreetmap.org/**', route => {
      const params = new URL(route.request().url()).searchParams;
      const query = params.get('q') || params.get('street');
      const hit = (road, house, lat) => ({ lat: String(lat), lon: '17.8', address: { road, ...(house ? { house_number: house } : {}) } });
      const replies = {
        'Broängsvägen 34A': [hit('Broängsvägen', '34A', 59.19)],
        'Alhagsvägen 58-60': [hit('Alhagsvägen', '58-60', 59.24)],
        'Broängsvägen 36': [hit('Broängsvägen', '36', 59.20)],
      };
      return route.fulfill({ json: replies[query] || [] });
    });
    await fresh.goto('http://127.0.0.1:4182/');
    await fresh.evaluate(() => {
      const original = L.Map.prototype.flyTo;
      L.Map.prototype.flyTo = function (...args) { window.testMap = this; return original.apply(this, args); };
    });
    await kit.unlock(fresh);
    const addressFiles = buildDailyExports({ meters: 3, days: 5, includeScenarios: false });
    const addresses = ['Broängsvägen 34 A TUMBA 14732', 'Alhagsvägen 58 -60 NORSBORG 14559', 'Broängsvägen 36 TUMBA 14732'];
    addressFiles.forEach(f => f.rows.slice(1).forEach((r, i) => { r[1] = addresses[i]; }));
    await kit.importFiles(fresh, addressFiles.map(f => ({ name: f.name, text: toCsv(f.rows) })));
    for (const [index, lat] of [[0, 59.19], [1, 59.24], [2, 59.20]]) {
      await fresh.locator('#search').fill(addresses[index]);
      await fresh.waitForFunction(() => state.visible.length === 1);
      await fresh.locator('#rows tr.row .addr').click();
      await fresh.waitForFunction(lat => window.testMap && testMap.getZoom() === 17 && testMap.getCenter().distanceTo([lat, 17.8]) < 2, lat);
      assert.equal(await fresh.locator('.map-meter-tip b').count(), 1);
      const approximate = await fresh.evaluate(() => LeakMap.cachedPosition(state.byId.get(state.focusId)).approximate === true);
      assert.equal(approximate, false);
      assert.equal(await fresh.evaluate(() => LeakMap.coordinates([state.byId.get(state.focusId)]).size), 1);
    }
    // Mark a whole street, narrow the list, switch category, and focus one
    // address. Every retained marked pin must remain visible in the viewport.
    await fresh.locator('#search').fill('Broängsvägen');
    await fresh.waitForFunction(() => state.visible.length === 2);
    await fresh.locator('#selectionBar .selection-menu summary').click();
    await fresh.locator('#selectionBar [data-sel="all"]').click();
    await fresh.waitForFunction(() => state.marked.size === 2);
    assert.equal(await fresh.locator('#rows [data-mark]:checked').count(), 2, 'Mark all updates the actual row checkboxes too');
    const markedFocus = await fresh.evaluate(() => state.focusId);
    const markedStreet = await fresh.evaluate(() => [...state.marked]);
    await fresh.locator('#rail [data-list="suspect"]').click();
    assert.equal(await fresh.evaluate(() => state.focusId), markedFocus, 'Changing tabs retains the marked chosen meter');
    await fresh.evaluate(id => LeakApp.setFocus(id), markedStreet[0]);
    await fresh.waitForFunction(() => {
      const pos = LeakMap.cachedPosition(state.byId.get(state.focusId));
      return pos && testMap.getCenter().distanceTo([pos.lat, pos.lng]) < 2 && [...state.marked].every(id => {
        const p = LeakMap.cachedPosition(state.byId.get(id)); return p && testMap.getBounds().contains([p.lat, p.lng]);
      });
    });
    const countPins = () => fresh.evaluate(() => { let n = 0; testMap.eachLayer(layer => { if (layer instanceof L.CircleMarker) n++; }); return n; });
    assert.equal(await countPins(), 2, 'Marked addresses survive an empty category tab');
    await fresh.locator('#search').fill('Alhagsvägen');
    await fresh.locator('#rail [data-list="all"]').click();
    await fresh.waitForFunction(() => state.visible.length === 1);
    await fresh.locator('#rows tr.row .addr').click();
    await fresh.waitForFunction(() => {
      const pos = LeakMap.cachedPosition(state.byId.get(state.focusId));
      return pos?.lat === 59.24 && testMap.getCenter().distanceTo([pos.lat, pos.lng]) < 2 && [...state.marked].every(id => {
        const p = LeakMap.cachedPosition(state.byId.get(id)); return p && testMap.getBounds().contains([p.lat, p.lng]);
      });
    });
    assert.equal(await countPins(), 3, 'Focus from another filter keeps all marked street pins');
    await fresh.locator('[data-map-action="results"]').click();
    await fresh.waitForFunction(() => {
      const dots = []; testMap.eachLayer(layer => { if (layer instanceof L.CircleMarker) dots.push(layer); });
      return dots.length === 3 && dots.every(layer => testMap.getBounds().contains(layer.getLatLng()));
    });
    await fresh.evaluate(ids => { LeakApp.worklist.add(ids); state.marked.clear(); LeakApp.render(); }, markedStreet);
    await fresh.locator('#openWorklist').click();
    await fresh.locator('#worklistDialog [data-pick]').first().check();
    await fresh.locator('#worklistDialog [data-pick]').nth(1).check();
    const worklistId = await fresh.locator('#worklistDialog tr[data-id]').first().getAttribute('data-id');
    await fresh.locator('#worklistDialog [data-act="focus"]').first().click();
    await fresh.waitForFunction(id => !document.querySelector('#worklistDialog').open && state.focusId === id, worklistId);
    assert.match(await fresh.locator('#selectionBar p b').textContent(), /2 markerade/, 'Worklist navigation updates the global selection count');
    await fresh.waitForFunction(() => {
      const pos = LeakMap.cachedPosition(state.byId.get(state.focusId));
      return pos && testMap.getCenter().distanceTo([pos.lat, pos.lng]) < 2 && [...state.marked].every(id => {
        const p = LeakMap.cachedPosition(state.byId.get(id)); return p && testMap.getBounds().contains([p.lat, p.lng]);
      });
    });
    // The same address pin receives new values even when its status is unchanged.
    await fresh.evaluate(id => LeakApp.applyDecision([id], 'interesting'), worklistId);
    await fresh.waitForFunction(id => document.querySelector(`#map .map-pin[data-meter-id="${id}"]`)?.getAttribute('fill') === LeakMeterView.statuses.watch.color, worklistId);
    const beforeUpdate = await fresh.evaluate(id => {
      let pin; testMap.eachLayer(l => { if (l instanceof L.CircleMarker && l.getElement()?.dataset.meterId === id) pin = l; });
      return { pinId: pin._leaflet_id, value: state.byId.get(id).latest.value, category: state.byId.get(id).category };
    }, worklistId);
    const extra = JSON.parse(JSON.stringify(addressFiles.at(-1)));
    extra.rows.slice(1).forEach(r => { r[3] = '2026-09-30 04:00'; r[4] = Number(r[4]) + 1; });
    await kit.importFiles(fresh, [{ name: 'Filtrerade mätare 2026-09-30 06-30.csv', text: toCsv(extra.rows) }]);
    await fresh.waitForFunction(({ id, value }) => state.byId.get(id).latest.value === value + 1 && document.querySelector('.map-meter-tip dd')?.textContent === String(value + 1), { id: worklistId, value: beforeUpdate.value });
    const afterUpdate = await fresh.evaluate(id => {
      let pin; testMap.eachLayer(l => { if (l instanceof L.CircleMarker && l.getElement()?.dataset.meterId === id) pin = l; });
      return { pinId: pin._leaflet_id, category: state.byId.get(id).category, marked: pin.getElement().classList.contains('is-marked') };
    }, worklistId);
    assert.equal(afterUpdate.pinId, beforeUpdate.pinId, 'Daily imports update an existing pin instead of replacing it');
    assert.equal(afterUpdate.category, beforeUpdate.category);
    assert.equal(afterUpdate.marked, true);
    await fresh.locator('#search').fill('');
    await fresh.locator('#rail [data-list="all"]').click();
    await fresh.locator('#sort').selectOption('changeAbs');
    let deltas = await fresh.evaluate(() => state.visible.map(m => m.changePrev?.delta).filter(v => v != null));
    assert.deepEqual(deltas, [...deltas].sort((a, b) => b - a));
    await fresh.locator('#sortDirection').click();
    deltas = await fresh.evaluate(() => state.visible.map(m => m.changePrev?.delta).filter(v => v != null));
    assert.deepEqual(deltas, [...deltas].sort((a, b) => a - b));
    assert.equal(await fresh.locator('#sortDirection').getAttribute('aria-pressed'), 'true');
    await fresh.locator('#showMarkedOnMap').click();
    await fresh.waitForFunction(() => [...state.marked].every(id => {
      const p = LeakMap.cachedPosition(state.byId.get(id)); return p && testMap.getBounds().contains([p.lat, p.lng]);
    }));
    assert.equal(await fresh.locator('#map .map-pin.is-marked').count(), 2);
    const legendColour = await fresh.locator('#mapLegend [data-category="watch"] i').evaluate(el => getComputedStyle(el).backgroundColor);
    const badgeColour = await fresh.locator('#rows tr.is-focus .pill').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(badgeColour, legendColour, 'Map key and list use the same status colour');
    fs.mkdirSync('test-results', { recursive: true });
    await fresh.screenshot({ path: 'test-results/map-selection-desktop.png' });
    await fresh.setViewportSize({ width: 390, height: 844 });
    await fresh.waitForTimeout(250);
    assert.equal(await fresh.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    await fresh.screenshot({ path: 'test-results/map-selection-mobile.png', fullPage: true });
    await fresh.close();
    console.log('Map search PASS: 60 results, persistent markers, warning colors, fitted bounds and mobile width.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

