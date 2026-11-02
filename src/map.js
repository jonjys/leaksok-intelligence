/* Map view (Leaflet + OpenStreetMap). Pins represent addresses, not meter GPS.
   Only matching street names and complete house numbers are accepted. */
(function (root) {
  const GEOCODE_CACHE_KEY = "leaksok_geocode_v2_exact";
  const MAP_MARKS_KEY = "leaksok_map_marks_v1";
  const BOUNDS = [[59.065, 17.54], [59.29, 18.035]];
  const CENTER = [59.18, 17.8];
  const LOOKUP_VERSION = 6;
  const View = root.LeakMeterView;


  function readJson(key) {
    try { const v = JSON.parse(localStorage.getItem(key) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
  }
  function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* map still works */ } }
  const cache = readJson(GEOCODE_CACHE_KEY);
  const marks = readJson(MAP_MARKS_KEY);
  const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function addressForMap(meter = {}) {
    const raw = String(meter.address || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    const postal = raw.match(/^(.*?\d+(?:[-/]\d+)?[A-Za-z]?)\s+(.+?)\s+(\d{5})$/i);
    if (postal) return `${postal[1]}, ${postal[3]} ${postal[2]}, Sverige`;
    const area = String(meter.area || "").trim();
    return `${raw}${area && !norm(raw).includes(norm(area)) ? `, ${area}` : ""}, Sverige`;
  }
  function parseAddress(meter = {}) {
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
    if (!meter?.address) return null;
    const hit = cache[keyOf(meter)];
    return inside(hit) && !hit.approximate ? { lat: hit.lat, lng: hit.lng } : null;
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
      // Postal towns such as Tullinge/Norsborg are not always indexed as cities.
      // Retry within the same bounds and still require the exact road/house.
      if (!hit && parsed) {
        ["street", "city", "postalcode", "country"].forEach((key) => url.searchParams.delete(key));
        url.searchParams.set("q", `${parsed.street}, Botkyrka, Sverige`);
        const candidates = await search(url);
        hit = candidates.find((c) => validHit(c) && exactHit(c, parsed));

      }
      const pos = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
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
    const map = L.map(el, { zoomControl: true, scrollWheelZoom: false, dragging: !touch, tap: false, minZoom: 8, preferCanvas: false }).setView(CENTER, 12);
    const layers = {
      street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }),
      satellite: L.layerGroup([
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" }),
        L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }),
      ]),
    };
    let base = layers.street.addTo(map);
    const markerLayer = L.layerGroup().addTo(map);
    const markerById = new Map();
    const markLayer = L.layerGroup().addTo(map);
    let version = 0, tool = "", rectStart = null, rect = null, entries = [], current = { meters: [], focusId: "", marked: new Set() };
    let userMarker = null;
    let lastFlight = "";
    let lastResults = "";

    function focusZoom(focused) {
      const selected = entries.filter((entry) => current.marked.has(entry.id));
      if (!selected.length || typeof map.getBoundsZoom !== "function") return 17;
      // Keep the camera centred on the clicked address, but zoom out enough
      // for the other marked addresses to remain visible around it.
      const lat = Math.max(...selected.map((p) => Math.abs(p.lat - focused.lat))) * 1.12;
      const lng = Math.max(...selected.map((p) => Math.abs(p.lng - focused.lng))) * 1.12;
      const bounds = L.latLngBounds([[focused.lat - lat, focused.lng - lng], [focused.lat + lat, focused.lng + lng]]);
      return Math.max(8, Math.min(17, map.getBoundsZoom(bounds, false, [72, 72])));
    }

    function placeFocusLabel() {
      const marker = markerById.get(current.focusId)?.marker;
      const tip = marker?.getTooltip?.();
      if (!tip || !map.latLngToContainerPoint) return;
      const point = map.latLngToContainerPoint(marker.getLatLng());
      const height = tip.getElement()?.offsetHeight || 140;
      const direction = point.y < height + 16 ? "bottom" : "top";
      if (tip.options.direction !== direction) {
        tip.options.direction = direction;
        tip.options.offset = [0, direction === "bottom" ? 8 : -8];
        tip.update();
      }
    }
    map.on("moveend zoomend resize", placeFocusLabel);

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
    function resizeMap(reframe = true) {
      if (!el.clientWidth || !el.clientHeight) return;
      map.invalidateSize({ pan: false });
      if (!reframe) return;
      // Changing between list and selected-meter layouts changes the map size.
      // Leaflet's old pixel origin can otherwise leave edge markers off-screen.
      if (current.focusId) {
        const focused = entries.find((entry) => entry.id === current.focusId);
        if (focused) map.setView([focused.lat, focused.lng], focusZoom(focused), { animate: false });
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
      // The selection belongs to this update, even if the app changes it while
      // a lookup is waiting. Newer updates supersede this run via version.
      current = { meters, focusId, marked: new Set(marked), focusRequest, resultIds: new Set(resultIds) };
      const rank = (m) => m.id === focusId ? 2 : marked.has(m.id) ? 1 : 0;
      const wanted = [...meters].sort((a, b) => rank(b) - rank(a));
      const located = [];
      const queue = [];
      for (const m of wanted) {
        const pos = cachedPosition(m);
        if (pos) located.push({ m, pos }); else queue.push(m);
      }
      const failures = new Set();
      let completed = 0;
      let focusResolved = !focusId || located.some(({ m }) => m.id === focusId);
      const report = () => {
        const selected = wanted.find((m) => m.id === focusId);
        const selectedFound = located.some(({ m }) => m.id === focusId);
        const focusMessage = selected && !selectedFound
          ? !focusResolved ? `Söker adress för ${selected.address}… `
            : failures.has(focusId) ? `Vald mätare: adressökningen misslyckades för ${selected.address}. Klicka igen för att försöka på nytt. `
            : `Vald mätare: adressen ${selected.address} kunde inte hittas. Ingen plupp placeras på en annan adress. ` : "";
        const pending = queue.length - completed;
        const missing = wanted.length - located.length - pending - failures.size;
        const markedFound = located.filter(({ m }) => current.marked.has(m.id)).length;
        status(`${focusMessage}${located.length} av ${wanted.length} på kartan${current.marked.size ? ` · ${markedFound} av ${current.marked.size} markerade på kartan` : ""}${pending ? ` · söker ${pending} återstående adresser…` : ""}${missing > 0 ? ` · ${missing} adresser kunde inte hittas` : ""}${failures.size ? ` · ${failures.size} adressökningar misslyckades, klicka på adressen för att försöka på nytt` : ""}`);
        if (options.statusElement) options.statusElement.dataset.state = selected && focusResolved && !selectedFound ? "warning" : pending ? "loading" : "ready";
      };
      draw(located, mode);
      report();
      for (const m of queue) {
        if (run !== version) return;
        try {
          const pos = await geocode(m, m.id === focusId);
          if (run !== version) return;
          if (pos) located.push({ m, pos });
        } catch (error) {
          if (run !== version) return;
          failures.add(m.id);
        }
        completed++;
        if (m.id === focusId) focusResolved = true;
        draw(located, mode);
        report();
      }
      if (run !== version) return;
      draw(located, mode, true);
      report();
    }

    function renderLegend(located) {
      if (!options.legendElement) return;
      const counts = new Map();
      for (const { m } of located) counts.set(m.category || "normal", (counts.get(m.category || "normal") || 0) + 1);
      const chips = Object.entries(View.statuses).filter(([key]) => counts.has(key)).map(([key, entry]) =>
        `<span class="map-legend-chip" data-category="${key}" style="--meter-color:${entry.color}"><i aria-hidden="true"></i>${esc(entry.label)} <b>${counts.get(key)}</b></span>`).join("");
      const content = `${chips}<span class="map-legend-selection"><i aria-hidden="true"></i>Svart ring = markerad · stor ring + adress = vald</span>`;
      if (options.legendElement.innerHTML !== content) options.legendElement.innerHTML = content;
    }

    function draw(located, mode, final) {
      entries = located.map(({ m, pos }) => ({ id: m.id, ...pos }));
      const rank = (m) => m.id === current.focusId ? 200 : current.marked.has(m.id) ? 100 : ({ dispatch: 90, confirmed: 85, suspect_auto: 70, watch: 69, customer_side: 60, stable_high: 40 })[m.category] || 0;
      // Draw the selected meter last so its marker stays on top.
      located.sort((a, b) => rank(a.m) - rank(b.m));
      const keep = new Set(located.map(({ m }) => m.id));
      for (const [id, entry] of markerById) {
        if (!keep.has(id)) { markerLayer.removeLayer(entry.marker); markerById.delete(id); }
      }
      for (const { m, pos } of located) {
        const isFocus = m.id === current.focusId;
        const isMarked = current.marked.has(m.id);
        const style = {
          radius: isFocus ? 11 : isMarked ? 9 : mode === "overview" ? 5.5 : 7,
          color: isFocus || isMarked ? "#111827" : "#ffffff",
          weight: isFocus ? 4 : isMarked ? 3 : 2,
          fillColor: (View.statuses[m.category] || View.statuses.normal).color,
          fillOpacity: 1, opacity: 1,
        };
        let entry = markerById.get(m.id);
        if (!entry) {
          const marker = L.circleMarker([pos.lat, pos.lng], { ...style, className: "map-pin" });
          marker.on("click", () => options.onFocus?.(m.id));
          marker.on("tooltipopen", placeFocusLabel);
          marker.addTo(markerLayer);
          entry = { marker };
          markerById.set(m.id, entry);
        } else {
          entry.marker.setLatLng([pos.lat, pos.lng]);
          entry.marker.setStyle(style);
        }
        const marker = entry.marker;
        const address = esc(options.label ? options.label(m) : m.address);
        const max = m.series?.length ? Math.max(...m.series.map((p) => p.value)) : null;
        const date = m.latest?.date instanceof Date ? m.latest.date.toLocaleDateString("sv-SE") : "Datum saknas";
        const tip = `<div class="map-meter-tip" style="--meter-color:${style.fillColor}"><b>${address}</b><span class="map-tip-status">${esc(m.status || View.statuses[m.category]?.label || "")}${isMarked ? " · Markerad" : ""}</span><span>Adressposition · ${esc(date)}</span><dl><dt>Senaste nivå</dt><dd>${esc(m.latest?.value ?? "–")}</dd><dt>Max i historiken</dt><dd>${esc(max ?? "–")}</dd></dl></div>`;
        if (entry.tip !== tip || entry.focus !== isFocus) {
          if (entry.tip != null) marker.unbindTooltip();
          marker.bindTooltip(tip, { permanent: isFocus, direction: "top", offset: [0, -8], className: "map-label" });
          entry.tip = tip; entry.focus = isFocus;
          if (isFocus) marker.openTooltip();
        }
        // Priority and selection order determine both drawing and click order.
        marker.bringToFront();
        const node = marker.getElement();
        if (node) {
          node.dataset.meterId = m.id;
          node.dataset.category = m.category || "normal";
          node.classList.toggle("is-focus", isFocus);
          node.classList.toggle("is-marked", isMarked);
          node.setAttribute("tabindex", "0");
          node.setAttribute("role", "button");
          node.setAttribute("aria-pressed", String(isMarked));
          node.setAttribute("aria-label", `${m.address} · ${m.status || ""} · nivå ${m.latest?.value ?? "saknas"}${isMarked ? " · markerad" : ""}`);
          node.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); options.onFocus?.(m.id); } };
        }
      }
      renderLegend(located);
      drawMarks();
      const focused = located.find(({ m }) => m.id === current.focusId);
      if (current.focusId) {
        // A selection always wins over the bounds of other marked meters.
        // Pins require the complete house address, including any letter suffix.
        if (focused) {
          const zoom = focusZoom(focused.pos);
          const flight = `${current.focusId}|${current.focusRequest}|${focused.pos.lat}|${focused.pos.lng}|${zoom}`;
          if (flight !== lastFlight) {
            lastFlight = flight;
            map.stop();
            map.flyTo([focused.pos.lat, focused.pos.lng], zoom, {
              duration: 0.7, animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            });
          }
        }
      } else if (mode === "results") {
        const resultKey = located.filter(({ m }) => current.resultIds.has(m.id)).map(({ m }) => m.id).sort().join(",");
        if (resultKey !== lastResults || lastFlight) { fitResults(); lastResults = resultKey; }
      } else if (final || located.length) {
        lastFlight = "";
        const pts = located.map(({ pos }) => [pos.lat, pos.lng]);
        if (pts.length === 1) map.setView(pts[0], 17);
        else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 14 });
      }
    }

    function fitResults(markedOnly = false) {
      const pts = entries.filter((e) => (markedOnly ? current.marked : current.resultIds).has(e.id)).map((e) => [e.lat, e.lng]);
      map.stop();
      lastFlight = "";
      if (markedOnly && !pts.length) { status("De markerade adresserna har ännu ingen hittad adressposition."); return; }
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
    return { update, setTool, setStyle, locate, fitResults, fitMarked: () => fitResults(true), invalidate: () => resizeMap(false), map };
  }

  function navigationUrl(meter) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressForMap(meter))}`;
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

