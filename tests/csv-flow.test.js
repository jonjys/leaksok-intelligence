const assert = require("node:assert/strict");
const { app } = require("./workflow-harness.js")();

const fixtures = [
  ["2026-08-20.csv", "TEST-001,TESTVÄGEN 1 TUMBA 14730,2026-08-20,6,6,8,,TUMBA\nTEST-002,TESTVÄGEN 2 TULLINGE 14640,2026-08-20,12,10,15,,TULLINGE"],
  ["2026-08-27.csv", "TEST-001,TESTVÄGEN 1 TUMBA 14730,2026-08-27,18,8,20,,TUMBA\nTEST-002,TESTVÄGEN 2 TULLINGE 14640,2026-08-27,11,10,15,,TULLINGE"],
  ["2026-09-03.csv", "TEST-001,TESTVÄGEN 1 TUMBA 14730,2026-09-03,42,12,45,LEAK,TUMBA\nTEST-002,TESTVÄGEN 2 TULLINGE 14640,2026-09-03,10,10,15,,TULLINGE"],
];
const header = "Serienummer,Adress,Senaste avläsning,Senaste värde,Genomsnittsvärde,Maxvärde,Infokod,Område\n";

(async () => {
  for (const [name, body] of fixtures) {
    const text = header + body;
    const parsed = await app.parseWorkbook({ name, text: async () => text, lastModified: 0 });
    assert.equal(parsed.rows.length, 2);
    app.state.files.push({ name, exportDate: parsed.exportDate, rows: parsed.rows });
  }

  app.analyze();
  const rising = app.state.meters.find((meter) => meter.id === "TEST-001");
  const stable = app.state.meters.find((meter) => meter.id === "TEST-002");

  assert.equal(rising.points.length, 3);
  assert.equal(rising.engine.points, 3);
  assert.equal(rising.infrastructure.customerSide, false, "LEAK is a signal, not proof of customer-side ownership");
  assert.equal(rising.category, "suspect_auto");
  assert.equal(Math.round(rising.lastJump * 100), 133);
  assert.equal(Math.round(rising.engine.relativeRise * 100), 400);
  assert.equal(rising.engine.persistenceDays, 7);
  assert.equal(stable.category, "normal", "Two to three weeks of readings must be assessed normally");

  const original = app.state.meters.map((meter) => [meter.id, meter.category, meter.risk, meter.engine.points]);
  app.state.files.reverse();
  app.analyze();
  assert.deepEqual(
    app.state.meters.map((meter) => [meter.id, meter.category, meter.risk, meter.engine.points]),
    original,
    "Import order must not change the result"
  );

  console.log("multi-file CSV flow tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
