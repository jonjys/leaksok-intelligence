const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const mapSource = fs.readFileSync(path.join(__dirname, '../src/map.js'), 'utf8');

function element() {
  return { hidden: false, dataset: {}, classList: { toggle() {} }, querySelectorAll: () => [], appendChild() {}, scrollIntoView() {} };
}
function appHarness() {
  const meters = Array.from({ length: 61 }, (_, i) => ({ id: String(i), address: `FALKVÄGEN ${i + 1} TUMBA 14730`, category: 'suspect_auto', series: [], latest: { value: 50 }, status: 'Misstänk' }));
  const state = { files: [{}], view: 'list', focusId: 'old', marked: new Set(['old']), visible: meters, byId: new Map(meters.map(m => [m.id, m])), list: 'all', search: '', area: 'all', chartHidden: true };
  const nodes = new Map();
  const els = Object.fromEntries(['focus', 'focusChart', 'focusTitle', 'focusMeta', 'rows'].map(k => [k, element()]));
  const updates = [], charts = [];
  const context = { state, els, LIST: { suspect: { label: 'Misstänk' } }, $: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, document: { body: element(), createElement: () => ({ dataset: {}, setAttribute() {} }) }, window: { matchMedia: () => ({ matches: false }) }, localStorage: { setItem() {} }, VIEW_KEY: 'view', clearTimeout() {}, focusTimer: 1, focusRequest: 0, lastMapKey: '', Engine: { fmtDate: () => '', fmtPct: () => '' }, num: String, esc: String, shortAddress: m => m.address, openChart() {}, Chart: { render: (el, m) => charts.push(m.id) }, ensureMap: () => ({ invalidate() {}, update: options => { updates.push(options); } }), requestAnimationFrame: fn => fn() };
  context.render = () => context.renderFocus();
  vm.createContext(context);
  vm.runInContext(appSource.slice(appSource.indexOf('  function renderFocus()'), appSource.indexOf('  function openChart(id)')) + appSource.slice(appSource.indexOf('  function setList(key)'), appSource.indexOf('  // Window resize')), context);
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

function mapHarness({ cache = {}, fetch, timers = {} } = {}) {
  const maps = [], groups = [];
  const layer = () => ({ addTo() { return this; }, on() { return this; }, bindTooltip() { return this; } });
  const L = {
    map() { const m = { setView(point, zoom) { this.center = point; this.zoom = zoom; return this; }, flyTo(point, zoom) { this.center = point; this.zoom = zoom; return this; }, fitBounds(points) { this.points = points; return this; }, stop() {}, on() {}, invalidateSize() {} }; maps.push(m); return m; },
    tileLayer: layer,
    layerGroup() { const group = { ...layer(), dots: [], clearLayers() { this.dots = []; } }; groups.push(group); return group; },
    circleMarker(point, options) { return { ...layer(), point, options, addTo(group) { group.dots.push(this); return this; } }; },
    latLngBounds: points => points,
  };
  const context = { L, URL, localStorage: { getItem: key => JSON.stringify(key.includes('geocode') ? cache : {}), setItem() {} }, matchMedia: () => ({ matches: false }), window: { matchMedia: () => ({ matches: true }) }, document: { addEventListener() {} }, setTimeout: fn => fn(), fetch: fetch || (() => { throw new Error('Unexpected fetch'); }), ...timers };
  vm.createContext(context);
  vm.runInContext(mapSource, context);
  const status = {};
  const view = context.LeakMap.create({ element: { ...element(), parentElement: element() }, statusElement: status });
  return { api: context.LeakMap, view, map: maps[0], markers: groups[1], status };
}

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

test('Uncached list loads beyond old limit and continues after address service failure', async () => {
  let calls = 0;
  const meters = Array.from({ length: 17 }, (_, i) => ({ id: String(i), address: `FALKVÄGEN ${i + 1} TUMBA 14730` }));
  const { view, markers, status } = mapHarness({ fetch: async url => {
    calls++;
    const house = new URL(url).searchParams.get('street').split(' ').at(-1);
    if (house === '1') throw Error('Service unavailable');
    return { ok: true, json: async () => [{ lat: '59.18', lon: '17.8', address: { road: 'Falkvägen', house_number: house, postcode: '14730' } }] };
  } });
  await view.update({ meters });
  assert.equal(calls, 17);
  assert.equal(markers.dots.length, 16);
  assert.match(status.textContent, /1 adressökningar misslyckades/);
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

test('Clicking an uncached range address flies to its building and preserves other pins', async () => {
  const meters = [{ id: 'range', address: 'ALHAGSVÄGEN 58 -60 NORSBORG 14559' }, { id: 'other', address: 'FALKVÄGEN 1 TUMBA 14730' }];
  const calls = [];
  const { view, api, map, markers } = mapHarness({
    cache: { 'falkvagen 1, 14730 tumba, sverige': { lat: 59.18, lng: 17.8 } },
    fetch: async url => {
      const q = new URL(url).searchParams.get('q'); calls.push(q);
      return { ok: true, json: async () => q === 'ALHAGSVÄGEN 58, Botkyrka, Sverige'
        ? [{ lat: '59.24', lon: '17.82', address: { road: 'Alhagsvägen', house_number: '58', postcode: '14559' } }] : [] };
    },
  });
  await view.update({ meters, focusId: 'range', focusRequest: 1, mode: 'results' });
  assert.equal(map.zoom, 17); assert.equal(map.center[0], 59.24);
  assert.equal(markers.dots.length, 2);
  assert.equal(api.cachedPosition(meters[0]).approximate, true);
  assert.equal(api.coordinates(meters).has('range'), false, 'Range fallback is navigation only');
  const requests = calls.length;
  await view.update({ meters, focusId: 'range', focusRequest: 2, mode: 'results' });
  assert.equal(calls.length, requests, 'Successful address fallback is cached');
});

test('Old failed lookup retries and missing house falls back to the correct street only', async () => {
  const meter = { id: 'street', address: 'BROÄNGSVÄGEN 36 TUMBA 14732' };
  const { view, api, map, status } = mapHarness({
    cache: { 'broangsvagen 36, 14732 tumba, sverige': { missing: true, lookupVersion: 4, at: Date.now() } },
    fetch: async url => ({ ok: true, json: async () => new URL(url).searchParams.get('q') === 'BROÄNGSVÄGEN, Botkyrka, Sverige'
      ? [{ lat: '59.19', lon: '17.81', address: { road: 'Stora Broängsvägen' } }, { lat: '59.20', lon: '17.82', address: { road: 'Broängsvägen' } }] : [] }),
  });
  await view.update({ meters: [meter], focusId: 'street' });
  assert.equal(map.zoom, 17); assert.equal(map.center[0], 59.20);
  assert.equal(api.cachedPosition(meter).approximate, true);
  assert.match(status.textContent, /ungefärlig adressposition/);
  assert.equal(api.coordinates([meter]).size, 0);
});

test('No address match never substitutes a different numbered house or an unrelated street', async () => {
  const meter = { id: 'missing', address: 'BROÄNGSVÄGEN 36 TUMBA 14732' };
  const { view, api, markers, status } = mapHarness({ fetch: async () => ({ ok: true, json: async () => [
    { lat: '59.2', lon: '17.8', address: { road: 'Broängsvägen', house_number: '35' } },
    { lat: '59.2', lon: '17.8', address: { road: 'Stora Broängsvägen' } },
  ] }) });
  await view.update({ meters: [meter], focusId: 'missing' });
  assert.equal(markers.dots.length, 0);
  assert.equal(api.cachedPosition(meter), null);
  assert.match(status.textContent, /adressen .* kunde inte hittas/);
});

test('Selected address overtakes queued background lookups without concurrent requests', async () => {
  let release, started, active = 0, maximum = 0;
  const began = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const houses = [];
  const { api } = mapHarness({ fetch: async url => {
    active++; maximum = Math.max(maximum, active);
    const house = new URL(url).searchParams.get('street').split(' ').at(-1);
    houses.push(house);
    if (house === '1') { started(); await blocked; }
    active--;
    return { ok: true, json: async () => [{ lat: '59.18', lon: '17.8', address: { road: 'Falkvägen', house_number: house, postcode: '14730' } }] };
  } });
  const meters = [1, 2, 3, 4].map(n => ({ id: String(n), address: `FALKVÄGEN ${n} TUMBA 14730` }));
  const work = meters.map(m => api.resolvePositions([m]));
  await began;
  // A second view of the same module shares the lookup queue.
  const focus = api.create({ element: { ...element(), parentElement: element() } });
  const chosen = focus.update({ meters: [meters[3]], focusId: '4' });
  release();
  await Promise.all([...work, chosen]);
  assert.deepEqual(houses, ['1', '4', '2', '3']);
  assert.equal(maximum, 1);
});

test('A hanging address request times out and the next meter still gets a pin', async () => {
  const meters = [1, 2].map(n => ({ id: String(n), address: `FALKVÄGEN ${n} TUMBA 14730` }));
  const { view, markers, status } = mapHarness({
    timers: { AbortController, setTimeout: (fn, ms) => { if (ms === 10000) queueMicrotask(fn); else fn(); return 1; }, clearTimeout() {} },
    fetch: async (url, { signal }) => {
      const house = new URL(url).searchParams.get('street').split(' ').at(-1);
      if (house === '1') return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      return { ok: true, json: async () => [{ lat: '59.18', lon: '17.8', address: { road: 'Falkvägen', house_number: house, postcode: '14730' } }] };
    },
  });
  await view.update({ meters, focusId: '1' });
  assert.equal(markers.dots.length, 1);
  assert.match(status.textContent, /1 adressökningar misslyckades/);
});

