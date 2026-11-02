/* Match imported names against a public address table locally. No meter data
   is included in the single same-origin request for the complete table. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakAddressIndex = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const norm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’´`]/g, "").replace(/\s+/g, " ").trim();
  const houseKey = v => norm(v).replace(/\s/g, "");
  const roadKey = v => norm(v).replace(/\s/g, "");
  function parseAddress(meter = {}) {
    const raw = String(meter.address || "").replace(/,+/g, " ").replace(/\([^)]*\)/g, " ").replace(/[–—]/g, "-").replace(/(\d)\s*([-\/])\s*(?=[\dA-Za-z])/g, "$1$2").replace(/(\d)\s+([A-Za-z])(?=\s|[-/]|$)/g, "$1$2").replace(/([A-Za-zÅÄÖåäö])(?=\d)/g, "$1 ").replace(/(\d{3})\s+(\d{2})(?=\s|$)/g, "$1$2").replace(/\s+/g, " ").trim();
    const atEnd = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/](?:\d+[A-Za-z]?|[A-Za-z]))?)\s+(.+?)\s+(\d{5})$/i);
    const before = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/](?:\d+[A-Za-z]?|[A-Za-z]))?)\s+(\d{5})\s+(.+)$/i);
    if (atEnd) return { street: `${atEnd[1]} ${atEnd[2]}`, road: atEnd[1], house: atEnd[2], city: atEnd[3], postcode: atEnd[4] };
    if (before) return { street: `${before[1]} ${before[2]}`, road: before[1], house: before[2], city: before[4], postcode: before[3] };
    const onlyPostcode = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/](?:\d+[A-Za-z]?|[A-Za-z]))?)\s+(\d{5})$/i);
    if (onlyPostcode) return { street: `${onlyPostcode[1]} ${onlyPostcode[2]}`, road: onlyPostcode[1], house: onlyPostcode[2], city: meter.area || "Botkyrka", postcode: onlyPostcode[3] };
    const noPostcode = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/](?:\d+[A-Za-z]?|[A-Za-z]))?)(?:\s+(.+?))?$/i);
    if (noPostcode) return { street: `${noPostcode[1]} ${noPostcode[2]}`, road: noPostcode[1], house: noPostcode[2], city: noPostcode[3] || meter.area || "Botkyrka", postcode: "" };
    return null;
  }

  // Inverse transverse Mercator, GRS80, SWEREF 99 18 00 (EPSG:3011).
  // The municipal columns are northing xkoord / easting ykoord.
  // Krüger series to n^4; inverse conformal latitude solved iteratively.
  function toWgs84(north, east) {
    if (!Number.isFinite(north) || !Number.isFinite(east) || north < 6500000 || north > 6600000 || east < 100000 || east > 200000) return null;
    const f = 1 / 298.257222101, n = f / (2 - f), e = Math.sqrt(f * (2 - f));
    const a = 6378137 / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64);
    const beta = [n / 2 - 2 * n ** 2 / 3 + 37 * n ** 3 / 96 - n ** 4 / 360,
      n ** 2 / 48 + n ** 3 / 15 - 437 * n ** 4 / 1440,
      17 * n ** 3 / 480 - 37 * n ** 4 / 840, 4397 * n ** 4 / 161280];
    const xi = north / a, eta = (east - 150000) / a;
    let x = xi, y = eta;
    beta.forEach((b, i) => { const j = 2 * (i + 1); x -= b * Math.sin(j * xi) * Math.cosh(j * eta); y -= b * Math.cos(j * xi) * Math.sinh(j * eta); });
    const chi = Math.asin(Math.sin(x) / Math.cosh(y)), q = Math.asinh(Math.tan(chi));
    let phi = chi;
    for (let i = 0; i < 8; i++) phi = Math.atan(Math.sinh(q + e * Math.atanh(e * Math.sin(phi))));
    return { lat: phi * 180 / Math.PI, lng: 18 + Math.atan2(Math.sinh(y), Math.cos(x)) * 180 / Math.PI };
  }

  function build(payload) {
    if (payload?.version !== 1 || payload.crs !== "EPSG:3011" || !Array.isArray(payload.rows)) throw Error("Adressregistret har fel format.");
    const streets = new Map(), houses = new Map();
    for (const row of payload.rows) {
      if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") continue;
      const pos = toWgs84(row[4], row[5]);
      if (!pos) continue;
      const road = roadKey(row[0]);
      if (!streets.has(road)) streets.set(road, []);
      const entry = { road: row[0], house: row[1], postcode: String(row[2] || "").replace(/\s/g, ""), city: row[3], ...pos };
      streets.get(road).push(entry);
      const house = `${road}|${houseKey(row[1])}`;
      if (!houses.has(house)) houses.set(house, []);
      houses.get(house).push(entry);
    }
    function match(meter) {
      const parsed = parseAddress(meter);
      if (!parsed) return null;
      const road = roadKey(parsed.road);
      let exact = houses.get(`${road}|${houseKey(parsed.house)}`) || [];
      let interval = false;
      // For an explicit interval, use its first registered endpoint. It is an
      // actual address in that interval, labelled below; never its midpoint.
      if (!exact.length) {
        const range = parsed.house.match(/^(\d+)([A-Za-z]?)[-/](\d+)?([A-Za-z]?)$/);
        if (range) {
          const endpoints = [`${range[1]}${range[2]}`, `${range[3] || range[1]}${range[4]}`];
          for (const endpoint of endpoints) {
            exact = houses.get(`${road}|${houseKey(endpoint)}`) || [];
            if (exact.length) { interval = true; break; }
          }
        }
      }
      // Towns in exports may be neighbourhoods rather than postal towns.
      // Use the town to disambiguate, but never loosen street/house matching.
      let candidates = exact;
      if (parsed.postcode) {
        const postal = candidates.filter(r => r.postcode === parsed.postcode);
        if (postal.length) candidates = postal;
      }
      const town = candidates.filter(r => norm(r.city) === norm(parsed.city));
      if (town.length) candidates = town;
      if (!candidates.length) return null;
      const first = candidates[0];
      if (candidates.some(r => Math.abs(r.lat - first.lat) > .0001 || Math.abs(r.lng - first.lng) > .0002)) return null;
      return { lat: first.lat, lng: first.lng, source: "municipal", address: `${first.road} ${first.house}`, postcode: first.postcode, city: first.city,
        interval, postcodeChanged: !!parsed.postcode && parsed.postcode !== first.postcode };
    }
    const labels = [...streets.values()].flat().map(r => `${r.road} ${r.house}, ${r.postcode} ${r.city}`);
    const suggest = query => {
      const key = roadKey(query).replace(/,/g, "");
      return key.length < 3 ? [] : labels.filter(label => roadKey(label).replace(/,/g, "").includes(key)).slice(0, 20);
    };
    return { match, suggest, size: labels.length, fetchedAt: payload.fetchedAt, stale: !!payload.stale };
  }
  let current, loading;
  function load() {
    if (current) return Promise.resolve(current);
    if (!loading) loading = (async () => {
      const response = await fetch("/api/addresses", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(55000) });
      if (!response.ok) throw Error("Adressregistret kunde inte hämtas. Klicka på en adress för att försöka igen.");
      current = build(await response.json());
      return current;
    })().finally(() => { loading = null; });
    return loading;
  }
  return { build, load, parseAddress, toWgs84, position: meter => current?.match(meter) || null,
    suggestions: query => current?.suggest(query) || [], ready: () => !!current };
}));
