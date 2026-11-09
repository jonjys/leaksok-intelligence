const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const MeterView = require('../src/meter-view.js');
const AddressIndex = require('../src/address-index.js');
const addressSource = fs.readFileSync(path.join(__dirname, '../src/address-index.js'), 'utf8');
const mapSource = fs.readFileSync(path.join(__dirname, '../src/map.js'), 'utf8');

function element() {
  return { hidden: false, dataset: {}, classList: { toggle() {} }, querySelectorAll: () => [], addEventListener() {}, appendChild() {}, insertAdjacentHTML() {}, scrollIntoView() {} };
}
function appHarness() {
  const meters = Array.from({ length: 61 }, (_, i) => ({ id: String(i), address: `FALKVÄGEN ${i + 1} TUMBA 14730`, category: 'suspect_auto', series: [], latest: { value: 50 }, status: 'Misstänk' }));
  const state = { files: [{}], view: 'list', focusId: 'old', marked: new Set(['old']), visible: meters, byId: new Map(meters.map(m => [m.id, m])), list: 'all', search: '', area: 'all', chartHidden: true };
  const nodes = new Map();
  const els = Object.fromEntries(['focus', 'focusChart', 'focusTitle', 'focusMeta', 'rows'].map(k => [k, element()]));
  const updates = [], charts = [];
  const context = { comparisonHtml: () => "", excelPHtml: () => "", state, els, LIST: { suspect: { label: 'Misstänk' } }, $: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, document: { body: element(), createElement: () => ({ dataset: {}, setAttribute() {} }) }, window: { matchMedia: () => ({ matches: false }) }, localStorage: { setItem() {} }, VIEW_KEY: 'view', clearTimeout() {}, focusTimer: 1, focusRequest: 0, mapRenderVersion: 0, MeterView, lastMapKey: '', Engine: { fmtDate: () => '', fmtPct: () => '' }, num: String, esc: String, shortAddress: m => m.address, openChart() {}, Chart: { render: (el, m) => charts.push(m.id) }, ensureMap: () => ({ invalidate() {}, update: options => { updates.push(options); } }), requestAnimationFrame: fn => fn() };
  context.render = () => context.renderFocus();
  vm.createContext(context);
  vm.runInContext(appSource.slice(appSource.indexOf('  function renderFocus()'), appSource.indexOf('  function openChart(id)')) + appSource.slice(appSource.indexOf('  function setList('), appSource.indexOf('  // Window resize')), context);
  return { context, state, els, updates, charts, meters };
}

test('Misstänk opens map and sends every result beyond pagination; clicking shows graph and focus', () => {
  const { context, state, els, updates, charts } = appHarness();
  context.setList('suspect');
  assert.equal(state.view, 'map');
  assert.equal(state.focusId, '');
  assert.equal(updates.at(-1).meters.length, 61);
  assert.equal(updates.at(-1).resultIds.length, 61);
  assert.equal(els.focus.hidden, false);
  context.setFocus('5');
  assert.equal(state.focusId, '5');
  assert.equal(state.chartHidden, false);
  assert.equal(els.focusChart.hidden, false);
  assert.equal(charts.at(-1), '5');
  assert.equal(updates.at(-1).focusId, '5');
  assert.equal(updates.at(-1).meters.length, 61);
  state.chartHidden = true;
  context.setFocus('5');
  assert.equal(els.focusChart.hidden, false, 'Clicking the same address reopens its graph');
  state.view = 'list';
  context.setFocus('6');
  assert.equal(state.view, 'map', 'Address click also opens map from list view');
  assert.equal(charts.at(-1), '6');
});

test('Marked addresses stay on the map across tabs, search and address corrections', () => {
  const { context, state, updates, meters } = appHarness();
  state.marked = new Set(['0', '1', '2']);
  state.visible = meters.slice(10, 12);
  state.view = 'map'; state.focusId = '10';
  context.renderFocus();
  assert.deepEqual(Array.from(updates.at(-1).meters, m => m.id).sort(), ['0', '1', '10', '11', '2'].sort());
  assert.ok(updates.at(-1).resultIds.includes('0'), 'Show all results includes retained marked pins');
  context.setFocus('0');
  assert.ok(updates.at(-1).meters.some(m => m.id === '2'));
  assert.equal(updates.at(-1).meters.filter(m => m.id === '0').length, 1);
  const before = updates.length;
  meters[0].address = 'NY ADRESS 1 TUMBA';
  context.renderFocus();
  assert.equal(updates.length, before + 1, 'An updated address invalidates the map even for the same serial');
});

test('Address navigation ignores meter GPS fields and cached coordinates', () => {
  const { api } = mapHarness({ cache: { 'falkvagen 6, 14730 tumba, sverige': { lat: 59.2, lng: 17.8 } } });
  const meter = { id: '6', address: 'FALKVÄGEN 6 TUMBA 14730', lat: 0, lng: 0, latitude: 10, longitude: 20, gps: { lat: 30, lng: 40 } };
  assert.equal(new URL(api.navigationUrl(meter)).searchParams.get('destination'), 'FALKVÄGEN 6, 14730 TUMBA, Sverige');
  assert.equal(api.cachedPosition(meter).lat, 59.2, 'Map pins use only the address cache');
});

function mapHarness({ cache = {}, fetch, timers = {} } = {}) {
  const maps = [], groups = [];
  const layer = () => ({ addTo() { return this; }, on() { return this; }, bindTooltip(tip, options) { this.tip = tip; this.tipOptions = options; return this; }, unbindTooltip() { return this; }, openTooltip() { return this; } });
  const L = {
    map() { const m = { setView(point, zoom) { this.center = point; this.zoom = zoom; return this; }, flyTo(point, zoom) { this.center = point; this.zoom = zoom; return this; }, fitBounds(points) { this.points = points; return this; }, getBoundsZoom(points) { this.focusBounds = points; return points[0][0] === points[1][0] && points[0][1] === points[1][1] ? 17 : 12; }, stop() {}, on() {}, invalidateSize() {} }; maps.push(m); return m; },
    tileLayer: layer,
    layerGroup() { const group = { ...layer(), dots: [], clearLayers() { this.dots = []; }, removeLayer(dot) { this.dots = this.dots.filter(d => d !== dot); } }; groups.push(group); return group; },
    circleMarker(point, options) { return { ...layer(), point, options, setLatLng(point) { this.point = point; return this; }, setStyle(style) { Object.assign(this.options, style); return this; }, bringToFront() { const group = this.group; group.dots = group.dots.filter(d => d !== this); group.dots.push(this); return this; }, getElement() { return null; }, addTo(group) { this.group = group; group.dots.push(this); return this; } }; },
    latLngBounds: points => points,
  };
  const context = { L, URL, AbortSignal, LeakMeterView: MeterView, localStorage: { getItem: key => JSON.stringify(key.includes('geocode') ? cache : {}), setItem() {} }, matchMedia: () => ({ matches: false }), window: { matchMedia: () => ({ matches: true }) }, document: { addEventListener() {} }, setTimeout: fn => fn(), fetch: fetch || (async () => reply([])), ...timers };
  vm.createContext(context);
  vm.runInContext(addressSource, context);
  vm.runInContext(mapSource, context);
  const status = { dataset: {} };
  const view = context.LeakMap.create({ element: { ...element(), parentElement: element() }, statusElement: status });
  return { api: context.LeakMap, view, map: maps[0], markers: groups[1], status };
}
const addressRow = (road, house, north = 6564000, east = 139000) => [road, house, '14730', 'Tumba', north, east];
const reply = rows => ({ ok: true, json: async () => ({ version: 1, crs: 'EPSG:3011', rows }) });

test('Map fits all 61 suspect markers, zooms to selected address, keeps remaining markers', async () => {
  const meters = Array.from({ length: 61 }, (_, i) => ({ id: String(i), address: `FALKVÄGEN ${i + 1} TUMBA 14730`, category: 'suspect_auto' }));
  const cache = Object.fromEntries(meters.map((m, i) => [`falkvagen ${i + 1}, 14730 tumba, sverige`, { lat: 59.18 + i * .0001, lng: 17.8 + i * .0001 }]));
  const { view, map, markers } = mapHarness({ cache });
  await view.update({ meters, mode: 'results' });
  assert.equal(markers.dots.length, 61);
  assert.equal(map.points.length, 61);
  await view.update({ meters, mode: 'results', focusId: '5', focusRequest: 1 });
  assert.equal(markers.dots.length, 61);
  assert.equal(map.zoom, 17);
  assert.equal(map.center[0], cache['falkvagen 6, 14730 tumba, sverige'].lat);
  assert.equal(markers.dots.at(-1).options.radius, 11);
  await view.update({ meters, mode: 'results' });
  assert.equal(map.points.length, 61);
});

test('All 3151 uncached meters load from one public table request with no meter data', async () => {
  let calls = 0;
  const meters = Array.from({ length: 3151 }, (_, i) => ({ id: String(i), address: `TESTVÄGEN ${i + 1} TUMBA 14730`, lat: 0, lng: 0 }));
  const { view, markers, status } = mapHarness({ fetch: async url => {
    calls++;
    assert.equal(url, '/api/addresses', 'No address or serial is submitted');
    return reply(meters.map((m, i) => addressRow('Testvägen', String(i + 1), 6564000 + i)));
  } });
  await view.update({ meters });
  assert.equal(calls, 1);
  assert.equal(markers.dots.length, 3151);
  assert.match(status.textContent, /^3151 av 3151/);
});

test('Address formats with spaced or missing postcode still require exact house', () => {
  const { api } = mapHarness();
  for (const address of ['FALKVÄGEN 6 TUMBA 147 30', 'FALKVÄGEN 6 147 30 TUMBA', 'FALKVÄGEN 6 TUMBA', 'FALKVÄGEN 6']) {
    const parsed = api.parseAddress({ address });
    assert.equal(parsed.house, '6');
    assert.equal(parsed.road, 'FALKVÄGEN');
    assert.equal(api.exactHit({ address: { road: 'Falkvägen', house_number: '6', postcode: '14730' } }, parsed), true);
    assert.equal(api.exactHit({ address: { road: 'Falkvägen', house_number: '7', postcode: '14730' } }, parsed), false);
  }
});

test('Excel address variants normalize ranges, house letters, commas and attached numbers', () => {
  const { api } = mapHarness();
  for (const [address, house] of [
    ['ALHAGSVÄGEN 58 -60 NORSBORG 14559', '58-60'],
    ['ALHAGSVÄGEN 58 – 60, 145 59 NORSBORG', '58-60'],
    ['BROÄNGSVÄGEN 34 A TUMBA 14732', '34A'],
    ['BROÄNGSVÄGEN34A, TUMBA, 147 32', '34A'],
    ['BROÄNGSVÄGEN 34A 14732', '34A'],
  ]) {
    const parsed = api.parseAddress({ address, area: 'TUMBA' });
    assert.equal(parsed.house, house, address);
    assert.ok(['ALHAGSVÄGEN', 'BROÄNGSVÄGEN'].includes(parsed.road));
    assert.ok(!/^\d+$/.test(parsed.city), 'Postcode is not mistaken for town');
  }
  assert.equal(api.exactHit({ address: { road: 'Stora Broängsvägen', house_number: '34A' } }, api.parseAddress({ address: 'BROÄNGSVÄGEN 34A TUMBA' })), false);
});

test('Letter suffix is required and old approximate cache cannot place 9C at 9 or on the street', async () => {
  const meter = { id: 'letter', address: 'SOLTORPSVÄGEN 9C TUMBA 14732' };
  const { view, api, markers, status } = mapHarness({
    cache: { 'soltorpsvagen 9c, 14732 tumba, sverige': { lat: 59.2, lng: 17.8, approximate: true } },
    fetch: async () => reply([addressRow('Soltorpsvägen', '9'), addressRow('Soltorpsvägen', '9B')]),
  });
  assert.equal(api.cachedPosition(meter), null);
  await view.update({ meters: [meter], focusId: meter.id });
  assert.equal(markers.dots.length, 0);
  assert.equal(api.cachedPosition(meter), null);
  assert.match(status.textContent, /kunde inte hittas/);
});

test('Multiple selected letter addresses retain their own matching house pins', async () => {
  const meters = ['9A', '9C'].map(house => ({ id: house, address: `SOLTORPSVÄGEN ${house} TUMBA 14732` }));
  const { view, api, markers, map } = mapHarness({ fetch: async () => reply([
    addressRow('Soltorpsvägen', '9A', 6564000), addressRow('Soltorpsvägen', '9C', 6565000),
  ]) });
  await view.update({ meters, marked: new Set(['9A', '9C']), focusId: '9C' });
  assert.equal(markers.dots.length, 2);
  assert.ok(api.cachedPosition(meters[1]).lat > api.cachedPosition(meters[0]).lat);
  assert.equal(map.center[0], api.cachedPosition(meters[1]).lat);
});

test('No address match never substitutes a different numbered house or an unrelated street', async () => {
  const meter = { id: 'missing', address: 'BROÄNGSVÄGEN 36 TUMBA 14732' };
  const { view, api, markers, status } = mapHarness({ fetch: async () => reply([
    addressRow('Broängsvägen', '35'), addressRow('Stora Broängsvägen', '36'),
  ]) });
  await view.update({ meters: [meter], focusId: 'missing' });
  assert.equal(markers.dots.length, 0);
  assert.equal(api.cachedPosition(meter), null);
  assert.match(status.textContent, /adressen .* kunde inte hittas/);
});

test('Concurrent position and focus requests share one table download', async () => {
  let release, started, calls = 0;
  const began = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const { api } = mapHarness({ fetch: async () => {
    calls++; started(); await blocked;
    return reply([1, 2, 3, 4].map(n => addressRow('Falkvägen', String(n))));
  } });
  const meters = [1, 2, 3, 4].map(n => ({ id: String(n), address: `FALKVÄGEN ${n} TUMBA 14730` }));
  const work = meters.map(m => api.resolvePositions([m]));
  await began;
  // A second view also waits for the same table.
  const focus = api.create({ element: { ...element(), parentElement: element() } });
  const chosen = focus.update({ meters: [meters[3]], focusId: '4' });
  release();
  await Promise.all([...work, chosen]);
  assert.equal(calls, 1);
  assert.equal(api.coordinates(meters).size, 4);
});

test('A failed registry download preserves already cached pins and can be retried', async () => {
  const meters = [1, 2].map(n => ({ id: String(n), address: `FALKVÄGEN ${n} TUMBA 14730` }));
  let calls = 0;
  const { view, markers, status } = mapHarness({
    cache: { 'falkvagen 2, 14730 tumba, sverige': { lat: 59.2, lng: 17.8 } },
    fetch: async () => {
      if (++calls === 1) throw Error('timeout');
      return reply([1, 2].map(n => addressRow('Falkvägen', String(n))));
    },
  });
  await view.update({ meters, focusId: '1' });
  assert.equal(markers.dots.length, 1);
  assert.match(status.textContent, /registret kunde inte hämtas/);
  await view.update({ meters, focusId: '1' });
  assert.equal(markers.dots.length, 2);
  assert.equal(calls, 2);
});



test('New reading with the same category refreshes the map and pending frames only use the latest selection', () => {
  const { context, state, updates, meters } = appHarness();
  state.view = 'map'; state.focusId = '0';
  context.renderFocus();
  const count = updates.length;
  meters[0].latest = { value: 87, date: new Date('2026-11-02') };
  context.renderFocus();
  assert.equal(updates.length, count + 1);
  assert.equal(updates.at(-1).meters[0].latest.value, 87);
  const frames = [];
  context.requestAnimationFrame = fn => frames.push(fn);
  context.setFocus('1');
  context.setFocus('2');
  state.marked.add('2');
  context.renderFocus();
  for (const frame of frames) frame();
  assert.equal(updates.length, count + 2, 'Superseded animation frames must not draw old results');
  assert.equal(updates.at(-1).focusId, '2');
  state.marked.clear();
  assert.equal(updates.at(-1).marked.has('2'), true, 'An update owns its selection snapshot');
});

test('Changing category tabs retains the marked focused meter even outside the new result list', () => {
  const { context, state, updates } = appHarness();
  state.view = 'map'; state.focusId = '5'; state.marked = new Set(['5']); state.visible = [];
  context.setList('suspect');
  assert.equal(state.focusId, '5');
  assert.equal(updates.at(-1).meters.length, 1);
  assert.equal(updates.at(-1).meters[0].id, '5');
});

test('Sorting and updated analysis reuse pins and refresh tooltips, colour and selection', async () => {
  const meters = [1, 2].map(n => ({ id: String(n), address: `FALKVÄGEN ${n} TUMBA 14730`, category: 'suspect_auto', latest: { value: n } }));
  const cache = Object.fromEntries(meters.map((m, i) => [`falkvagen ${i + 1}, 14730 tumba, sverige`, { lat: 59.18 + i * .01, lng: 17.8 }]));
  const { view, markers } = mapHarness({ cache });
  await view.update({ meters, marked: new Set(['1']), focusId: '1' });
  const first = markers.dots.find(m => m.point[0] === 59.18);
  const second = markers.dots.find(m => m !== first);
  meters[0].latest.value = 87;
  meters[0].status = 'ÅK UT'; meters[0].category = 'dispatch';
  await view.update({ meters: [...meters].reverse(), marked: new Set(['1']), focusId: '2' });
  assert.equal(markers.dots.length, 2);
  assert.ok(markers.dots.includes(first) && markers.dots.includes(second));
  assert.match(first.tip, /<dd>87<\/dd>/);
  assert.equal(first.options.fillColor, MeterView.statuses.dispatch.color);
  assert.equal(first.options.color, '#111827');
  assert.equal(first.options.fillOpacity, 1);
  assert.equal(second.options.radius, 11);
});

test('A single marked address remains in view when focusing another address; fit marked excludes other results', async () => {
  const meters = [1, 2, 3].map(n => ({ id: String(n), address: `FALKVÄGEN ${n} TUMBA 14730` }));
  const cache = Object.fromEntries(meters.map((m, i) => [`falkvagen ${i + 1}, 14730 tumba, sverige`, { lat: 59.18 + i * .02, lng: 17.8 }]));
  const { view, map } = mapHarness({ cache });
  await view.update({ meters, marked: new Set(['1']), focusId: '2' });
  assert.ok(map.zoom < 17);
  assert.equal(map.center[0], 59.2);
  view.fitMarked();
  assert.equal(map.center[0], 59.18);
  assert.equal(map.zoom, 17);
});

test('An older address lookup cannot restore pins or focus after a newer selection', async () => {
  const meters = [1, 2].map(n => ({ id: String(n), address: `FALKVÄGEN ${n} TUMBA 14730` }));
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const { view, markers, status } = mapHarness({
    cache: { 'falkvagen 2, 14730 tumba, sverige': { lat: 59.2, lng: 17.8 } },
    fetch: async () => { started(); await pending; return reply([addressRow('Falkvägen', '1')]); },
  });
  const old = view.update({ meters, focusId: '1' });
  await began;
  const latest = view.update({ meters: [meters[1]], focusId: '2', marked: new Set(['2']) });
  release();
  await Promise.all([old, latest]);
  assert.equal(markers.dots.length, 1);
  assert.equal(markers.dots[0].point[0], 59.2);
  assert.equal(markers.dots[0].options.radius, 11);
  assert.match(status.textContent, /1 av 1 markerade/);
});

test('Missing selected house is reported after the shared table download completes', async () => {
  const meters = [1, 2].map(n => ({ id: String(n), address: `FALKVÄGEN ${n} TUMBA 14730` }));
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const { view, status } = mapHarness({ fetch: async () => {
    started(); await pending;
    return reply([addressRow('Falkvägen', '2')]);
  } });
  const update = view.update({ meters, focusId: '1' });
  await began;
  assert.equal(status.dataset.state, 'loading');
  release(); await update;
  assert.match(status.textContent, /Vald mätare: adressen .* kunde inte hittas/);
  assert.equal(status.dataset.state, 'warning');
});

test('Corrected map address uses its exact house, preserves the imported name and rejects missing letters', async () => {
  const meter = { id: 'container', address: 'I CONTAINER', gps: { lat: 0, lng: 0 } };
  const { api, view, markers } = mapHarness({ fetch: async () => reply([addressRow('Provvägen', '9C')]) });
  await view.update({ meters: [meter], focusId: meter.id });
  assert.equal(markers.dots.length, 0);
  await assert.rejects(api.correctAddress(meter, 'Provvägen 9A'), /Ingen säker träff/);
  await api.correctAddress(meter, 'Provvägen 9C Tumba');
  await view.update({ meters: [meter], focusId: meter.id });
  assert.equal(markers.dots.length, 1);
  assert.equal(meter.address, 'I CONTAINER');
  assert.equal(api.cachedPosition(meter).corrected, true);
  assert.match(new URL(api.navigationUrl(meter)).searchParams.get('destination'), /Provvägen 9C/);
  await api.correctAddress(meter, '');
  await view.update({ meters: [meter], focusId: meter.id });
  assert.equal(markers.dots.length, 0);
});

test('Repeated map updates keep a stable coordinate revision even when the cache timestamp changes', async () => {
  const meter = { id: '1', address: 'FALKVÄGEN 1 TUMBA 14730' };
  const { api, view } = mapHarness({ cache: { 'falkvagen 1, 14730 tumba, sverige': { lat: 59.2, lng: 17.8, at: 123 } } });
  const before = JSON.stringify([...api.coordinates([meter])]);
  await view.update({ meters: [meter] });
  assert.equal(JSON.stringify([...api.coordinates([meter])]), before);
  await view.update({ meters: [meter], focusId: meter.id });
  assert.equal(JSON.stringify([...api.coordinates([meter])]), before, 'No needless reanalysis loop on cached addresses');
});

