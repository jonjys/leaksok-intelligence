const assert = require("node:assert/strict");
const fs = require("node:fs");

const field = fs.readFileSync(require.resolve("../src/field-workflow.js"), "utf8");
const workspace = fs.readFileSync(require.resolve("../src/map-workspace.js"), "utf8");
const officeCss = fs.readFileSync(require.resolve("../src/office-demo.css"), "utf8");

assert.match(field, /doubleClickZoom:\s*true/);
assert.match(field, /touchZoom:\s*true/);
assert.match(field, /scrollWheelZoom:\s*false/);
assert.doesNotMatch(workspace, /stopImmediatePropagation/);
assert.match(workspace, /Öppna helskärmskarta/);
assert.match(workspace, /Tillbaka till fältläge/);
assert.match(officeCss, /body\[data-work-view="map"\] \.meter-preview[\s\S]*position:\s*fixed/);
assert.match(officeCss, /height:\s*100dvh/);
assert.match(officeCss, /body\[data-work-view="list"\] #search/);

console.log("ui structure tests: ok");
