const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const kit = require('./browser-kit.cjs');
const { buildDailyExports, toCsv } = require('./fixtures/synthetic-exports');
const Session = require('../server/ai-session');
const { createHandler } = require('../api/ai-review');

// Fältläget med AI: Idag visar vad som behövs, aktivering slår på automatisk
// granskning, Claudes ordning styr korten och sparas till nästa öppning.
const code = 'a-long-synthetic-field-code-123456';
const nowDate = '2026-11-09T12:00:00Z';
const responseFor = input => ({
  summary: '<img src=x onerror=alert(1)> Tre nya ökningar först.',
  order: input.cases.map(c => c.caseId).reverse(),
  sharedChecks: ['Kontrollera driftlogg.'],
  cases: input.cases.map((c, i) => ({
    caseId: c.caseId, summary: 'En förändring att undersöka.', evidenceIds: i === input.cases.length - 1 ? [] : [c.evidence[0].id],
    hypotheses: [{ explanation: 'En hypotes.', support: [c.evidence[0].id], against: [], check: 'Kontrollera på plats.' }],
    nextChecks: [`Lyssna på ventilen vid fall ${c.caseId}.`], limitations: ['Ingen bekräftad läcka.'],
  })),
});

(async () => {
  const now = Date.parse(nowDate);
  const provider = [], wire = [], errors = [];
  const env = { NODE_ENV: 'test', LEAKSOK_AI_ACCESS_CODE: code, ANTHROPIC_API_KEY: 'synthetic-server-only-provider-key' };
  const handlers = {
    '/api/ai-session': Session.createHandler({ env, now: () => now }),
    '/api/ai-review': createHandler({ env, now: () => now, fetcher: async (url, options) => {
      const body = JSON.parse(options.body), input = JSON.parse(body.messages[0].content);
      provider.push(input);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({
        content: [{ type: 'text', text: JSON.stringify(responseFor(input)) }], stop_reason: 'end_turn',
        model: body.model, usage: { input_tokens: 100, output_tokens: 80 },
      }) };
    } }),
  };
  const server = await kit.startServer(4193, handlers), browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Stockholm' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.dismiss());
    page.on('request', req => { if (req.url().endsWith('/api/ai-review') && req.method() === 'POST') wire.push(req.postDataJSON()); });
    await page.clock.setFixedTime(new Date(nowDate));
    await kit.routeExternal(page);
    await page.goto('http://127.0.0.1:4193/');
    await kit.unlock(page, 'Falt AI');

    const files = buildDailyExports({ meters: 42, days: 20, end: '2026-11-09' });
    for (const [index, file] of files.entries()) {
      const date = file.name.match(/20\d\d-\d\d-\d\d/)[0];
      for (const row of file.rows.slice(1)) if (+row[0] >= 20000000 && +row[0] < 30000000) {
        row[3] = date + ' 04:00'; row[4] = index === files.length - 1 ? 25 : 5; row[5] = 5;
      }
    }
    await kit.importFiles(page, files.map(f => ({ name: f.name, text: toCsv(f.rows) })));
    await page.waitForFunction(() => state.meters.length === 42 && document.querySelector('.today-card'));

    // 1. AI finns men är inte aktiverat: Idag erbjuder aktivering, inget anrop.
    await page.waitForSelector('.today-ai [data-f="ai-open"]');
    assert.match(await page.locator('.today-ai h3').textContent(), /räkna fram dagens ordning/);
    assert.equal(provider.length, 0);

    // 2. Aktivera från Idag: automatisk granskning är förvald och startar direkt.
    await page.locator('.today-ai [data-f="ai-open"]').click();
    await page.waitForSelector('#aiDialog[open] #aiLoginForm:not([hidden])');
    assert.equal(await page.locator('#aiAuto').isChecked(), true, 'Automatiskt är förvalt vid aktivering');
    await page.locator('#aiAccessCode').fill(code);
    await page.locator('#aiLogin').click();
    await page.waitForFunction(() => LeakAI.status()?.phase === 'ranked', null, { timeout: 30000 });
    assert.equal(provider.length, 1, 'En automatisk granskning');
    assert.equal(provider[0].mode, 'daily');
    // Inga mätar-id, serienummer eller adresser i det som skickas.
    const identities = await page.evaluate(() => state.meters.flatMap(m => [m.id, m.serial, m.address]).filter(v => v && String(v).length >= 6));
    const sent = JSON.stringify(wire);
    assert.ok(identities.length >= 42);
    for (const value of identities) assert.equal(sent.includes(String(value)), false, `${value} skickades inte`);
    await page.locator('#aiDialog [data-close]').first().click();

    // 3. Claudes ordning styr Idag; AI-text visas som text.
    await page.waitForSelector('.today-ai[data-ai="ranked"]');
    const status = await page.evaluate(() => LeakAI.status());
    assert.ok(status.ranking.length > 0);
    const firstCard = page.locator('.today-card[data-meter]').first();
    assert.equal(await firstCard.getAttribute('data-meter'), status.ranking[0].id, 'AI #1 överst');
    assert.match(await firstCard.locator('.tag.t-ai').textContent(), /AI #1/);
    assert.equal(await page.locator('.today-ai img, .today-card img').count(), 0, 'AI-svar tolkas aldrig som HTML');
    assert.match(await page.locator('.today-ai').textContent(), /<img src=x/);
    const untraceable = status.ranking.find(r => !r.traceable), traced = status.ranking.find(r => r.traceable);
    // AI #1 saknar belägg: det står överst men som något att verifiera.
    assert.equal(untraceable.rank, 1);
    assert.match(await page.locator(`.today-card[data-meter="${untraceable.id}"] .ai-why`).textContent(), /Verifiera först/);
    assert.match(await page.locator(`.today-card[data-meter="${traced.id}"] .ai-why`).textContent(), /Börja här: Lyssna på ventilen/);
    assert.match(await page.locator('.today-ai-strip').textContent(), /42\s*genomgångna/);

    // 4. Lägg AI:s första fall med belägg i arbetslistan.
    const before = await page.evaluate(() => state.tripList.length);
    await page.locator('.today-ai [data-f="ai-add"]').click();
    const added = await page.evaluate(() => state.tripList.length);
    assert.equal(added - before, status.actionable.length);
    assert.ok(status.actionable.length > 0 && !status.actionable.includes(untraceable.id), 'Bara fall med belägg');

    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/field-ai-390.png', fullPage: true });

    // 5. Ett fältbeslut ändrar underlaget men inte vilken export som granskades:
    //    AI-ordningen ligger kvar, den dolda mätaren försvinner ur korten.
    const second = status.ranking[1].id, third = status.ranking[2].id;
    const keyBefore = await page.evaluate(() => state.reviewKey);
    await page.evaluate(id => LeakApp.setHidden([id], true), second);
    await page.waitForFunction(id => !document.querySelector(`.today-card[data-meter="${id}"]`), second);
    await page.evaluate(id => LeakApp.applyDecision([id], 'watch'), third);
    await page.waitForFunction(key => state.reviewKey !== key, keyBefore);
    assert.equal(await page.evaluate(() => LeakAI.status().phase), 'ranked');
    assert.equal(await page.locator('.today-card[data-meter]').first().getAttribute('data-meter'), status.ranking[0].id);
    assert.match(await page.locator('.today-ai').textContent(), /Gjord före dina senaste beslut/);
    assert.match(await page.locator('.today-card[data-meter]').nth(1).locator('.tag.t-ai').textContent(), /AI #3/);

    // 6. Nästa öppning: planen finns kvar och inget nytt betalt anrop görs,
    //    inte heller när den automatiska kontrollen har hunnit köra.
    await page.reload();
    await kit.unlock(page, null);
    await page.waitForSelector('.today-ai[data-ai="ranked"]');
    await page.waitForTimeout(2500);
    assert.equal(provider.length, 1, 'Ingen ny granskning efter omladdning');
    assert.equal(wire.length, 1);
    assert.equal(await page.locator('.today-card[data-meter]').first().getAttribute('data-meter'), status.ranking[0].id);

    // 7. En andra export samma dag med nya avläsningar: morgonens AI-ordning
    //    gäller inte längre. Inga AI-märken, ingen AI-knapp till arbetslistan,
    //    och dagens plan är redan använd, så inget nytt anrop.
    const last = files.at(-1);
    const afternoon = { name: last.name.replace(/(\.\w+)?$/, ' eftermiddag.csv'),
      text: toCsv(last.rows.map((row, i) => i && +row[0] >= 20000000 && +row[0] < 20000004 ? row.map((v, j) => j === 4 ? 31 : v) : row)) };
    await kit.importFiles(page, [afternoon]);
    await page.waitForFunction(n => state.files.length === n, files.length + 1);
    await page.waitForSelector('.today-ai[data-ai="stale"]');
    assert.equal(await page.locator('.today-card .tag.t-ai').count(), 0, 'Morgonens AI-ordning visas inte för eftermiddagens export');
    assert.equal(await page.locator('.today-ai [data-f="ai-add"]').count(), 0);
    await page.waitForTimeout(1500);
    assert.equal(provider.length, 1, 'En plan per dag');

    // 8. Nästa dag före dagens import: ingen knapp förbrukar dagens plan på
    //    gårdagens export, och runNow öppnar dialogen i stället för att anropa.
    await page.clock.setFixedTime(new Date('2026-11-10T06:00:00Z'));
    await page.evaluate(() => LeakApp.render());
    await page.waitForSelector('.today-ai[data-ai="idle"]');
    assert.equal(await page.evaluate(() => LeakAI.status().exportIsToday), false);
    assert.equal(await page.locator('.today-ai [data-f="ai-run"]').count(), 0, 'Ingen knapp som använder dagens plan på gårdagens export');
    await page.evaluate(() => LeakAI.runNow());
    await page.waitForSelector('#aiDialog[open]');
    await page.waitForTimeout(800);
    assert.equal(provider.length, 1, 'runNow på gårdagens export gör inget anrop');
    assert.deepEqual(errors, []);
    console.log('Field AI PASS: activation from Idag, automatic daily review, AI order drives cards and survives decisions, AI text escaped, worklist from AI, plan kept after reload, second same-day export not shown with the morning order, no button spends today\'s plan on yesterday.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
