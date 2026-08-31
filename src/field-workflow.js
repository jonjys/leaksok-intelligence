(function applyFieldWorkflow() {
  const workflowTypes = {
    leak: "Konstaterad läcka",
    repaired: "Lagad",
    seasonal: "Säsong",
    known_noise: "Falsklarm/Annat",
    district_heating: "Fjärrvärme",
    large_building: "Höghus/stor byggnad",
    pump: "Undercentral/pumpar",
    false_alarm: "Falsklarm/Annat",
    suspect: "Misstänk",
    ignored: "Ignorera",
    manual_dispatch: "Åk ut",
    interesting: "Bevaka",
    reset_baseline: "Nollställ och följ nya värden",
    customer_contact: "Kontakta FÄ",
  };
  const bulkDefaults = {
    seasonal: ["värmepanna"],
    known_noise: ["falsklarm/annat"],
    district_heating: ["fjärrvärme"],
    large_building: ["höghus"],
    pump: ["undercentral/pumpar"],
    false_alarm: ["falsklarm/annat"],
    reset_baseline: ["nollställd/följ nya värden"],
    customer_contact: ["efter mätare/kontakta FÄ"],
  };
  const selectedMeters = new Set();
  const GEOCODE_CACHE_KEY = "leaksok_geocode_v1";
  const geocodeCache = readGeocodeCache();
  const geocodeInFlight = new Map();
  const mapCoordinates = new Map();
  let selectedPreviewId = "";
  let currentPage = 1;
  let geocodeChain = Promise.resolve();
  let lastGeocodeAt = 0;
  let mapRenderVersion = 0;
  let previewMap = null;
  let previewMapLayers = null;
  let previewBaseLayer = null;
  let previewMarkerLayer = null;
  let previewUserMarker = null;
  let previewUserLatLng = null;
  let previewMapPoints = [];
  let previewMapStyle = "satellite";

  Object.assign(categoryText, {
    confirmed: "HITTAD LÄCKA",
    customer_side: "EFTER MÄTARE",
    seasonal: "SÄSONG",
    noise: "FALSKLARM / STÖRNING",
    ignored: "IGNORERAD",
    suspect_auto: "MISSTÄNK",
  });
  Object.assign(labelTypes, workflowTypes);
  Object.keys(feedbackButtons).forEach((key) => { delete feedbackButtons[key]; });
  Object.assign(feedbackButtons, {
    leak: "Hittad läcka",
    repaired: "Lagad",
    manual_dispatch: "Ska åka ut på",
    interesting: "Intressant",
    ignored: "Ignorera denna",
    known_noise: "Tillfällig topp",
    reset_baseline: "Falsklarm - nollställ",
    seasonal: "Säsong",
    false_alarm: "Falsklarm/Annat",
    suspect: "Misstänk",
  });
  const listLabels = {
    all: "Alla mätare",
    dispatch: "Åk ut",
    watch: "Bevaka",
    suspect_auto: "Misstänk",
    seasonal: "Säsong",
    confirmed: "Aktiva läckor",
    customer_side: "Efter mätare",
    repaired: "Lagad",
    ignored: "Ignorera",
    learning: "Under inlärning",
    stale_contact: "Utan avläsning",
    noise: "Falsklarm/störning",
  };
  document.querySelectorAll('#filter option[value="normal"]').forEach((option) => option.remove());

  const originalScoreMeter = scoreMeter;
  scoreMeter = function scoreMeterWithFieldLists(meter, networkContext) {
    const result = originalScoreMeter(meter, networkContext);
    const label = state.labels[meter.id];
    const shortHistory = result.profile?.coverage?.days < 365 || meter.points.length < 5;
    const staleReadDays = result.staleReadDays ?? Math.max(0, Math.round(((result.last?.date || new Date()) - (result.last?.readAt || result.last?.date || new Date())) / 86400000));
    const staleContact = result.staleContact || staleReadDays >= 14;
    const customerSide = Boolean(result.infrastructure?.customerSide);
    if (label?.type === "leak") result.category = "confirmed";
    if (label?.type === "repaired") result.category = "repaired";
    if (label?.type === "manual_dispatch") {
      result.category = "dispatch";
      result.risk = Math.max(result.risk, 90);
      result.reasons = ["Manuellt vald: åk ut", ...result.reasons.filter((reason) => !/manuellt vald/i.test(reason))];
    }
    if (label?.type === "interesting") {
      result.category = "watch";
      result.risk = Math.max(result.risk, 45);
      result.reasons = ["Manuellt vald: bevaka", ...result.reasons.filter((reason) => !/manuellt vald/i.test(reason))];
    }
    if (label?.type === "customer_contact") {
      result.category = "customer_side";
      result.risk = Math.max(Math.min(result.risk, 58), 35);
      result.reasons = ["Efter mätare: kontakta FÄ/kund", ...result.reasons.filter((reason) => !/efter mätare|kundsida/i.test(reason))];
    }
    if (label?.type === "reset_baseline") {
      const resetDate = parseLabelDate(label);
      const pointsAfterReset = resetDate
        ? meter.points.filter((point) => point.date > resetDate)
        : [];
      if (!pointsAfterReset.length || !hasNewRiseAfterReset(pointsAfterReset)) {
        result.category = "normal";
        result.risk = Math.min(result.risk, 18);
        result.reasons = ["Falsklarm nollställt: inväntar nya värden efter nästa Excel", ...result.reasons.filter((reason) => !/falsklarm nollställt/i.test(reason))];
      } else if (result.category === "watch") {
        result.category = "suspect_auto";
      }
    }
    if (label?.type === "ignored") {
      result.category = "ignored";
      result.risk = 0;
      result.reasons = ["Ignorerad manuellt i fältfacit", ...result.reasons.filter((reason) => !/ignorerad manuellt/i.test(reason))];
    }
    if (label?.type === "suspect" && result.category !== "dispatch") result.category = "suspect_auto";
    if (label?.type === "seasonal" && !["dispatch", "repaired"].includes(result.category)) result.category = "seasonal";
    if (["known_noise", "district_heating", "large_building", "pump", "false_alarm"].includes(label?.type) && result.category !== "repaired") {
      result.category = "noise";
      result.risk = Math.min(result.risk, 24);
    }
    if (!label && customerSide) {
      result.category = "customer_side";
      result.risk = Math.max(Math.min(result.risk, 58), result.risk >= 45 ? 45 : 28);
      if (!result.reasons.some((reason) => /kundsida|efter mätaren/i.test(reason))) result.reasons.unshift("LEAK i Excel: efter mätare/kundsida");
    }
    if (!label && staleContact) {
      result.category = "normal";
      result.risk = Math.min(result.risk, 24);
      if (!result.reasons.some((reason) => /gammal avläsning|dålig kontakt/i.test(reason))) {
        result.reasons.unshift(`Dålig kontakt/gammal avläsning: ${staleReadDays} dagar sedan senaste mätarläsning`);
      }
    }
    if (!label && result.category === "repaired") {
      if (result.risk >= 58 && !result.infrastructure?.customerSide) result.category = "dispatch";
      else if (result.risk >= 38 || result.lowRelativeRise) result.category = "watch";
      else if (result.infrastructure?.customerSide) result.category = "normal";
      else if (shortHistory) result.category = "learning";
      else result.category = "normal";
    }
    if (!label && shortHistory && result.category === "normal" && !customerSide && !staleContact) {
      result.category = "learning";
    }
    if (!label && result.category === "watch") result.category = "suspect_auto";
    return result;
  };

  function parseLabelDate(label) {
    const raw = label.notedDate || label.at || label.confirmedDate || "";
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function hasNewRiseAfterReset(points) {
    if (points.length < 2) return false;
    const values = points.map((point) => point.current).filter(Number.isFinite);
    if (values.length < 2) return false;
    const previous = values.slice(0, -1);
    const base = median(previous) || avg(previous) || 1;
    const last = values[values.length - 1];
    return last >= 25 && last >= base * 1.7;
  }

  function terms(value) {
    return String(value || "")
      .split(/[\n,;]+/)
      .map((term) => normalize(term))
      .filter(Boolean);
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matches(row, searchTerms) {
    const haystack = normalize(`${row.address} ${row.serial} ${row.area}`);
    return searchTerms.some((term) => haystack.includes(term));
  }

  function renderBulk(rows, searchTerms) {
    const box = document.getElementById("bulkActions");
    const count = document.getElementById("bulkCount");
    if (!box || !count) return;
    const selectedCount = selectedMeters.size;
    const show = selectedCount > 0 || (searchTerms.length > 0 && rows.length > 0);
    box.hidden = !show;
    if (show) count.textContent = selectedCount > 0 ? `${selectedCount} markerade` : `${rows.length} träffar`;
    const save = document.getElementById("bulkSave");
    if (save) save.textContent = selectedCount > 0 ? `Flytta ${selectedCount} markerade` : `Flytta ${rows.length} träffar`;
  }

  function pageSize() {
    return Number(document.getElementById("pageSize")?.value || 50);
  }

  function renderPager(totalRows) {
    const size = pageSize();
    const pages = Math.max(1, Math.ceil(totalRows / size));
    currentPage = Math.min(Math.max(1, currentPage), pages);
    const info = document.getElementById("pageInfo");
    const prev = document.getElementById("prevPage");
    const next = document.getElementById("nextPage");
    if (info) info.textContent = `${currentPage}/${pages}`;
    if (prev) prev.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= pages;
  }

  render = function renderFieldWorkflow() {
    const searchTerms = terms(els.search.value);
    const filter = els.filter.value;
    const sort = els.sort.value;
    let rows = [...state.meters];
    if (filter !== "all") {
      rows = rows.filter((row) => {
        if (filter === "learning") return ["learning", "new_high", "new_unknown"].includes(row.category);
        if (filter === "confirmed") return row.category === "confirmed";
        if (filter === "suspect_auto") return row.category === "suspect_auto";
        if (filter === "stale_contact") return row.staleContact || row.staleReadDays >= 14;
        return row.category === filter;
      });
    }
    if (searchTerms.length) rows = rows.filter((row) => matches(row, searchTerms));
    rows.sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
    renderPager(rows.length);
    const size = pageSize();
    const visibleRows = rows.slice((currentPage - 1) * size, currentPage * size);
    renderSummary();
    renderLabels();
    renderBulk(rows, searchTerms);
    renderRows(visibleRows);
    renderSelectedPreview();
  };

  renderSummary = function renderFieldSummary() {
    const counts = {
      meters: state.meters.length,
      dispatch: state.meters.filter((meter) => meter.category === "dispatch").length,
      watch: state.meters.filter((meter) => meter.category === "watch").length,
      suspect: state.meters.filter((meter) => meter.category === "suspect_auto").length,
      customer: state.meters.filter((meter) => meter.category === "customer_side").length,
      confirmed: state.meters.filter((meter) => meter.category === "confirmed").length,
      repaired: state.meters.filter((meter) => meter.category === "repaired").length,
      seasonal: state.meters.filter((meter) => meter.category === "seasonal").length,
      noise: state.meters.filter((meter) => meter.category === "noise").length,
      ignored: state.meters.filter((meter) => meter.category === "ignored").length,
      stale: state.meters.filter((meter) => meter.staleContact || meter.staleReadDays >= 14).length,
      short: state.meters.filter((meter) => ["learning", "new_high", "new_unknown"].includes(meter.category)).length,
    };
    els.summary.innerHTML = `
      <div><b>${counts.meters}</b><span>mätare</span></div>
      <div><b>${counts.dispatch}</b><span>åk ut</span></div>
      <div><b>${counts.suspect}</b><span>misstänk</span></div>
      <div><b>${counts.confirmed}</b><span>aktiva läckor</span></div>
    `;
    renderListTabs(counts);
  };

  function renderListTabs(counts) {
    const tabs = document.getElementById("listTabs");
    if (!tabs) return;
    const active = els.filter.value;
    const values = {
      all: state.meters.length, dispatch: counts.dispatch, watch: counts.watch, suspect_auto: counts.suspect, customer_side: counts.customer,
      seasonal: counts.seasonal, confirmed: counts.confirmed, repaired: counts.repaired, ignored: counts.ignored, stale_contact: counts.stale, learning: counts.short, noise: counts.noise,
    };
    const secondary = ["seasonal", "noise", "ignored", "stale_contact", "learning"];
    const moreCount = secondary.reduce((sum, key) => sum + (values[key] || 0), 0);
    tabs.querySelectorAll("button[data-filter]").forEach((button) => {
      const filter = button.dataset.filter;
      button.classList.toggle("active", filter === active);
      button.innerHTML = `${listLabels[filter] || filter} <b>${values[filter] || 0}</b>`;
    });
    const more = document.getElementById("moreLists");
    const moreBadge = document.getElementById("moreListCount");
    if (moreBadge) moreBadge.textContent = String(moreCount);
    if (more && secondary.includes(active)) more.open = true;
  }

  labelSummary = function labelSummaryField(label) {
    const parts = [];
    if (label.type === "ignored") parts.push("ignorerad");
    if (label.type === "manual_dispatch") parts.push("åk ut");
    if (label.type === "interesting") parts.push("bevaka");
    if (label.type === "customer_contact") parts.push("kontakta FÄ");
    if (label.type === "reset_baseline") parts.push("nollställd");
    if (label.confirmedDate) parts.push(`hittad ${label.confirmedDate}`);
    if (label.confirmedDateUncertain) parts.push("datum osäkert");
    if (label.repairedDate) parts.push(`lagad ${label.repairedDate}`);
    if (Number.isFinite(label.distanceMeters)) parts.push(`ca ${label.distanceMeters} m från mätaren`);
    if (label.distanceUncertain) parts.push("avstånd osäkert");
    if (label.lineType) parts.push(label.lineType);
    if (label.noiseTags?.length) parts.push(label.noiseTags.join(", "));
    if (label.notedDate) parts.push(label.notedDate);
    if (label.note) parts.push(label.note);
    return parts.join(" · ");
  };

  renderRows = function renderRowsFieldWorkflow(rows) {
    if (!rows.length) {
      els.rows.innerHTML = `<tr><td colspan="8" class="empty">Ingen mätare matchar filtret.</td></tr>`;
      return;
    }
    els.rows.innerHTML = rows.map((r) => `
      <tr>
        <td data-label="Välj" class="select-cell">
          <label class="row-check">
            <input type="checkbox" class="row-select" data-id="${escapeAttr(r.id)}" ${selectedMeters.has(r.id) ? "checked" : ""}>
            <span>Markera</span>
          </label>
        </td>
        <td data-label="Beslut" class="decision-cell">
          <span class="pill ${r.category}">${categoryText[r.category]}</span>
          <div class="score">${r.risk}</div>
          <div class="small">säkerhet: ${r.confidence}</div>
        </td>
        <td data-label="Adress" class="address-cell">
          <div class="address-line"><b>${escapeHtml(r.address || "-")}</b>${customerSideMark(r)}<button class="copy-address secondary" title="Kopiera adress" onclick="copyAddress('${escapeAttr(r.id)}', event)">Kopiera</button><button class="copy-address secondary" title="Öppna GPS" onclick="openMeterNavigation('${escapeAttr(r.id)}', event)">GPS</button></div>
          <div class="small">${escapeHtml(r.serial || r.id)} · ${escapeHtml(r.area || "ÖVRIGT")}</div>
          ${tagLine(r)}
        </td>
        <td data-label="E/F/P" class="metrics-cell">
          <b>E ${round(r.last.current)}</b> · F ${round(r.last.average)} · G ${round(r.maxSeen)}
          <div class="small">P ${(r.pDeviation * 100).toFixed(0)}% · ${signedPct(r.lastJump)} senast</div>
        </td>
        <td data-label="Trend" class="trend-cell">
          <b>${signedPct(r.lastJump)}</b> senast
          <div class="small">${signedPct(r.firstChange)} från första filen</div>
        </td>
        <td data-label="Historik" class="history-cell">
          <svg class="spark" viewBox="0 0 160 42" onclick="openDetail('${escapeAttr(r.id)}')">${sparkPath(r.points)}</svg>
          <div class="small">${r.points.length} punkter · ${r.profile.coverage.days} dagar · ${r.profile.coverage.months} månader · ${r.profile.coverage.seasons} säsonger</div>
        </td>
        <td data-label="Varför" class="reason-cell">
          <ul class="reasons">${r.reasons.slice(0, 5).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
        </td>
        <td data-label="Facit" class="feedback-cell"><div class="feedback">${feedbackActions(r.id)}</div></td>
      </tr>
    `).join("");
  };

  feedbackActions = function feedbackActionsFieldWorkflow(id) {
    const meter = state.meters.find((item) => item.id === id);
    const active = els.filter.value;
    const category = meter?.category || active;
    const sets = {
      dispatch: ["leak", "suspect", "interesting", "customer_contact", "known_noise", "reset_baseline", "ignored"],
      confirmed: ["repaired", "manual_dispatch", "interesting", "ignored"],
      repaired: ["manual_dispatch", "interesting", "ignored"],
      watch: ["manual_dispatch", "suspect", "leak", "customer_contact", "known_noise", "reset_baseline", "ignored"],
      suspect_auto: ["manual_dispatch", "leak", "interesting", "customer_contact", "known_noise", "reset_baseline", "ignored"],
      customer_side: ["customer_contact", "manual_dispatch", "suspect", "interesting", "ignored", "reset_baseline"],
      seasonal: ["manual_dispatch", "suspect", "interesting", "reset_baseline", "ignored"],
      ignored: ["manual_dispatch", "suspect", "interesting", "reset_baseline"],
      noise: ["manual_dispatch", "suspect", "interesting", "reset_baseline", "ignored"],
      stale_contact: ["manual_dispatch", "suspect", "interesting", "ignored"],
      learning: ["manual_dispatch", "suspect", "interesting", "ignored"],
      new_high: ["manual_dispatch", "suspect", "interesting", "ignored"],
      new_unknown: ["manual_dispatch", "suspect", "interesting", "ignored"],
      normal: ["manual_dispatch", "suspect", "interesting", "customer_contact", "ignored"],
    };
    const types = active === "all"
      ? ["manual_dispatch", "suspect", "interesting", "leak", "customer_contact", "ignored"]
      : (sets[active] || sets[category] || ["manual_dispatch", "suspect", "interesting", "ignored"]);
    const address = escapeAttr(meter?.address || id);
    return `
      <select class="row-action" aria-label="Flytta ${address}" onchange="if(this.value){labelMeter(\'${escapeAttr(id)}\',this.value);this.value=\'\'}">
        <option value="">Flytta till...</option>
        ${types.map((type) => `<option value="${escapeAttr(type)}">${feedbackButtons[type] || workflowTypes[type] || type}</option>`).join("")}
      </select>
    `;
  };

  function readGeocodeCache() {
    if (typeof localStorage === "undefined") return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveGeocodeCache() {
    if (typeof localStorage === "undefined") return;
    const entries = Object.entries(geocodeCache);
    if (entries.length > 1000) {
      entries
        .sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0))
        .slice(0, entries.length - 1000)
        .forEach(([key]) => { delete geocodeCache[key]; });
    }
    try {
      localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(geocodeCache));
    } catch {
      // The map still works when the browser blocks local storage.
    }
  }

  function selectedMeterList() {
    const ids = selectedMeters.size ? [...selectedMeters] : [selectedPreviewId].filter(Boolean);
    return ids.map((id) => state.meters.find((meter) => meter.id === id)).filter(Boolean);
  }

  function addressForMap(meter) {
    const raw = String(meter.address || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    const postalAtEnd = raw.match(/^(.*?\d+(?:[-/]\d+)?[A-Za-z]?)\s+(.+?)\s+(\d{5})$/i);
    if (postalAtEnd) return `${postalAtEnd[1]}, ${postalAtEnd[3]} ${postalAtEnd[2]}, Sverige`;
    const area = String(meter.area || "").replace(/\s+/g, " ").trim();
    const suffix = area && !normalize(raw).includes(normalize(area)) ? `, ${area}` : "";
    return `${raw}${suffix}, Sverige`;
  }

  function geocodeKey(meter) {
    return normalize(addressForMap(meter));
  }

  function waitFor(ms) {
    return new Promise((resolve) => {
      if (typeof setTimeout === "function") setTimeout(resolve, ms);
      else resolve();
    });
  }

  function geocodeMeter(meter) {
    const key = geocodeKey(meter);
    if (!key) return Promise.resolve(null);
    const cached = geocodeCache[key];
    if (Number.isFinite(cached?.lat) && Number.isFinite(cached?.lng)) {
      const result = { lat: cached.lat, lng: cached.lng, label: cached.label || addressForMap(meter) };
      mapCoordinates.set(meter.id, result);
      return Promise.resolve(result);
    }
    if (cached?.missing && Date.now() - Number(cached.at || 0) < 7 * 86400000) return Promise.resolve(null);
    if (geocodeInFlight.has(key)) return geocodeInFlight.get(key);
  
    const task = geocodeChain.then(async () => {
      if (typeof fetch !== "function") throw new Error("GPS-sökning saknas i webbläsaren");
      const delay = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
      if (delay) await waitFor(delay);
      lastGeocodeAt = Date.now();
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("countrycodes", "se");
      url.searchParams.set("accept-language", "sv");
      url.searchParams.set("q", addressForMap(meter));
      const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`GPS-sökning misslyckades (${response.status})`);
      const results = await response.json();
      const hit = Array.isArray(results) ? results[0] : null;
      const lat = Number(hit?.lat);
      const lng = Number(hit?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        geocodeCache[key] = { missing: true, at: Date.now() };
        saveGeocodeCache();
        return null;
      }
      const result = { lat, lng, label: hit.display_name || addressForMap(meter) };
      geocodeCache[key] = { ...result, at: Date.now() };
      mapCoordinates.set(meter.id, result);
      saveGeocodeCache();
      return result;
    });
  
    geocodeChain = task.catch(() => null);
    const tracked = task.finally(() => { geocodeInFlight.delete(key); });
    geocodeInFlight.set(key, tracked);
    return tracked;
  }

  function setMapStatus(message) {
    const status = document.getElementById("mapStatus");
    if (status) status.textContent = message || "";
  }

  function updateMapStyleButtons() {
    document.getElementById("streetMap")?.classList.toggle("active", previewMapStyle === "street");
    document.getElementById("satelliteMap")?.classList.toggle("active", previewMapStyle === "satellite");
  }

  function setPreviewMapStyle(style) {
    if (!["street", "satellite"].includes(style)) return;
    previewMapStyle = style;
    updateMapStyleButtons();
    if (!previewMap || !previewMapLayers) return;
    if (previewBaseLayer) previewMap.removeLayer(previewBaseLayer);
    previewBaseLayer = previewMapLayers[style];
    previewBaseLayer.addTo(previewMap);
  }

  function ensurePreviewMap() {
    const mapElement = document.getElementById("selectedMap");
    if (!mapElement) return null;
    if (!window.L) {
      setMapStatus("Kartan kunde inte laddas. Kör hit fungerar fortfarande.");
      return null;
    }
    if (previewMap) return previewMap;
  
    const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    const satelliteImage = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri",
    });
    const satelliteLabels = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
    });
  
    previewMapLayers = {
      street,
      satellite: L.layerGroup([satelliteImage, satelliteLabels]),
    };
    previewMap = L.map(mapElement, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView([59.2, 17.83], 10);
    previewBaseLayer = previewMapLayers[previewMapStyle];
    previewBaseLayer.addTo(previewMap);
    previewMarkerLayer = L.layerGroup().addTo(previewMap);
    updateMapStyleButtons();
    return previewMap;
  }

  function focusPreviewMap(includeUser = false) {
    if (!previewMap || !window.L) return;
    const points = [...previewMapPoints];
    if (includeUser && previewUserLatLng) points.push(previewUserLatLng);
    const resize = () => {
      previewMap.invalidateSize({ pan: false });
      if (!points.length) return;
      if (points.length === 1) previewMap.flyTo(points[0], 17, { duration: .35 });
      else previewMap.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 18 });
    };
    if (typeof setTimeout === "function") setTimeout(resize, 0);
    else resize();
  }

  function mapMarkerColor(category) {
    return {
      dispatch: "#dc2626",
      watch: "#d97706",
      suspect_auto: "#f59e0b",
      confirmed: "#059669",
      repaired: "#2563eb",
      seasonal: "#7c3aed",
      noise: "#64748b",
      ignored: "#475569",
      customer_side: "#06b6d4",
    }[category] || "#0284c7";
  }

  function shortMapLabel(meter) {
    const address = String(meter.address || meter.id).replace(/\s+/g, " ").trim();
    const streetAndNumber = address.match(/^(.+?\d+(?:[-/]\d+)?[A-Za-z]?)(?:\s|$)/i);
    return streetAndNumber?.[1] || address;
  }

  function renderSelectedChips() {
    const chips = document.getElementById("selectedMeterChips");
    if (!chips) return;
    const meters = selectedMeterList();
    chips.innerHTML = meters.map((meter) => `
      <button type="button" class="meter-chip${meter.id === selectedPreviewId ? " active" : ""}" data-preview-meter="${escapeAttr(meter.id)}" title="${escapeAttr(meter.address || meter.id)}">
        ${escapeHtml(shortMapLabel(meter))}
      </button>
    `).join("");
  }

  async function renderSelectedMap() {
    const version = ++mapRenderVersion;
    const meters = selectedMeterList();
    renderSelectedChips();
    const map = ensurePreviewMap();
    if (!map || !previewMarkerLayer) return;
    previewMarkerLayer.clearLayers();
    previewMapPoints = [];
    if (!meters.length) {
      setMapStatus("");
      return;
    }
  
    setMapStatus(meters.length > 1 ? `Hämtar GPS för ${meters.length} markerade adresser...` : "Hämtar GPS-position...");
    const located = [];
    for (let index = 0; index < meters.length; index += 1) {
      if (version !== mapRenderVersion) return;
      setMapStatus(`Hämtar GPS ${index + 1}/${meters.length}...`);
      try {
        const coordinates = await geocodeMeter(meters[index]);
        if (coordinates) located.push({ meter: meters[index], coordinates });
      } catch (error) {
        if (version === mapRenderVersion) setMapStatus(error.message || "GPS-sökningen misslyckades.");
      }
    }
    if (version !== mapRenderVersion) return;
  
    previewMarkerLayer.clearLayers();
    for (const { meter, coordinates } of located) {
      const point = [coordinates.lat, coordinates.lng];
      previewMapPoints.push(point);
      mapCoordinates.set(meter.id, coordinates);
      const marker = L.circleMarker(point, {
        radius: selectedMeters.has(meter.id) ? 11 : (meter.id === selectedPreviewId ? 10 : 8),
        color: selectedMeters.has(meter.id) ? "#111827" : "#ffffff",
        weight: selectedMeters.has(meter.id) ? 4 : 3,
        fillColor: mapMarkerColor(meter.category),
        fillOpacity: 1,
      });
      marker.bindTooltip(shortMapLabel(meter), {
        permanent: located.length <= 8,
        direction: "top",
        offset: [0, -7],
        className: "meter-map-label",
      });
      marker.bindPopup(`
        <b>${escapeHtml(meter.address || meter.id)}</b><br>
        ${escapeHtml(categoryText[meter.category] || meter.category)} · risk ${meter.risk}<br>
        <button type="button" onclick="openMeterNavigation('${escapeAttr(meter.id)}', event)">Kör hit</button>
      `);
      marker.on("click", () => {
        selectedPreviewId = meter.id;
        renderSelectedPreview();
      });
      marker.addTo(previewMarkerLayer);
    }
  
    if (!located.length) {
      setMapStatus("GPS-position saknas. Kör hit söker direkt på adressen.");
      previewMap.setView([59.2, 17.83], 10);
      return;
    }
    focusPreviewMap();
    setMapStatus(located.length === meters.length
      ? `${located.length} markerade adresser på kartan · OpenStreetMap`
      : `${located.length} av ${meters.length} adresser hittades · OpenStreetMap`);
  }

  window.openMeterNavigation = function openMeterNavigation(id, event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const meter = state.meters.find((item) => item.id === id);
  if (!meter) return;
  const coordinates = mapCoordinates.get(id);
  const destination = coordinates ? `${coordinates.lat},${coordinates.lng}` : addressForMap(meter);
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  window.open(url, "_blank", "noopener,noreferrer");
};

  function locateUser() {
    const map = ensurePreviewMap();
    if (!map || !window.navigator?.geolocation) {
      setMapStatus("GPS är inte tillgänglig i den här webbläsaren.");
      return;
    }
    setMapStatus("Hämtar din GPS-position...");
    window.navigator.geolocation.getCurrentPosition((position) => {
      previewUserLatLng = [position.coords.latitude, position.coords.longitude];
      if (previewUserMarker) previewMap.removeLayer(previewUserMarker);
      previewUserMarker = L.circleMarker(previewUserLatLng, {
        radius: 8,
        color: "#ffffff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1,
      }).bindTooltip("Min position", { permanent: true, direction: "top" }).addTo(previewMap);
      focusPreviewMap(true);
      setMapStatus(`Min GPS · noggrannhet cirka ${Math.round(position.coords.accuracy)} m`);
    }, () => {
      setMapStatus("Kunde inte läsa GPS. Tillåt platsåtkomst och försök igen.");
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    });
  }

  function setPreviewView(view) {
    const preview = document.getElementById("meterPreview");
    if (!preview) return;
    preview.dataset.mobileView = view;
    const chartButton = document.getElementById("showPreviewChart");
    const mapButton = document.getElementById("showPreviewMap");
    chartButton?.classList.toggle("active", view === "chart");
    mapButton?.classList.toggle("active", view === "map");
    chartButton?.setAttribute("aria-pressed", String(view === "chart"));
    mapButton?.setAttribute("aria-pressed", String(view === "map"));
    if (view === "map") focusPreviewMap();
  }

  function meterDates(meter) {
    const firstPoint = meter.points[0];
    const lastPoint = meter.points[meter.points.length - 1];
    return {
      firstDate: firstPoint?.date?.toISOString?.().slice(0, 10) || "-",
      lastDate: lastPoint?.date?.toISOString?.().slice(0, 10) || "-",
      lastReadDate: lastPoint?.readAt?.toISOString?.().slice(0, 10) || "-",
    };
  }

  function chartDatasets(meter, staleDays) {
    const staleMarker = meter.points.map((p, index) => (index === meter.points.length - 1 && staleDays >= 14 ? p.current : null));

    return [
      { label: "Brus E", data: meter.points.map((p) => p.current), borderColor: "#0ea5e9", backgroundColor: "rgba(14,165,233,.16)", fill: true, tension: .14 },
      { label: "Trend", data: rollingAverage(meter.points.map((p) => p.current)), borderColor: "#16a34a", borderWidth: 3, pointRadius: 0, tension: .25 },
      { label: "Snitt F", data: meter.points.map((p) => p.average), borderColor: "#64748b", borderDash: [5, 4], tension: .2 },
      { label: "Max G", data: meter.points.map((p) => p.max), borderColor: "#f97316", borderDash: [2, 4], tension: .2, hidden: true },
      { label: staleDays >= 14 ? `Tappad kontakt ${staleDays} dagar` : "Kontakt OK", data: staleMarker, borderColor: "#dc2626", backgroundColor: "#dc2626", pointRadius: staleDays >= 14 ? 6 : 0, pointHoverRadius: 8, showLine: false },
    ];
  }

  function chartOptions(labels, meter) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { position: "top", labels: { color: "#334155", boxWidth: 12, usePointStyle: true, padding: 8 } },
        tooltip: {
          callbacks: {
            afterBody(items) {
              const point = meter.points[items[0].dataIndex];
              const read = point?.readAt?.toISOString?.().slice(0, 10);
              return [read ? `Avläst: ${read}` : "", point?.info ? `Info: ${point.info}` : ""].filter(Boolean);
            },
          },
        },
      },
      elements: { line: { borderWidth: 2.5 }, point: { radius: meter.points.length > 40 ? 0 : 2.5, hoverRadius: 6 } },
      scales: {
        x: {
          ticks: {
            color: "#475569",
            maxRotation: 0,
            minRotation: 0,
            autoSkip: false,
            callback(value, index) {
              const last = labels.length - 1;
              if (index === 0 || index === last) return labels[index];
              const step = window.innerWidth < 640 ? Math.ceil(labels.length / 3) : Math.ceil(labels.length / 6);
              return index % step === 0 ? labels[index] : "";
            },
          },
          grid: { color: "rgba(100,116,139,.14)" },
        },
        y: { beginAtZero: true, ticks: { color: "#475569" }, grid: { color: "rgba(100,116,139,.18)" } },
      },
    };
  }

  function renderSelectedPreview() {
    const box = document.getElementById("meterPreview");
    const canvas = document.getElementById("selectedChart");
    if (!box || !canvas) return;
    const meter = state.meters.find((item) => item.id === selectedPreviewId);
    box.hidden = !meter;
    if (!meter) {
      mapRenderVersion += 1;
      previewMapPoints = [];
      previewMarkerLayer?.clearLayers?.();
      renderSelectedChips();
      if (state.previewChart) state.previewChart.destroy();
      state.previewChart = null;
      return;
    }
  
    const dates = meterDates(meter);
    const staleDays = meter.staleReadDays || 0;
    const selectedCount = selectedMeterList().length;
    document.getElementById("previewTitle").textContent = meter.address || meter.id;
    document.getElementById("previewMeta").textContent = `${categoryText[meter.category]} · risk ${meter.risk} · ${dates.firstDate} till ${dates.lastDate}${staleDays >= 14 ? ` · tappad kontakt ${staleDays} dagar` : ""}${selectedCount > 1 ? ` · ${selectedCount} mätare på kartan` : ""}`;
    if (state.previewChart) state.previewChart.destroy();
    const labels = meter.points.map((point) => point.date.toISOString().slice(0, 10));
    state.previewChart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets: chartDatasets(meter, staleDays) },
      options: chartOptions(labels, meter),
    });
    renderSelectedMap().catch((error) => {
      setMapStatus(error.message || "Kartan kunde inte uppdateras.");
    });
  }

  window.openDetail = function openDetailFieldWorkflow(id) {
    const meter = state.meters.find((m) => m.id === id);
    if (!meter) return;
    const { firstDate, lastDate, lastReadDate } = meterDates(meter);
    const staleDays = meter.staleReadDays || 0;
    els.detailTitle.textContent = meter.address || meter.id;
    els.detailMeta.textContent = `${meter.serial || meter.id} · ${meter.area || "ÖVRIGT"} · ${firstDate} till ${lastDate} · risk ${meter.risk} · ${categoryText[meter.category]}`;
    els.detailText.innerHTML = `
      <div class="detail-actions">
        <button class="secondary" onclick="copyAddress('${escapeAttr(meter.id)}', event)">Kopiera adress</button>
        <button class="secondary" onclick="openMeterNavigation('${escapeAttr(meter.id)}', event)">Kör hit</button>
        ${feedbackActions(meter.id)}
      </div>
      <p><b>Period:</b> första fil ${firstDate} · sista fil ${lastDate} · senaste mätaravläsning ${lastReadDate}${staleDays >= 14 ? ` · tappad/gammal kontakt ${staleDays} dagar` : ""}</p>
      <p><b>Motivering:</b> ${meter.reasons.map(escapeHtml).join(" · ")}</p>
      <p><b>Mönster:</b> värme=${meter.profile.heating ? "ja" : "nej"}, årsupprepning=${meter.profile.annualRepeat ? `${meter.profile.annualRepeat.months} jämförda månader` : "nej"}, fladdrig=${meter.profile.fluctuating ? "ja" : "nej"}, ny nivå=${meter.profile.newLevel ? "ja" : "nej"}.</p>
      <p><b>Miljö:</b> fjärrvärme=${meter.infrastructure.districtHeating ? "ja" : "nej"}, undercentral/höghus=${meter.infrastructure.largeSubstation ? "ja" : "nej"}, efter mätaren=${meter.infrastructure.customerSide ? "ja" : "nej"}, sommarvattenmätare=${meter.infrastructure.summerWaterMeter ? "ja" : "nej"}${meter.networkContext?.sharedSignal ? `, gemensam signal på ${meter.networkContext.meterCount} mätare` : ""}.</p>
      ${meter.label ? `<p><b>Facit:</b> ${escapeHtml(labelTypes[meter.label.type] || meter.label.type)} · ${escapeHtml(labelSummary(meter.label))}</p>` : ""}
    `;
    const ctx = document.getElementById("detailChart");
    if (state.chart) state.chart.destroy();
    const labels = meter.points.map((p) => p.date.toISOString().slice(0, 10));
    state.chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          ...chartDatasets(meter, staleDays),
        ],
      },
      options: chartOptions(labels, meter),
    });
    els.detailDialog.showModal();
  };

  window.labelMeter = function labelMeterField(id, type) {
    const meter = state.meters.find((item) => item.id === id);
    if (!meter) return;
    const existing = state.labels[id] || {};
    const today = localDate(new Date());
    document.getElementById("feedbackMeterId").value = id;
    document.getElementById("feedbackType").value = type;
    document.getElementById("feedbackTitle").textContent = workflowTypes[type] || feedbackButtons[type] || "Facit";
    document.getElementById("feedbackAddress").textContent = meter.address || id;
    document.getElementById("confirmedDateField").hidden = type === "repaired";
    document.getElementById("confirmedFields").hidden = type !== "leak";
    document.getElementById("repairFields").hidden = type !== "repaired";
    document.getElementById("noiseFields").hidden = !["seasonal", "known_noise", "district_heating", "large_building", "pump", "false_alarm", "reset_baseline"].includes(type);
    document.getElementById("feedbackDateLabel").textContent = type === "leak" ? "Datum hittad" : "Datum noterat";
    document.getElementById("confirmedDate").value = existing.confirmedDate || existing.notedDate || today;
    document.getElementById("confirmedDateUncertain").checked = Boolean(existing.confirmedDateUncertain);
    document.getElementById("repairedDate").value = existing.repairedDate || today;
    document.getElementById("distanceMeters").value = existing.distanceMeters ?? "";
    document.getElementById("distanceUncertain").checked = Boolean(existing.distanceUncertain);
    document.getElementById("feedbackNote").value = existing.note || "";
    document.querySelectorAll('input[name="lineType"]').forEach((input) => { input.checked = input.value === existing.lineType; });
    document.querySelectorAll('input[name="repairLineType"]').forEach((input) => { input.checked = input.value === existing.lineType; });
    document.querySelectorAll('input[name="noiseTag"]').forEach((input) => {
      input.checked = (existing.noiseTags || []).includes(input.value)
        || (bulkDefaults[type] || []).includes(input.value);
    });
    document.getElementById("feedbackDialog").showModal();
  };

  function saveFieldFeedback(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const id = document.getElementById("feedbackMeterId").value;
    const type = document.getElementById("feedbackType").value;
    const meter = state.meters.find((item) => item.id === id);
    const existing = state.labels[id] || {};
    const next = {
      ...existing,
      type,
      address: meter?.address || existing.address,
      serial: meter?.serial || existing.serial,
      note: document.getElementById("feedbackNote").value.trim(),
      at: new Date().toISOString(),
      source: "fältfacit",
    };
    if (type === "leak") {
      next.confirmedDate = document.getElementById("confirmedDate").value || localDate(new Date());
      next.confirmedDateUncertain = document.getElementById("confirmedDateUncertain").checked;
      delete next.lineType;
    } else if (type === "repaired") {
      next.repairedDate = document.getElementById("repairedDate").value || localDate(new Date());
      next.lineType = document.querySelector('input[name="repairLineType"]:checked')?.value || "";
      next.distanceMeters = parseNumber(document.getElementById("distanceMeters").value);
      next.distanceUncertain = document.getElementById("distanceUncertain").checked;
    } else {
      next.notedDate = document.getElementById("confirmedDate").value || localDate(new Date());
      if (["seasonal", "known_noise", "district_heating", "large_building", "pump", "false_alarm", "reset_baseline"].includes(type)) {
        next.noiseTags = [...document.querySelectorAll('input[name="noiseTag"]:checked')].map((input) => input.value);
      }
    }
    state.labels[id] = next;
    saveLabels();
    document.getElementById("feedbackDialog").close();
    analyze();
  }

  document.getElementById("feedbackForm")?.addEventListener("submit", saveFieldFeedback, true);
  document.getElementById("rows")?.addEventListener("change", (event) => {
    const input = event.target.closest?.(".row-select");
    if (!input) return;
    if (input.checked) {
      selectedMeters.add(input.dataset.id);
      selectedPreviewId = input.dataset.id;
    } else {
      selectedMeters.delete(input.dataset.id);
      if (selectedPreviewId === input.dataset.id) selectedPreviewId = [...selectedMeters].at(-1) || "";
    }
    render();
  });
  document.getElementById("listTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-filter]");
    if (!button) return;
    els.filter.value = button.dataset.filter;
    selectedMeters.clear();
    selectedPreviewId = "";
    currentPage = 1;
    render();
  });
  els.search?.addEventListener("input", () => { currentPage = 1; }, true);
  els.sort?.addEventListener("change", () => { currentPage = 1; }, true);
  document.getElementById("clearSelection")?.addEventListener("click", () => {
    selectedMeters.clear();
    selectedPreviewId = "";
    render();
  });
  document.getElementById("selectedMeterChips")?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-preview-meter]");
    if (!button) return;
    selectedPreviewId = button.dataset.previewMeter;
    renderSelectedPreview();
  });
  document.getElementById("showPreviewChart")?.addEventListener("click", () => setPreviewView("chart"));
  document.getElementById("showPreviewMap")?.addEventListener("click", () => setPreviewView("map"));
  document.getElementById("streetMap")?.addEventListener("click", () => setPreviewMapStyle("street"));
  document.getElementById("satelliteMap")?.addEventListener("click", () => setPreviewMapStyle("satellite"));
  document.getElementById("locateMe")?.addEventListener("click", locateUser);
  document.getElementById("openNavigation")?.addEventListener("click", (event) => {
    if (selectedPreviewId) window.openMeterNavigation(selectedPreviewId, event);
  });
  document.getElementById("pageSize")?.addEventListener("change", () => {
    currentPage = 1;
    render();
  });
  document.getElementById("prevPage")?.addEventListener("click", () => {
    currentPage -= 1;
    render();
  });
  document.getElementById("nextPage")?.addEventListener("click", () => {
    currentPage += 1;
    render();
  });
  document.getElementById("bulkSave")?.addEventListener("click", () => {
    const searchTerms = terms(els.search.value);
    const type = document.getElementById("bulkType").value;
    const rows = selectedMeters.size > 0
      ? state.meters.filter((meter) => selectedMeters.has(meter.id))
      : state.meters.filter((meter) => matches(meter, searchTerms));
    if (!rows.length) return;
    const now = new Date().toISOString();
    for (const meter of rows) {
      const existing = state.labels[meter.id] || {};
      state.labels[meter.id] = {
        ...existing,
        type,
        address: meter.address || existing.address,
        serial: meter.serial || existing.serial,
        noiseTags: [...new Set([...(existing.noiseTags || []), ...(bulkDefaults[type] || [])])],
        notedDate: existing.notedDate || localDate(new Date()),
        at: now,
        source: "fältfacit bulk",
      };
    }
    selectedMeters.clear();
    selectedPreviewId = "";
    saveLabels();
    analyze();
    els.importStatus.textContent = `${rows.length} mätare flyttade till ${workflowTypes[type] || type}.`;
  });

  analyze();
}());