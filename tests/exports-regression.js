// Local check of real Kamstrup exports against the production parser and engine.
// Data never leaves the machine and is not committed.
//   node tests/exports-regression.js exports/*.csv
//   python3 extract.py | node tests/exports-regression.js     (JSON [{ name, table }])
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Parse = require("../src/parse.js");
const Engine = require("../src/engine.js");

function fromTables(sources) {
  return sources.map(({ name, table }) => {
    const parsed = Parse.parseTable(table, { name });
    for (const warning of parsed.warnings) console.log(`  ${name}: ${warning}`);
    return { name, exportDate: parsed.exportDate, rows: parsed.rows };
  });
}

function run(files) {
  const result = Engine.analyzeAll(files, {});
  const counts = {};
  for (const m of result.meters) counts[m.category] = (counts[m.category] || 0) + 1;
  console.log(`Filer: ${files.length} · mätare: ${result.meters.length} · senaste export: ${result.latestExport?.toISOString()}`);
  console.log("Kategorier:", counts);
  for (const m of result.meters.filter((x) => ["dispatch", "suspect_auto"].includes(x.category)).slice(0, 25)) {
    console.log(`  ${m.priority.toString().padStart(3)} ${m.status.padEnd(9)} ${m.address} · ${m.summary}`);
  }
  const signature = (r) => r.meters.map((m) => `${m.id}|${m.category}|${m.priority}`).sort().join("\n");
  assert.equal(signature(Engine.analyzeAll([...files].reverse(), {})), signature(result), "Import order must not change the result");
  assert.ok(result.meters.every((m) => m.category !== "repaired"), "No automatic 'Lagad' without a manual decision");
  assert.ok(result.meters.every((m) => !m.latest || m.history.readings <= files.length * 3), "Readings are unique reading days");
  console.log("Originalexporter: PASS");
}

const args = process.argv.slice(2);
if (args.length) {
  run(fromTables(args.map((file) => ({ name: path.basename(file), table: Parse.parseCsvRows(fs.readFileSync(file, "utf8")) }))));
} else {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try { run(fromTables(JSON.parse(input))); } catch (error) { console.error(error); process.exitCode = 1; }
  });
}
