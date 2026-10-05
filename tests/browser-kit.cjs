// Shared browser test setup: static server, offline CDN copies when present,
// deterministic geocoding and no map tile traffic.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function startServer(port = 4173) {
  const server = http.createServer((req, res) => {
    const clean = req.url.split('?')[0];
    const file = path.resolve(root, '.' + (clean === '/' ? '/index.html' : decodeURIComponent(clean)));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' }); res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// LEAKSOK_VENDOR may point at local copies of the CDN files (offline runs).
async function routeExternal(page) {
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
  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    const url = new URL(route.request().url());
    const street = url.searchParams.get('street') || url.searchParams.get('q') || '';
    const match = street.match(/^(.*?)\s+(\d+\S*)$/);
    if (!match) return route.fulfill({ json: [] });
    let hash = 0;
    for (const char of street) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return route.fulfill({ json: [{
      lat: String(59.15 + (hash % 1000) / 10000), lon: String(17.75 + ((hash >> 10) % 1000) / 10000),
      display_name: street, address: { house_number: match[2], road: match[1], postcode: url.searchParams.get('postalcode') || '' },
    }] });
  });
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

module.exports = { root, startServer, routeExternal, unlock, importFiles, selectionAction };

