const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const kit = require('./browser-kit.cjs');
const { buildDailyExports, toCsv } = require('./fixtures/synthetic-exports');
(async () => {
  const server = await kit.startServer(4186), browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await kit.routeExternal(page);
    let configured = false, sent = [];
    await page.route('**/api/ai-review', async route => {
      const req = route.request();
      if (req.method() === 'GET') return route.fulfill({ json: { configured, needsAccessCode: !configured } });
      sent.push({ body: req.postDataJSON(), auth: req.headers().authorization });
      if (req.headers().authorization !== 'Bearer a-long-synthetic-test-code-123456') return route.fulfill({ status: 401, json: { error: 'Fel åtkomstkod för Claude.' } });
      return route.fulfill({ json: { review: { summary: '<img src=x onerror=alert(1)> är text.', observations: ['Observerade värden.'], possibleCauses: ['En hypotes.'], nextChecks: ['Kontrollera på plats.'], limitations: ['Inte en bekräftad läcka.'] }, model: 'test-model', createdAt: '2026-11-03T10:00:00Z', usage: { inputTokens: 100, outputTokens: 100 }, cached: false } });
    });
    await page.goto('http://127.0.0.1:4186/'); await kit.unlock(page);
    await kit.importFiles(page, buildDailyExports({ meters: 20, days: 10 }).map(f => ({ name: f.name, text: toCsv(f.rows) })));
    await page.evaluate(() => LeakApp.setFocus('90000002', { scroll: false }));
    const original = await page.evaluate(() => JSON.stringify([state.byId.get('90000002').category, state.byId.get('90000002').priority, state.labels]));
    await page.locator('#focusAI').click(); await page.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('LEAKSOK_AI_ACCESS_CODE'));
    assert.equal(await page.locator('#aiRun').isDisabled(), true); assert.equal(sent.length, 0);
    await page.locator('#aiDialog [data-close]').click(); configured = true;
    await page.locator('#focusAI').click(); await page.waitForFunction(() => !document.querySelector('#aiRun').disabled);
    await page.locator('#aiAccessCode').fill('wrong-but-long-enough-test-code'); await page.locator('#aiRun').click();
    await page.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('Fel åtkomstkod'));
    await page.locator('#aiAccessCode').fill('a-long-synthetic-test-code-123456'); await page.locator('#aiRun').click();
    await page.waitForSelector('#aiResult .ai-summary');
    assert.equal(await page.locator('#aiResult img').count(), 0, 'Model output is rendered only as text');
    const wire = JSON.stringify(sent.at(-1).body);
    assert.doesNotMatch(wire, /LÅGNIVÅVÄGEN|90000002|address|serial|comment|lat|lng/);
    assert.equal(sent.at(-1).body.readings.length, 10);
    assert.equal(await page.evaluate(() => JSON.stringify([state.byId.get('90000002').category, state.byId.get('90000002').priority, state.labels])), original);
    await page.locator('#aiRun').click(); assert.equal(sent.length, 2, 'Identical analysis reuses the result');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/claude-mobile.png' });
    await page.locator('#aiDialog [data-close]').click();
    await page.locator('#infoMenu > summary').click(); await page.locator('[data-info="lock"]').click(); await kit.unlock(page, null);
    await page.locator('#focusAI').click(); assert.equal(await page.locator('#aiAccessCode').inputValue(), '');
    assert.equal(await page.locator('#aiResult .ai-summary').count(), 0, 'Lock clears cached AI results');
    await page.locator('#aiDialog [data-close]').click();
    await page.evaluate(() => LeakApp.openChart('90000001'));
    await page.locator('#chartDialogDetail [data-act="ai"]').click();
    assert.equal(await page.locator('#aiMeter').textContent(), await page.evaluate(() => state.byId.get('90000001').address), 'Chart review targets the chart meter even when map focus differs');
    const bounded = await page.evaluate(() => {
      const m = state.byId.get('90000001');
      const series = Array.from({ length: 200 }, (_, i) => ({ date: new Date(2026, 0, i + 1), value: i }));
      return LeakAI.payload({ ...m, series });
    });
    assert.equal(bounded.readings.length, 180); assert.equal(bounded.totalReadingDays, 200); assert.equal(bounded.readings[0].value, 20);
    assert.deepEqual(errors, []);
    console.log('Claude UI PASS: fail-closed setup, explicit send, private fields excluded, errors, safe rendering, cache, unchanged decisions, mobile and lock.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
