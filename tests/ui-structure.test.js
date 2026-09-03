const assert = require("node:assert/strict");
const fs = require("node:fs");

const field = fs.readFileSync(require.resolve("../src/field-workflow.js"), "utf8");
const workspace = fs.readFileSync(require.resolve("../src/map-workspace.js"), "utf8");
const officeCss = fs.readFileSync(require.resolve("../src/office-demo.css"), "utf8");
const mapProCss = fs.readFileSync(require.resolve("../src/map-pro.css"), "utf8");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");

assert.match(field, /doubleClickZoom:\s*true/);
assert.match(field, /touchZoom:\s*true/);
assert.match(field, /scrollWheelZoom:\s*window\.innerWidth > 760/);
assert.match(field, /boxZoom:\s*true/);
assert.match(field, /data-map-tool="select"/);
assert.match(field, /data-map-tool="valve"/);
assert.match(field, /data-map-tool="leak"/);
assert.match(field, /LeakMapTools\.idsWithinBounds/);
assert.match(field, /LeakMapTools\.roundedDistance/);
assert.doesNotMatch(workspace, /stopImmediatePropagation/);
assert.match(workspace, /Öppna helskärmskarta/);
assert.match(workspace, /Tillbaka till fältläge/);
assert.match(workspace, /if \(isMobile\(\)\) return "list"/);
assert.match(officeCss, /body\[data-work-view="map"\] \.meter-preview[\s\S]*position:\s*fixed/);
assert.match(officeCss, /height:\s*100dvh/);
assert.match(officeCss, /body\[data-work-view="list"\] #search/);
assert.match(mapProCss, /grid-template-columns:\s*252px minmax\(0, 1fr\)/);
assert.match(mapProCss, /\.map-toolbar[\s\S]*right:\s*13px !important;[\s\S]*left:\s*auto !important;/);
assert.match(mapProCss, /\.map-inspector/);
assert.match(html, /src\/map-tools\.js/);
assert.match(html, /src\/map-pro\.css/);

console.log("ui structure tests: ok");
