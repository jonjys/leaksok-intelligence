const assert = require("node:assert/strict");
const SmartEngine = require("../src/smart-engine.js");

function points(values, start = "2026-07-01T06:00:00", spacingDays = 7) {
  const first = new Date(start);
  return values.map((current, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index * spacingDays);
    return { date, readAt: date, current };
  });
}

function baseResult(overrides = {}) {
  return {
    risk: 10,
    category: "normal",
    confidence: "låg",
    reasons: [],
    info: "",
    profile: {
      coverage: { days: 500 },
      newLevel: false,
      slowRise: false,
      repeatedPattern: false,
      fluctuating: false,
    },
    infrastructure: { customerSide: false },
    networkContext: null,
    lowRelativeRise: null,
    staleReadDays: 0,
    ...overrides,
  };
}

function rank(values, options = {}) {
  const meter = {
    id: options.id || "test-meter",
    info: options.info || "",
    points: options.points || points(values, options.start, options.spacingDays),
  };
  return SmartEngine.rankMeter(baseResult(options.result), meter, options.label);
}

const twoPoint = SmartEngine.analyzeSeries(points([10, 30]));
assert.equal(twoPoint.baseline, 10);
assert.equal(twoPoint.recentLevel, 30);
assert.equal(twoPoint.relativeRise, 2);

const unsorted = points([10, 20, 40]);
assert.deepEqual(
  SmartEngine.analyzeSeries([unsorted[2], unsorted[0], unsorted[1]]),
  SmartEngine.analyzeSeries(unsorted)
);

assert.equal(rank([10, 10, 70, 72, 74]).category, "dispatch");
const extreme = rank([800], { start: "2026-08-24T06:00:00" });
assert.equal(extreme.category, "dispatch");
assert.equal(extreme.confidence, "låg");
assert.ok(extreme.risk >= 0 && extreme.risk <= 100);

assert.equal(rank([407, 872, 829]).category, "dispatch");
assert.equal(rank([10, 11, 200, 10, 11]).category, "noise");

const stale = rank([10, 30, 60], { result: { staleReadDays: 21 } });
assert.equal(stale.category, "normal");
assert.equal(stale.staleContact, true);

const customerSide = rank([10, 40, 80], {
  info: "Leak",
  result: { infrastructure: { customerSide: true } },
});
assert.equal(customerSide.category, "customer_side");

const manualCases = {
  leak: "confirmed",
  repaired: "repaired",
  manual_dispatch: "dispatch",
  suspect: "suspect_auto",
  interesting: "watch",
  customer_contact: "customer_side",
  seasonal: "seasonal",
  known_noise: "noise",
  district_heating: "noise",
  large_building: "noise",
  pump: "noise",
  false_alarm: "noise",
  reset_baseline: "normal",
  ignored: "ignored",
};

for (const [type, expected] of Object.entries(manualCases)) {
  assert.equal(rank([10, 20, 40], { label: { type } }).category, expected, type);
}

console.log("smart engine tests: ok");
