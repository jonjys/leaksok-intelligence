const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../src/engine.js");
const Xlsx = require("../src/xlsx-writer.js");
const FieldExport = require("../src/field-export.js");
const { unzip, cells } = require("./xlsx-inspect.cjs");

const DAY = 86400000;
function meters() {
  const files = [];
  const first = new Date("2026-09-01T06:30:00");
  for (let d = 0; d < 21; d++) {
    const exportDate = new Date(first.getTime() + d * DAY);
    const readAt = new Date(exportDate); readAt.setHours(4, 0, 0, 0);
    files.push({ name: `x ${d}.csv`, exportDate, rows: [
      { id: "00012345", serial: "00012345", address: "LÅGNIVÅVÄGEN 1 TUMBA 14730", area: "TUMBA", readAt, current: d === 20 ? 10 : 5, average: 5.2, max: 10 },
      { id: "2", serial: "2", address: "=HYPERLINK(\"http://x\")", area: "TUMBA", readAt, current: 7, average: 7, max: 8 },
      { id: "3", serial: "3", address: "HÖGVÄGEN 3 TUMBA 14730", area: "TUMBA", readAt, current: d < 15 ? 10 : 30, average: 12, max: 30 },
    ] });
  }
  return Engine.analyzeAll(files, {}).meters;
}

test("arbetsboken har rätt blad, tabeller, frysning, validering och utskrift", async () => {
  const chosen = meters();
  const labels = { "00012345": { comment: "=SUM(A1) kolla ventil" } };
  const bytes = await Xlsx.write(FieldExport.buildWorkbook(chosen, { labels, exportedAt: new Date("2026-09-21T07:00:00") }));
  const parts = unzip(bytes);
  assert.match(parts["xl/workbook.xml"], /<sheet name="Arbetslista" sheetId="1"/);
  assert.match(parts["xl/workbook.xml"], /<sheet name="Analysunderlag" sheetId="2"/);
  assert.match(parts["xl/workbook.xml"], /_xlnm.Print_Titles" localSheetId="0">'Arbetslista'!\$1:\$1/);
  const list = parts["xl/worksheets/sheet1.xml"];
  assert.match(list, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(list, /<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"\/>/);
  assert.match(list, /<pageSetUpPr fitToPage="1"\/>/);
  assert.match(list, /<dataValidation type="list"[^>]*sqref="K2:K4"><formula1>"Ej utförd,Klar"<\/formula1>/);
  assert.match(list, /<cfRule type="expression" dxfId="0" priority="1"><formula>\$K2="Klar"<\/formula>/);
  assert.match(list, /<tableParts count="1">/);
  const table = parts["xl/tables/table1.xml"];
  assert.match(table, /displayName="Arbetslista" ref="A1:K4"/);
  assert.match(table, /<autoFilter ref="A1:K4"\/>/);
  const c = cells(list);
  assert.deepEqual(["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "I1", "J1", "K1"].map((r) => c[r]),
    ["Adress", "Serienummer", "Status", "Senast avläst", "Senaste värde", "Förändring sedan föreg. avläsning", "Förändring sedan föreg. avläsning %", "Huvudorsak", "Rekommenderad kontroll", "Kommentar", "Utförd"]);
  const rowOf = (serial) => Object.keys(c).find((k) => /^B\d+$/.test(k) && c[k] === serial).slice(1);
  const r = rowOf("00012345");
  assert.equal(c[`B${r}@t`], "inlineStr", "Serial number is text and keeps leading zeros");
  assert.equal(c[`E${r}`], 10);
  assert.equal(c[`F${r}`], 5);
  assert.equal(c[`G${r}`], 1, "Percent stored as number 1 = +100 %");
  assert.ok(Math.abs(c[`D${r}`] - Xlsx.excelSerial(new Date("2026-09-21T04:00:00"))) < 1e-9);
  assert.equal(c[`K${r}`], "Ej utförd");
  assert.equal(c[`J${r}`], "=SUM(A1) kolla ventil");
  const styles = parts["xl/styles.xml"];
  const xf = [...styles.matchAll(/<xf [^>]*>/g)].map((m) => m[0]).slice(1);
  assert.match(xf[c[`J${r}@s`]], /quotePrefix="1"/, "Formula-like comment cannot become a formula");
  const formulaRow = rowOf("2");
  assert.equal(c[`A${formulaRow}`], '=HYPERLINK("http://x")');
  assert.match(xf[c[`A${formulaRow}@s`]], /quotePrefix="1"/);
  assert.doesNotMatch(list, /<f>/, "No formulas anywhere");
  const analysis = cells(parts["xl/worksheets/sheet2.xml"]);
  assert.equal(analysis.A1, "Adress");
  assert.ok(Object.values(analysis).includes("P = E/F − 1"));
  assert.match(parts["xl/worksheets/sheet2.xml"], /<pane xSplit="1" ySplit="1"/);
  assert.match(parts["[Content_Types].xml"], /table\+xml/);
});

test("Excel-serienummer påverkas inte av sommartid", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  near(Xlsx.excelSerial(new Date(2026, 9, 25, 4, 0)), 46320 + 4 / 24);
  near(Xlsx.excelSerial(new Date(2026, 2, 29, 4, 0)), 46110 + 4 / 24);
});

test("tomt urval ger ingen export", () => {
  assert.throws(() => FieldExport.buildWorkbook([], {}), /Inga mätare valda/);
});

test("exakt de valda mätarna exporteras i vald ordning", async () => {
  const all = meters();
  const chosen = all.filter((m) => m.id !== "2");
  const parts = unzip(await Xlsx.write(FieldExport.buildWorkbook(chosen, { sort: "address" })));
  const c = cells(parts["xl/worksheets/sheet1.xml"]);
  assert.deepEqual([c.A2, c.A3], ["HÖGVÄGEN 3 TUMBA 14730", "LÅGNIVÅVÄGEN 1 TUMBA 14730"]);
  assert.equal(c.A4, undefined);
});

test("export och app använder samma analysvärden", async () => {
  const m = meters().find((x) => x.id === "00012345");
  const row = FieldExport.rowFor(m, {});
  assert.equal(row.summary, m.summary);
  assert.equal(row.latestValue, m.latest.value);
  assert.equal(row.prevPct, m.changePrev.pct);
  assert.equal(row.refLevel, m.finding.ref.level);
  assert.equal(row.P, m.excel.P);
  assert.match(row.refPeriod, /1 sep–20 sep 2026, 20 avläsningar/);
});
