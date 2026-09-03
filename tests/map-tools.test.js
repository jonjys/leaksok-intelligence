const assert = require("node:assert/strict");
const MapTools = require("../src/map-tools.js");

assert.equal(MapTools.roundedDistance([59.2, 17.83], [59.201, 17.83]), 111);
assert.equal(MapTools.roundedDistance({ lat: 59.2, lng: 17.83 }, { lat: 59.2, lng: 17.831 }), 57);
assert.equal(MapTools.distanceMeters(null, [59.2, 17.83]), null);

const bounds = { southWest: [59.19, 17.82], northEast: [59.21, 17.84] };
assert.equal(MapTools.pointInBounds([59.2, 17.83], bounds), true);
assert.equal(MapTools.pointInBounds([59.22, 17.83], bounds), false);
assert.deepEqual(MapTools.idsWithinBounds([
  { id: "inside", lat: 59.2, lng: 17.83 },
  { id: "edge", lat: 59.21, lng: 17.84 },
  { id: "outside", lat: 59.25, lng: 17.83 },
], bounds), ["inside", "edge"]);

console.log("map tools tests: ok");
