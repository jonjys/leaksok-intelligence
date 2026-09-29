const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../src/engine.js");
const Chart = require("../src/chart.js");

const DAY = 86400000;
function analyzed(values, start = "2026-09-01") {
  const first = new Date(`${start}T06:30:00`);
  const files = values.map((v, d) => {
    const exportDate = new Date(first.getTime() + d * DAY);
    const rows = [];
    if (v !== null) {
      const { value, readDay } = typeof v === "object" ? v : { value: v, readDay: d };
      const readAt = new Date(first.getTime() + readDay * DAY); readAt.setHours(4, 0, 0, 0);
      rows.push({ id: "c", serial: "c", address: "GRAFVÄGEN 1 TUMBA", area: "TUMBA", readAt, current: value });
    }
    return { name: `f${d}.csv`, exportDate, rows };
  });
  return Engine.analyzeAll(files, {}).meters[0];
}
const segments = (svg) => (svg.match(/class="ch-line"/) ? svg.match(/<path d="([^"]*)" class="ch-line"/)[1].split("M").filter(Boolean).length : 0);

test("ingen kurva dras genom dataluckor", () => {
  const m = analyzed([5, 5, 5, 5, ...Array(10).fill(null), 10, 10, 10]);
  const { svg } = Chart.buildSvg(m, { width: 600, height: 240 });
  assert.equal(segments(svg), 2, "Two separate segments around the gap");
  assert.match(svg, /class="ch-gap"><title>Inga avläsningar 4 sep–15 sep \(11 dagar\)/);
  assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
});

test("tid efter senaste avläsning visas som saknat underlag", () => {
  const m = analyzed([5, 6, 5, 6, 5, { value: 5, readDay: 4 }, { value: 5, readDay: 4 }, { value: 5, readDay: 4 }]);
  const { svg } = Chart.buildSvg(m, { width: 600, height: 240 });
  assert.match(svg, /class="ch-stale"><title>Ingen ny avläsning 5 sep–8 sep \(3 dagar\)/);
  const dots = svg.match(/class="ch-dot/g).length;
  assert.equal(dots, 5, "Re-exported readings are not drawn as new points");
});

test("x-axeln följer verkliga datum och etiketter överlappar inte", () => {
  const m = analyzed(Array.from({ length: 40 }, (_, i) => 5 + (i % 3)));
  const { svg, points } = Chart.buildSvg(m, { width: 640, height: 260 });
  const xs = points.map((p) => p.x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), "x increases with date");
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.01, "Equal day spacing gives equal distance");
  const labels = [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="middle" class="ch-axis">/g)].map((x) => Number(x[1]));
  assert.ok(labels.length >= 3);
  assert.ok(labels.slice(1).every((x, i) => x - labels[i] >= 60), "Date labels at least 60 px apart");
});

test("jämförelse mot tidigare 0 ger ingen påhittad procent", () => {
  const m = analyzed([0, 0, 0, 8]);
  const { comparison } = Chart.buildSvg(m, {});
  assert.equal(comparison.percent, null);
  assert.equal(Chart.compareText(comparison), "+8 (ingen procent, från 0) mot 3 sep: 0");
});

test("en enda avläsning och inga avläsningar ritas utan fel", () => {
  const one = analyzed([42]);
  assert.doesNotMatch(Chart.buildSvg(one, {}).svg, /NaN|Infinity/);
  assert.match(Chart.buildSvg({ id: "x", series: [] }, {}).svg, /Inga avläsningar att visa/);
});

test("minigraf, graf och tabell visar samma senaste värde", () => {
  const m = analyzed([5, 5, 5, 5, 10]);
  const { points } = Chart.buildSvg(m, {});
  assert.equal(points[points.length - 1].value, m.latest.value);
  const spark = Chart.sparkline(m);
  assert.match(spark, /class="sp-last"/);
  assert.match(spark, /class="sp-ref"/, "Reference level line in the sparkline");
});

test("referenslinjer förklaras med period", () => {
  const m = analyzed([...Array(20).fill(5), 10, 11, 12, 12]);
  const { svg } = Chart.buildSvg(m, { width: 700, height: 260 });
  assert.match(svg, /class="ch-ref"><title>före 5 \(1 sep–20 sep\)<\/title>/);
  assert.match(svg, /class="ch-now"><title>nu 11,5 \(21 sep–24 sep\)<\/title>/);
});
