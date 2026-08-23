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
vm.runInContext(`${source}\n;globalThis.__engine = { scoreMeter };`, context);

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
assert.equal(customerSide.category, "customer_side");
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

console.log("app engine tests: ok");
