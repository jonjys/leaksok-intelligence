// Browser workflow: 3 000 synthetic meters, 30 daily exports, decisions, reload.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const kit = require("./browser-kit.cjs");
const { buildDailyExports, toCsv } = require("./fixtures/synthetic-exports.js");

(async () => {
  fs.mkdirSync("test-results", { recursive: true });
  const server = await kit.startServer(4173);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Stockholm" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await kit.routeExternal(page);
  const row = (id) => page.locator(`#rows tr[data-id="${id}"]`);
  const meter = (id) => page.evaluate((i) => { const m = state.byId.get(i); return m && { category: m.category, summary: m.summary, latest: m.latest?.value, priority: m.priority, label: state.labels[i] || null, obs: m.observations }; }, id);
  const list = async (key) => {
    if (["customer_side", "seasonal", "noise", "ignored"].includes(key)) key = "hidden";
    const button = page.locator(`#rail [data-list="${key}"]`).first();
    if (!(await button.isVisible())) await page.locator("#rail .rail-more > summary").click();
    await button.click();
  };
  try {
    await page.goto("http://127.0.0.1:4173/", { waitUntil: "load" });
    await kit.unlock(page, "Test", "1234");
    const files = buildDailyExports({ meters: 3000, days: 30 });
    await kit.importFiles(page, files.map((f) => ({ name: f.name, text: toCsv(f.rows) })));
    assert.equal(await page.evaluate(() => state.meters.length), 3000);
    assert.equal(await page.evaluate(() => state.files.length), 30);

    // Quiet/customer groups start hidden and have no separate navigation tabs.
    assert.equal(await page.locator('#rail [data-list="customer_side"]').count(), 0);
    assert.equal(await page.evaluate(() => state.visible.some(m => m.category === "customer_side")), false);
    await page.locator("#groupFilter summary").click();
    await page.locator('#groupFilter input[value="customer_side"]').check();
    assert.equal(await page.evaluate(() => state.visible.some(m => m.category === "customer_side")), true);
    await page.locator('#groupFilter input[value="customer_side"]').uncheck();
    await page.locator("#groupFilter summary").click();

    // Morning overview and lists come from the same analysis.
    await list("today");
    const today = await page.evaluate(() => state.visible.map((m) => m.id));
    assert.ok(today.includes("90000001") && today.includes("90000003"), "New signals today are listed");
    assert.ok(!today.includes("90000009"), "An old reading is not a new signal today");
    await list("suspect");
    assert.match(await row("90000001").textContent(), /5 → 10 \(\+100 %\)/);
    assert.match(await row("90000001").locator(".c-latest").innerText(), /\+5 \(\+100 %\)/);
    assert.equal(await page.locator("#rail [data-list='suspect'] b").textContent(), String(await page.evaluate(() => state.visible.length)));
    await list("customer_side");
    assert.equal(await row("90000014").count(), 1, "LEAK info code goes to Efter mätare");
    await list("stale_contact");
    assert.match(await row("90000009").textContent(), /Ingen ny avläsning sedan 9 sep/);

    // Laptop focus stacks map and chart beside the meter list; values agree.
    await page.locator('button[data-view="map"]').click();
    await list("suspect");
    await row("90000002").locator(".addr").click();
    await page.waitForSelector("#focusChart .ch-stage svg");
    assert.equal(await page.locator("#focusChart .ch-latest b").textContent(), await row("90000002").locator(".val").innerText());
    const chartBox = await page.locator("#focusChart").boundingBox();
    const mapBox = await page.locator("#map").boundingBox();
    assert.ok(mapBox.x + mapBox.width <= chartBox.x, "Map beside the compact inspector on a laptop");
    const listBox = await page.locator(".table-wrap").boundingBox();
    assert.ok(listBox.x + listBox.width <= mapBox.x, "Meter list remains left of the map");
    await page.locator("#focusChart .ch-stage").click();
    await page.waitForSelector("#chartDialog[open] .ch-stage svg");
    await page.locator("#chartDialog [data-close]").click();

    // Expanded evidence and comment.
    await row("90000013").count() || await list("suspect");
    await row("90000013").locator('[data-act="expand"]').click();
    const detail = page.locator('tr[data-detail="90000013"]');
    assert.match(await detail.innerText(), /fortfarande lägre än den äldre nivån 34/);
    assert.match(await detail.innerText(), /Sedan föregående avläsning/i);
    await detail.locator("textarea[data-comment]").fill("Lyssna vid servisventilen");
    await detail.locator("textarea[data-comment]").blur();
    assert.equal((await meter("90000013")).label.comment, "Lyssna vid servisventilen");

    // Konstaterad via right-click menu: date + uncertain, no repair fields.
    await row("90000002").click({ button: "right" });
    await page.locator('#contextMenu [data-decision="leak"]').click();
    assert.equal(await page.locator('#decisionFields [name="repairedDate"]').count(), 1, "Leak supports an optional repair date");
    await page.locator('#decisionFields [name="confirmedDate"]').fill("2026-09-28");
    await page.locator('#decisionFields [name="confirmedDateUncertain"]').check();
    await page.locator("#decisionSave").click();
    let m2 = await meter("90000002");
    assert.equal(m2.category, "confirmed");
    assert.equal(m2.label.confirmedDateUncertain, true);

    // Active case dates survive moving the same case to repaired.
    await list("dispatch");
    await row("90000016").locator('[data-act="menu"]').click();
    await page.locator('#contextMenu [data-decision="leak"]').click();
    await page.locator('#decisionFields [name="confirmedDate"]').fill("2026-09-27");
    await page.locator('#decisionFields [name="lineType"][value="AV"]').check();
    await page.locator("#decisionSave").click();

    // Lagad via ⋯ menu with repair details.
    await list("confirmed");
    await row("90000016").locator('[data-act="menu"]').click();
    await page.locator('#contextMenu [data-decision="repaired"]').click();
    await page.locator('#decisionFields [name="repairedDate"]').fill("2026-09-29");
    await page.locator('#decisionFields [name="lineType"][value="SV"]').check();
    await page.locator('#decisionFields [name="distanceMeters"]').fill("55");
    await page.locator("#decisionComment").fill("Lagad vid nr 31");
    await page.locator("#decisionSave").click();
    const m16 = await meter("90000016");
    assert.equal(m16.category, "repaired");
    assert.equal(m16.label.distanceMeters, 55);
    assert.equal(m16.label.lineType, "SV");
    assert.equal(m16.label.confirmedDate, "2026-09-27", "Original case date is preserved");
    await list("repaired");
    assert.equal(await row("90000016").count(), 1);

    // Bevaka is manual; Misstänk stays automatic.
    await list("suspect");
    await row("90000003").click({ button: "right" });
    await page.locator('#contextMenu [data-decision="interesting"]').click();
    assert.equal((await meter("90000003")).category, "watch");
    await list("watch");
    assert.equal(await row("90000003").count(), 1);

    // Undo restores the previous decision.
    await row("90000003").click({ button: "right" });
    await page.locator("#contextMenu .menu-decisions summary").click();
    await page.locator('#contextMenu [data-decision="ignored"]').click();
    assert.equal((await meter("90000003")).category, "ignored");
    await page.locator("#toast [data-undo]").click();
    assert.equal((await meter("90000003")).category, "watch");

    // Nollställ defines the moment from which readings count.
    await list("suspect");
    await row("90000006").click({ button: "right" });
    await page.locator("#contextMenu .menu-decisions summary").click();
    await page.locator('#contextMenu [data-decision="reset_baseline"]').click();
    assert.match(await page.locator("#decisionFields").innerText(), /bedöms bara avläsningar som tas efter denna tidpunkt/);
    await page.locator("#decisionSave").click();
    const reset = await meter("90000006");
    assert.ok(reset.label.resetAfter);
    assert.match(reset.obs[0], /^Nollställd .* endast avläsningar efter denna tidpunkt bedöms \(0 hittills\)/);

    // Göm and restore; hidden meters leave Alla but keep decisions.
    await list("all");
    await page.locator("#search").fill("HÖGNIVÅVÄGEN 9");
    await row("90000005").locator("[data-mark]").check();
    await kit.selectionAction(page, "hide");
    assert.equal(await row("90000005").count(), 0);
    await page.locator("#search").fill("");
    await list("hidden");
    assert.equal(await row("90000005").count(), 1);
    await row("90000005").locator("[data-mark]").check();
    await kit.selectionAction(page, "hide");
    assert.equal(await page.evaluate(() => state.labels["90000005"].hidden), false);

    // Duplicate import and the next morning's export.
    await kit.importFiles(page, [{ name: files[29].name, text: toCsv(files[29].rows) }]);
    assert.match(await page.locator("#importStatus").innerText(), /1 redan i historiken/);
    const next = buildDailyExports({ meters: 3000, days: 31, end: "2026-09-30" }).at(-1);
    next.rows = next.rows.map((r) => (r[0] === "90000001" ? [...r.slice(0, 4), 11, ...r.slice(5)] : r));
    await kit.importFiles(page, [{ name: next.name, text: toCsv(next.rows) }]);
    const firstRise = await meter("90000001");
    assert.match(firstRise.summary, /Ny högre nivå sedan 29 sep: 5 → 10,5/, "Second reading confirms a new level");

    await page.screenshot({ path: "test-results/desktop-1440.png" });

    // Reload: files, decisions and comments persist.
    const before = await page.evaluate(() => state.meters.slice(0, 50).map((m) => [m.id, m.category, m.priority]));
    await page.reload({ waitUntil: "load" });
    await kit.unlock(page, null, "1234");
    await page.waitForFunction(() => state.meters.length === 3000);
    assert.equal(await page.evaluate(() => state.files.length), 31);
    assert.equal((await meter("90000013")).label.comment, "Lyssna vid servisventilen");
    assert.equal((await meter("90000016")).label.distanceMeters, 55);
    assert.equal((await meter("90000002")).category, "confirmed");
    assert.deepEqual(await page.evaluate(() => state.meters.slice(0, 50).map((m) => [m.id, m.category, m.priority])), before, "Same analysis after reload");

    // Laptop screen: opening the panel does not move the clicked row away, and a
    // double-click on the row (including the address) opens the large chart.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => { document.getElementById("focusClose").click(); window.scrollTo(0, 0); });
    await list("all");
    const target = page.locator("#rows tr.row").nth(1);
    const top = (await target.boundingBox()).y;
    await target.locator(".addr").click();
    await page.waitForFunction(() => !document.getElementById("focus").hidden);
    assert.ok(Math.abs((await target.boundingBox()).y - top) < 90, "Clicked row stays near the pointer");
    await target.locator(".addr").dblclick();
    await page.waitForSelector("#chartDialog[open] .ch-stage svg");
    const check = await page.evaluate((id) => {
      const series = state.byId.get(id).series.map((p) => `${LeakHistory.dayKey(p.date)}=${p.value}`);
      const dots = [...document.querySelectorAll("#chartDialogChart circle.ch-dot")].map((c) => `${c.dataset.day}=${c.dataset.value}`);
      return { dots, tail: series.slice(-dots.length) };
    }, await target.getAttribute("data-id"));
    assert.ok(check.dots.length > 0);
    assert.deepEqual(check.dots, check.tail, "Chart dots are exactly the meter's readings in the shown period");
    await page.locator("#chartDialog [data-close]").click();

    // Visible copy button right after the address copies the street address.
    await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = async (t) => { window.__copied.push(t); }; });
    const copyId = await target.getAttribute("data-id");
    await target.locator(".copy-addr").click();
    await page.locator("#focusCopy").click();
    const copied = await page.evaluate(() => window.__copied);
    const street = await page.evaluate((id) => state.byId.get(id).address.split(/\s+\d/)[0], copyId);
    assert.equal(copied.length, 2);
    assert.ok(copied.every((t) => t.startsWith(street)), "Copied text is the street address");

    // Phone: cards, list picker, no horizontal page overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#listSelect").selectOption("suspect");
    const phoneFocus = await page.locator('#rows tr.row').first().getAttribute('data-id');
    await page.locator("#rows tr.row").first().locator(".addr").click();
    await page.waitForFunction(id => state.focusId === id && document.querySelector('#focusChart').__chart?.id === id, phoneFocus);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "No horizontal overflow on phone");
    await page.waitForFunction(() => {
      const chart = document.querySelector('#focusChart').getBoundingClientRect(), map = document.querySelector('#map').getBoundingClientRect();
      return chart.top > map.bottom - 5;
    });
    await page.screenshot({ path: "test-results/mobile-390.png", fullPage: true });

    // Supplemental area evidence: three nearby addresses, same rise, no replacement
    // of existing decisions. Click once to mark the group and show its evidence.
    await page.setViewportSize({ width: 1440, height: 900 });
    const areaIds = ['98000001', '98000002', '98000003'];
    const areaFiles = Array.from({ length: 12 }, (_, i) => {
      const date = `2026-09-${String(i + 19).padStart(2, '0')}`;
      const rows = [['Serienummer', 'Adress', 'Område', 'Senaste avläsning', 'Senaste värde'],
        ...areaIds.map((id, j) => [id, `OMRÅDESTESTVÄGEN ${1 + j * 2} TUMBA 14730`, 'TUMBA', `${date} 04:00`, i < 10 ? 9 : 23])];
      return { name: `Områdestest ${date} 08-00.csv`, text: toCsv(rows) };
    });
    await kit.importFiles(page, areaFiles);
    await list('all');
    await page.locator('#search').fill('OMRÅDESTESTVÄGEN');
    await page.waitForFunction(() => state.areaSignals.some((s) => s.ids.includes('98000001')));
    const previousMarks = await page.evaluate(() => [...state.marked]);
    await page.locator('#brief .area-signals > summary').click();
    await page.locator('#brief [data-area-signal="98000001|98000002|98000003"]').click();
    assert.ok(await page.evaluate((ids) => ids.every((id) => state.marked.has(id)), [...previousMarks, ...areaIds]));
    assert.equal(await page.evaluate(() => state.focusId), '98000002');
    const evidence = page.locator('tr[data-detail="98000002"]');
    assert.match(await evidence.innerText(), /9 → 23/);
    assert.match(await evidence.innerText(), /huvudledning/);
    assert.match(await evidence.innerText(), /inte fastställda/);
    assert.equal((await meter('90000002')).category, 'confirmed', 'Existing confirmed leak survives');
    assert.equal((await meter('90000016')).category, 'repaired', 'Existing repair survives');
    await page.screenshot({ path: 'test-results/area-signal-1440.png' });

    // Older cached imports lack Kamstrup's interest rank. Re-import the exact
    // readings with this metadata: update in place, persist, and show Misstänk.
    const interestId = '99000001';
    const interestFiles = ['2026-09-11', '2026-09-14', '2026-09-30', '2026-10-01'].map((date, i) => ({
      name: `Intressetest ${date} 07-00.csv`,
      text: toCsv([['Serienummer', 'Adress', 'Senaste avläsning', 'Senaste värde', 'Genomsnittsvärde'],
        [interestId, 'INTRESSETESTVÄGEN 1 TUMBA 14730', `${date} 04:00`, [226, 218, 234, 292][i], 244]])
    }));
    await kit.importFiles(page, interestFiles);
    assert.equal((await meter(interestId)).category, 'sparse_history');
    const countBeforeRank = await page.evaluate(() => state.files.length);
    const rankedFile = (rank) => ({ name: interestFiles[3].name, text: toCsv([
      ['Mätare av intresse', 'Serienummer', 'Adress', 'Senaste avläsning', 'Senaste värde', 'Genomsnittsvärde'],
      [rank, interestId, 'INTRESSETESTVÄGEN 1 TUMBA 14730', '2026-10-01 04:00', 292, 244]
    ]) });
    await kit.importFiles(page, [rankedFile(2)]);
    assert.equal(await page.evaluate(() => state.files.length), countBeforeRank);
    assert.match(await page.locator('#importStatus').innerText(), /1 uppdaterade exporter/);
    assert.equal((await meter(interestId)).category, 'suspect_auto');
    await list('suspect');
    await page.locator('#search').fill('INTRESSETESTVÄGEN');
    assert.match(await row(interestId).textContent(), /Kamstrup · rang 2/);
    await kit.importFiles(page, [interestFiles[3]]);
    assert.equal((await meter(interestId)).category, 'suspect_auto', 'Absent header does not erase enriched duplicate metadata');
    await page.reload({ waitUntil: 'load' });
    await kit.unlock(page, null, '1234');
    assert.equal((await meter(interestId)).category, 'suspect_auto', 'Enriched metadata survives reload');
    assert.equal(await page.evaluate((id) => state.byId.get(id).history.readings, interestId), 4);
    assert.equal(await page.evaluate(() => state.files.length), countBeforeRank);
    await kit.importFiles(page, [rankedFile('')]);
    assert.equal((await meter(interestId)).category, 'sparse_history', 'Explicit blank removes rank without adding a reading');
    assert.equal(await page.evaluate(() => state.files.length), countBeforeRank);
    assert.equal((await meter('90000002')).category, 'confirmed');
    assert.equal((await meter('90000016')).category, 'repaired');
    // Both dates in one leak form; invalid chronology must not save.
    await page.locator("#search").fill("");
    await list("all");
    await page.evaluate(() => { state.marked.clear(); LeakApp.render(); LeakApp.setFocus("90000011", {scroll:false}); });
    await page.locator("#focusMenu").click();
    await page.locator('#contextMenu [data-decision="leak"]').click();
    await page.locator('#decisionFields [name="confirmedDate"]').fill("2026-09-08");
    await page.locator('#decisionFields [name="repairedDate"]').fill("2026-09-07");
    await page.locator('#decisionFields [name="lineType"][value="AV"]').check();
    await page.locator("#decisionSave").click();
    assert.match(await page.locator("#decisionError").innerText(), /före läckdatum/);
    await page.locator('#decisionFields [name="repairedDate"]').fill("2026-09-14");
    await page.screenshot({path:"test-results/leak-case-form.png"});
    await page.locator("#decisionSave").click();
    assert.equal((await meter("90000011")).label.type, "repaired");
    assert.equal((await meter("90000011")).label.lineType, "AV");
    assert.ok(await page.evaluate(() => state.leakCases.some(c=>c.anchorId==="90000011")));
    await page.locator("#focusMenu").click();
    await page.screenshot({path:"test-results/compact-decisions.png"});
    assert.equal(await page.locator('#contextMenu [data-decision="seasonal"]').isVisible(), false);
    await page.keyboard.press("Escape");
    await page.reload({waitUntil:"load"});
    await kit.unlock(page,null,"1234");
    await page.waitForFunction(()=>state.byId.has("90000011"));
    assert.equal((await meter("90000011")).label.confirmedDate,"2026-09-08");
    assert.ok(await page.evaluate(() => state.leakCases.some(c=>c.anchorId==="90000011")));
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log("Browser workflow PASS: import 3000×30, lists, focus, evidence, confirmed/repaired/watch/undo/reset/hide, duplicates, next export, reload, desktop and phone.");
  } catch (error) {
    await page.screenshot({ path: "test-results/failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
