/* Map view (Leaflet + OpenStreetMap). Pins represent addresses, not meter GPS.
   Street/range fallbacks are labelled approximate and excluded from distance analysis. */
(function (root) {
  const GEOCODE_CACHE_KEY = "leaksok_geocode_v2_exact";
  const MAP_MARKS_KEY = "leaksok_map_marks_v1";
  const BOUNDS = [[59.065, 17.54], [59.29, 18.035]];
  const CENTER = [59.18, 17.8];
  const LOOKUP_VERSION = 5;
  const COLORS = {
    dispatch: "#c62828", confirmed: "#8e1b1b", suspect_auto: "#e08a00", watch: "#2f6fd6", customer_side: "#0e8fa3",
    stable_high: "#7b4bc4", noise: "#6b7785", seasonal: "#6b7785", repaired: "#2e7d4f", learning: "#90a0b0",
    stale_contact: "#90a0b0", normal: "#4f8fb8", ignored: "#9aa5b1",
  };

  function readJson(key) {
    try { const v = JSON.parse(localStorage.getItem(key) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
  }
  function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* map still works */ } }
  const cache = readJson(GEOCODE_CACHE_KEY);
  const marks = readJson(MAP_MARKS_KEY);
  const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function addressForMap(meter) {
    const raw = String(meter.address || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    const postal = raw.match(/^(.*?\d+(?:[-/]\d+)?[A-Za-z]?)\s+(.+?)\s+(\d{5})$/i);
    if (postal) return `${postal[1]}, ${postal[3]} ${postal[2]}, Sverige`;
    const area = String(meter.area || "").trim();
    return `${raw}${area && !norm(raw).includes(norm(area)) ? `, ${area}` : ""}, Sverige`;
  }
  function parseAddress(meter) {
    const raw = String(meter.address || "").replace(/[–—]/g, "-").replace(/(\d)\s*([-\/])\s*(?=\d)/g, "$1$2").replace(/(\d)\s+([A-Za-z])(?=\s|$)/g, "$1$2").replace(/([A-Za-zÅÄÖåäö])(?=\d)/g, "$1 ").replace(/(\d{3})\s+(\d{2})(?=\s|$)/g, "$1$2").replace(/,+/g, " ").replace(/\s+/g, " ").trim();
    const atEnd = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)\s+(.+?)\s+(\d{5})$/i);
    const before = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)\s+(\d{5})\s+(.+)$/i);
    if (atEnd) return { street: `${atEnd[1]} ${atEnd[2]}`, road: atEnd[1], house: atEnd[2], city: atEnd[3], postcode: atEnd[4] };
    if (before) return { street: `${before[1]} ${before[2]}`, road: before[1], house: before[2], city: before[4], postcode: before[3] };
    const onlyPostcode = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)\s+(\d{5})$/i);
    if (onlyPostcode) return { street: `${onlyPostcode[1]} ${onlyPostcode[2]}`, road: onlyPostcode[1], house: onlyPostcode[2], city: meter.area || "Botkyrka", postcode: onlyPostcode[3] };
    const noPostcode = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)(?:\s+(.+?))?$/i);
    if (noPostcode) return { street: `${noPostcode[1]} ${noPostcode[2]}`, road: noPostcode[1], house: noPostcode[2], city: noPostcode[3] || meter.area || "Botkyrka", postcode: "" };
    return null;
  }
  const roadKey = (v) => norm(v).replace(/['’´`]/g, "").replace(/\s*[-]\s*/g, "-");
  function sameRoad(hit, parsed) {
    const a = hit?.address || {};
    return Boolean(parsed && roadKey(a.road || a.pedestrian || a.residential || a.footway || (hit?.addresstype === "road" ? hit.name : "")) === roadKey(parsed.road));
  }
  function exactHit(hit, parsed) {
    const a = hit?.address || {};
    if (!parsed || norm(a.house_number).replace(/\s/g, "") !== norm(parsed.house).replace(/\s/g, "")) return false;
    if (!sameRoad(hit, parsed)) return false;
    const postcode = String(a.postcode || "").replace(/\s/g, "");
    return !parsed.postcode || !postcode || postcode === parsed.postcode;
  }
  const inside = (p) => p && p.lat >= BOUNDS[0][0] && p.lat <= BOUNDS[1][0] && p.lng >= BOUNDS[0][1] && p.lng <= BOUNDS[1][1];
  const keyOf = (meter) => norm(addressForMap(meter));

  function cachedPosition(meter) {
    const hit = cache[keyOf(meter)];
    return inside(hit) ? { lat: hit.lat, lng: hit.lng, ...(hit.approximate ? { approximate: true } : {}) } : null;
  }

  const jobs = [];
  let searching = false;
  let lastRequest = 0;
  const inflight = new Map();
  async function search(url) {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequest));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, ...(controller ? { signal: controller.signal } : {}) });
      if (!response.ok) throw new Error(`Adressökning misslyckades (${response.status})`);
      const hits = await response.json();
      return Array.isArray(hits) ? hits : [];
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Adressökningen tog för lång tid. Klicka på adressen igen för att försöka på nytt.");
      throw error;
    } finally { if (timer != null) clearTimeout(timer); }
  }
  async function runSearches() {
    if (searching) return;
    searching = true;
    try {
      while (jobs.length) {
        jobs.sort((a, b) => Number(b.priority) - Number(a.priority));
        const job = jobs.shift();
        try { job.resolve(await job.run()); } catch (error) { job.reject(error); }
        finally { inflight.delete(job.key); }
      }
    } finally { searching = false; }
  }
  function geocode(meter, retryMissing = false) {
    const key = keyOf(meter);
    if (!key) return Promise.resolve(null);
    const known = cachedPosition(meter);
    if (known) return Promise.resolve(known);
    if (!retryMissing && cache[key]?.missing && cache[key].lookupVersion === LOOKUP_VERSION && Date.now() - Number(cache[key].at || 0) < 7 * 86400000) return Promise.resolve(null);
    if (inflight.has(key)) {
      const queued = jobs.find((job) => job.key === key);
      if (queued && retryMissing) queued.priority = true;
      return inflight.get(key);
    }
    const lookup = async () => {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      const parsed = parseAddress(meter);
      if (!parsed) return null;
      Object.entries({ format: "jsonv2", limit: "5", addressdetails: "1", countrycodes: "se", "accept-language": "sv", bounded: "1", viewbox: `${BOUNDS[0][1]},${BOUNDS[1][0]},${BOUNDS[1][1]},${BOUNDS[0][0]}` }).forEach(([k, v]) => url.searchParams.set(k, v));
      if (parsed) { url.searchParams.set("street", parsed.street); url.searchParams.set("city", parsed.city); if (parsed.postcode) url.searchParams.set("postalcode", parsed.postcode); url.searchParams.set("country", "Sverige"); }
      else url.searchParams.set("q", addressForMap(meter));
      const results = await search(url);
      const validHit = (c) => inside({ lat: Number(c.lat), lng: Number(c.lon) });
      let hit = results.find((c) => validHit(c) && exactHit(c, parsed));
      let approximate = false;
      // Postal towns such as Tullinge/Norsborg are not always indexed as cities.
      // Retry within the same bounds and still require the exact road/house.
      if (!hit && parsed) {
        ["street", "city", "postalcode", "country"].forEach((key) => url.searchParams.delete(key));
        url.searchParams.set("q", `${parsed.street}, Botkyrka, Sverige`);
        const candidates = await search(url);
        hit = candidates.find((c) => validHit(c) && exactHit(c, parsed));
        // "58-60" or "6A" can be mapped to the same building at 58 or 6.
        const firstHouse = parsed.house.match(/^\d+/)?.[0];
        if (!hit && firstHouse && parsed.house !== firstHouse) {
          url.searchParams.set("q", `${parsed.road} ${firstHouse}, Botkyrka, Sverige`);
          const buildings = await search(url);
          hit = buildings.find((c) => validHit(c) && exactHit(c, { ...parsed, house: firstHouse, postcode: "" }));
          approximate = Boolean(hit);
        }
        // Address navigation may use the correct street when OSM lacks a house.
        // Never substitute a different numbered house or a different street.
        if (!hit) {
          url.searchParams.set("q", `${parsed.road}, Botkyrka, Sverige`);
          const streets = await search(url);
          hit = streets.find((c) => validHit(c) && sameRoad(c, parsed) && !c.address?.house_number);
          approximate = Boolean(hit);
        }
      }
      const pos = hit ? { lat: Number(hit.lat), lng: Number(hit.lon), ...(approximate ? { approximate: true } : {}) } : null;
      if (!inside(pos)) { cache[key] = { missing: true, lookupVersion: LOOKUP_VERSION, at: Date.now() }; persistCache(); return null; }
      cache[key] = { ...pos, lookupVersion: LOOKUP_VERSION, at: Date.now() };
      persistCache();
      return pos;
    };
    const task = new Promise((resolve, reject) => jobs.push({ key, priority: retryMissing, run: lookup, resolve, reject }));
    inflight.set(key, task);
    runSearches();
    return task;
  }
  function persistCache() {
    const entries = Object.entries(cache);
    if (entries.length > 4000) entries.sort((a, b) => (a[1].at || 0) - (b[1].at || 0)).slice(0, entries.length - 4000).forEach(([k]) => delete cache[k]);
    writeJson(GEOCODE_CACHE_KEY, cache);
  }

  function distance(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  /* options: { element, statusElement, onFocus(id), onMarkMany(ids), label(meter) } */
  function create(options) {
    const el = options.element;
    const status = (text) => { if (options.statusElement) options.statusElement.textContent = text || ""; };
    if (!root.L) { status("Kartan kunde inte laddas. Kör hit fungerar ändå."); return null; }
    const L = root.L;
    const touch = root.matchMedia?.("(pointer: coarse)").matches;
    const map = L.map(el, { zoomControl: true, scrollWheelZoom: false, dragging: !touch, tap: false, minZoom: 10, maxBounds: BOUNDS, maxBoundsViscosity: 1, preferCanvas: true }).setView(CENTER, 12);
    const layers = {
      street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }),
      satellite: L.layerGroup([
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" }),
        L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }),
      ]),
    };
    let base = layers.street.addTo(map);
    const markerLayer = L.layerGroup().addTo(map);
    const markLayer = L.layerGroup().addTo(map);
    let version = 0, tool = "", rectStart = null, rect = null, entries = [], current = { meters: [], focusId: "", marked: new Set() };
    let userMarker = null;
    let lastFlight = "";
    let lastResults = "";

    // Touch: the page scrolls past the map until the user taps it.
    if (touch) {
      const gate = document.createElement("button");
      gate.type = "button";
      gate.className = "map-gate";
      gate.textContent = "Tryck för att flytta kartan";
      el.appendChild(gate);
      gate.addEventListener("click", () => { map.dragging.enable(); gate.hidden = true; });
      document.addEventListener("pointerdown", (e) => { if (!el.contains(e.target)) { map.dragging.disable(); gate.hidden = false; } });
    }
    function resizeMap() {
      if (!el.clientWidth || !el.clientHeight) return;
      map.invalidateSize({ pan: false });
      // Changing between list and selected-meter layouts changes the map size.
      // Leaflet's old pixel origin can otherwise leave edge markers off-screen.
      if (current.focusId) {
        const focused = entries.find((entry) => entry.id === current.focusId);
        if (focused) map.setView([focused.lat, focused.lng], 17, { animate: false });
      } else if (entries.length) fitResults();
    }
    if (typeof ResizeObserver === "function") new ResizeObserver(resizeMap).observe(el);

    map.on("click", (e) => {
      if (tool === "valve" || tool === "leak") {
        const id = current.focusId;
        if (!id) { status("Välj först en mätare."); return; }
        const mark = marks[id] || {};
        mark[tool] = { lat: e.latlng.lat, lng: e.latlng.lng };
        refreshMark(id, mark);
        setTool("");
      }
    });
    map.on("mousedown", (e) => {
      if (tool !== "select" || e.originalEvent?.button !== 0) return;
      rectStart = e.latlng;
      rect?.remove();
      rect = L.rectangle([rectStart, rectStart], { color: "#0f5e6e", weight: 2, dashArray: "6 5", fillOpacity: 0.1, interactive: false }).addTo(map);
    });
    map.on("mousemove", (e) => { if (rectStart && rect) rect.setBounds(L.latLngBounds(rectStart, e.latlng)); });
    map.on("mouseup", (e) => {
      if (!rectStart || !rect) return;
      const b = L.latLngBounds(rectStart, e.latlng);
      rectStart = null;
      rect.remove(); rect = null;
      const ids = entries.filter((x) => b.contains([x.lat, x.lng])).map((x) => x.id);
      setTool("");
      if (ids.length) options.onMarkMany?.(ids);
      status(ids.length ? `${ids.length} mätare markerade i rutan.` : "Ingen mätare med känd position i rutan.");
    });

    function setTool(next) {
      tool = next;
      el.dataset.tool = tool;
      if (tool === "select") map.dragging.disable(); else if (!touch) map.dragging.enable();
      el.parentElement?.querySelectorAll("[data-map-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mapTool === tool)));
      if (tool === "select") status("Dra en ruta runt mätarna som ska markeras. Esc avbryter.");
      if (tool === "valve") status("Klicka där ventilen ligger.");
      if (tool === "leak") status("Klicka där läckan hittades. Avståndet räknas från husnumrets kartpunkt.");
    }

    function refreshMark(id, mark) {
      const meter = current.meters.find((m) => m.id === id);
      const pos = meter ? cachedPosition(meter) : null;
      mark.distanceFromMeter = mark.leak && pos && !pos.approximate ? Math.round(distance(pos, mark.leak)) : null;
      mark.distanceValveToLeak = mark.leak && mark.valve ? Math.round(distance(mark.valve, mark.leak)) : null;
      mark.updatedAt = new Date().toISOString();
      marks[id] = mark;
      writeJson(MAP_MARKS_KEY, marks);
      drawMarks();
      status(mark.distanceFromMeter != null ? `Läckpunkt ca ${mark.distanceFromMeter} m fågelväg från husnumrets kartpunkt.` : "Punkten sparad.");
    }

    function drawMarks() {
      markLayer.clearLayers();
      const id = current.focusId;
      const mark = marks[id];
      if (!mark) return;
      const meter = current.meters.find((m) => m.id === id);
      const pos = meter ? cachedPosition(meter) : null;
      for (const kind of ["valve", "leak"]) {
        if (!mark[kind]) continue;
        const icon = L.divIcon({ className: `map-mark ${kind}`, html: `<span>${kind === "leak" ? "×" : "V"}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
        const marker = L.marker(mark[kind], { icon, draggable: true, title: kind === "leak" ? "Läckpunkt" : "Ventil" }).addTo(markLayer);
        marker.on("dragend", () => { mark[kind] = marker.getLatLng(); refreshMark(id, mark); });
      }
      if (pos && !pos.approximate && mark.leak) L.polyline([[pos.lat, pos.lng], mark.leak], { color: "#b3261e", weight: 3, dashArray: "8 6", interactive: false }).addTo(markLayer);
    }

    async function update({ meters, focusId = "", marked = new Set(), mode = "overview", focusRequest = 0, resultIds = meters.map((m) => m.id) }) {
      const run = ++version;
      current = { meters, focusId, marked, focusRequest, resultIds: new Set(resultIds) };
      const rank = (m) => m.id === focusId ? 2 : marked.has(m.id) ? 1 : 0;
      const wanted = [...meters].sort((a, b) => rank(b) - rank(a));
      const located = [];
      const queue = [];
      for (const m of wanted) {
        const pos = cachedPosition(m);
        if (pos) located.push({ m, pos }); else queue.push(m);
      }
      const limit = queue.length;
      const failures = [];
      draw(located, mode);
      if (queue.length) status(focusId && queue.some((m) => m.id === focusId) ? `Söker adress för ${wanted.find((m) => m.id === focusId).address}…` : `Söker ${queue.length} adresser utan känd position…`);
      for (const m of queue.slice(0, limit)) {
        if (run !== version) return;
        try {
          const pos = await geocode(m, m.id === focusId);
          if (run !== version) return;
          if (pos) {
            located.push({ m, pos });
            draw(located, mode);
            const selected = located.find(({ m }) => m.id === focusId);
            status(`${selected?.pos.approximate ? "Vald mätare: ungefärlig adressposition. " : ""}${located.length} av ${wanted.length} på kartan · söker återstående adresser…`);
          }
        } catch (error) {
          failures.push(m.id);
          status(error.message);
          // One failed lookup must not prevent the rest of the list loading.
        }
      }
      if (run !== version) return;
      draw(located, mode, true);
      const missing = wanted.length - located.length;
      const pending = Math.max(0, queue.length - limit);
      const selected = wanted.find((m) => m.id === focusId);
      const noSelectedPosition = selected && !located.some(({ m }) => m.id === focusId);
      const selectedApproximate = located.find(({ m }) => m.id === focusId)?.pos.approximate;
      status(`${noSelectedPosition ? `Vald mätare: adressen ${selected.address} kunde inte hittas. ` : selectedApproximate ? "Vald mätare: ungefärlig adressposition. " : ""}${located.length} av ${wanted.length} på kartan${pending ? ` · ${pending} adresser återstår att söka` : ""}${missing - pending - failures.length ? ` · ${missing - pending - failures.length} adresser kunde inte hittas` : ""}${failures.length ? ` · ${failures.length} adressökningar misslyckades, klicka på adressen för att försöka på nytt` : ""}`);
    }

    function draw(located, mode, final) {
      markerLayer.clearLayers();
      entries = located.map(({ m, pos }) => ({ id: m.id, ...pos }));
      const rank = (m) => m.id === current.focusId ? 2 : current.marked.has(m.id) ? 1 : 0;
      // Draw the selected meter last so its marker stays on top.
      located.sort((a, b) => rank(a.m) - rank(b.m));
      for (const { m, pos } of located) {
        const isFocus = m.id === current.focusId;
        const isMarked = current.marked.has(m.id);
        const marker = L.circleMarker([pos.lat, pos.lng], {
          radius: isFocus ? 11 : isMarked ? 9 : mode === "overview" ? 5.5 : 7,
          color: isFocus || isMarked ? "#111827" : "#ffffff",
          weight: isFocus ? 4 : isMarked ? 3 : 1.5,
          fillColor: COLORS[m.category] || COLORS.normal,
          fillOpacity: 0.95,
        });
        const address = esc(options.label ? options.label(m) : m.address);
        const max = m.series?.length ? Math.max(...m.series.map((p) => p.value)) : null;
        marker.bindTooltip(`<div class="map-meter-tip"><b>${address}</b><span>${esc(m.status || "")}${pos.approximate ? " · Ungefärlig adressposition" : " · Adressposition"}</span><dl><dt>Senaste nivå</dt><dd>${esc(m.latest?.value ?? "–")}</dd><dt>Max i historiken</dt><dd>${esc(max ?? "–")}</dd></dl></div>`, { permanent: isFocus, direction: "top", offset: [0, -8], className: "map-label" });
        marker.on("click", () => options.onFocus?.(m.id));
        marker.addTo(markerLayer);
      }
      drawMarks();
      const focused = located.find(({ m }) => m.id === current.focusId);
      if (current.focusId) {
        // A selection always wins over the bounds of other marked meters.
        // Address pins are sufficient, including labelled street fallbacks.
        if (focused) {
          const flight = `${current.focusId}|${current.focusRequest}|${focused.pos.lat}|${focused.pos.lng}`;
          if (flight !== lastFlight) {
            lastFlight = flight;
            map.stop();
            map.flyTo([focused.pos.lat, focused.pos.lng], 17, {
              duration: 0.7, animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            });
          }
        }
      } else if (mode === "results") {
        const resultKey = located.filter(({ m }) => current.resultIds.has(m.id)).map(({ m }) => m.id).join(",");
        if (resultKey !== lastResults || final) { fitResults(); lastResults = resultKey; }
      } else if (final || located.length) {
        lastFlight = "";
        const pts = located.map(({ pos }) => [pos.lat, pos.lng]);
        if (pts.length === 1) map.setView(pts[0], 17);
        else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 14 });
      }
    }

    function fitResults() {
      const pts = entries.filter((e) => current.resultIds.has(e.id)).map((e) => [e.lat, e.lng]);
      map.stop();
      if (pts.length === 1) map.setView(pts[0], 17, { animate: false });
      else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 17, animate: false });
      else map.setView(CENTER, 12, { animate: false });
    }

    function setStyle(style) {
      if (!layers[style]) return;
      map.removeLayer(base);
      base = layers[style].addTo(map);
      el.parentElement?.querySelectorAll("[data-map-style]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mapStyle === style)));
    }

    function locate() {
      if (!navigator.geolocation) { status("GPS saknas i webbläsaren."); return; }
      status("Hämtar din position…");
      navigator.geolocation.getCurrentPosition((p) => {
        const ll = [p.coords.latitude, p.coords.longitude];
        userMarker?.remove();
        userMarker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#1d4ed8", fillOpacity: 1 }).bindTooltip("Min position", { permanent: true, direction: "top" }).addTo(map);
        map.setView(ll, 16);
        status(`Min position · noggrannhet ca ${Math.round(p.coords.accuracy)} m`);
      }, () => status("Kunde inte läsa GPS. Tillåt platsåtkomst."), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    }

    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tool) { rect?.remove(); rect = null; rectStart = null; setTool(""); status("Verktyget avbröts."); } });
    return { update, setTool, setStyle, locate, fitResults, invalidate: resizeMap, map };
  }

  function navigationUrl(meter) {
    const pos = cachedPosition(meter);
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pos ? `${pos.lat},${pos.lng}` : addressForMap(meter))}`;
  }

  function coordinates(meters) {
    const out = new Map();
    for (const m of meters) { const pos = cachedPosition(m); if (pos && !pos.approximate) out.set(m.id, pos); }
    return out;
  }

  async function resolvePositions(meters) {
    for (const m of meters.slice(0, 12)) await geocode(m);
    return coordinates(meters);
  }

  root.LeakMap = { resolvePositions, create, navigationUrl, coordinates, markFor: (id) => marks[id] || null, addressForMap, parseAddress, exactHit, cachedPosition };
}(typeof globalThis !== "undefined" ? globalThis : this));

