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
assert.equal(extreme.category, "suspect_auto");
assert.equal(extreme.confidence, "låg");
assert.ok(extreme.risk >= 0 && extreme.risk <= 100);

const establishedNormal = rank([10, 10, 10], {
  spacingDays: 10,
  result: { profile: { coverage: { days: 20 }, newLevel: false, slowRise: false, repeatedPattern: false, fluctuating: false } },
});
assert.equal(establishedNormal.category, "normal");

const establishedRise = rank([6, 18, 42], {
  spacingDays: 7,
  info: "LEAK",
  result: { profile: { coverage: { days: 14 }, newLevel: false, slowRise: false, repeatedPattern: false, fluctuating: false } },
});
assert.equal(establishedRise.category, "suspect_auto");
assert.equal(establishedRise.engine.persistenceDays, 7);
assert.ok(establishedRise.engine.relativeRise >= 4);

assert.equal(rank([407, 872, 829]).category, "suspect_auto");
assert.equal(rank([10, 11, 200, 10, 11]).category, "noise");

// A Stallbacken-like series can be loud but is too uneven and currently falling
// to be called a probable leak automatically. Keep it visible for review.
const fluctuatingFall = rank([12, 8, 10, 150, 250, 130, 210, 180, 215, 50, 170, 20, 130, 145, 170, 200, 90, 175, 40, 160, 130, 145, 66], {
  spacingDays: 10,
  info: "LEAK",
  result: { profile: { coverage: { days: 220 }, newLevel: true, slowRise: false, repeatedPattern: false, fluctuating: true } },
});
assert.equal(fluctuatingFall.category, "suspect_auto");
assert.equal(fluctuatingFall.engine.fallingNow, true);
assert.notEqual(fluctuatingFall.confidence, "hög");

const stale = rank([10, 30, 60], { result: { staleReadDays: 21 } });
assert.equal(stale.category, "normal");
assert.equal(stale.staleContact, true);

const customerSide = rank([10, 40, 80], {
  info: "Leak",
  result: { infrastructure: { customerSide: true } },
});
assert.equal(customerSide.category, "customer_side");

const heatPumpPoints = [
  { date: new Date("2025-05-15T06:00:00"), readAt: new Date("2025-05-15T06:00:00"), current: 10 },
  { date: new Date("2025-07-15T06:00:00"), readAt: new Date("2025-07-15T06:00:00"), current: 11 },
  { date: new Date("2025-11-15T06:00:00"), readAt: new Date("2025-11-15T06:00:00"), current: 27 },
  { date: new Date("2026-02-15T06:00:00"), readAt: new Date("2026-02-15T06:00:00"), current: 29 },
];
const heatPump = rank([], { points: heatPumpPoints });
assert.notEqual(heatPump.category, "seasonal", "four sparse readings do not prove recurrence");
assert.equal(heatPump.engine.heatPump.is, false);

const tooLoudForHeatPump = heatPumpPoints.map((point, index) => ({ ...point, current: index === 3 ? 45 : point.current }));
assert.equal(SmartEngine.detectHeatPumpSeasonality(tooLoudForHeatPump).is, false);

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

const repeated = Array.from({length:12},(_,i)=>({
  date:new Date(Date.UTC(2026,8,1+i)),readAt:new Date('2026-09-01T06:00:00Z'),current:80
}));
assert.equal(SmartEngine.analyzeSeries(repeated).points,1);
assert.equal(SmartEngine.analyzeSeries(repeated).sustained,false);
assert.equal(SmartEngine.analyzeSeries(repeated).persistenceDays,0);
assert.equal(rank([], {points:repeated}).category,'learning');
assert.equal(SmartEngine.analyzeSeries([{date:'2026-09-01',current:null}]).points,0);
assert.equal(rank([3,3,8,9],{spacingDays:1}).category,'suspect_auto');
const resetLabel={type:'reset_baseline',resetAfter:'2026-06-30T23:59:59Z'};
assert.equal(rank([10,10,70,72,74],{label:resetLabel}).category,'dispatch');
assert.equal(rank([10,10,70,72,74],{label:{...resetLabel,resetAfter:'2027-01-01'}}).category,'normal');
assert.equal(rank([10,20,40],{info:'LEAK',result:{staleReadDays:30,infrastructure:{customerSide:true}}}).category,'customer_side');
console.log('Deduplication, low-level rise and reset regressions: ok');
