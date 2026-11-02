// Export selection: exactly the marked meters, across pages; explicit filtered
// "mark all"; work list exports only ticked rows; downloaded XLSX is inspected.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const kit = require("./browser-kit.cjs");
const { unzip, cells } = require("./xlsx-inspect.cjs");
const { buildDailyExports, toCsv } = require("./fixtures/synthetic-exports.js");

(async () => {
  fs.mkdirSync("test-results", { recursive: true });
  const server = await kit.startServer(4174);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Stockholm", acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await kit.routeExternal(page);
  async function download(trigger) {
    const event = page.waitForEvent("download");
    await trigger();
    const file = await (await event).path();
    const parts = unzip(fs.readFileSync(file));
    const c = cells(parts["xl/worksheets/sheet1.xml"]);
    const serials = Object.keys(c).filter((k) => /^B\d+$/.test(k) && k !== "B1").sort((a, b) => a.slice(1) - b.slice(1)).map((k) => c[k]);
    return { parts, cells: c, serials };
  }
  try {
    await page.goto("http://127.0.0.1:4174/", { waitUntil: "load" });
    await kit.unlock(page, "Export", "1234");
    const files = buildDailyExports({ meters: 3000, days: 3 });
    await kit.importFiles(page, files.map((f) => ({ name: f.name, text: toCsv(f.rows) })));
    await page.waitForFunction(() => state.meters.length === 3000);

    // Mark one meter on each of three pages.
    const marked = [];
    for (let p = 0; p < 3; p++) {
      const box = page.locator("#rows tr.row").nth(p * 7).locator("[data-mark]");
      marked.push(await page.locator("#rows tr.row").nth(p * 7).getAttribute("data-id"));
      await box.check();
      await page.locator("#nextPage").click();
    }
    assert.match(await page.locator("#selectionBar").innerText(), /3 markerade/);
    const visibleTotal = await page.evaluate(() => state.visible.length);
    assert.match(await page.locator("#pageInfo").innerText(), new RegExp(`Visar 151–200 av ${visibleTotal.toLocaleString("sv-SE").replace(/\s/g,"\\s")} träffar · sida 4/${Math.ceil(visibleTotal/50)}`));
    await kit.selectionAction(page, "excel");
    assert.match(await page.locator("#exportTitle").innerText(), /Exportera 3 mätare/, "Count shown before download");
    let book = await download(() => page.locator('#exportDialog [data-act="download"]').click());
    assert.deepEqual([...book.serials].sort(), [...marked].sort(), "Exactly the three marked meters");
    assert.equal(book.cells.A1, "Adress");
    assert.equal(book.cells.B1, "Serienummer");
    assert.equal(book.cells["B2@t"], "inlineStr");
    assert.match(book.parts["xl/tables/table1.xml"], /ref="A1:K4"/);
    assert.match(book.parts["xl/worksheets/sheet1.xml"], /state="frozen"/);
    assert.match(book.parts["xl/worksheets/sheet1.xml"], /orientation="landscape" fitToWidth="1"/);
    assert.match(book.parts["xl/worksheets/sheet1.xml"], /"Ej utförd,Klar"/);
    assert.ok(book.parts["xl/worksheets/sheet2.xml"].includes("Analysunderlag") || book.parts["xl/workbook.xml"].includes("Analysunderlag"));

    // Filtered "mark all" covers exactly the filtered hits, and says so.
    await page.locator("#search").fill("LÅGNIVÅVÄGEN");
    const hits = await page.evaluate(() => state.visible.length);
    assert.equal(hits, 2);
    await page.locator("#selectionBar .selection-menu summary").click();
    assert.match(await page.locator('#selectionBar [data-sel="all"]').innerText(), /Markera alla 2 träffar/);
    await kit.selectionAction(page, "all");
    assert.match(await page.locator("#selectionBar").innerText(), /5 markerade \(3 utanför listan · kvar på kartan\)/);
    await kit.selectionAction(page, "clear");
    assert.equal(await page.locator('#selectionBar [data-sel="excel"]').count(), 0, "No export without a selection");
    await kit.selectionAction(page, "all");
    book = await download(async () => { await kit.selectionAction(page, "excel"); await page.locator('#exportDialog [data-act="download"]').click(); });
    assert.deepEqual([...book.serials].sort(), ["90000001", "90000002"]);

    // Work list: add, nothing preselected, export only ticked rows.
    await kit.selectionAction(page, "worklist");
    assert.equal(await page.locator("#worklistCount").innerText(), "2");
    await page.locator("#openWorklist").click();
    assert.equal(await page.locator('#worklistDialog [data-act="export"]').isDisabled(), true);
    await page.locator("#worklistDialog tr[data-id='90000002'] [data-pick]").check();
    await page.locator("#worklistDialog tr[data-id='90000002'] [data-comment]").fill("=ring FÄ före besök");
    await page.locator("#worklistDialog tr[data-id='90000002'] [data-comment]").blur();
    await page.locator('#worklistDialog [data-act="export"]').click();
    book = await download(() => page.locator('#exportDialog [data-act="download"]').click());
    assert.deepEqual(book.serials, ["90000002"]);
    const commentRow = Object.keys(book.cells).find((k) => /^J\d+$/.test(k) && book.cells[k] === "=ring FÄ före besök");
    assert.ok(commentRow, "Comment exported as text");
    await page.locator('#worklistDialog [data-act="close"]').click();

    // Reload: work list persists, old ticks are not restored.
    await page.reload({ waitUntil: "load" });
    await kit.unlock(page, null, "1234");
    await page.waitForFunction(() => state.meters.length === 3000);
    await page.locator("#openWorklist").click();
    assert.equal(await page.locator("#worklistDialog tbody tr").count(), 2);
    assert.equal(await page.locator('#worklistDialog [data-act="export"]').isDisabled(), true);
    await page.locator('#worklistDialog [data-act="close"]').click();

    // Legacy list with 2 900 entries never exports everything automatically.
    await page.evaluate(async () => {
      state.tripList = state.meters.slice(0, 2900).map((m) => ({ id: m.id, name: m.id, address: m.address, reason: "Kontroll" }));
      LeakApp.render();
    });
    await page.locator("#openWorklist").click();
    assert.equal(await page.locator("#worklistDialog tbody tr").count(), 2900);
    assert.equal(await page.locator('#worklistDialog [data-act="export"]').isDisabled(), true);
    assert.match(await page.locator("#worklistDialog tbody tr").first().innerText(), /Sparad text från tidigare lista: Kontroll/);
    await page.locator("#worklistDialog [data-pick]").first().check();
    book = await download(async () => { await page.locator('#worklistDialog [data-act="export"]').click(); await page.locator('#exportDialog [data-act="download"]').click(); });
    assert.equal(book.serials.length, 1);

    // Phone layout of the work list.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#openWorklist").click().catch(() => {});
    await page.screenshot({ path: "test-results/worklist-mobile.png" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    console.log("Export PASS: 3 marked across pages → 3 rows, filtered mark-all, no empty export, work list ticks only, comments as text, persisted list, 2 900 legacy entries, phone.");
  } catch (error) {
    await page.screenshot({ path: "test-results/failure-export.png", fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });

