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
  const MAP_MARKS_KEY = "leaksok_map_marks_v1";
  const geocodeCache = readGeocodeCache();
  const mapMarks = readMapMarks();
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
  let previewAnnotationLayer = null;
  let previewUserMarker = null;
  let previewUserLatLng = null;
  let previewMapPoints = [];
  let previewMapEntries = [];
  let previewMapStyle = "street";
  let mapCategoryFilter = "all";
  let mapToolMode = "";
  let selectionStart = null;
  let selectionRectangle = null;
  let ignoreNextMapClick = false;

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
    leak: "Konstaterad läcka",
    repaired: "Lagad",
    manual_dispatch: "Åk ut",
    interesting: "Bevaka",
    ignored: "Ignorera",
    customer_contact: "Kontakta FÄ",
    known_noise: "Tillfällig topp",
    reset_baseline: "Nollställ och följ nya värden",
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
    const staleReadDays = result.staleReadDays ?? calendarDaysBetween(
      result.last?.readAt || result.last?.date || new Date(),
      result.last?.date || new Date()
    );
    const staleContact = result.staleContact || staleReadDays >= 14;
    const customerSide = Boolean(result.infrastructure?.customerSide);
    result.staleReadDays = staleReadDays;
    result.staleContact = staleContact;
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
    renderMapConsole(counts);
  };

  function ensureMapConsole() {
    const rail = document.querySelector(".left-rail");
    if (!rail || document.getElementById("mapConsole")) return;
    const consolePanel = document.createElement("section");
    consolePanel.id = "mapConsole";
    consolePanel.className = "map-console";
    consolePanel.innerHTML = `
      <div class="map-console-heading">
        <span>OPERATIV KARTA</span>
        <b>Prioritera och markera</b>
      </div>
      <label class="map-search-label" for="mapSearch">Sök mätare</label>
      <div class="map-search-wrap">
        <span aria-hidden="true">⌕</span>
        <input id="mapSearch" type="search" autocomplete="off" placeholder="Adress, nummer, område">
      </div>
      <nav class="map-status-list" aria-label="Kartfilter">
        <button type="button" data-map-filter="field"><span><i class="map-status-dot field"></i>Fältläge</span><b data-map-count="field">0</b></button>
        <button type="button" data-map-filter="dispatch"><span><i class="map-status-dot dispatch"></i>Åk ut</span><b data-map-count="dispatch">0</b></button>
        <button type="button" data-map-filter="suspect"><span><i class="map-status-dot suspect"></i>Misstänkt / bevaka</span><b data-map-count="suspect">0</b></button>
        <button type="button" data-map-filter="confirmed"><span><i class="map-status-dot confirmed"></i>Aktiva läckor</span><b data-map-count="confirmed">0</b></button>
        <button type="button" data-map-filter="customer_side"><span><i class="map-status-dot customer"></i>Efter mätare</span><b data-map-count="customer_side">0</b></button>
        <button type="button" data-map-filter="all"><span><i class="map-status-dot all"></i>Alla mätare</span><b data-map-count="all">0</b></button>
      </nav>
      <div class="map-gesture-help">
        <b>Kartkommandon</b>
        <span>Dubbelklick / scroll: zooma</span>
        <span>Shift + dra: zooma område</span>
        <span>Välj ruta: markera flera</span>
      </div>
    `;
    rail.prepend(consolePanel);
    const search = consolePanel.querySelector("#mapSearch");
    search.addEventListener("input", () => {
      els.search.value = search.value;
      currentPage = 1;
      render();
    });
    consolePanel.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-map-filter]");
      if (!button) return;
      applyMapCategoryFilter(button.dataset.mapFilter);
    });
  }

  function renderMapConsole(counts) {
    ensureMapConsole();
    const search = document.getElementById("mapSearch");
    if (search && search !== document.activeElement) search.value = els.search.value;
    const values = {
      field: counts.dispatch + counts.suspect + counts.watch + counts.confirmed + counts.customer,
      dispatch: counts.dispatch,
      suspect: counts.suspect + counts.watch,
      confirmed: counts.confirmed,
      customer_side: counts.customer,
      all: counts.meters,
    };
    Object.entries(values).forEach(([key, value]) => {
      const output = document.querySelector(`[data-map-count="${key}"]`);
      if (output) output.textContent = String(value);
    });
    updateMapCategoryButtons();
  }

  function ensureSuspectTabVisible() {
    const tab = document.querySelector('#listTabs button[data-filter="suspect_auto"]');
    if (!tab) return;
    tab.hidden = false;
    tab.style.display = "";
  }

  function renderListTabs(counts) {
    const tabs = document.getElementById("listTabs");
    if (!tabs) return;
    ensureSuspectTabVisible();
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
    if (Number.isFinite(label.valveToLeakMeters)) parts.push(`${label.valveToLeakMeters} m ventil–läcka`);
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
      dispatch: ["leak", "suspect", "interesting", "customer_contact", "ignored"],
      confirmed: ["repaired", "manual_dispatch", "interesting", "ignored"],
      repaired: ["manual_dispatch", "interesting", "ignored"],
      watch: ["manual_dispatch", "suspect", "leak", "customer_contact", "ignored"],
      suspect_auto: ["manual_dispatch", "leak", "interesting", "customer_contact", "ignored"],
      customer_side: ["customer_contact", "manual_dispatch", "suspect", "interesting", "ignored"],
      seasonal: ["manual_dispatch", "suspect", "interesting", "ignored"],
      ignored: ["manual_dispatch", "suspect", "interesting"],
      noise: ["manual_dispatch", "suspect", "interesting", "ignored"],
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

  function readMapMarks() {
    if (typeof localStorage === "undefined") return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(MAP_MARKS_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveMapMarks() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(MAP_MARKS_KEY, JSON.stringify(mapMarks));
    } catch {
      setMapStatus("Kartmarkeringen visas men kunde inte sparas lokalt.");
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
    if (ids.length) return ids.map((id) => state.meters.find((meter) => meter.id === id)).filter(Boolean);
    return overviewMapMeters();
  }

  function currentRowsForOverview() {
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
    return rows;
  }

  function overviewMapMeters() {
    const priority = { dispatch: 1, confirmed: 2, suspect_auto: 3, customer_side: 4, watch: 5, learning: 6, seasonal: 7, noise: 8, normal: 9, repaired: 10, ignored: 11 };
    return currentRowsForOverview()
      .filter((meter) => mapFilterMatch(meter))
      .sort((a, b) => (priority[a.category] || 20) - (priority[b.category] || 20) || (b.enginePriority || b.risk || 0) - (a.enginePriority || a.risk || 0));
  }

  function mapFilterMatch(meter) {
    if (mapCategoryFilter === "all") return true;
    if (mapCategoryFilter === "suspect") return ["suspect_auto", "watch"].includes(meter.category);
    if (mapCategoryFilter === "field") return ["dispatch", "suspect_auto", "watch", "confirmed", "customer_side"].includes(meter.category);
    return meter.category === mapCategoryFilter;
  }

  function mapFilterLabel() {
    return {
      all: "Alla",
      field: "Fältläge",
      dispatch: "Åk ut",
      suspect: "Bevakning",
      confirmed: "Aktiva läckor",
      customer_side: "Efter mätare",
    }[mapCategoryFilter] || "Alla";
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

  function ensureMapCategoryControls() {
    const toolbar = document.querySelector(".map-toolbar");
    if (!toolbar || document.getElementById("mapCategoryControls")) return;
    const controls = document.createElement("div");
    controls.id = "mapCategoryControls";
    controls.className = "map-category-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Visa mätare på kartan");
    controls.innerHTML = [
      ["field", "Fält"],
      ["dispatch", "Åk ut"],
      ["suspect", "Bevakning"],
      ["confirmed", "Aktiva"],
      ["customer_side", "Efter"],
      ["all", "Alla"],
    ].map(([value, label]) => `<button type="button" class="secondary" data-map-filter="${value}">${label}</button>`).join("");
    toolbar.prepend(controls);
    controls.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-map-filter]");
      if (!button) return;
      applyMapCategoryFilter(button.dataset.mapFilter);
    });
    updateMapCategoryButtons();
  }

  function applyMapCategoryFilter(filter) {
    const valid = new Set(["field", "dispatch", "suspect", "confirmed", "customer_side", "all"]);
    mapCategoryFilter = valid.has(filter) ? filter : "field";
    els.filter.value = "all";
    selectedMeters.clear();
    selectedPreviewId = "";
    clearSelectionRectangle();
    updateMapCategoryButtons();
    render();
  }

  function updateMapCategoryButtons() {
    document.querySelectorAll("[data-map-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mapFilter === mapCategoryFilter);
    });
  }

  function ensureMapDrawingControls() {
    const toolbar = document.querySelector(".map-toolbar");
    if (!toolbar || document.getElementById("mapDrawingControls")) return;
    const controls = document.createElement("div");
    controls.id = "mapDrawingControls";
    controls.className = "map-drawing-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Markera på kartan");
    controls.innerHTML = `
      <button type="button" class="secondary" data-map-tool="select" title="Dra en ruta runt flera mätare">▣ Välj ruta</button>
      <button type="button" class="secondary" data-map-tool="valve" title="Klicka sedan på ventilens position">◉ Ventil</button>
      <button type="button" class="secondary leak-tool" data-map-tool="leak" title="Klicka sedan där läckan hittades">× Läckpunkt</button>
      <button type="button" class="secondary clear-map-marks" data-map-tool="clear" title="Rensa ventil och läckpunkt">Rensa märken</button>
    `;
    const locate = document.getElementById("locateMe");
    toolbar.insertBefore(controls, locate || null);
    controls.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-map-tool]");
      if (!button) return;
      const tool = button.dataset.mapTool;
      if (tool === "clear") {
        clearMapMarks();
        return;
      }
      setMapToolMode(mapToolMode === tool ? "" : tool);
    });
    updateMapToolButtons();
  }

  function activeMapMeter() {
    return state.meters.find((meter) => meter.id === selectedPreviewId)
      || state.meters.find((meter) => selectedMeters.has(meter.id))
      || null;
  }

  function updateMapToolButtons() {
    document.querySelectorAll("[data-map-tool]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mapTool === mapToolMode);
      button.setAttribute("aria-pressed", String(button.dataset.mapTool === mapToolMode));
    });
    const mapElement = document.getElementById("selectedMap");
    if (mapElement) {
      mapElement.dataset.mapTool = mapToolMode;
      mapElement.classList.toggle("is-map-marking", Boolean(mapToolMode));
    }
  }

  function setMapToolMode(mode) {
    const next = ["select", "valve", "leak"].includes(mode) ? mode : "";
    if (["valve", "leak"].includes(next) && !activeMapMeter()) {
      setMapStatus("Välj först en mätare som ventil/läckpunkt ska kopplas till.");
      return;
    }
    mapToolMode = next;
    selectionStart = null;
    if (previewMap?.dragging) {
      if (mapToolMode === "select") previewMap.dragging.disable();
      else previewMap.dragging.enable();
    }
    updateMapToolButtons();
    if (mapToolMode === "select") setMapStatus("Dra en ruta runt mätarna du vill markera. Esc avbryter.");
    if (mapToolMode === "valve") setMapStatus("Klicka på kartan där ventilen ligger. Punkten kan sedan dras.");
    if (mapToolMode === "leak") setMapStatus("Klicka på kartan där läckan hittades. Avståndet räknas automatiskt.");
  }

  function clearSelectionRectangle() {
    if (selectionRectangle && previewMap) previewMap.removeLayer(selectionRectangle);
    selectionRectangle = null;
    selectionStart = null;
  }

  function clearMapMarks() {
    const meter = activeMapMeter();
    if (!meter) {
      setMapStatus("Välj en mätare vars kartmarkering ska rensas.");
      return;
    }
    delete mapMarks[meter.id];
    saveMapMarks();
    renderMapAnnotations(meter, mapCoordinates.get(meter.id));
    renderMapInspector(meter);
    setMapToolMode("");
    setMapStatus("Ventil och läckpunkt rensades för vald mätare.");
  }

  function refreshMarkDistances(meter, mark) {
    const meterPoint = mapCoordinates.get(meter.id);
    mark.distanceFromMeter = mark.leak && meterPoint && window.LeakMapTools
      ? LeakMapTools.roundedDistance(meterPoint, mark.leak)
      : null;
    mark.distanceValveToLeak = mark.leak && mark.valve && window.LeakMapTools
      ? LeakMapTools.roundedDistance(mark.valve, mark.leak)
      : null;
    mark.updatedAt = new Date().toISOString();
  }

  function saveMapPoint(meter, kind, latlng) {
    const mark = mapMarks[meter.id] || {};
    mark[kind] = { lat: latlng.lat, lng: latlng.lng };
    refreshMarkDistances(meter, mark);
    mapMarks[meter.id] = mark;
    saveMapMarks();
    renderMapAnnotations(meter, mapCoordinates.get(meter.id));
    renderMapInspector(meter);
    const label = kind === "valve" ? "Ventilen" : "Läckpunkten";
    const distance = kind === "leak" && Number.isFinite(mark.distanceFromMeter)
      ? ` · ca ${mark.distanceFromMeter} m från husnumrets kartpunkt`
      : "";
    setMapStatus(`${label} markerades${distance}. Dra punkten för att finjustera.`);
  }

  function annotationIcon(kind) {
    const leak = kind === "leak";
    return L.divIcon({
      className: `map-annotation-icon ${kind}`,
      html: `<span>${leak ? "×" : "V"}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  function annotationMarker(meter, kind, point) {
    const marker = L.marker(point, {
      icon: annotationIcon(kind),
      draggable: true,
      keyboard: true,
      title: kind === "leak" ? "Markerad läckpunkt" : "Markerad ventil",
      zIndexOffset: kind === "leak" ? 1200 : 1100,
    }).addTo(previewAnnotationLayer);
    marker.bindTooltip(kind === "leak" ? "Läckpunkt" : "Ventil", { direction: "top", offset: [0, -14] });
    marker.on("dragend", () => saveMapPoint(meter, kind, marker.getLatLng()));
    return marker;
  }

  function renderMapAnnotations(meter, coordinates) {
    if (!previewAnnotationLayer || !window.L) return;
    previewAnnotationLayer.clearLayers();
    if (!meter) return;
    const mark = mapMarks[meter.id];
    if (!mark) return;
    if (mark.valve) annotationMarker(meter, "valve", mark.valve);
    if (mark.leak) annotationMarker(meter, "leak", mark.leak);
    if (coordinates && mark.leak) {
      L.polyline([[coordinates.lat, coordinates.lng], mark.leak], {
        color: "#e11d48",
        weight: 3,
        dashArray: "8 7",
        opacity: .9,
        interactive: false,
      }).addTo(previewAnnotationLayer);
    }
    if (mark.valve && mark.leak) {
      L.polyline([mark.valve, mark.leak], {
        color: "#0f766e",
        weight: 4,
        opacity: .9,
        interactive: false,
      }).addTo(previewAnnotationLayer);
    }
  }

  function handleMapClick(event) {
    if (ignoreNextMapClick) {
      ignoreNextMapClick = false;
      return;
    }
    if (!["valve", "leak"].includes(mapToolMode)) return;
    const meter = activeMapMeter();
    if (!meter) return;
    const kind = mapToolMode;
    saveMapPoint(meter, kind, event.latlng);
    setMapToolMode("");
  }

  function startAreaSelection(event) {
    if (mapToolMode !== "select" || event.originalEvent?.button !== 0) return;
    clearSelectionRectangle();
    selectionStart = event.latlng;
    selectionRectangle = L.rectangle([selectionStart, selectionStart], {
      color: "#0f766e",
      weight: 2,
      dashArray: "7 5",
      fillColor: "#14b8a6",
      fillOpacity: .14,
      interactive: false,
    }).addTo(previewMap);
  }

  function moveAreaSelection(event) {
    if (!selectionStart || !selectionRectangle) return;
    selectionRectangle.setBounds(L.latLngBounds(selectionStart, event.latlng));
  }

  function finishAreaSelection(event) {
    if (!selectionStart || !selectionRectangle || !window.LeakMapTools) return;
    selectionRectangle.setBounds(L.latLngBounds(selectionStart, event.latlng));
    const bounds = selectionRectangle.getBounds();
    const selectedIds = LeakMapTools.idsWithinBounds(previewMapEntries, {
      southWest: bounds.getSouthWest(),
      northEast: bounds.getNorthEast(),
    });
    selectionStart = null;
    ignoreNextMapClick = true;
    mapToolMode = "";
    previewMap.dragging.enable();
    updateMapToolButtons();
    selectedMeters.clear();
    selectedIds.forEach((id) => selectedMeters.add(id));
    selectedPreviewId = selectedIds[0] || "";
    if (!selectedIds.length) {
      setMapStatus("Ingen synlig mätare låg i rutan. Zooma närmare eller välj en större ruta.");
      return;
    }
    render();
    setMapStatus(`${selectedIds.length} mätare markerade i rutan.`);
  }

  function ensurePreviewMap() {
    const mapElement = document.getElementById("selectedMap");
    ensureMapCategoryControls();
    ensureMapDrawingControls();
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
      doubleClickZoom: true,
      touchZoom: true,
      scrollWheelZoom: window.innerWidth > 760,
      dragging: true,
      boxZoom: true,
      maxBounds: [[59.05, 17.55], [59.35, 18.15]],
      maxBoundsViscosity: .7,
    }).setView([59.20, 17.83], 12);
    previewBaseLayer = previewMapLayers[previewMapStyle];
    previewBaseLayer.addTo(previewMap);
    previewMarkerLayer = L.layerGroup().addTo(previewMap);
    previewAnnotationLayer = L.layerGroup().addTo(previewMap);
    previewMap.on("click", handleMapClick);
    previewMap.on("mousedown", startAreaSelection);
    previewMap.on("mousemove", moveAreaSelection);
    previewMap.on("mouseup", finishAreaSelection);
    updateMapStyleButtons();
    return previewMap;
  }

  function focusPreviewMap(includeUser = false, overviewMode = false) {
    if (!previewMap || !window.L) return;
    const points = [...previewMapPoints];
    if (includeUser && previewUserLatLng) points.push(previewUserLatLng);
    const resize = () => {
      previewMap.invalidateSize({ pan: false });
      if (!points.length) {
        if (overviewMode) previewMap.setView([59.20, 17.83], 12);
        return;
      }
      if (overviewMode) {
        const bounds = L.latLngBounds(points);
        previewMap.fitBounds(bounds, { padding: [18, 18], maxZoom: 13 });
        return;
      }
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
    if (!selectedMeters.size && !selectedPreviewId) {
      chips.innerHTML = "";
      return;
    }
    const meters = selectedMeterList();
    chips.innerHTML = meters.map((meter) => `
      <button type="button" class="meter-chip${meter.id === selectedPreviewId ? " active" : ""}" data-preview-meter="${escapeAttr(meter.id)}" title="${escapeAttr(meter.address || meter.id)}">
        ${escapeHtml(shortMapLabel(meter))}
      </button>
    `).join("");
  }

  function ensureMapInspector() {
    const preview = document.getElementById("meterPreview");
    if (!preview || document.getElementById("mapInspector")) return;
    const inspector = document.createElement("aside");
    inspector.id = "mapInspector";
    inspector.className = "map-inspector";
    inspector.setAttribute("aria-label", "Mätare i kartvyn");
    inspector.innerHTML = `
      <div class="map-inspector-head">
        <div><span id="mapInspectorEyebrow">MÄTARE I KARTVYN</span><b id="mapInspectorTitle">Prioriterad kö</b></div>
        <strong id="mapInspectorCount">0</strong>
      </div>
      <div id="mapMeasurement" class="map-measurement" hidden></div>
      <div id="mapInspectorActions" class="map-inspector-actions" hidden>
        <button type="button" class="secondary" data-inspector-action="navigate">Kör hit</button>
        <button type="button" class="secondary confirm-leak" data-inspector-action="confirm-leak">Hittad läcka</button>
        <button type="button" class="secondary" data-inspector-action="clear-selection">Visa kartkö</button>
      </div>
      <div id="mapInspectorList" class="map-inspector-list"></div>
    `;
    preview.appendChild(inspector);
    inspector.addEventListener("click", (event) => {
      const card = event.target.closest("button[data-map-inspector-meter]");
      if (card) {
        const id = card.dataset.mapInspectorMeter;
        clearSelectionRectangle();
        if (event.shiftKey) {
          if (selectedMeters.has(id)) selectedMeters.delete(id);
          else selectedMeters.add(id);
          selectedPreviewId = selectedMeters.has(id) ? id : ([...selectedMeters].at(-1) || "");
        } else if (selectedMeters.size > 1 && selectedMeters.has(id)) {
          selectedPreviewId = id;
        } else {
          selectedMeters.clear();
          selectedMeters.add(id);
          selectedPreviewId = id;
        }
        render();
        return;
      }
      const action = event.target.closest("button[data-inspector-action]")?.dataset.inspectorAction;
      if (!action) return;
      if (action === "clear-selection") {
        selectedMeters.clear();
        selectedPreviewId = "";
        clearSelectionRectangle();
        render();
      }
      if (action === "navigate" && selectedPreviewId) window.openMeterNavigation(selectedPreviewId, event);
      if (action === "confirm-leak" && selectedPreviewId) {
        const mark = mapMarks[selectedPreviewId];
        window.labelMeter(selectedPreviewId, "leak");
        const field = document.getElementById("distanceMeters");
        if (field && Number.isFinite(mark?.distanceFromMeter)) field.value = String(mark.distanceFromMeter);
      }
    });
  }

  function mapMeterCard(meter, selected) {
    const status = categoryText[meter.category] || meter.category;
    const current = round(meter.last?.current);
    const persistence = meter.engine?.persistenceDays || 0;
    return `
      <button type="button" class="map-meter-card${selected ? " active" : ""}" data-map-inspector-meter="${escapeAttr(meter.id)}">
        <span class="map-card-status ${escapeAttr(meter.category)}"><i></i>${escapeHtml(status)}</span>
        <b>${escapeHtml(shortMapLabel(meter))}</b>
        <span class="map-card-meta">${escapeHtml(meter.serial || meter.id)} · ${escapeHtml(meter.area || "ÖVRIGT")}</span>
        <span class="map-card-numbers"><strong>${meter.risk}</strong><small>risk</small><strong>${current}</strong><small>brus E</small>${persistence ? `<strong>${persistence}</strong><small>dagar</small>` : ""}</span>
      </button>
    `;
  }

  function renderMapInspector(meter) {
    ensureMapInspector();
    const list = document.getElementById("mapInspectorList");
    const title = document.getElementById("mapInspectorTitle");
    const eyebrow = document.getElementById("mapInspectorEyebrow");
    const count = document.getElementById("mapInspectorCount");
    const actions = document.getElementById("mapInspectorActions");
    const measurement = document.getElementById("mapMeasurement");
    if (!list || !title || !eyebrow || !count || !actions || !measurement) return;

    const rows = meter ? selectedMeterList() : overviewMapMeters();
    eyebrow.textContent = meter ? "MARKERADE MÄTARE" : "MÄTARE I KARTVYN";
    title.textContent = meter
      ? (rows.length > 1 ? `${rows.length} markerade` : "Vald mätare")
      : `${mapFilterLabel()} · prioriterad kö`;
    count.textContent = String(rows.length);
    actions.hidden = !meter;

    const mark = meter ? mapMarks[meter.id] : null;
    if (meter && (mark?.valve || mark?.leak)) {
      const parts = [];
      if (mark.valve) parts.push("Ventil markerad");
      if (mark.leak && Number.isFinite(mark.distanceFromMeter)) parts.push(`Läckpunkt ca ${mark.distanceFromMeter} m från husnumret`);
      if (Number.isFinite(mark.distanceValveToLeak)) parts.push(`${mark.distanceValveToLeak} m ventil–läcka`);
      measurement.hidden = false;
      measurement.innerHTML = `<b>Kartmätning</b><span>${parts.map(escapeHtml).join(" · ")}</span><small>Ungefärligt fågelvägsavstånd från kartpunkterna.</small>`;
    } else {
      measurement.hidden = true;
      measurement.innerHTML = "";
    }

    if (!rows.length) {
      list.innerHTML = `<p class="map-inspector-empty">Inga mätare matchar sökningen och kartfiltret.</p>`;
      return;
    }
    list.innerHTML = rows.slice(0, 100).map((row) => mapMeterCard(row, row.id === selectedPreviewId)).join("");
    if (rows.length > 100) list.insertAdjacentHTML("beforeend", `<p class="map-inspector-empty">Visar de 100 högst prioriterade av ${rows.length}.</p>`);
  }

  async function renderSelectedMap() {
    const version = ++mapRenderVersion;
    const meters = selectedMeterList();
    renderSelectedChips();
    const map = ensurePreviewMap();
    if (!map || !previewMarkerLayer) return;
    previewMarkerLayer.clearLayers();
    previewMapPoints = [];
    previewMapEntries = [];
    if (!meters.length) {
      setMapStatus("");
      return;
    }
  
    const overviewMode = !selectedMeters.size && !selectedPreviewId;
    const cachedLocated = [];
    for (const meter of meters) {
      const cached = geocodeCache[geocodeKey(meter)];
      if (Number.isFinite(cached?.lat) && Number.isFinite(cached?.lng)) {
        cachedLocated.push({ meter, coordinates: { lat: cached.lat, lng: cached.lng, label: cached.label || addressForMap(meter) } });
      }
    }
    const geocodeLimit = overviewMode ? 80 : meters.length;
    const queue = meters
      .filter((meter) => !cachedLocated.some((hit) => hit.meter.id === meter.id))
      .slice(0, Math.max(0, geocodeLimit - cachedLocated.length));
    const located = [...cachedLocated];

    if (overviewMode) {
      setMapStatus(cachedLocated.length
        ? `${cachedLocated.length} GPS-positioner visas · fyller på prioriterade mätare...`
        : "Bygger Botkyrka-karta · hämtar GPS för prioriterade mätare...");
    } else {
      setMapStatus(meters.length > 1 ? `Hämtar GPS för ${meters.length} markerade adresser...` : "Hämtar GPS-position...");
    }

    for (let index = 0; index < queue.length; index += 1) {
      if (version !== mapRenderVersion) return;
      setMapStatus(overviewMode
        ? `Fyller karta ${located.length}/${meters.length} · GPS ${index + 1}/${queue.length}`
        : `Hämtar GPS ${index + 1}/${queue.length}`);
      try {
        const coordinates = await geocodeMeter(queue[index]);
        if (coordinates) located.push({ meter: queue[index], coordinates });
      } catch (error) {
        if (version === mapRenderVersion) setMapStatus(error.message || "GPS-sökningen misslyckades.");
      }
    }
    if (version !== mapRenderVersion) return;
  
    previewMarkerLayer.clearLayers();
    for (const { meter, coordinates } of located) {
      const point = [coordinates.lat, coordinates.lng];
      previewMapPoints.push(point);
      previewMapEntries.push({ id: meter.id, lat: coordinates.lat, lng: coordinates.lng });
      mapCoordinates.set(meter.id, coordinates);
      const selected = selectedMeters.has(meter.id) || meter.id === selectedPreviewId;
      const marker = L.circleMarker(point, {
        radius: selected ? 12 : (overviewMode ? 5.5 : 8),
        color: selected ? "#111827" : "#ffffff",
        weight: selected ? 4 : (overviewMode ? 1.5 : 3),
        fillColor: mapMarkerColor(meter.category),
        fillOpacity: selected ? 1 : .9,
      });
      marker.bindTooltip(shortMapLabel(meter), {
        permanent: !overviewMode && located.length <= 8,
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
        clearSelectionRectangle();
        selectedPreviewId = meter.id;
        selectedMeters.clear();
        selectedMeters.add(meter.id);
        render();
      });
      marker.addTo(previewMarkerLayer);
    }

    renderMapAnnotations(activeMapMeter(), activeMapMeter() ? mapCoordinates.get(activeMapMeter().id) : null);
  
    if (!located.length) {
      setMapStatus("GPS-position saknas. Kör hit söker direkt på adressen.");
      previewMap.setView([59.20, 17.83], 12);
      return;
    }
    focusPreviewMap(false, overviewMode);
    setMapStatus(overviewMode
      ? `${mapFilterLabel()}: ${located.length} av ${meters.length} på kartan · klicka en plupp för graf`
      : (located.length === meters.length
        ? `${located.length} markerade adresser på kartan · OpenStreetMap`
        : `${located.length} av ${meters.length} adresser hittades · OpenStreetMap`));
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
      firstDate: firstPoint?.date ? localDate(firstPoint.date) : "-",
      lastDate: lastPoint?.date ? localDate(lastPoint.date) : "-",
      lastReadDate: lastPoint?.readAt ? localDate(lastPoint.readAt) : "-",
    };
  }

  function chartDatasets(meter, staleDays) {
    const staleMarker = meter.points.map((p, index) => (index === meter.points.length - 1 && staleDays >= 14 ? p.current : null));

    return [
      { label: "Brus E", data: meter.points.map((p) => p.current), borderColor: "#0284c7", backgroundColor: "rgba(14,165,233,.18)", fill: true, tension: .14, pointRadius: meter.points.length > 50 ? 0 : 2 },
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
              const read = point?.readAt instanceof Date ? localDate(point.readAt) : "";
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
            autoSkip: true,
            maxTicksLimit: window.innerWidth < 640 ? 4 : 6,
          },
          grid: { color: "rgba(100,116,139,.14)" },
        },
        y: { beginAtZero: true, grace: "8%", ticks: { color: "#475569", maxTicksLimit: 7 }, grid: { color: "rgba(100,116,139,.18)" } },
      },
    };
  }

  function renderSelectedPreview() {
    const box = document.getElementById("meterPreview");
    const canvas = document.getElementById("selectedChart");
    if (!box || !canvas) return;
    const meter = state.meters.find((item) => item.id === selectedPreviewId);
    box.hidden = state.meters.length === 0;
    box.classList.toggle("overview-map", !meter);
    if (!meter) {
      if (state.previewChart) state.previewChart.destroy();
      state.previewChart = null;
      const rows = overviewMapMeters();
      document.getElementById("previewTitle").textContent = "Karta över mätare";
      document.getElementById("previewMeta").textContent = rows.length
        ? `${mapFilterLabel()}: ${rows.length} mätare på kartan · klicka en plupp för graf och åtgärder`
        : `${mapFilterLabel()}: inga mätare i kartfiltret`;
      renderMapInspector(null);
      renderSelectedMap().catch((error) => {
        setMapStatus(error.message || "Kartan kunde inte uppdateras.");
      });
      return;
    }
  
    const dates = meterDates(meter);
    const staleDays = meter.staleReadDays || 0;
    const selectedCount = selectedMeterList().length;
    document.getElementById("previewTitle").textContent = meter.address || meter.id;
    document.getElementById("previewMeta").textContent = `${categoryText[meter.category]} · risk ${meter.risk} · ${dates.firstDate} till ${dates.lastDate}${staleDays >= 14 ? ` · tappad kontakt ${staleDays} dagar` : ""}${selectedCount > 1 ? ` · ${selectedCount} mätare på kartan` : ""}`;
    if (state.previewChart) state.previewChart.destroy();
    const labels = meter.points.map((point) => localDate(point.date));
    state.previewChart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets: chartDatasets(meter, staleDays) },
      options: chartOptions(labels, meter),
    });
    renderMapInspector(meter);
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
    const labels = meter.points.map((p) => localDate(p.date));
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
      const mark = mapMarks[id];
      if (mark?.leak) {
        next.distanceMeters = Number.isFinite(mark.distanceFromMeter) ? mark.distanceFromMeter : null;
        next.valveToLeakMeters = Number.isFinite(mark.distanceValveToLeak) ? mark.distanceValveToLeak : null;
        next.mapMarks = { valve: mark.valve || null, leak: mark.leak };
        next.distanceUncertain = true;
      }
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
    clearSelectionRectangle();
    currentPage = 1;
    render();
  });
  els.search?.addEventListener("input", () => {
    currentPage = 1;
    const mapSearch = document.getElementById("mapSearch");
    if (mapSearch && mapSearch !== document.activeElement) mapSearch.value = els.search.value;
  }, true);
  els.sort?.addEventListener("change", () => { currentPage = 1; }, true);
  document.getElementById("clearSelection")?.addEventListener("click", () => {
    selectedMeters.clear();
    selectedPreviewId = "";
    clearSelectionRectangle();
    setMapToolMode("");
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
  updateMapCategoryButtons();
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
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !mapToolMode) return;
    clearSelectionRectangle();
    setMapToolMode("");
    setMapStatus("Kartverktyget avbröts.");
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
