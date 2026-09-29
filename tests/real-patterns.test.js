// Anonymised patterns taken from real Kamstrup exports (22–28 Sep). IDs, addresses and
// exact numbers are invented; the structure follows the real files: one sheet, title
// row, export timestamp with offset in N1, header on row 6, every value a string,
// Ignorera/Följ as booleans, rows without value or date, and only the latest reading
// per meter in each export (so days without an export have no readings at all).
const test = require("node:test");
const assert = require("node:assert/strict");
const Parse = require("../src/parse.js");
const History = require("../src/history.js");
const Engine = require("../src/engine.js");

const HEADER = ["Mätare av intresse", "Adress", "Serienummer", "Senaste avläsning", "Senaste värde", "Genomsnittsvärde", "Maxvärde", "Minimiflöde", "Minimum flödesdatum", "Infokod", "Aktiva händelser", "Stängda händelser", "Ignorera", "Följ"];
// Real export times; readings are normally from the same morning.
const EXPORTS = ["2026-09-22T15:31:10+02:00", "2026-09-23T15:21:40+02:00", "2026-09-24T15:22:43+02:00", "2026-09-25T06:28:05+02:00", "2026-09-28T06:48:30+02:00"];
const READ = ["2026-09-22 04:40", "2026-09-23 04:35", "2026-09-24 04:50", "2026-09-25 04:30", "2026-09-28 04:45"];

// meter: { id, values: [v | [readAt, v] | null per export], F, info, active, closed, follow }
function table(meters, e) {
  const aoa = [Array(13).fill(null).concat(EXPORTS[e]), Array(14).fill(null), Array(14).fill(null), [null, "Filtrerade mätare"].concat(Array(12).fill(null)), Array(14).fill(null), HEADER];
  for (const m of meters) {
    const entry = m.values[e];
    if (entry === undefined) continue;
    const [readAt, value] = entry === null ? ["", ""] : Array.isArray(entry) ? entry : [READ[e], entry];
    const seen = m.values.slice(0, e + 1).map((x) => (Array.isArray(x) ? x[1] : x)).filter((x) => x != null);
    aoa.push(["", m.address || `PROVGATAN ${m.id.slice(-2)} TUMBA 14730`, m.id, readAt, value === "" ? "" : String(value), m.F == null ? "" : String(m.F), seen.length ? String(Math.max(...seen, m.F || 0)) : "", "", "", (m.info && m.info[e]) || "", (m.active && m.active[e]) || "", (m.closed && m.closed[e]) || "", false, Boolean(m.follow)]);
  }
  return aoa;
}
const fileName = (e) => `Filtrerade_mätare_${EXPORTS[e].slice(0, 10)}_${EXPORTS[e].slice(11, 16).replace(":", "-")}.xlsx`;
function files(meters, order = [0, 1, 2, 3, 4]) {
  return order.map((e) => {
    const p = Parse.parseTable(table(meters, e), { name: fileName(e) });
    return { name: fileName(e), exportDate: p.exportDate, rows: p.rows };
  });
}
const analyzeAll = (meters, order) => Engine.analyzeAll(files(meters, order), {}).meters;
const one = (meter) => analyzeAll([meter]).find((m) => m.id === meter.id);

test("verklig exportstruktur: rubrik på rad 6, exporttid i N1, strängvärden, flaggor och tomma rader", () => {
  const meters = [
    { id: "90000001", values: [6, 5, 6, 6, 7], F: 6, follow: true },
    { id: "90000002", values: [null, null, null, null, null] },
  ];
  const p = Parse.parseTable(table(meters, 4), { name: fileName(4) });
  assert.equal(p.exportDate.getTime(), new Date(2026, 8, 28, 6, 48).getTime(), "File name gives the export time (local clock)");
  const renamed = Parse.parseTable(table(meters, 4), { name: "export.xlsx" });
  assert.equal(renamed.exportDate.toISOString(), "2026-09-28T04:48:30.000Z", "Without a dated name, N1 with its offset is used");
  assert.equal(renamed.exportDateSource, "rapporthuvud");
  assert.equal(p.rows.length, 2);
  const [a, b] = p.rows;
  assert.equal(a.id, "90000001");
  assert.equal(a.current, 7);
  assert.equal(a.average, 6);
  assert.equal(a.follow, true, "Följ flag kept");
  assert.equal(b.current, null, "Blank value is missing, not zero");
  assert.equal(b.readAt, null);
  const h = History.buildHistories(files(meters)).histories;
  assert.equal(h.get("90000002").series.length, 0);
  const m = Engine.analyzeAll(files(meters), {}).meters.find((x) => x.id === "90000002");
  assert.match(m.summary, /Saknar giltiga värden/);
});

test("låg nivå med stor procentuell ökning: 6,5,6,6 → 27 är ny signal med tydlig osäkerhet", () => {
  const m = one({ id: "90000011", values: [6, 5, 6, 6, 27], F: 13 });
  assert.equal(m.finding.type, "new_signal");
  assert.equal(m.category, "suspect_auto");
  assert.equal(m.finding.ref.level, 6);
  assert.equal(m.finding.ref.n, 4);
  assert.equal(m.finding.delta, 21);
  assert.match(m.summary, /6 → 27 \(\+350 %\)/);
  assert.equal(m.confidence, "tunt");
  assert.ok(m.observations.some((o) => /ännu oklart/.test(o)));
  assert.ok(Math.abs(m.excel.P - (27 / 13 - 1)) < 1e-9, "P from the same row");
});

test("tydlig nivåhöjning: 13,13 → 23,24,22 är ny nivå med referens av två avläsningar", () => {
  const m = one({ id: "90000012", values: [13, 13, 23, 24, 22], F: 16 });
  assert.equal(m.finding.type, "level_shift");
  assert.equal(m.finding.direction, "up");
  assert.equal(m.finding.ref.level, 13);
  assert.equal(m.finding.ref.n, 2);
  assert.equal(m.finding.persistence.n, 3);
  assert.equal(m.category, "suspect_auto");
  assert.match(m.summary, /13 → 23 \(\+77 %\), 3 avläsningar på 5 dagar/);
});

test("LEAK med nivåhöjning efter en enda referensavläsning: σ överskattas inte av själva hoppet", () => {
  const m = one({ id: "90000013", values: [177, 412, 345, 420, 410], F: 42, info: ["", "LEAK", "LEAK", "LEAK", "LEAK"] });
  assert.equal(m.finding.type, "level_shift", "Not dismissed as a transient");
  assert.equal(m.finding.ref.n, 1);
  assert.equal(m.category, "customer_side");
  assert.match(m.summary, /LEAK/);
  assert.ok(m.observations.some((o) => /1 avläsning – osäker referens/.test(o)));
});

test("ökning under Kamstrups längre snitt F med kort egen historik är inte förhöjd", () => {
  const m = one({ id: "90000014", values: [6, 6, 7, 6, 11], F: 50 });
  assert.equal(m.category, "normal");
  assert.match(m.summary, /inte över Kamstrups snitt F 50/);
});

test("förändring inom normal variation: 11 ×4 → 14 är inte en ny signal", () => {
  const m = one({ id: "90000015", values: [11, 11, 11, 11, 14], F: 11 });
  assert.notEqual(m.finding.type, "new_signal");
  assert.equal(m.category, "normal");
  assert.equal(m.changePrev.delta, 3, "The change itself is still shown");
});

test("stabil nivå långt över F med kort historik lyfts med osäkerhet", () => {
  const m = one({ id: "90000016", values: [104, 99, 113, 108, 106], F: 31 });
  assert.equal(m.category, "suspect_auto");
  assert.match(m.summary, /Över Kamstrups snitt: nivå 106 mot F 31/);
  assert.ok(m.observations.some((o) => /räcker inte för att se när nivån ändrades/.test(o)));
});

test("topp med observerad återgång: 31,29,58,56,31 är tillfällig", () => {
  const m = one({ id: "90000017", values: [31, 29, 58, 56, 31], F: 33 });
  assert.equal(m.finding.type, "transient");
  assert.equal(m.category, "noise");
});

test("gammal avläsning som exporteras fem gånger räknas en gång och är inte färsk", () => {
  const read = ["2026-08-26 14:30", 25];
  const m = one({ id: "90000018", values: [read, read, read, read, read], F: 26 });
  assert.equal(m.history.readings, 1);
  assert.equal(m.history.reexports, 4);
  assert.equal(m.category, "stale_contact");
  assert.match(m.summary, /Ingen ny avläsning sedan 26 aug/);
});

test("BURST med stor ensam topp är efter mätaren, men ensam avläsning", () => {
  const m = one({ id: "90000019", values: [26, 11, 22, 28, 986], F: 25, info: ["", "", "", "", "BURST, LEAK"] });
  assert.equal(m.category, "customer_side");
  assert.equal(m.finding.type, "new_signal");
  assert.match(m.summary, /BURST/);
});

test("lucka: avläsning stående på 20 sep i fyra exporter och sedan ny avläsning 28 sep", () => {
  const old = ["2026-09-20 04:10", 8];
  const m = one({ id: "90000020", values: [old, old, old, old, 29], F: 9 });
  assert.equal(m.history.readings, 2, "Four exports of the same reading count once");
  assert.equal(m.changePrev.gapDays, 8);
  assert.ok(m.observations.some((o) => /8 dagar tidigare/.test(o)));
});

test("två avläsningar samma dag ger en dagspunkt med dygnets lägsta värde", () => {
  const meter = { id: "90000021", values: [10, 10, ["2026-09-24 08:50", 12], ["2026-09-24 23:10", 10], 10], F: 10 };
  const m = one(meter);
  const day = m.series.find((p) => p.date.getDate() === 24);
  assert.equal(day.value, 10);
  assert.equal(day.readings, 2);
  assert.equal(m.history.readings, 4, "Four reading days, not five");
});

test("Följ-flaggan och stängda händelser syns som information, inte som läckbevis", () => {
  const m = one({ id: "90000022", values: [455, 496, 442, 458, 464], F: 562, follow: true, closed: ["", "", "", "", "Läckage"] });
  assert.equal(m.category, "stable_high");
  assert.ok(m.codes.follow);
  assert.match(m.codes.closedEvents, /Läckage/);
  assert.ok(m.observations.some((o) => /Följ i Kamstrup/.test(o)));
});

test("importordning och omimport av de verkliga mönstren ger samma resultat utan dubblerad historik", () => {
  const meters = [
    { id: "90000011", values: [6, 5, 6, 6, 27], F: 13 },
    { id: "90000012", values: [13, 13, 23, 24, 22], F: 16 },
    { id: "90000013", values: [177, 412, 345, 420, 410], F: 42, info: ["", "LEAK", "LEAK", "LEAK", "LEAK"] },
    { id: "90000017", values: [31, 29, 58, 56, 31], F: 33 },
    { id: "90000018", values: Array(5).fill(["2026-08-26 14:30", 25]), F: 26 },
  ];
  const sig = (list) => list.map((m) => [m.id, m.category, m.priority, m.summary, m.history.readings, m.series.map((p) => p.value).join(",")].join("|")).sort().join("\n");
  const base = sig(analyzeAll(meters));
  assert.equal(sig(analyzeAll(meters, [4, 2, 0, 3, 1])), base);
  assert.equal(sig(analyzeAll(meters, [0, 1, 2, 3, 4, 0, 1, 2, 3, 4])), base, "Re-import adds no readings");
});
