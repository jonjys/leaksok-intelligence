const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const kit = require('./browser-kit.cjs');
const { buildDailyExports, toCsv } = require('./fixtures/synthetic-exports');
const Session = require('../server/ai-session');
const { createHandler } = require('../api/ai-review');

const code = 'a-long-synthetic-test-code-123456';
const nowDate = '2026-11-09T12:00:00Z';
const responseFor = input => ({
  summary: '<img src=x onerror=alert(1)> är text.',
  order: input.cases.map(c => c.caseId).reverse(),
  sharedChecks: ['Kontrollera driftlogg.'],
  cases: input.cases.map(c => ({
    caseId: c.caseId, summary: 'En förändring att undersöka.', evidenceIds: [c.evidence[0].id],
    hypotheses: [{ explanation: 'En hypotes.', support: [(input.cases.find(other => other.caseId !== c.caseId) || c).evidence[0].id],
      against: [], check: 'Kontrollera på plats.' }],
    nextChecks: ['Jämför fler avläsningar.'], limitations: ['Ingen bekräftad läcka.'],
  })),
});

(async () => {
  let now = Date.parse(nowDate);
  const provider = [], wire = [], errors = [];
  const env = { NODE_ENV: 'test', LEAKSOK_AI_ACCESS_CODE: code, ANTHROPIC_API_KEY: 'synthetic-server-only-provider-key' };
  const handlers = {
    '/api/ai-session': Session.createHandler({ env, now: () => now }),
    '/api/ai-review': createHandler({ env, now: () => now, fetcher: async (url, options) => {
      const body = JSON.parse(options.body), input = JSON.parse(body.messages[0].content);
      assert.equal(options.headers.Authorization, 'Bearer ' + env.ANTHROPIC_API_KEY);
      provider.push(input); now += 11000;
      await new Promise(resolve => setTimeout(resolve, 180));
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', model: 'test-model',
        usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: 'text', text: JSON.stringify(responseFor(input)) }] }) };
    } }),
  };
  const browser = await chromium.launch(), server = await kit.startServer(4186, handlers);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' });
    const openPage = async () => {
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', req => {
        if (req.url().endsWith('/api/ai-review') && req.method() === 'POST') wire.push({ body: req.postDataJSON(), auth: req.headers().authorization });
      });
      await page.clock.setFixedTime(new Date(nowDate));
      await kit.routeExternal(page);
      await page.goto('http://127.0.0.1:4186/');
      await kit.unlock(page, await page.locator('#profileName').isEditable() ? 'Test' : null);
      return page;
    };
    const ready = page => page.waitForFunction(() => !document.getElementById('aiRun').hidden && !document.getElementById('aiRun').disabled);
    const close = page => page.locator('#aiDialog [data-close]').click();
    const waitJournal = async (page, check) => {
      for (let i = 0; i < 90; i++) {
        const r = await page.evaluate(async () => {
          const record = await LeakStorage.loadDailyReview(state.profileId);
          return { day: record.report?.day, selected: record.report?.selected, auto: record.auto, status: record.attempt?.status };
        });
        if (check(r)) return;
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      assert.fail('Daily review journal did not reach the expected state');
    };
    const page = await openPage();

    const files = buildDailyExports({ meters: 42, days: 20, end: '2026-11-09' });
    // Many independent fresh signals ensure the plan does real selection beyond eight.
    for (const [index, file] of files.entries()) {
      const date = file.name.match(/20\d\d-\d\d-\d\d/)[0];
      for (const row of file.rows.slice(1)) if (+row[0] >= 20000000 && +row[0] < 30000000) {
        row[3] = date + ' 04:00'; row[4] = index === files.length - 1 ? 25 : 5; row[5] = 5;
      }
    }
    await kit.importFiles(page, files.map(f => ({ name: f.name, text: toCsv(f.rows) })));

    // An isolated new spike appears as a useful next check when the field lane is empty.
    await page.locator('#search').fill('TOPPGATAN 5');
    await page.locator('#rail [data-list="dispatch"]').click();
    assert.equal(await page.locator('.field-lanes [data-field-lane="ready"] b').textContent(), '0');
    assert.match(await page.locator('#rows tr.row').first().textContent(), /KONTROLLERA FÖRST/);
    assert.match(await page.locator('#rows .field-cue').first().textContent(), /nästa avläsning/);
    await page.locator('#search').fill('');
    await page.locator('#rail [data-list="all"]').click();
    await page.evaluate(() => LeakApp.setFocus('90000002', { scroll: false }));
    const original = await page.evaluate(() => JSON.stringify([state.byId.get('90000002').category, state.byId.get('90000002').priority, state.labels]));

    await page.locator('#focusAI').click();
    await page.locator('#aiAccessCode').fill('wrong-but-long-enough-test-code');
    await page.locator('#aiLogin').click();
    await page.waitForFunction(() => document.getElementById('aiStatus').textContent.includes('Fel åtkomstkod'));
    assert.equal(provider.length, 0);
    await page.locator('#aiAccessCode').fill(code);
    await page.locator('#aiLogin').click();
    await ready(page);
    const cookie = (await context.cookies()).find(c => c.name === '__Host-leaksok_ai');
    assert.ok(cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Strict');
    assert.equal(await page.locator('#aiAccessCode').inputValue(), '');
    assert.equal(provider.length, 0, 'Activation is separate from a paid single-meter call');
    await page.locator('#aiRun').click();
    await page.waitForSelector('#aiResult .ai-summary');
    assert.equal(provider.length, 1);
    assert.equal(wire.at(-1).auth, undefined);
    assert.equal(wire.at(-1).body.version, 2);
    assert.equal(wire.at(-1).body.cases[0].readings.length, 20);
    assert.doesNotMatch(JSON.stringify(wire), /LÅGNIVÅVÄGEN|90000002|synthetic-test-code/);
    assert.doesNotMatch(JSON.stringify(provider), /LÅGNIVÅVÄGEN|90000002|synthetic-test-code/);
    assert.equal(await page.locator('#aiResult img').count(), 0);
    assert.equal(await page.evaluate(() => JSON.stringify([state.byId.get('90000002').category, state.byId.get('90000002').priority, state.labels])), original);
    await page.locator('#aiResult .ai-ref').first().click();
    assert.equal(await page.locator('#aiResult .ai-evidence').first().getAttribute('open'), '');
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#aiExport').click();
    const report = fs.readFileSync(await (await downloadEvent).path(), 'utf8');
    assert.match(report, /leaksok-evidence-2.0/); assert.match(report, /LÅGNIVÅVÄGEN/); assert.doesNotMatch(report, /synthetic-test-code/);
    fs.mkdirSync('test-results', { recursive: true });
    await close(page);

    await page.reload(); await kit.unlock(page, null);
    await page.waitForFunction(() => state.meters.length === 42);
    await page.evaluate(() => {
      state.marked = new Set(state.meters.slice(0,12).map(m => m.id));
      LeakApp.render();
    });
    await page.locator('#selectionBar [data-sel="ai"]').click();
    await ready(page);
    assert.equal(await page.locator('#aiLoginForm').isVisible(), false, 'Reload does not require the AI code again');
    await page.locator('#aiRun').click();
    await page.waitForFunction(() => document.querySelectorAll('#aiResult .ai-case').length === 12);
    assert.equal(wire.at(-1).body.mode, 'selection');
    assert.equal(wire.at(-1).body.cases.length, 12);
    await page.locator('.ai-case .ai-reasoning > summary').first().click();
    await page.locator('.ai-case .ai-hypothesis .ai-ref').first().click();
    assert.equal(await page.locator('#ai-m1\\:e1').evaluate(el => el.closest('details').open), true);
    await close(page);

    // Two real tabs share IndexedDB and the HttpOnly cookie. Only one starts.
    const second = await openPage();
    await Promise.all([page.locator('#dailyButton').click(), second.locator('#dailyButton').click()]);
    await Promise.all([ready(page), ready(second)]);
    const before = provider.length;
    await Promise.all([page.locator('#aiRun').click(), second.locator('#aiRun').click()]);
    await waitJournal(page, r => r.selected === 24);
    assert.equal(provider.length, before + 1);
    const firstPlan = provider.at(-1);
    assert.equal(firstPlan.mode, 'daily'); assert.equal(firstPlan.examined, 42); assert.equal(firstPlan.cases.length, 24);
    await second.close();
    await close(page);
    await page.locator('#dailyButton').click();
    await page.waitForSelector('#aiResult .ai-summary');
    assert.equal(await page.locator('#aiRun').isVisible(), false);
    await page.locator('#aiAuto').check();
    await waitJournal(page, r => r.auto === true);
    await page.locator('#aiDialog').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: 'test-results/leaksok-daily-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    await page.screenshot({ path: 'test-results/leaksok-daily-mobile.png' });
    await close(page);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Automatic on the next day's new import, but not again after re-import/reload.
    await page.clock.setFixedTime(new Date('2026-11-10T12:00:00Z'));
    const last = files.at(-1);
    const tomorrow = { name: last.name.replace('2026-11-09','2026-11-10'),
      text: toCsv(last.rows.map((row, i) => i ? row.map((v, j) => j === 3 ? '2026-11-10 04:00' : v) : row)) };
    await kit.importFiles(page, [tomorrow]);
    await waitJournal(page, r => r.day === '2026-11-10' && r.selected === 24);
    assert.equal(provider.length, before + 2);
    await kit.importFiles(page, [tomorrow]);
    await page.reload(); await kit.unlock(page, null);
    await page.locator('#dailyButton').click();
    await page.waitForSelector('#aiResult .ai-summary');
    assert.equal(provider.length, before + 2);
    assert.equal(await page.locator('#aiRun').isVisible(), false);
    await page.locator('#aiDisconnect').click();
    await page.waitForSelector('#aiLoginForm');
    assert.ok(!(await context.cookies()).some(c => c.name === '__Host-leaksok_ai'));
    assert.deepEqual(errors, []);
    console.log('AI browser PASS: 0 ready with prechecks, one activation, V2 detail, 12 marked, 24-case daily, cross-tab reservation, auto-import, reload and logout.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
