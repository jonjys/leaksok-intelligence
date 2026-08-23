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

console.log("app engine tests: ok");
