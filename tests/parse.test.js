const test = require("node:test");
const assert = require("node:assert/strict");
const Parse = require("../src/parse.js");
const History = require("../src/history.js");

const local = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

test("svenska och internationella decimaler; saknat är inte noll", () => {
  assert.equal(Parse.parseNumber("5,5"), 5.5);
  assert.equal(Parse.parseNumber("1 234,56"), 1234.56);
  assert.equal(Parse.parseNumber("1.234,56"), 1234.56);
  assert.equal(Parse.parseNumber("1,234.56"), 1234.56);
  assert.equal(Parse.parseNumber("−12,5"), -12.5);
  assert.equal(Parse.parseNumber("12 dB"), 12);
  assert.equal(Parse.parseNumber("0"), 0);
  assert.equal(Parse.parseNumber(""), null);
  assert.equal(Parse.parseNumber("N/A"), null);
  assert.equal(Parse.parseNumber("saknas 5"), null, "Text around a number is not silently a value");
  assert.equal(Parse.parseNumber(null), null);
});

test("datumformat, Excel-serienummer och sommartid", () => {
  assert.deepEqual(local(Parse.parseDate("2026-09-29 04:00")), [2026, 9, 29, 4, 0]);
  assert.deepEqual(local(Parse.parseDate("2026-09-29 4:05")), [2026, 9, 29, 4, 5]);
  assert.deepEqual(local(Parse.parseDate("29.09.2026 04:00")), [2026, 9, 29, 4, 0]);
  assert.deepEqual(local(Parse.parseDate("29/09/2026")), [2026, 9, 29, 0, 0]);
  assert.equal(Parse.parseDate("2026-02-30"), null, "Invalid calendar dates are rejected");
  // Excel serial for 2026-10-25 04:00 (DST ends that night in Europe/Stockholm).
  const serial = 46320 + 4 / 24;
  assert.deepEqual(local(Parse.parseDate(serial)), [2026, 10, 25, 4, 0]);
  assert.deepEqual(local(Parse.parseDate(46110 + 4 / 24)), [2026, 3, 29, 4, 0], "Spring DST day keeps 04:00");
  assert.equal(Parse.parseDate(14730), null, "Postcode-like numbers are not dates");
  const zoned = Parse.parseDate("2026-09-29T02:00:00Z");
  assert.equal(zoned.toISOString(), "2026-09-29T02:00:00.000Z");
  assert.deepEqual(local(Parse.dateFromFileName("Filtrerade mätare 2026-09-08 06-27.xlsx")), [2026, 9, 8, 6, 27]);
});

test("kalenderdagar över sommartidsskifte", () => {
  assert.equal(History.calendarDays(new Date(2026, 9, 24, 4), new Date(2026, 9, 26, 4)), 2);
  assert.equal(History.calendarDays(new Date(2026, 2, 28, 23), new Date(2026, 2, 30, 1)), 2);
});

test("rubrikrad hittas efter rapporthuvud och kolumner kopplas rätt", () => {
  const table = [
    ["Rapport: Leak Detector"], ["Skapad", "2026-09-29 06:30"], [],
    ["Serienummer", "Adress", "Område", "Senaste avläsning", "Senaste värde", "Genomsnittsvärde", "Maxvärde", "Infokod", "Aktiva händelser"],
    ["123", "TESTVÄGEN 1 TUMBA 14730", "TUMBA", "2026-09-29 04:00", "10", "5,2", "12", "", "Läckage"],
    ["124", "TESTVÄGEN 3 TUMBA 14730", "TUMBA", "2026-09-29 04:00", "", "5", "7", "DRY", ""],
    ["125", "TESTVÄGEN 5 TUMBA 14730", "TUMBA", "okänt", "8", "5", "", "", ""],
  ];
  const parsed = Parse.parseTable(table, { name: "export.xlsx" });
  assert.equal(parsed.exportDateSource, "rapporthuvud");
  assert.deepEqual(local(parsed.exportDate), [2026, 9, 29, 6, 30]);
  const [a, b, c] = parsed.rows;
  assert.equal(a.current, 10);
  assert.equal(a.average, 5.2);
  assert.equal(a.max, 12);
  assert.equal(a.activeEvents, "Läckage");
  assert.equal(a.infoCode, "");
  assert.equal(b.current, null, "Missing value kept as null so the meter is known to be in the export");
  assert.equal(b.infoCode, "DRY");
  assert.equal(c.readAt, null);
  assert.equal(c.max, null, "Missing G is not replaced by E");
  assert.ok(parsed.warnings.some((w) => /saknar Senaste värde/.test(w)));
  assert.ok(parsed.warnings.some((w) => /saknar giltigt avläsningsdatum/.test(w)));
});

test("nya avläsningar försvinner inte när exportdatum tolkats för gammalt", () => {
  const table = [
    ["Period från", "2026-08-01"],
    ["Serienummer", "Adress", "Senaste avläsning", "Senaste värde"],
    ["1", "A 1", "2026-09-28 04:00", "5"],
    ["2", "A 2", "2026-09-29 04:00", "9"],
  ];
  const parsed = Parse.parseTable(table, { name: "export utan datum.csv", lastModified: Date.parse("2026-08-02") });
  assert.deepEqual(local(parsed.exportDate).slice(0, 3), [2026, 9, 29]);
  assert.ok(parsed.rows.every((row) => row.readAt));
  assert.ok(parsed.warnings.some((w) => /exportdatum satt till avläsningen/.test(w)));
});

test("CSV med semikolon, citat och BOM", () => {
  const rows = Parse.parseCsvRows('﻿Serienummer;Adress;Senaste värde\n1;"GATAN 1; UPPG A";5,5\n2;"Citat ""x""";7');
  assert.deepEqual(rows[1], ["1", "GATAN 1; UPPG A", "5,5"]);
  assert.equal(rows[2][1], 'Citat "x"');
});

test("jämförelse mot tidigare datum interpolerar aldrig", () => {
  const series = [
    { date: new Date(2026, 8, 1), value: 5 },
    { date: new Date(2026, 8, 20), value: 8 },
    { date: new Date(2026, 8, 29), value: 10 },
  ];
  const prev = History.compare(series, "previous");
  assert.equal(prev.reference.value, 8);
  assert.equal(prev.delta, 2);
  assert.equal(prev.percent, 25);
  const week = History.compare(series, "7");
  assert.equal(week.reference.value, 8, "Closest reading within tolerance; the actual date is shown");
  const short = History.compare(series, "3");
  assert.equal(short.reference, null, "No reading near 3 days back");
  assert.match(short.note, /3 dagar/);
  const month = History.compare(series, "28");
  assert.equal(month.reference.value, 5);
  const zero = History.compare([{ date: new Date(2026, 8, 1), value: 0 }, { date: new Date(2026, 8, 2), value: 4 }]);
  assert.equal(zero.percent, null);
  assert.equal(zero.delta, 4);
});
