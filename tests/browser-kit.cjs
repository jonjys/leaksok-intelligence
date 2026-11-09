// Shared browser test setup: static server, offline CDN copies when present,
// deterministic geocoding and no map tile traffic.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { buildDailyExports } = require('./fixtures/synthetic-exports');
const { parseAddress } = require('../src/address-index');
const fixtureAddresses = buildDailyExports({ meters: 3000, days: 1 }).at(-1).rows.slice(1).map(row => {
  const p = parseAddress({ address: row[1] });
  if (!p) return null;
  let hash = 0;
  for (const char of p.street) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return [p.road, p.house, p.postcode, p.city, 6561000 + hash % 10000, 136000 + (hash >> 10) % 10000];
}).filter(Boolean);
fixtureAddresses.push(...[1, 3, 5].map(n => ['OMRÅDESTESTVÄGEN', String(n), '14730', 'Tumba', 6565000 + n * 11, 138572]));

const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function startServer(port = 4173, handlers = {}) {
  const server = http.createServer(async (req, res) => {
    const clean = req.url.split('?')[0];
    if (handlers[clean]) {
      try {
        if (req.method === 'POST') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          req.body = JSON.parse(Buffer.concat(chunks).toString());
        }
        res.status = status => { res.statusCode = status; return res; };
        res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
        return await handlers[clean](req, res);
      } catch { if (!res.headersSent) res.writeHead(500); return res.end(); }
    }
    const file = path.resolve(root, '.' + (clean === '/' ? '/index.html' : decodeURIComponent(clean)));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' }); res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// LEAKSOK_VENDOR may point at local copies of the CDN files (offline runs).
async function routeExternal(page) {
  await page.route('**/api/addresses', route => route.fulfill({ json: { version: 1, crs: 'EPSG:3011', rows: fixtureAddresses } }));
  const vendor = process.env.LEAKSOK_VENDOR;
  const local = {
    'xlsx.full.min.js': 'text/javascript', 'chart.umd.min.js': 'text/javascript',
    'leaflet.js': 'text/javascript', 'leaflet.css': 'text/css',
  };
  if (vendor) {
    await page.route(/cdn\.(sheetjs\.com|jsdelivr\.net)\//, (route) => {
      const name = Object.keys(local).find((file) => route.request().url().endsWith('/' + file));
      if (!name) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: local[name], body: fs.readFileSync(path.join(vendor, name)) });
    });
  }
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('https://nominatim.openstreetmap.org/**', route => { throw Error('Unexpected external address lookup'); });
}

async function unlock(page, name = 'Test', code = '1234') {
  if (name && await page.locator('#profileName').isEditable()) await page.locator('#profileName').fill(name);
  await page.locator('#profileCode').fill(code);
  await page.locator('#profileForm button[type="submit"], #profileForm button').first().click();
  await page.waitForFunction(() => !document.getElementById('profileDialog').open);
}

async function importFiles(page, files) {
  await page.locator('#fileInput').setInputFiles(files.map((file) => ({
    name: file.name, mimeType: file.mimeType || 'text/csv', buffer: Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.text),
  })));
  await page.waitForFunction(() => typeof state !== 'undefined' && !state.importing, null, { timeout: 120000 });
}

async function selectionAction(page, action) {
  const button = page.locator(`#selectionBar [data-sel="${action}"]`);
  if (!await button.isVisible()) await page.locator("#selectionBar .selection-menu summary").click();
  await button.click();
}

async function chooseSort(page, key) {
  await page.locator('#sortMenu > summary').click();
  await page.locator(`#sortOptions [data-sort-option="${key}"]`).click();
}

module.exports = { root, startServer, routeExternal, unlock, importFiles, selectionAction, chooseSort };

