const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const kit = require('./browser-kit.cjs');
const { buildDailyExports, toCsv } = require('./fixtures/synthetic-exports.js');

(async () => {
  const server = await kit.startServer(4185);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); await kit.routeExternal(page);
    // Use a real, cloneable directory handle; only the OS picker is substituted.
    await page.addInitScript(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Exporter', { create: true }); });
    await page.goto('http://127.0.0.1:4185/'); await kit.unlock(page, 'Autoimport', '1234');
    const files = buildDailyExports({ meters: 80, days: 4, includeScenarios: false }).map(f => ({ name: f.name, text: toCsv(f.rows) }));
    const write = file => page.evaluate(async f => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Exporter', { create: true });
      const handle = await dir.getFileHandle(f.name, { create: true }), writable = await handle.createWritable();
      await writable.write(f.text); await writable.close();
    }, file);
    await write(files[0]); await write(files[1]);
    await page.locator('#folderButton').click(); await page.locator('#sourceConnect').click();
    await page.waitForFunction(() => state.files.length === 2 && !LeakApp.folderImport.isBusy());
    assert.equal(await page.locator('#folderButton').textContent(), 'Autoimport aktiv');
    await page.locator('#sourceCheck').click(); await page.waitForFunction(() => !LeakApp.folderImport.isBusy());
    assert.equal(await page.evaluate(() => state.files.length), 2);
    await page.locator('#sourceDialog [data-close]').click();
    const id = await page.evaluate(() => state.meters[0].id);
    await page.evaluate(id => LeakApp.applyDecision([id], 'interesting', {}, 'Lyssna vid ventilen'), id);
    await write(files[2]);
    // The visibility/focus scan used in production; no manual file selection.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => state.files.length === 3 && !LeakApp.folderImport.isBusy());
    assert.equal(await page.evaluate(id => state.labels[id].comment, id), 'Lyssna vid ventilen');

    // Same reading with changed infocode updates its metadata, without adding a file.
    const modified = { name: files[2].name, text: '' };
    const rows = buildDailyExports({ meters: 80, days: 4, includeScenarios: false })[2].rows;
    rows[1][7] = 'LEAK'; modified.text = toCsv(rows); await write(modified);
    await page.evaluate(() => LeakApp.folderImport.scan());
    assert.equal(await page.evaluate(() => state.files.length), 3);
    assert.equal(await page.evaluate(id => state.byId.get(id).category, String(rows[1][0])), 'customer_side');

    const downloadEvent = page.waitForEvent('download');
    await page.locator('#infoMenu summary').click(); await page.locator('[data-info="backup"]').click();
    const backup = fs.readFileSync(await (await downloadEvent).path(), 'utf8');
    assert.equal(JSON.parse(backup).files.length, 3);
    assert.equal(JSON.parse(backup).labels[id].comment, 'Lyssna vid ventilen');

    await page.reload(); await kit.unlock(page, null, '1234');
    await page.waitForFunction(() => LeakApp.folderImport.getStatus().phase === 'connected' && !LeakApp.folderImport.isBusy());
    assert.equal(await page.evaluate(() => state.files.length), 3);
    await write(files[3]);
    await page.locator('#infoMenu summary').click(); await page.locator('[data-info="lock"]').click();
    await page.evaluate(() => LeakApp.folderImport.scan()); assert.equal(await page.evaluate(() => state.files.length), 3);
    await kit.unlock(page, null, '1234');
    await page.waitForFunction(() => state.files.length === 4 && !LeakApp.folderImport.isBusy());

    // Restore through the actual UI, twice: keep current files and newer decisions.
    await page.evaluate(id => LeakApp.applyDecision([id], 'manual_dispatch', {}, 'Senaste beslutet'), id);
    const restore = async () => {
      await page.locator('#backupInput').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
      await page.waitForSelector('#restoreDialog[open]'); await page.locator('#restoreApply').click();
      await page.waitForFunction(() => !state.importing && !document.getElementById('restoreDialog').open);
    };
    await restore(); await restore();
    assert.equal(await page.evaluate(() => state.files.length), 4);
    assert.equal(await page.evaluate(id => state.labels[id].type, id), 'manual_dispatch');
    assert.equal(await page.evaluate(id => state.labels[id].comment, id), 'Senaste beslutet');
    assert.equal(await page.evaluate(() => LeakApp.folderImport.getStatus().phase), 'connected');
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/product-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    await page.screenshot({ path: 'test-results/product-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Autoimport PASS: real directory persistence, new/changed files, deduplication, lock, reload, full backup and repeated additive restore.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
