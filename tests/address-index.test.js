const test = require('node:test');
const assert = require('node:assert/strict');
const { build, parseAddress, toWgs84 } = require('../src/address-index');
const api = require('../api/addresses');
const row = (house, north = 6564000, postcode = '14730', city = 'Tumba', road = 'Provvägen') => [road, house, postcode, city, north, 139000];
const indexOf = rows => build({ version: 1, crs: 'EPSG:3011', rows });

test('Municipal SWEREF north/east coordinates agree with independent PROJ reference to sub-millimetres', () => {
  // Independently generated using PROJ EPSG:3011 -> EPSG:4326, always_xy.
  for (const [north, east, lat, lng] of [
    [6570832.583957783, 138303.50806387904, 59.25265883434518, 17.794991228592547],
    [6548588.65, 131187.56, 59.052725688537635, 17.672184380165703],
    [6571784.62, 148036.21, 59.26136185672975, 17.965571179074477],
  ]) {
    const p = toWgs84(north, east);
    assert.ok(Math.abs(p.lat - lat) < 1e-9);
    assert.ok(Math.abs(p.lng - lng) < 1e-9);
  }
  assert.equal(toWgs84(139000, 6564000), null, 'Swapped axes cannot silently make a pin');
});

test('A full house letter is mandatory, independently of Excel GPS', () => {
  const a = indexOf([row('9'), row('9A'), row('9C', 6564100)]);
  const p = a.match({ address: 'PROVVÄGEN9 C, TUMBA, 147 30', lat: 0, gps: { lat: 0, lng: 0 } });
  assert.equal(p.address, 'Provvägen 9C');
  assert.equal(a.match({ address: 'Provvägen 9B Tumba' }), null);
  assert.equal(a.match({ address: 'Provvägen Tumba' }), null);
});

test('An old postcode does not hide an otherwise unique exact road and complete house', () => {
  const a = indexOf([row('8', 6564000, '14731', 'Uttran')]);
  const p = a.match({ address: 'PROVVÄGEN 8 TUMBA 14730' });
  assert.equal(p.address, 'Provvägen 8');
  assert.equal(p.postcodeChanged, true);
  assert.equal(p.postcode, '14731');
});

test('Duplicate road/house locations require disambiguation rather than a first-result guess', () => {
  const a = indexOf([row('8', 6564000, '14730', 'Tumba'), row('8', 6570000, '14630', 'Tullinge')]);
  assert.equal(a.match({ address: 'Provvägen 8' }), null);
  assert.equal(a.match({ address: 'Provvägen 8 Tullinge' }).city, 'Tullinge');
  assert.equal(a.match({ address: 'Provvägen 8 14730 Tumba' }).city, 'Tumba');
});

test('Intervals use only an explicitly named endpoint and disclose the resolved address', () => {
  const a = indexOf([row('2'), row('4'), row('7A'), row('7D'), row('11')]);
  const p = a.match({ address: 'Provvägen 2 - 4 Tumba 14730' });
  assert.equal(p.address, 'Provvägen 2');
  assert.equal(p.interval, true);
  assert.equal(parseAddress({ address: 'Provvägen 7 A-D Tumba 14730' }).house, '7A-D');
  assert.equal(a.match({ address: 'Provvägen 7 A-D Tumba 14730' }).address, 'Provvägen 7A');
  assert.equal(a.match({ address: 'Provvägen 1 - 9 Tumba' }), null, 'An interior house is not substituted for missing endpoints');
  assert.equal(a.match({ address: 'Provvägen 7C Tumba' }), null);
});

test('Only whitespace and accents normalize; an unrelated road or locality cannot substitute', () => {
  const a = indexOf([row('4', 6564000, '14730', 'Tumba', 'Lilla Ängsvägen')]);
  assert.ok(a.match({ address: 'LILLA ÄNGS VÄGEN 4 Tumba' }));
  assert.equal(a.match({ address: 'Stora Ängsvägen 4 Tumba' }), null);
  assert.equal(a.match({ address: 'Ängsvägen 4 Tumba' }), null);
});

test('Public address download strips every non-address field and uses a fixed read query', async () => {
  const calls = [];
  const data = Array.from({ length: 1001 }, (_, i) => ({ beladress: `Provvägen ${i + 1}`, adressplats: String(i + 1), postnr: '147 30', postort: 'Tumba', xkoord: 6564000, ykoord: 139000, fnr: 'must-not-be-exposed', arbitrary: 'not-public-output' }));
  const result = await api.download(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return { ok: true, text: async () => `sessionStorage.setItem("spatialmapSessionId", 'anonymous-public-session');` };
    return { ok: true, json: async () => data };
  });
  assert.equal(calls.length, 2);
  const query = new URL(calls[1].url).searchParams;
  assert.equal(query.get('datasource'), 'ds_fb_adressnummer_sok');
  assert.equal(query.get('expression'), 'select beladress,adressplats,postnr,postort,xkoord,ykoord from ds_fb_adressnummer_sok command read');
  assert.equal(calls[1].options.headers['Session-Id'], 'anonymous-public-session');
  assert.deepEqual(result.rows[0], ['Provvägen', '1', '14730', 'Tumba', 6564000, 139000]);
  assert.ok(!JSON.stringify(result).includes('must-not-be-exposed'));
});

test('The public endpoint rejects caller-supplied search inputs and non-read methods', async () => {
  const response = () => ({ code: 0, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } });
  const query = response();
  await api({ method: 'GET', url: '/api/addresses?q=private-meter' }, query);
  assert.equal(query.code, 400);
  const post = response();
  await api({ method: 'POST', url: '/api/addresses' }, post);
  assert.equal(post.code, 405);
});
