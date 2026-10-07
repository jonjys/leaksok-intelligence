// Workspace layout: compact navigation, independent list scroll, responsive map
// and chart, preserved selection, and a keyboard/drag divider on wide screens.
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
      listX: table.x, listRight: table.right, focusX: document.getElementById("focus").getBoundingClientRect().x, listH: table.height, listScroll: document.querySelector(".table-wrap").scrollTop, gridH: grid.height, chartW: svg ? svg.width : 0, mapW: map.width, visible,
      font: getComputedStyle(document.querySelector("#rows .addr")).fontSize, zoom: getComputedStyle(document.body).zoom, transform: getComputedStyle(document.body).transform,
      marked: state.marked.size, focusId: state.focusId, scrollY: window.scrollY,
    };
  });
  try {
    await page.goto("http://127.0.0.1:4178/", { waitUntil: "load" });
    await page.evaluate(() => {
      const fly = L.Map.prototype.flyTo;
      L.Map.prototype.flyTo = function (...args) { window.testMap = this; return fly.apply(this, args); };
    });
    await kit.unlock(page, "Layout", "1234");
    await kit.importFiles(page, buildDailyExports({ meters: 3000, days: 30 }).map((f) => ({ name: f.name, text: toCsv(f.rows) })));
    await page.waitForFunction(() => state.meters.length === 3000);
    await page.locator('button[data-view="map"]').click();

    // Laptop: compact layout, select a meter, mark two, scroll down.
    await page.locator("#rows tr.row").nth(0).locator("[data-mark]").check();
    await page.locator("#rows tr.row").nth(1).locator("[data-mark]").check();
    const checkedId = await page.locator("#rows tr.row").nth(1).getAttribute("data-id");
    await page.waitForFunction((id) => {
      const pos = LeakMap.coordinates([...state.prepared.histories.values()]).get(id);
      const center = window.testMap?.getCenter();
      return state.focusId === id && pos && center && testMap.getZoom() === 17 && Math.abs(center.lat - pos.lat) < 0.00001 && Math.abs(center.lng - pos.lng) < 0.00001;
    }, checkedId);
    const chosenId = await page.locator("#rows tr.row").nth(2).getAttribute("data-id");
    await page.locator("#rows tr.row").nth(2).locator(".addr").click();
    await page.waitForFunction((id) => state.focusId === id, chosenId);
    await page.waitForSelector("#focusChart .ch-stage svg");
    const focusId = await page.evaluate(() => state.focusId);
    await page.waitForFunction((id) => {
      const pos = LeakMap.cachedPosition(state.byId.get(id));
      return pos && testMap.getCenter().distanceTo([pos.lat, pos.lng]) < 2;
    }, focusId);
    await page.evaluate(() => testMap.setView([59.18, 17.8], 12));
    await page.locator(`#rows tr[data-id="${focusId}"] .addr`).click();
    await page.waitForFunction((id) => {
      const pos = LeakMap.cachedPosition(state.byId.get(id));
      return testMap.getZoom() === 17 && testMap.getCenter().distanceTo([pos.lat, pos.lng]) < 2;
    }, focusId);
    await page.evaluate(() => { document.querySelector(".table-wrap").scrollTop = 500; });
    const laptop = await measure();
    assert.equal(laptop.overflow, 0, "No horizontal scroll at 1366×768");
    assert.ok(laptop.listRight <= laptop.focusX, "List sits to the left of the map, without overlap");
    assert.ok(laptop.listScroll > 0, "Meter list scrolls in its own container");
    assert.equal(laptop.scrollY, 0, "Scrolling the list leaves the map and page in place");
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "Laptop workspace fits the viewport after marking meters");

    // Navigation overlays the workspace on hover and keyboard focus.
    const listBeforeHover = await page.locator(".table-wrap").boundingBox();
    await page.locator("#rail").hover();
    await page.waitForTimeout(200);
    assert.ok((await page.locator("#rail").boundingBox()).width >= 200);
    assert.deepEqual(await page.locator(".table-wrap").boundingBox(), listBeforeHover, "Navigation opens without moving the list");
    await page.locator("#search").hover();
    await page.waitForTimeout(200);
    assert.ok((await page.locator("#rail").boundingBox()).width <= 56);

    // Right-click sort links act immediately, including with several rows marked.
    await page.locator("#rows tr.row").first().locator(".addr").click({ button: "right" });
    await page.locator("#contextMenu .menu-sort:not(.menu-decisions) summary").click();
    await page.locator('#contextMenu [data-menu-sort="address"]').click();
    assert.equal(await page.locator("#sort").inputValue(), "address");
    assert.equal(await page.locator("#contextMenu").isVisible(), false);
    assert.equal(await page.evaluate(() => state.marked.size), 2);
    await page.locator("#sort").selectOption("priority");
    await page.evaluate(() => document.querySelector(".table-wrap").scrollTop = 500);

    // Wide office screens: no max-width, table fills the width, panel bounded.
    const sizes = {};
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3440, 1440]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      const m = sizes[w] = await measure();
      assert.equal(m.overflow, 0, `No horizontal scroll at ${w}×${h}`);
      assert.ok(m.layoutW >= w - 1, `Work area fills ${w}px (no max-width)`);
      assert.ok(m.tableW >= 320 && m.tableW <= 440, "List stays readable and compact");
      assert.ok(m.listRight <= m.focusX, "List never passes underneath map");
      assert.ok(m.railW <= 240, "Rail keeps a reasonable width");
      assert.ok(m.gridH <= h, "Map and chart stay within workspace height");
      assert.equal(m.font, laptop.font, "Text keeps its normal size");
      assert.ok((m.zoom === "1" || m.zoom === "normal") && m.transform === "none", "No zoom or CSS scaling");
      if (w === 1920) await page.screenshot({ path: "test-results/layout-focus-1920.png" });
      assert.equal(m.marked, 2, "Marked meters survive resize");
      assert.equal(m.focusId, focusId, "Selected meter survives resize");
      assert.ok(m.listScroll > 0, "List scroll position is kept");
    }
    assert.ok(sizes[2560].chartW > laptop.chartW, "Chart redraws wider");
    assert.ok(sizes[2560].mapW > laptop.mapW, "Map follows its container");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#focusClose").click();
    await page.waitForTimeout(200);
    const tall = await measure();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(300);
    const mid = await measure();
    assert.ok(tall.visible > mid.visible, "Taller window shows more meter rows");
    await page.screenshot({ path: "test-results/layout-1920.png" });

    // Overview: list scroll must not shift map.
    await page.locator("button[data-view=map]").click();
    const overview = await page.locator("#map").boundingBox();
    await page.evaluate(() => document.querySelector(".table-wrap").scrollTop = 800);
    assert.deepEqual(await page.locator("#map").boundingBox(), overview, "Map stays put while list scrolls");
    await page.screenshot({ path: "test-results/layout-map-1920.png" });
    await page.evaluate(() => document.querySelector(".table-wrap").scrollTop = 0);

    // Chart stays a small strip beneath the map on office screens.
    await page.locator("#rows tr.row").nth(0).locator(".addr").click();
    await page.waitForSelector("#focusChart .ch-stage svg");
    const chartBox = await page.locator("#focusChart").boundingBox();
    const mapBox = await page.locator("#map").boundingBox();
    assert.ok(chartBox.height <= 241, "Chart never grows beyond 240px");
    assert.ok(chartBox.y >= mapBox.y + mapBox.height, "Chart sits beneath the map");
    assert.ok(mapBox.height > chartBox.height, "Map gets most of the workspace");
    await page.locator('#focusChart .ch-stage').click();
    assert.equal(await page.locator('#chartDialog').isVisible(), true, "Compact graph can still be enlarged");
    await page.locator('#chartDialog [data-close]').click();
    await page.locator('[data-chart-action="close"]').click();
    assert.equal(await page.locator('#focusChart').isVisible(), false, "X closes just the compact graph");
    assert.equal(await page.locator('#map').isVisible(), true, "Map remains visible");
    await page.locator('#showFocusChart').click();
    assert.equal(await page.locator('#focusChart').isVisible(), true, "Graph can be restored");

    // Narrow browser window on a big screen, and phone.
    for (const [w, h] of [[1100, 1440], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `No horizontal scroll at ${w}×${h}`);
    }
    await page.evaluate(() => LeakApp.setFocus(state.visible[0].id, { scroll: false }));
    await page.waitForSelector("#focusChart .ch-stage svg");
    await page.screenshot({ path: "test-results/layout-phone.png", fullPage: true });
    assert.equal(await page.locator("#focusSplit").count(), 0, "No split divider");
    assert.deepEqual(errors, []);
    console.log(`Layout PASS: rows visible 1920×1080 ${mid.visible}, 2560×1440 ${tall.visible}; table ${Math.round(sizes[3440].tableW)} px at 3440; resize keeps selection and scroll; compact chart below map.`);
  } catch (error) {
    await page.screenshot({ path: "test-results/failure-layout.png", fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
