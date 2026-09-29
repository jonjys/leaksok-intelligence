const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../src/engine.js");

const DAY = 86400000;
// Build daily exports from a list of values; null = meter absent from that export,
// { v, readDay } = re-export of an older reading.
function exportsFor(values, { start = "2026-09-01", id = "m1", address = "TESTVÄGEN 1 TUMBA 14730", area = "TUMBA", info = [], events = [], average = [], max = [], extra = [] } = {}) {
  const first = new Date(`${start}T06:30:00`);
  const files = [];
  values.forEach((entry, d) => {
    const exportDate = new Date(first.getTime() + d * DAY);
    const rows = [];
    if (entry !== null) {
      const { v, readDay } = typeof entry === "object" ? entry : { v: entry, readDay: d };
      const readAt = new Date(first.getTime() + readDay * DAY);
      readAt.setHours(4, 0, 0, 0);
      rows.push({ id, serial: id, address, area, readAt, current: v, average: average[d] ?? null, max: max[d] ?? null, infoCode: info[d] || "", activeEvents: events[d] || "" });
    }
    for (const other of extra) {
      const e = other.values[d];
      if (e == null) continue;
      const readAt = new Date(first.getTime() + d * DAY); readAt.setHours(4, 0, 0, 0);
      rows.push({ id: other.id, serial: other.id, address: other.address, area: other.area || area, readAt, current: e });
    }
    files.push({ name: `Filtrerade mätare ${exportDate.toISOString().slice(0, 10)} 06-30.xlsx`, exportDate, rows });
  });
  return files;
}
function analyze(values, options = {}) {
  const { meters } = Engine.analyzeAll(exportsFor(values, options), options.labels || {});
  return meters.find((m) => m.id === (options.id || "m1"));
}
const flat = (value, count) => Array(count).fill(value);

test("1. liten första ökning 5 → 10 är en ny signal, inte bevisad läcka", () => {
  const m = analyze([...flat(5, 20), 10]);
  assert.equal(m.finding.type, "new_signal");
  assert.equal(m.category, "suspect_auto");
  assert.equal(m.changePrev.delta, 5);
  assert.equal(m.changePrev.pct, 1);
  assert.equal(m.confidence, "tunt");
  assert.match(m.summary, /5 → 10 \(\+100 %\)/);
  assert.match(m.action, /nästa avläsning/);
  assert.ok(m.observations.some((o) => /ännu oklart/.test(o)));
  assert.ok(m.priority < 50, "Priority is a ranking, a single reading stays moderate");
});

test("2. liten bestående ökning 5 → 10 → 11 → 12 ger starkare belägg", () => {
  const single = analyze([...flat(5, 20), 10]);
  const m = analyze([...flat(5, 20), 10, 11, 12, 12]);
  assert.equal(m.finding.type, "level_shift");
  assert.equal(m.finding.direction, "up");
  assert.equal(m.finding.persistence.n, 4);
  assert.equal(m.finding.ref.level, 5);
  assert.equal(m.category, "suspect_auto");
  assert.ok(m.priority > single.priority);
  assert.notEqual(m.confidence, "tunt");
  assert.match(m.summary, /Ny högre nivå sedan 21 sep: 5 → 11,5/);
});

test("3. stor ensam topp 5 → 100 med en avläsning är oklar, inte falsklarm", () => {
  const m = analyze([...flat(5, 20), 100]);
  assert.equal(m.finding.type, "new_signal");
  assert.equal(m.category, "suspect_auto");
  assert.notEqual(m.category, "noise");
  assert.ok(m.observations.some((o) => /ännu oklart om den består/.test(o)));
});

test("4. observerad återgång 5 → 100 → 5 är tillfällig topp", () => {
  const m = analyze([...flat(5, 20), 100, 5]);
  assert.equal(m.finding.type, "transient");
  assert.equal(m.category, "noise");
  assert.match(m.summary, /Tillfällig topp 100 \(21 sep\), tillbaka på 5 \(22 sep\)/);
  const two = analyze([...flat(5, 20), 100, 100, 5]);
  assert.equal(two.finding.type, "transient", "A two-reading excursion that returns is also transient");
});

test("5. långvarigt högt stabilt brus skiljs från ny bestående ökning", () => {
  const high = analyze(flat(200, 30).map((v, i) => v + (i % 5) - 2));
  assert.equal(high.category, "stable_high");
  assert.equal(high.upFinding, null);
  const lowRise = analyze([...flat(5, 20), 10, 11, 12, 12, 11, 12, 12, 11, 12, 12]);
  assert.ok(lowRise.priority > high.priority, "A low but persistent relative rise outranks an always-high meter");
  assert.ok(["suspect_auto", "dispatch"].includes(lowRise.category));
});

test("6. långsam ökning ger trend", () => {
  const m = analyze(Array.from({ length: 30 }, (_, i) => Math.round(10 + (20 * i) / 29)));
  assert.equal(m.finding.type, "trend");
  assert.ok(m.finding.slopePerDay > 0.5 && m.finding.slopePerDay < 0.9);
  assert.ok(["suspect_auto", "dispatch"].includes(m.category));
  assert.match(m.summary, /Gradvis ökning/);
});

test("7. upprepade exporter av samma avläsning är inte nya bekräftelser", () => {
  const values = [...flat(5, 20), 12, { v: 12, readDay: 20 }, { v: 12, readDay: 20 }, { v: 12, readDay: 20 }];
  const m = analyze(values);
  assert.equal(m.history.readings, 21);
  assert.equal(m.finding.type, "new_signal", "Still one reading on the new level");
  assert.equal(m.latest.reexports, 3);
  assert.equal(m.latest.ageDays, 3);
  assert.ok(m.dataQuality.some((q) => /exporterats 4 gånger/.test(q)));
  assert.match(m.summary, /^Avläst 21 sep, 3 dagar sedan/);
});

test("8. lång datalucka räknas inte som beständighet", () => {
  const values = [...flat(5, 8), ...flat(null, 18), 10, 10, 10, 10];
  const m = analyze(values);
  assert.equal(m.finding.type, "level_shift");
  assert.equal(m.finding.persistence.n, 4);
  assert.equal(m.finding.persistence.days, 3);
  assert.ok(m.observations.some((o) => /någon gång mellan 8 sep och 27 sep/.test(o)));
  assert.ok(m.dataQuality.some((q) => /Inga avläsningar 8 sep–27 sep \(19 dagar\)/.test(q)));
});

test("9. gammal avläsning i ny export presenteras inte som färsk ökning", () => {
  const values = [...flat(6, 9), 40, ...Array(20).fill({ v: 40, readDay: 9 })];
  const m = analyze(values);
  assert.equal(m.category, "stale_contact");
  assert.equal(m.latest.ageDays, 20);
  assert.match(m.summary, /^Ingen ny avläsning sedan 10 sep \(20 dagar\)\. Senast:/);
  assert.equal(m.isNewToday, false);
});

test("10. nollvärde, saknat värde och decimaler", () => {
  const zero = analyze([...flat(0, 20), 5.5, 8]);
  assert.equal(zero.finding.ref.level, 0);
  assert.equal(zero.finding.pct, null, "Zero denominator gives no invented percentage");
  assert.equal(zero.changePrev.pct, 8 / 5.5 - 1);
  assert.match(zero.summary, /ingen procent, från 0/);
  const missing = analyze([...flat(7, 20), ""]);
  assert.equal(missing.latest.value, 7, "Missing value is not zero");
  assert.ok(missing.dataQuality.some((q) => /saknar Senaste värde/.test(q)));
  const fZero = analyze([...flat(7, 5)], { average: flat(0, 5) });
  assert.equal(fZero.excel.P, null);
  assert.ok(fZero.dataQuality.some((q) => /F är 0/.test(q)));
});

test("E, F, G och P kommer från samma senaste exportrad", () => {
  const m = analyze([5, 6, 12], { average: [5, 5.5, 8], max: [5, 6, 30] });
  assert.equal(m.excel.E, 12);
  assert.equal(m.excel.F, 8);
  assert.equal(m.excel.G, 30);
  assert.equal(m.excel.P, 12 / 8 - 1);
  const noMax = analyze([5, 6, 12]);
  assert.equal(noMax.excel.G, null, "Missing G is not replaced by E");
});

test("11. ofullständigt respektive återkommande säsongsunderlag", () => {
  const monthly = (entries) => {
    const files = entries.map(([date, v]) => {
      const exportDate = new Date(`${date}T06:30:00`);
      const files = [];
      return { name: `x ${date}.xlsx`, exportDate, rows: [{ id: "s", serial: "s", address: "VÄRMEVÄGEN 1 TUMBA", area: "TUMBA", readAt: new Date(`${date}T04:00:00`), current: v }] };
    });
    return Engine.analyzeAll(files, {}).meters[0];
  };
  const days = (from, to, value) => {
    const out = [];
    for (let t = new Date(`${from}T12:00:00`); t <= new Date(`${to}T12:00:00`); t = new Date(t.getTime() + 5 * DAY)) out.push([t.toISOString().slice(0, 10), value]);
    return out;
  };
  const incomplete = monthly([...days("2025-06-01", "2025-08-31", 8), ...days("2025-11-01", "2026-02-28", 30)]);
  assert.equal(incomplete.season.status, "possible");
  assert.notEqual(incomplete.category, "seasonal", "One winter and one summer is not a verified pattern");
  const recurring = monthly([...days("2024-11-01", "2025-02-28", 30), ...days("2025-05-01", "2025-08-31", 8), ...days("2025-11-01", "2026-02-28", 31)]);
  assert.equal(recurring.season.status, "verified");
  assert.equal(recurring.category, "seasonal");
});

test("12. ny avvikelse trots känd störning dämpas men tystas inte", () => {
  const values = [...flat(14, 20), 58, 59, 58, 59, 58, 59];
  const heating = analyze(values, { address: "BLOCKVÄGEN 23 TULLINGE 14640", area: "TULLINGE" });
  assert.equal(heating.interference.districtHeating, true);
  assert.ok(["suspect_auto", "dispatch"].includes(heating.category), "A clear new change is not silenced by known interference");
  assert.ok(heating.explanations.some((e) => /Känd störmiljö/.test(e)));
  const labelled = analyze(values, { labels: { m1: { type: "seasonal", notedDate: "2026-09-05" } } });
  assert.equal(labelled.category, "suspect_auto");
  assert.ok(labelled.observations.some((o) => /Ny tydlig avvikelse trots markeringen/.test(o)));
  const quiet = analyze(flat(14, 26), { labels: { m1: { type: "seasonal", notedDate: "2026-09-05" } } });
  assert.equal(quiet.category, "seasonal");
});

test("13. konstaterad och lagad är manuella beslut; sjunkande värde markeras aldrig lagat", () => {
  const drop = analyze([...flat(80, 15), ...flat(10, 10)]);
  assert.equal(drop.finding.direction, "down");
  assert.notEqual(drop.category, "repaired");
  assert.ok(drop.observations.some((o) => /aldrig en mätare som lagad/.test(o)));
  const leak = analyze([...flat(80, 15), ...flat(10, 10)], { labels: { m1: { type: "leak", confirmedDate: "2026-09-10", confirmedDateUncertain: true } } });
  assert.equal(leak.category, "confirmed");
  assert.ok(leak.observations[0].includes("osäkert datum"));
  const repaired = analyze([...flat(80, 15), ...flat(10, 10)], { labels: { m1: { type: "repaired", repairedDate: "2026-09-15" } } });
  assert.equal(repaired.category, "repaired");
  const riseAfterRepair = analyze([...flat(10, 20), ...flat(40, 6)], { labels: { m1: { type: "repaired", repairedDate: "2026-09-05" } } });
  assert.equal(riseAfterRepair.category, "suspect_auto");
  assert.ok(riseAfterRepair.observations.some((o) => /Ny ökning efter lagning/.test(o)));
});

test("14. nollställning bedömer bara avläsningar efter tidpunkten", () => {
  const values = [...flat(5, 10), ...flat(60, 10), 60, 60, 61, 90, 91, 92, 90, 91];
  const before = analyze(values);
  assert.equal(before.finding.direction, "up");
  const resetAt = new Date("2026-09-21T08:15:00").toISOString();
  const reset = analyze(values, { labels: { m1: { type: "reset_baseline", resetAfter: resetAt } } });
  assert.equal(reset.series[0].date > new Date(resetAt), true);
  assert.equal(reset.finding.ref.level, 60.5);
  assert.ok(reset.observations[0].startsWith("Nollställd 21 sep kl. 08:15"));
  const justReset = analyze(values, { labels: { m1: { type: "reset_baseline", resetAfter: new Date("2026-09-27T12:00:00").toISOString() } } });
  assert.equal(justReset.category, "normal");
  assert.equal(justReset.reset.readingsAfter, 1);
  const waiting = analyze(values, { labels: { m1: { type: "reset_baseline", resetAfter: new Date("2026-09-28T12:00:00").toISOString() } } });
  assert.equal(waiting.category, "normal", "No new readings yet is not a contact problem");
  assert.match(waiting.summary, /inväntar nya avläsningar/);
});

test("15. infokoder: LEAK/BURST efter mätare, akustisk Läckage är inte LEAK, DRY är inte kontaktfel", () => {
  const leak = analyze(flat(9, 10), { info: flat("LEAK", 10) });
  assert.equal(leak.category, "customer_side");
  assert.match(leak.summary, /^Infokod LEAK/);
  const acoustic = analyze([...flat(12, 10), ...flat(45, 8)], { events: [...flat("", 10), ...flat("Läckage", 8)] });
  assert.equal(acoustic.codes.leak, false);
  assert.equal(acoustic.codes.acousticLeak, true);
  assert.notEqual(acoustic.category, "customer_side");
  assert.ok(acoustic.observations.some((o) => /Anger inte om läckan finns före eller efter/.test(o)));
  const dry = analyze(flat(3, 10), { info: flat("DRY", 10) });
  assert.notEqual(dry.category, "stale_contact");
  assert.ok(dry.observations.some((o) => /inte ett kommunikationsfel/.test(o)));
  const reverse = analyze(flat(6, 10), { info: flat("REVERSE", 10) });
  assert.equal(reverse.category, "normal", "REVERSE is not a leak signal");
});

test("äldre baslinje och ny ökning beskrivs med perioder", () => {
  const m = analyze([...flat(34, 20), ...flat(11, 5), 20]);
  assert.equal(m.finding.type, "new_signal");
  assert.equal(m.finding.ref.level, 11);
  assert.match(m.observations.join(" "), /steg till 20 från nivån 11 \(median 21 sep–25 sep, 5 avläsningar\): \+9 \(\+82 %\)/);
  assert.match(m.observations.join(" "), /fortfarande lägre än den äldre nivån 34 \(1 sep–20 sep\)/);
  assert.equal(m.summary.match(/\+/g).length, 1, "One comparison in the short reason");
});

test("pumpliknande återkommande toppar bedöms mot mätarens eget mönster", () => {
  const values = [10, 11, 10, 30, 10, 9, 11, 28, 10, 11, 10, 32, 10, 11, 9, 10, 29];
  const m = analyze(values);
  assert.ok(m.intermittent && m.intermittent.count >= 2);
  assert.equal(m.category, "noise");
});

test("grannar: liknande ökning på samma gata anges utan att peka ut läckans plats", () => {
  const rise = [...flat(5, 20), 10, 11, 11, 12];
  const files = exportsFor(rise, { extra: [{ id: "m2", address: "TESTVÄGEN 3 TUMBA 14730", values: rise }, { id: "m3", address: "ANNANVÄGEN 3 TUMBA 14730", values: rise }] });
  const { meters } = Engine.analyzeAll(files, {});
  const m1 = meters.find((m) => m.id === "m1");
  assert.equal(m1.neighbors.similar.length, 1);
  assert.equal(m1.neighbors.similar[0].id, "m2");
  assert.ok(m1.explanations.some((e) => /Visar inte läckans plats/.test(e)));
  assert.equal(m1.neighbors.similar[0].distance, null, "No invented coordinates");
});

test("importordning och överlappande filer ändrar inte resultatet", () => {
  const files = exportsFor([...flat(5, 20), 10, 11, 12, 12]);
  const overlap = files.slice(10, 15).map((f) => ({ ...f, name: `${f.name} (kopia)` }));
  const a = Engine.analyzeAll([...files], {}).meters[0];
  const b = Engine.analyzeAll([...overlap, ...files].reverse(), {}).meters[0];
  for (const key of ["category", "priority", "summary"]) assert.deepEqual(b[key], a[key], key);
  assert.equal(b.history.readings, a.history.readings);
});

test("samma filnamn med nytt datum och innehåll behåller historiken", () => {
  const files = exportsFor([5, 5, 5, 10, 11]).map((f) => ({ ...f, name: "Filtrerade mätare.xlsx" }));
  const m = Engine.analyzeAll(files, {}).meters[0];
  assert.equal(m.history.readings, 5);
});

test("morgonöversikten använder samma analys", () => {
  const files = exportsFor([...flat(5, 20), 10], { extra: [{ id: "old", address: "GAMLA 1 TUMBA", values: [...flat(5, 5), 30, ...flat(null, 15)] }] });
  const { meters, latestExport } = Engine.analyzeAll(files, {});
  const report = Engine.morning(meters, {}, latestExport);
  assert.deepEqual(report.newToday.map((m) => m.id), ["m1"]);
  assert.equal(report.stale, 1);
});

test("säsong: hög återkommande vinternivå, en växling räcker inte, nytt vinteröverskott bryter dämpningen", () => {
  const monthsSeries = (months) => months.flatMap(([y, m, v]) => [4, 12, 22].map((d) => [new Date(y, m - 1, d, 4), v]));
  const run = (entries) => {
    const files = entries.map(([readAt, v], i) => ({ name: `s${i}.csv`, exportDate: new Date(readAt.getTime() + 3 * 3600000), rows: [{ id: "s", serial: "s", address: "VÄRMEVÄGEN 2 TUMBA", area: "TUMBA", readAt, current: v }] }));
    return Engine.analyzeAll(files, {}).meters[0];
  };
  const cycle = monthsSeries([[2024, 11, 65], [2024, 12, 70], [2025, 1, 68], [2025, 4, 35], [2025, 6, 9], [2025, 7, 10], [2025, 10, 40], [2025, 11, 67], [2025, 12, 72]]);
  const seasonal = run(cycle);
  assert.equal(seasonal.season.status, "verified", "High absolute noise can still be seasonal");
  assert.equal(seasonal.category, "seasonal");
  const one = run(monthsSeries([[2025, 1, 70], [2025, 2, 68], [2025, 6, 9], [2025, 7, 10]]));
  assert.equal(one.season.status, "possible", "A repair can mimic one winter-to-summer drop");
  const excess = run([...cycle, ...monthsSeries([[2026, 1, 180]])]);
  assert.equal(excess.category, "suspect_auto", "A new winter excess is not hidden by the seasonal pattern");
  const flat = run(monthsSeries([[2025, 1, 8], [2025, 2, 8], [2025, 6, 8], [2025, 7, 8], [2025, 11, 8], [2025, 12, 8]]));
  assert.equal(flat.season.status, "none");
});

test("grannar: ensam ökning, återgång och dubbelexport ger ingen gemensam händelse", () => {
  const street = (values, others) => Engine.analyzeAll(exportsFor(values, { extra: others }), {}).meters.find((m) => m.id === "m1");
  const alone = street([...flat(7, 10), 13], [{ id: "m2", address: "TESTVÄGEN 2 TUMBA 14730", values: [...flat(6, 10), 7] }]);
  assert.equal(alone.neighbors.similar.length, 0, "One rising meter is not a shared event");
  const reverted = street([...flat(7, 10), 13, 7], [{ id: "m2", address: "TESTVÄGEN 2 TUMBA 14730", values: [...flat(6, 10), 10, 6] }]);
  assert.equal(reverted.neighbors.similar.length, 0, "A reverted transient is not an active event");
  const singles = street([...flat(7, 10), 13], [{ id: "m2", address: "TESTVÄGEN 2 TUMBA 14730", values: [...flat(6, 10), 10] }]);
  assert.equal(singles.neighbors.similar.length, 0, "Single readings rising the same day are not called a shared change");
  const together = street([...flat(7, 10), 13, 13], [{ id: "m2", address: "TESTVÄGEN 2 TUMBA 14730", values: [...flat(6, 10), 10, 10] }]);
  assert.equal(together.neighbors.similar.length, 1);
  assert.equal(together.neighbors.similar[0].relation, "samma gata");
});

test("kommundel tas från ortskolumnen, inte gatunamn", () => {
  const Parse = require("../src/parse.js");
  for (const [area, want] of [["FITTJA", "Fittja"], ["NORSBORG", "Hallunda-Norsborg"], ["HALLUNDA", "Hallunda-Norsborg"], ["TUMBA", "Tumba-Storvreten"], ["STORVRETEN", "Tumba-Storvreten"], ["GRÖDINGE", "Vårsta-Grödinge"], ["VÅRSTA", "Vårsta-Grödinge"], ["ALBY", "Alby"], ["TULLINGE", "Tullinge"]]) {
    assert.equal(Parse.districtOf(area, ""), want);
  }
  assert.equal(Parse.districtOf("", "ALBYVÄGEN 1 TULLINGE"), "Tullinge");
  assert.equal(Parse.districtOf("", "OKÄNDVÄGEN 1"), "Övrigt");
});

test("Kamstrups snitt F dämpar bara när egen historik före ökningen aldrig nått F", () => {
  // Short own history, F from a longer period the app has not seen: not elevated.
  const unseen = analyze([...flat(6, 10), 11], { average: Array(11).fill(50) });
  assert.equal(unseen.category, "normal");
  assert.match(unseen.summary, /inte över Kamstrups snitt F 50/);
  // Own older level 34 already explains F 25: the new rise 11 → 20 stays visible.
  const seen = analyze([...flat(34, 6), ...flat(11, 10), 20], { average: Array(17).fill(25) });
  assert.equal(seen.finding.type, "new_signal");
  assert.equal(seen.category, "suspect_auto");
  assert.doesNotMatch(seen.summary, /Kamstrups snitt/);
});
