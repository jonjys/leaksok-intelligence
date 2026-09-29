// Responsive layout: the work area follows the window (no max-width), the table uses
// the full width, the focus panel stays bounded, text keeps its size, the chart/map
// divider is draggable and remembered, and resizing keeps selection and scroll.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const kit = require("./browser-kit.cjs");
const { buildDailyExports, toCsv } = require("./fixtures/synthetic-exports.js");

(async () => {
  fs.mkdirSync("test-results", { recursive: true });
  const server = await kit.startServer(4178);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: "Europe/Stockholm" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await kit.routeExternal(page);
  const measure = () => page.evaluate(() => {
    const layout = document.querySelector(".layout").getBoundingClientRect();
    const table = document.querySelector(".table-wrap").getBoundingClientRect();
    const rail = document.querySelector(".rail").getBoundingClientRect();
    const grid = document.querySelector(".focus-grid").getBoundingClientRect();
    const svg = document.querySelector("#focusChart .ch-stage svg")?.getBoundingClientRect();
    const map = document.getElementById("map").getBoundingClientRect();
    const rows = [...document.querySelectorAll("#rows tr.row")];
    const visible = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }).length;
    return {
      overflow: document.documentElement.scrollWidth - innerWidth, layoutW: layout.width, tableW: table.width, railW: rail.width,
      gridH: grid.height, chartW: svg ? svg.width : 0, mapW: map.width, visible,
      font: getComputedStyle(document.querySelector("#rows .addr")).fontSize, zoom: getComputedStyle(document.body).zoom, transform: getComputedStyle(document.body).transform,
      marked: state.marked.size, focusId: state.focusId, scrollY: window.scrollY,
    };
  });
  try {
    await page.goto("http://127.0.0.1:4178/", { waitUntil: "load" });
    await kit.unlock(page, "Layout", "1234");
    await kit.importFiles(page, buildDailyExports({ meters: 3000, days: 30 }).map((f) => ({ name: f.name, text: toCsv(f.rows) })));
    await page.waitForFunction(() => state.meters.length === 3000);

    // Laptop: compact layout, select a meter, mark two, scroll down.
    await page.locator("#rows tr.row").nth(0).locator("[data-mark]").check();
    await page.locator("#rows tr.row").nth(1).locator("[data-mark]").check();
    await page.locator("#rows tr.row").nth(2).locator(".addr").click();
    await page.waitForSelector("#focusChart .ch-stage svg");
    const focusId = await page.evaluate(() => state.focusId);
    await page.evaluate(() => window.scrollTo(0, 500));
    const laptop = await measure();
    assert.equal(laptop.overflow, 0, "No horizontal scroll at 1366×768");
    assert.ok(laptop.gridH <= 300, "Panel stays compact on a laptop");

    // Wide office screens: no max-width, table fills the width, panel bounded.
    const sizes = {};
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3440, 1440]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      const m = sizes[w] = await measure();
      assert.equal(m.overflow, 0, `No horizontal scroll at ${w}×${h}`);
      assert.ok(m.layoutW >= w - 1, `Work area fills ${w}px (no max-width)`);
      assert.ok(m.tableW >= w - m.railW - 60, `Table uses the work area width at ${w}px`);
      assert.ok(m.railW <= 240, "Rail keeps a reasonable width");
      assert.ok(m.gridH <= h * 0.34, `Focus panel does not take over the screen at ${w}×${h}`);
      assert.equal(m.font, laptop.font, "Text keeps its normal size");
      assert.ok((m.zoom === "1" || m.zoom === "normal") && m.transform === "none", "No zoom or CSS scaling");
      assert.equal(m.marked, 2, "Marked meters survive resize");
      assert.equal(m.focusId, focusId, "Selected meter survives resize");
      assert.ok(m.scrollY > 0, "Scroll position is kept");
    }
    assert.ok(sizes[2560].chartW > laptop.chartW * 1.6, "Chart redraws wider");
    assert.ok(sizes[2560].mapW > laptop.mapW * 1.6, "Map follows its container");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#focusClose").click();
    await page.waitForTimeout(200);
    const tall = await measure();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(300);
    const mid = await measure();
    assert.ok(tall.visible > mid.visible, "Taller window shows more meter rows");
    await page.screenshot({ path: "test-results/layout-1920.png" });

    // Draggable divider between chart and map, remembered after reload.
    await page.locator("#rows tr.row").nth(0).locator(".addr").click();
    await page.waitForSelector("#focusChart .ch-stage svg");
    const handle = page.locator("#focusSplit");
    const grid = await page.locator(".focus-grid").boundingBox();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(grid.x + grid.width * 0.65, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    assert.equal(await handle.getAttribute("aria-valuenow"), "65");
    await page.waitForTimeout(300);
    const split = await page.evaluate(() => ({ chart: document.getElementById("focusChart").offsetWidth, map: document.querySelector(".focus-map").offsetWidth }));
    assert.ok(split.chart > split.map * 1.6, "Chart gets the dragged share");
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal(await handle.getAttribute("aria-valuenow"), "60", "Divider works with the keyboard");
    await page.reload({ waitUntil: "load" });
    await kit.unlock(page, null, "1234");
    await page.waitForFunction(() => state.meters.length === 3000);
    assert.equal(await page.locator("#focusSplit").getAttribute("aria-valuenow"), "60", "Split is remembered");

    // Narrow browser window on a big screen, and phone.
    for (const [w, h] of [[1100, 1440], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `No horizontal scroll at ${w}×${h}`);
    }
    assert.equal(await page.locator("#focusSplit").isVisible(), false, "No divider on phone");
    assert.deepEqual(errors, []);
    console.log(`Layout PASS: rows visible 1920×1080 ${mid.visible}, 2560×1440 ${tall.visible}; table ${Math.round(sizes[3440].tableW)} px at 3440; resize keeps selection and scroll; divider saved.`);
  } catch (error) {
    await page.screenshot({ path: "test-results/failure-layout.png", fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
