const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const LeakIntelligence = require("../src/intelligence.js");

function fakeElement() {
  return {
    addEventListener() {},
    classList: { add() {}, remove() {} },
    close() {},
    value: "",
    innerHTML: "",
    textContent: "",
  };
}

const elements = new Map();
const context = {
  LeakIntelligence,
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },
  },
  localStorage: { getItem() { return null; }, setItem() {} },
  window: {},
  console,
  Date,
  Intl,
  Math,
  Set,
  Map,
  Blob,
  URL,
  confirm() { return true; },
  prompt() { return ""; },
};
vm.createContext(context);
const source = fs.readFileSync(require.resolve("../src/app.js"), "utf8");
vm.runInContext(`${source}\n;globalThis.__engine = { state, scoreMeter, detectSharedSignals, addressForCopy, labelSummary, readingTimeline, hydrateFiles, dedupePoints, parseNumber, parseDate, dateFromFile, calendarDaysBetween, median, localDate };`, context);

function meter(serial, address, values, averages, maxes, info = "") {
  const start = new Date("2026-07-01T06:00:00");
  const dates = [0, 50, 53].map((days) => new Date(start.getTime() + days * 86400000));
  return {
    id: serial,
    serial,
    address,
    area: "ÖVRIGT",
    info,
    points: values.map((current, index) => ({
      date: dates[index],
      readAt: dates[index],
      current,
      average: averages[index],
      max: maxes[index],
      info: index === values.length - 1 ? info : "",
      source: `file-${index}.xlsx`,
    })),
  };
}

const vattravagen = context.__engine.scoreMeter(meter(
  "12777229", "VATTRAVÄGEN 8 UTTRAN 14763", [407, 872, 829], [608, 589, 589], [933, 933, 933]
));
assert.equal(vattravagen.category, "dispatch");

const broangsvagen = context.__engine.scoreMeter(meter(
  "23571905", "BROÄNGSVÄGEN 22 TUMBA 14732", [8, 8, 14], [127, 127, 127], [1039, 1039, 1039]
));
assert.equal(broangsvagen.category, "repaired");

const alice = context.__engine.scoreMeter(meter(
  "23571762", "ALICE TEGNÉRS VÄG 23 TULLINGE 14638", [8, 10, 13], [96, 96, 95], [175, 184, 184]
));
assert.equal(alice.category, "seasonal");

const alhagsvagen = context.__engine.scoreMeter(meter(
  "53843859", "ALHAGSVÄGEN 58 -60 NORSBORG 14559", [30, 34, 17], [61, 56, 56], [183, 183, 183], ""
));
assert.equal(alhagsvagen.category, "repaired");
assert.ok(!alhagsvagen.reasons.some((reason) => reason.includes("Infokod LEAK")));

const customerSide = context.__engine.scoreMeter(meter(
  "99900001", "TESTVÄGEN 1 TUMBA 14730", [7, 8, 9], [7, 8, 9], [12, 13, 14], "Leak"
));
assert.equal(customerSide.category, "normal");
assert.equal(customerSide.infrastructure.customerSide, true);
assert.ok(customerSide.reasons.some((reason) => reason.includes("kundsida")));

const districtHeating = context.__engine.scoreMeter(meter(
  "23571872", "ADLER SALVIUS VÄG 17 TULLINGE 14654", [50, 52, 54], [18, 18, 17], [170, 170, 170], ""
));
assert.equal(districtHeating.infrastructure.districtHeating, true);
assert.ok(districtHeating.reasons.some((reason) => reason.includes("Fjärrvärmeområde")));

const lignell = context.__engine.scoreMeter(meter(
  "54366419", "LIGNELLSVÄGEN 29 TUMBA 14743", [51, 47, 107], [91, 86, 84], [252, 252, 252], ""
));
assert.equal(lignell.profile.summerWater, false);
assert.equal(lignell.infrastructure.summerWaterMeter, false);

const drySummerWater = context.__engine.scoreMeter(meter(
  "99900002", "SOMMARVÄGEN 1 TUMBA 14743", [12, 10, 0], [10, 10, 10], [18, 18, 18], "Dry"
));
assert.equal(drySummerWater.infrastructure.summerWaterMeter, true);
assert.equal(drySummerWater.category, "noise");

const newVeryHigh = {
  id: "99900003",
  serial: "99900003",
  address: "TESTVÄGEN 3 TUMBA 14730",
  area: "TUMBA",
  info: "",
  points: [{
    date: new Date("2026-08-24T06:00:00"), readAt: new Date("2026-08-24T06:00:00"),
    current: 800, average: 100, max: 800, info: "", source: "today.xlsx",
  }],
};
assert.equal(context.__engine.scoreMeter(newVeryHigh).category, "dispatch");

context.__engine.state.labels["99900004"] = {
  type: "repaired",
  repairedDate: "2026-08-23",
  address: "TESTVÄGEN 4 TUMBA 14730",
};
const justRepaired = context.__engine.scoreMeter(meter(
  "99900004", "TESTVÄGEN 4 TUMBA 14730", [20, 80, 80], [20, 20, 20], [90, 90, 90], ""
));
assert.equal(justRepaired.category, "repaired");

assert.equal(
  context.__engine.addressForCopy("NORDANVÄGEN 11 D TULLINGE 14640"),
  "NORDANVÄGEN 11 D"
);

const sharedDates = [0, 7, 14, 21, 28, 35].map((days) => new Date(new Date("2026-06-01T06:00:00").getTime() + days * 86400000));
function sharedMeter(id, address, values) {
  return {
    id,
    address,
    points: values.map((current, index) => ({ date: sharedDates[index], current })),
  };
}
const shared = context.__engine.detectSharedSignals([
  sharedMeter("a", "NORDANVÄGEN 11 A TULLINGE 14640", [20, 30, 40, 80, 120, 90]),
  sharedMeter("b", "NORDANVÄGEN 11 B TULLINGE 14640", [18, 28, 38, 75, 110, 85]),
  sharedMeter("c", "NORDANVÄGEN 11 C TULLINGE 14640", [22, 31, 43, 82, 118, 92]),
]);
assert.equal(shared.get("a").meterCount, 3);
assert.equal(shared.get("a").place, "NORDANVÄGEN 11");

assert.equal(
  context.__engine.labelSummary({ confirmedDate: "2026-08-20", repairedDate: "2026-08-23", distanceMeters: 55, lineType: "SV" }),
  "konstaterad 2026-08-20 · lagad 2026-08-23 · ca 55 m från mätaren · SV"
);

const staleTimeline = context.__engine.readingTimeline([
  {
    date: new Date("2026-08-27T06:00:00"),
    readAt: new Date("2026-06-15T06:00:00"),
    current: 12,
  },
]);
assert.equal(staleTimeline.lastReadingDate, "2026-06-15");
assert.equal(staleTimeline.gapDays, 73);
assert.equal(staleTimeline.hasGap, true);
assert.equal(staleTimeline.points.length, 1);

const heatingEntries = [
  ["2023-05-15", 8], ["2023-06-15", 8], ["2023-09-15", 20], ["2023-10-15", 24], ["2023-12-15", 36],
  ["2024-01-15", 38], ["2024-02-15", 36], ["2024-04-15", 18], ["2024-05-15", 9], ["2024-06-15", 8], ["2024-07-15", 8],
  ["2024-09-15", 21], ["2024-10-15", 25], ["2024-12-15", 37],
  ["2025-01-15", 39], ["2025-02-15", 37], ["2025-04-15", 17], ["2025-05-15", 9], ["2025-06-15", 8],
];
const learnedHeating = context.__engine.scoreMeter({
  id: "heating-cycle",
  serial: "heating-cycle",
  address: "VÄRMEVÄGEN 1 TUMBA 14730",
  area: "TUMBA",
  info: "",
  points: heatingEntries.map(([date, current]) => ({
    date: new Date(`${date}T06:00:00`),
    readAt: new Date(`${date}T06:00:00`),
    current,
    average: 18,
    max: 39,
    info: "",
    source: "history.xlsx",
  })),
});
assert.equal(learnedHeating.profile.heatingSeason.cycles, 2);
assert.equal(learnedHeating.profile.repeatedPattern, true);
assert.equal(learnedHeating.category, "seasonal");

assert.equal(context.__engine.parseNumber("1 234,56"), 1234.56);
assert.equal(context.__engine.parseNumber("1.234,56"), 1234.56);
assert.equal(context.__engine.parseNumber("1,234.56"), 1234.56);
assert.equal(context.__engine.parseNumber("−12,5"), -12.5);
assert.equal(context.__engine.parseNumber(""), null);

const swedishDate = context.__engine.parseDate("27.10.2026 06:30");
assert.deepEqual(
  [swedishDate.getFullYear(), swedishDate.getMonth() + 1, swedishDate.getDate(), swedishDate.getHours(), swedishDate.getMinutes()],
  [2026, 10, 27, 6, 30]
);
assert.equal(context.__engine.localDate(context.__engine.parseDate("2026-10-27")), "2026-10-27");
assert.equal(context.__engine.localDate(context.__engine.dateFromFile({ name: "export_2026-10-27.xlsx", lastModified: 0 })), "2026-10-27");

const healed = context.__engine.hydrateFiles([{
  name: "Filtrerade mätare 2026-09-08 06-27.xlsx",
  exportDate: "2026-08-27T12:29:00",
  rows: [{ id: "x", exportDate: "2026-08-27T12:29:00", readAt: "2026-09-08T04:00:00", current: 1 }]
}]);
assert.equal(context.__engine.localDate(healed[0].exportDate), "2026-09-08");
assert.equal(context.__engine.localDate(healed[0].rows[0].exportDate), "2026-09-08");
assert.equal(context.__engine.localDate(context.__engine.parseDate(45292)), "2024-01-01");

const dailyMinimum = context.__engine.dedupePoints([
  { date: new Date(2026, 9, 25, 23, 40), current: 18, source: "late.xlsx" },
  { date: new Date(2026, 9, 25, 6, 0), current: 9, source: "early.xlsx" },
  { date: new Date(2026, 9, 26, 6, 0), current: 14, source: "next.xlsx" },
]);
assert.deepEqual(Array.from(dailyMinimum, (point) => point.current), [9, 14]);

const dailyTimeline = context.__engine.readingTimeline([
  { date: new Date(2026, 9, 25, 12), readAt: new Date(2026, 9, 25, 8), current: 20 },
  { date: new Date(2026, 9, 25, 15), readAt: new Date(2026, 9, 25, 9), current: 7 },
]);
assert.equal(dailyTimeline.points.length, 1);
assert.equal(dailyTimeline.points[0].current, 7);
assert.equal(context.__engine.calendarDaysBetween(new Date(2026, 9, 24, 12), new Date(2026, 9, 26, 12)), 2);
assert.equal(context.__engine.median([1, 3, 7, 9]), 5);

console.log("app engine tests: ok");

