const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(process.argv[2] || "src/desk-layout.js", "utf8");
let callback, pending = false, text = "Markera alla", writes = 0;
const button = {
  get textContent() { return text; },
  set textContent(value) { text = value; writes++; pending = true; },
};
const size = { value: "50" };
const context = {
  window: { matchMedia: () => ({ matches: false }) },
  document: {
    readyState: "complete", body: {},
    addEventListener() {},
    querySelectorAll: () => [],
    getElementById: id => id === "selectAllMatches" ? button : id === "pageSize" ? size : null,
  },
  MutationObserver: class { constructor(fn) { callback = fn; } observe() {} },
  setTimeout() {},
};
vm.runInNewContext(source, context);
function settle() {
  let turns = 0;
  while (pending && turns < 20) { pending = false; turns++; callback(); }
  assert.equal(pending, false, "Observer must settle, not starve login and browser rendering");
}
settle();
assert.equal(writes, 1);
assert.equal(text, "Markera sida (50)");
size.value = "100"; pending = true; settle();
assert.equal(text, "Markera sida (100)");
assert.equal(writes, 2);
pending = true; settle();
assert.equal(writes, 2, "Unrelated DOM changes must not rewrite the button");
console.log("desk observer: settles after initial load and page-size changes");
