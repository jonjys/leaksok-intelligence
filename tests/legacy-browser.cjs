// Existing users: a profile saved by the previous app version must open with
// imports, decisions, hidden meters and the old download list intact. Also real
// XLSX bytes with a cover sheet and Excel date cells, and a year of history.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const kit = require("./browser-kit.cjs");

(async () => {
  fs.mkdirSync("test-results", { recursive: true });
  const server = await kit.startServer(4177);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: "Europe/Stockholm" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await kit.routeExternal(page);
  try {
    await page.goto("http://127.0.0.1:4177/", { waitUntil: "load" });
    // Seed the old profile format exactly as the previous version stored it.
    await page.evaluate(async () => {
      const salt = "00112233445566778899aabbccddeeff";
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fredde|1234|${salt}`));
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("leaksok-intelligence-profile", JSON.stringify({ name: "Fredde", salt, hash, profileId: "fredde" }));
      const day = (d, h = 6, m = 30) => new Date(2026, 8, d, h, m);
      const files = [];
      for (let d = 1; d <= 20; d++) {
        files.push({ name: `Filtrerade mätare 2026-09-${String(d).padStart(2, "0")} 06-30.xlsx`, exportDate: day(d), rows: [
          { id: "111", serial: "111", address: "GAMLAVÄGEN 1 TUMBA 14730", area: "TUMBA", readAt: day(d, 4, 0), readAtUnknown: false, exportDate: day(d), current: d < 15 ? 6 : 14, average: 6, max: d < 15 ? 6 : 14, info: "", infoCode: "", activeEvents: "", closedEvents: "", source: "x" },
          { id: "222", serial: "222", address: "GAMLAVÄGEN 3 TUMBA 14730", area: "TUMBA", readAt: day(d, 4, 0), readAtUnknown: false, exportDate: day(d), current: 30, average: 30, max: 30, info: "", infoCode: "", activeEvents: "", closedEvents: "", source: "x" },
          { id: "333", serial: "333", address: "GAMLAVÄGEN 5 TUMBA 14730", area: "TUMBA", readAt: null, readAtUnknown: true, exportDate: day(d), current: 9, average: 9, max: 9, info: "", infoCode: "", activeEvents: "", closedEvents: "", source: "x" },
        ] });
      }
      const labels = {
        "111": { type: "suspect", at: "2026-09-10T08:00:00.000Z", notedDate: "2026-09-10", note: "Kolla igen", source: "snabbgruppering" },
        "222": { hidden: true, visibilityUpdatedAt: "2026-09-12T08:00:00.000Z" },
        "333": { type: "repaired", repairedDate: "2026-09-05", lineType: "SV", distanceMeters: 40, note: "Lagad förra veckan", at: "2026-09-05T10:00:00.000Z" },
      };
      const tripList = [{ id: "111", name: "111", address: "GAMLAVÄGEN 1 TUMBA 14730", reason: "Egen anteckning om grinden" }];
      await new Promise((resolve, reject) => {
        const open = indexedDB.open("leaksok-intelligence", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("profiles");
        open.onsuccess = () => {
          const tx = open.result.transaction("profiles", "readwrite");
          tx.objectStore("profiles").put({ files, labels, tripList, savedAt: new Date("2026-09-20T07:00:00") }, "fredde");
          tx.oncomplete = () => { open.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.reload({ waitUntil: "load" });
    await kit.unlock(page, null, "1234");
    await page.waitForFunction(() => state.meters.length === 3);
    const info = await page.evaluate(() => ({
      files: state.files.length,
      m111: { cat: state.byId.get("111").category, comment: state.labels["111"].note, type: state.labels["111"].type },
      hidden: state.labels["222"].hidden,
      m333: { cat: state.byId.get("333").category, distance: state.labels["333"].distanceMeters, readings: state.byId.get("333").history.readings },
      trip: state.tripList,
    }));
    assert.equal(info.files, 20, "Imported history is kept");
    assert.equal(info.m111.type, "suspect", "Stored decision is not rewritten on load");
    assert.equal(info.m111.cat, "watch", "Old manual Misstänkt is shown in the manual Bevaka list");
    assert.equal(info.hidden, true);
    assert.equal(info.m333.cat, "repaired");
    assert.equal(info.m333.distance, 40);
    assert.equal(info.m333.readings, 0, "Rows without reading date never become readings");
    assert.equal(info.trip[0].reason, "Egen anteckning om grinden");
    await page.locator("#rail .rail-more > summary").click();
    await page.locator('#rail [data-list="hidden"]').click();
    assert.equal(await page.locator('#rows tr[data-id="222"]').count(), 1);
    await page.locator("#openWorklist").click();
    assert.match(await page.locator("#worklistDialog").innerText(), /Sparad text från tidigare lista: Egen anteckning om grinden/);
    await page.locator('#worklistDialog [data-act="close"]').click();
    // The legacy note is shown as the comment until a new comment is written.
    await page.locator('#rail [data-list="watch"]').click();
    await page.locator('#rows tr[data-id="111"] [data-act="expand"]').click();
    assert.equal(await page.locator('tr[data-detail="111"] textarea[data-comment]').inputValue(), "Kolla igen");

    // Real XLSX bytes: cover sheet, Excel date cells, number cells, Swedish decimals.
    await page.waitForFunction(() => typeof XLSX !== "undefined");
    const bytes = await page.evaluate(() => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Leak Detector – export"], ["Skapad", "2026-09-21 06:30"]]), "Info");
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Serienummer", "Adress", "Område", "Senaste avläsning", "Senaste värde", "Genomsnittsvärde", "Maxvärde", "Infokod", "Aktiva händelser"],
        ["111", "GAMLAVÄGEN 1 TUMBA 14730", "TUMBA", 46286 + 4 / 24, 15, "6,5", 15, "", ""],
        ["444", "NYVÄGEN 2 TUMBA 14730", "TUMBA", 46286 + 4 / 24, "5,5", 5.5, 6, "LEAK", ""],
      ]);
      sheet.D2.t = "n"; sheet.D2.z = "yyyy-mm-dd hh:mm"; sheet.D3.t = "n"; sheet.D3.z = "yyyy-mm-dd hh:mm";
      XLSX.utils.book_append_sheet(wb, sheet, "Mätare");
      return Array.from(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
    });
    await kit.importFiles(page, [{ name: "Filtrerade mätare 2026-09-21 06-30.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) }]);
    const imported = await page.evaluate(() => {
      const m = state.byId.get("111"), n = state.byId.get("444");
      const d = m.latest.date;
      return { latest: m.latest.value, when: [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], newValue: n.latest.value, F: m.excel.F, P: m.excel.P, cat: n.category };
    });
    assert.deepEqual(imported.when, [2026, 9, 21, 4, 0], "Excel date cell read as local wall-clock time");
    assert.equal(imported.latest, 15);
    assert.equal(imported.newValue, 5.5);
    assert.equal(imported.F, 6.5);
    assert.ok(Math.abs(imported.P - (15 / 6.5 - 1)) < 1e-9);
    assert.equal(imported.cat, "customer_side");

    // A year of daily history for 3 000 meters stays usable.
    const fixture = fs.readFileSync(require.resolve("./fixtures/synthetic-exports.js"), "utf8");
    await page.addScriptTag({ content: `window.Fixture = (function(){ const module = { exports: {} }; ${fixture}; return module.exports; })();` });
    const timing = await page.evaluate(async () => {
      const t0 = performance.now();
      const raw = Fixture.buildDailyExports({ meters: 3000, days: 365, end: "2026-09-29" });
      const files = raw.map((f) => { const p = LeakParse.parseTable(f.rows, { name: f.name }); return { name: f.name, exportDate: p.exportDate, rows: p.rows }; });
      const t1 = performance.now();
      state.files = files;
      LeakApp.reanalyze(true);
      const t2 = performance.now();
      state.labels["20000001"] = { type: "interesting", at: new Date().toISOString() };
      LeakApp.reanalyze();
      const t3 = performance.now();
      return { parse: Math.round(t1 - t0), analyze: Math.round(t2 - t1), decision: Math.round(t3 - t2), meters: state.meters.length };
    });
    console.log(`Year of history: ${timing.meters} meters · generate+parse ${timing.parse} ms · analyse ${timing.analyze} ms · decision re-analysis ${timing.decision} ms`);
    assert.ok(timing.decision < timing.analyze / 3, "A decision re-analyses only the changed meter");
    assert.deepEqual(errors, []);
    console.log("Legacy PASS: old profile, decisions, hidden, old download list, legacy note as comment, XLSX dates, year of history.");
  } catch (error) {
    await page.screenshot({ path: "test-results/failure-legacy.png", fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
