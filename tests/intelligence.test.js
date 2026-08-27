const assert = require("node:assert/strict");
const { detectAnnualRepeat, detectHeatingSeason, detectLowRelativeRise } = require("../src/intelligence.js");

function points(entries) {
  return entries.map(([date, current]) => ({ date: new Date(`${date}T06:00:00`), current }));
}

const oneNewReading = detectLowRelativeRise(points([
  ["2026-05-01", 4], ["2026-06-01", 4], ["2026-07-01", 4], ["2026-08-01", 4], ["2026-08-23", 8],
]));
assert.equal(oneNewReading.persistent, false);
assert.equal(oneNewReading.from, 4);
assert.equal(oneNewReading.to, 8);

const mondayToFriday = detectLowRelativeRise(points([
  ["2026-05-01", 4], ["2026-06-01", 4], ["2026-08-17", 4], ["2026-08-20", 8], ["2026-08-21", 9], ["2026-08-23", 9],
]));
assert.equal(mondayToFriday.persistent, false);

const heldForTenDays = detectLowRelativeRise(points([
  ["2026-05-01", 4], ["2026-06-01", 4], ["2026-07-01", 4], ["2026-08-10", 8], ["2026-08-16", 9], ["2026-08-20", 8],
]));
assert.equal(heldForTenDays.persistent, true);
assert.equal(heldForTenDays.persistenceDays, 10);

const threeToEight = detectLowRelativeRise(points([
  ["2026-06-01", 3], ["2026-07-01", 3], ["2026-08-23", 8],
]));
assert.ok(threeToEight.change > 1.6);

assert.equal(detectLowRelativeRise(points([
  ["2026-06-01", 20], ["2026-07-01", 20], ["2026-08-23", 40],
])), null);

const repeatedHeating = detectAnnualRepeat(points([
  ["2024-01-15", 42], ["2024-03-15", 34], ["2024-06-15", 8], ["2024-09-15", 18],
  ["2025-01-15", 45], ["2025-03-15", 32], ["2025-06-15", 9], ["2025-09-15", 20],
]));
assert.ok(repeatedHeating);
assert.ok(repeatedHeating.correlation > 0.9);

assert.equal(detectAnnualRepeat(points([
  ["2024-01-15", 42], ["2024-03-15", 34], ["2024-06-15", 8], ["2024-09-15", 18],
  ["2025-01-15", 8], ["2025-03-15", 20], ["2025-06-15", 45], ["2025-09-15", 32],
])), null);

const heatingSeason = detectHeatingSeason(points([
  ["2023-05-15", 8], ["2023-06-15", 8], ["2023-09-15", 20], ["2023-10-15", 24], ["2023-12-15", 36],
  ["2024-01-15", 38], ["2024-02-15", 36], ["2024-04-15", 18], ["2024-05-15", 9], ["2024-06-15", 8], ["2024-07-15", 8],
  ["2024-09-15", 21], ["2024-10-15", 25], ["2024-12-15", 37],
  ["2025-01-15", 39], ["2025-02-15", 37], ["2025-04-15", 17], ["2025-05-15", 9], ["2025-06-15", 8],
]));
assert.ok(heatingSeason);
assert.equal(heatingSeason.cycles, 2);
assert.equal(heatingSeason.confidence, "high");

assert.equal(detectHeatingSeason(points([
  ["2023-05-15", 8], ["2023-06-15", 9], ["2023-09-15", 14], ["2023-10-15", 18], ["2023-12-15", 24],
  ["2024-01-15", 30], ["2024-02-15", 36], ["2024-04-15", 42], ["2024-05-15", 48], ["2024-06-15", 54], ["2024-09-15", 60], ["2024-10-15", 66],
])), null);

console.log("intelligence tests: ok");
