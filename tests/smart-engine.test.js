const assert = require("node:assert/strict");
const { analyzeSeries, rankMeter } = require("../src/smart-engine.js");

function points(entries) {
  return entries.map(([date, current, readAt = date]) => ({
    date: new Date(`${date}T06:00:00`),
    readAt: new Date(`${readAt}T06:00:00`),
    current,
  }));
}

const transient = analyzeSeries(points([
  ["2026-05-01", 10], ["2026-06-01", 11], ["2026-07-01", 95], ["2026-08-01", 10], ["2026-09-01", 11],
]));
assert.equal(transient.transientSpike, true);
assert.equal(transient.sustained, false);

const sustained = analyzeSeries(points([
  ["2026-05-01", 10], ["2026-06-01", 10], ["2026-07-01", 11],
  ["2026-08-01", 38], ["2026-08-15", 42], ["2026-09-01", 41],
]));
assert.equal(sustained.sustained, true);
assert.ok(sustained.persistenceDays >= 31);
assert.ok(sustained.relativeRise > 2);

const stale = analyzeSeries(points([
  ["2026-08-01", 20], ["2026-09-01", 80, "2026-07-01"],
]));
assert.ok(stale.staleReadDays >= 60);
assert.equal(stale.staleContact, true);

const baseResult = {
  risk: 90,
  reasons: [],
  profile: { coverage: { days: 130 }, newLevel: null, slowRise: false, repeatedPattern: false, fluctuating: false },
  infrastructure: { customerSide: false },
  networkContext: null,
  lowRelativeRise: null,
  confidence: "hög",
};
const rankedSpike = rankMeter(baseResult, { id: "spike", info: "", points: points([
  ["2026-05-01", 10], ["2026-06-01", 11], ["2026-07-01", 95], ["2026-08-01", 10], ["2026-09-01", 11],
]) });
assert.equal(rankedSpike.category, "noise");
assert.ok(rankedSpike.risk < 40);

const rankedSustained = rankMeter(baseResult, { id: "sustained", info: "", points: points([
  ["2026-05-01", 10], ["2026-06-01", 10], ["2026-07-01", 11],
  ["2026-08-01", 38], ["2026-08-15", 42], ["2026-09-01", 41],
]) });
assert.equal(rankedSustained.category, "dispatch");
assert.ok(rankedSustained.enginePriority > rankedSpike.enginePriority);

const customer = rankMeter({ ...baseResult, infrastructure: { customerSide: true } }, {
  id: "customer", info: "BURST, LEAK", points: points([
    ["2026-06-01", 80], ["2026-07-01", 110], ["2026-08-01", 130], ["2026-09-01", 140],
  ]),
});
assert.equal(customer.category, "customer_side");

const manualRepair = rankMeter(baseResult, { id: "repair", info: "", points: points([
  ["2026-06-01", 20], ["2026-07-01", 60], ["2026-08-01", 90], ["2026-09-01", 100],
]) }, { type: "repaired" });
assert.equal(manualRepair.category, "repaired");
assert.ok(manualRepair.risk <= 18);

console.log("smart engine tests: ok");
