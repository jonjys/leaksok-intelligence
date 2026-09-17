(function applyFieldWorkflow() {
  const workflowTypes = {
    leak: "Konstaterad läcka",
    repaired: "Lagade",
    seasonal: "Säsong / falsklarm",
    known_noise: "Falsklarm/Annat",
    district_heating: "Fjärrvärme",
    large_building: "Höghus/stor byggnad",
    pump: "Undercentral/pumpar",
    false_alarm: "Falsklarm/Annat",
    suspect: "Misstänk",
    watch: "Bevaka",
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
  let feedbackBatchIds = [];
  const GEOCODE_CACHE_KEY = "leaksok_geocode_v2_exact";
  const MAP_MARKS_KEY = "leaksok_map_marks_v1";
  const BOTKYRKA_BOUNDS = [[59.065, 17.54], [59.29, 18.035]];
  const BOTKYRKA_CENTER = [59.18, 17.80];
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
  let lastFilteredRows = [];
  let contextMeterId = "";
  let previewChartRenderVersion = 0;
  let previewChartResizeObserver = null;
  let detailChartRenderVersion = 0;
  const signalRanges = new Map();

  Object.assign(categoryText, {
    confirmed: "HITTAD LÄCKA",
    customer_side: "EFTER MÄTARE",
    seasonal: "VÄRMEPANNA / SÄSONG",
    noise: "FALSKLARM / STÖRNING",
    ignored: "IGNORERAD",
    dispatch: "ÅK UT · PRIORITERAD",
    suspect_auto: "MISSTÄNK",
    learning: "NY MÄTARE",
  });

  function decisionText(meter) {
    if (meter?.category === "confirmed") return "HITTAD LÄCKA";
    if (meter?.category === "dispatch" && meter?.label?.type === "manual_dispatch") return "ÅK UT · MANUELL";
    return categoryText[meter?.category] || meter?.category || "";
  }
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
    seasonal: "Säsong / falsklarm",
    false_alarm: "Falsklarm/Annat",
    suspect: "Misstänkt / bevaka",
  });
  const listLabels = {
    all: "Alla mätare",
    dispatch: "Åk ut",
    suspect: "Misstänkt / bevaka",
    seasonal: "Säsong / falsklarm",
    confirmed: "Aktiva läckor",
    customer_side: "Efter mätare",
    repaired: "Lagad",
    ignored: "Ignorera",
    stale_contact: "Utan avläsning",
    noise: "Falsklarm/störning",
    hidden: "Gömda",
  };
  document.querySelectorAll('#filter option[value="normal"]').forEach((option) => option.remove());

  const originalHandleFiles = handleFiles;
  handleFiles = async function handleFilesAndResetChartRanges(files) {
    signalRanges.clear();
    const result = await originalHandleFiles(files);
    signalRanges.clear();
    return result;
  };

  const originalScoreMeter = scoreMeter;
  scoreMeter = function scoreMeterWithFieldLists(meter, networkContext) {
    const result = originalScoreMeter(meter, networkContext);
    const label = state.labels[meter.id]?.type ? state.labels[meter.id] : null;
    const observedPoints = readingTimeline(meter.points).points;
    const newMeter = observedPoints.length <= 1 || (result.profile?.coverage?.days ?? 0) <= 1;
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
      else if (newMeter) result.category = "learning";
      else result.category = "normal";
    }
    if (!label && newMeter && result.category === "normal" && !customerSide && !staleContact) {
      result.category = "learning";
    }
    if (!label && !newMeter && ["learning", "new_high", "new_unknown"].includes(result.category)) {
      if (result.risk >= 58 && !customerSide) result.category = "dispatch";
      else if (result.risk >= 38 || result.lowRelativeRise) result.category = "suspect_auto";
      else result.category = "normal";
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

  function matchesFilter(row, filter) {
    if (filter === "ignored") return row.category === "ignored" && !MeterVisibility.hidden(state.labels[row.id]);
    if (!MeterVisibility.visible(state.labels[row.id], filter)) return false;
    if (filter === "seasonal") return ["seasonal", "noise"].includes(row.category);
    if (filter === "hidden") return true;
    if (filter === "all") return true;
    if (filter === "actionable") return ["dispatch", "suspect_auto", "watch"].includes(row.category);
    if (filter === "suspect") return row.category === "suspect_auto";
    if (filter === "learning") return ["learning", "new_high", "new_unknown"].includes(row.category);
    if (filter === "confirmed") return row.category === "confirmed";
    if (filter === "stale_contact") return row.staleContact || row.staleReadDays >= 14;
    return row.category === filter;
  }

  const districts = [
    ["Alby", ["ALBY"]],
    ["Fittja", ["FITTJA", "FITJA"]],
    ["Hallunda-Norsborg", ["HALLUNDA", "NORSBORG"]],
    ["Tullinge", ["TULLINGE"]],
    ["Tumba-Storvreten", ["TUMBA", "STORVRETEN"]],
    ["Vårsta-Grödinge", ["VÅRSTA", "GRÖDINGE"]],
  ];
  function meterTown(row) {
    const area = normalize(row.area || "");
    const address = normalize(row.address || "");
    // Prefer the explicit locality. Avoid interpreting street names as districts.
    const match = (text) => districts.find(([,names]) => names.some(name => new RegExp("(^|[^a-zåäö])" + normalize(name) + "($|[^a-zåäö])", "i").test(text)));
    return (match(area) || match(address))?.[0] || "Övrigt / okänd";
  }
  function refreshAreaFilter() {
    const select = document.getElementById("areaFilter");
    if (!select) return;
    const current = select.value || "all";
    const towns = [...districts.map(([name])=>name), "Övrigt / okänd"];
    const signature = towns.join("|");
    if (select.dataset.signature !== signature) {
      select.innerHTML = '<option value="all">Alla kommundelar</option>' + towns.map(town => '<option value="' + escapeAttr(normalize(town)) + '">' + escapeHtml(town) + '</option>').join("");
      select.dataset.signature = signature;
    }
    select.value = [...select.options].some(option=>option.value===current) ? current : "all";
  }

  function latestReadingTime(row) {
    const point = row.points?.[row.points.length - 1] || row.last;
    const date = point?.readAt || point?.date;
    const time = date instanceof Date ? date.getTime() : new Date(date || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function compareRows(a, b, sort) {
    if (sort === "group") {
      const order = { dispatch:0, suspect_auto:1, watch:1, confirmed:2, repaired:3, seasonal:4, noise:4, customer_side:5, ignored:7 };
      return (order[a.category] ?? 6) - (order[b.category] ?? 6) || sortValue(b, "risk") - sortValue(a, "risk");
    }
    if (sort === "name") return String(a.address || a.serial || a.id).localeCompare(String(b.address || b.serial || b.id), "sv", { numeric: true, sensitivity: "base" });
    if (sort === "area") {
      const area = String(a.area || "").localeCompare(String(b.area || ""), "sv", { sensitivity: "base" });
      return area || String(a.address || a.id).localeCompare(String(b.address || b.id), "sv", { numeric: true, sensitivity: "base" });
    }
    if (sort === "lastRead") return latestReadingTime(b) - latestReadingTime(a);
    return sortValue(b, sort) - sortValue(a, sort);
  }

  function matchingRows() {
    const searchTerms = terms(els.search.value);
    const filter = els.filter.value;
    const sort = els.sort.value;
    const area = document.getElementById("areaFilter")?.value || "all";
    const excluded = Array.from(document.querySelectorAll('#excludeFilter input:checked'), (input) => input.value);
    const rows = state.meters
      .filter((row) => matchesFilter(row, filter))
      .filter((row) => area === "all" || normalize(meterTown(row)) === area)
      .filter((row) => filter === "hidden" || !excluded.some((group) => matchesFilter(row, group)))
      .filter((row) => !searchTerms.length || matches(row, searchTerms));
    rows.sort((a, b) => compareRows(a, b, sort));
    return rows;
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
    if (save) save.textContent = selectedCount > 0 ? `Flytta ${selectedCount} till vald grupp` : `Flytta ${rows.length} till vald grupp`;
    const hide = document.getElementById("hideSelected");
    if (hide) {
      hide.disabled = selectedCount === 0;
      hide.textContent = els.filter.value === "hidden" ? "Visa markerade igen" : "Göm markerade";
    }
  }

  function updateSelectionControls() {
    const selectAll = document.getElementById("selectAllMatches");
    const clearAll = document.getElementById("clearAllSelection");
    const allSelected = lastFilteredRows.length > 0 && lastFilteredRows.every((row) => selectedMeters.has(row.id));
    if (selectAll) {
      selectAll.disabled = lastFilteredRows.length === 0;
      selectAll.textContent = allSelected ? `${lastFilteredRows.length} markerade` : `Markera alla ${lastFilteredRows.length || ""}`.trim();
      selectAll.classList.toggle("active", allSelected);
    }
    if (clearAll) {
      clearAll.hidden = selectedMeters.size === 0;
      clearAll.textContent = `Avmarkera (${selectedMeters.size})`;
    }
  }

  function quickAssignMeters(ids, type) {
    const meters = ids.map((id) => state.meters.find((meter) => meter.id === id)).filter(Boolean);
    if (!meters.length) return;
    if (["leak", "repaired"].includes(type)) {
      window.labelMeter(meters[0].id, type);
      feedbackBatchIds = meters.map(m => m.id);
      if (meters.length > 1) document.getElementById("feedbackAddress").textContent = `${meters.length} markerade mätare · samma fältuppgifter sparas på alla`;
      closeMeterContextMenu();
      return;
    }
    const now = new Date().toISOString();
    const today = localDate(new Date());
    for (const meter of meters) {
      if (type === "auto") {
        state.labels[meter.id] = MeterVisibility.update({}, MeterVisibility.hidden(state.labels[meter.id]));
        continue;
      }
      const existing = state.labels[meter.id] || {};
      const next = {
        ...existing,
        type,
        hidden: false,
        address: meter.address || existing.address,
        serial: meter.serial || existing.serial,
        notedDate: existing.notedDate || today,
        at: now,
        source: "snabbgruppering",
      };
      if (type === "leak") next.confirmedDate = existing.confirmedDate || today;
      if (type === "repaired") next.repairedDate = existing.repairedDate || today;
      if (type === "reset_baseline") next.resetAfter = now;
      if (bulkDefaults[type]?.length) next.noiseTags = [...new Set([...(existing.noiseTags || []), ...bulkDefaults[type]])];
      state.labels[meter.id] = next;
    }
    saveLabels();
    closeMeterContextMenu();
    analyze();
    els.importStatus.textContent = `${meters.length} mätare sparade i ${type === "auto" ? "Automatisk bedömning" : (workflowTypes[type] || type)}.`;
  }

  window.quickGroupMeter = function quickGroupMeter(id, type) {
    if (!id || !type) return;
    quickAssignMeters([id], type);
  };

  function ensureMeterContextMenu() {
    let menu = document.getElementById("meterContextMenu");
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "meterContextMenu";
    menu.className = "meter-context-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div class="context-menu-head"><span>SNABBVAL</span><b id="contextMeterName">Mätare</b></div>
      <button type="button" data-context-action="show">Visa graf</button>
      <button type="button" data-context-action="toggle">Avmarkera</button>
      <button type="button" data-context-action="visibility">Göm markerade</button>
      <label for="contextGroupSelect">Lägg i grupp</label>
      <select id="contextGroupSelect">
        <option value="suspect">Misstänk</option>
        <option value="interesting">Bevaka</option>
        <option value="known_noise">Tillfällig topp / störning</option>
        <option value="reset_baseline">Nollställ basnivå</option>
        <option value="manual_dispatch">Åk ut</option>
        <option value="customer_contact">Efter mätare</option>
        <option value="leak">Aktiva läckor</option>
        <option value="seasonal">Säsong / falsklarm</option>
        <option value="repaired">Lagad</option>
        <option value="ignored">Ignorera</option>
        <option value="auto">Automatisk bedömning</option>
      </select>
      <button type="button" class="context-save" data-context-action="save">Spara grupp</button>
    `;
    document.body.appendChild(menu);
    menu.addEventListener("click", (event) => {
      const action = event.target.closest("[data-context-action]")?.dataset.contextAction;
      if (!action || !contextMeterId) return;
      if (action === "show") {
        selectedPreviewId = contextMeterId;
        if (!selectedMeters.has(contextMeterId)) selectedMeters.add(contextMeterId);
        closeMeterContextMenu();
        render();
      }
      if (action === "toggle") {
        if (selectedMeters.has(contextMeterId)) selectedMeters.delete(contextMeterId);
        else selectedMeters.add(contextMeterId);
        selectedPreviewId = selectedMeters.has(contextMeterId) ? contextMeterId : ([...selectedMeters].at(-1) || "");
        closeMeterContextMenu();
        render();
      }
      if (action === "save") {
        const ids = selectedMeters.has(contextMeterId) ? [...selectedMeters] : [contextMeterId];
        quickAssignMeters(ids, document.getElementById("contextGroupSelect")?.value || "suspect");
      }
      if (action === "visibility") {
        const ids = selectedMeters.has(contextMeterId) ? [...selectedMeters] : [contextMeterId];
        setMetersHidden(ids, !MeterVisibility.hidden(state.labels[contextMeterId]));
      }
    });
    return menu;
  }

  function openMeterContextMenu(id, clientX, clientY) {
    const meter = state.meters.find((item) => item.id === id);
    if (!meter) return;
    if (!selectedMeters.has(id)) {
      selectedMeters.clear();
      selectedMeters.add(id);
    }
    selectedPreviewId = id;
    contextMeterId = id;
    render();
    const menu = ensureMeterContextMenu();
    const name = document.getElementById("contextMeterName");
    if (name) name.textContent = shortMapLabel(meter);
    const toggle = menu.querySelector('[data-context-action="toggle"]');
    if (toggle) toggle.textContent = selectedMeters.has(id) ? "Avmarkera" : "Markera";
    menu.querySelector('[data-context-action="visibility"]').textContent = MeterVisibility.hidden(state.labels[id])
      ? `Visa ${selectedMeters.size} igen` : `Göm ${selectedMeters.size} markerade`;
    const currentType = state.labels[id]?.type;
    const select = document.getElementById("contextGroupSelect");
    if (select) select.value = [...select.options].some((option) => option.value === currentType) ? currentType : "suspect";
    menu.hidden = false;
    const width = menu.offsetWidth || 290;
    const height = menu.offsetHeight || 410;
    menu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - height - 8))}px`;
  }

  function closeMeterContextMenu() {
    const menu = document.getElementById("meterContextMenu");
    if (menu) menu.hidden = true;
    contextMeterId = "";
  }

  function pageSize() {
    return Number(document.getElementById("pageSize")?.value || 50);
  }

  function setMetersHidden(ids, hidden) {
    for (const id of ids) state.labels[id] = MeterVisibility.update(state.labels[id], hidden);
    selectedMeters.clear();
    selectedPreviewId = "";
    currentPage = 1;
    closeMeterContextMenu();
    saveLabels();
    render();
    els.importStatus.textContent = hidden ? `${ids.length} mätare flyttade till Gömda. Facit och historik finns kvar.` : `${ids.length} mätare visas igen.`;
  }

  document.getElementById("hideSelected")?.addEventListener("click", () => {
    if (selectedMeters.size) setMetersHidden([...selectedMeters], els.filter.value !== "hidden");
  });

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
    refreshAreaFilter();
    const searchTerms = terms(els.search.value);
    const rows = matchingRows();
    lastFilteredRows = rows;
    renderPager(rows.length);
    const size = pageSize();
    const visibleRows = rows.slice((currentPage - 1) * size, currentPage * size);
    renderSummary();
    renderLabels();
    renderBulk(rows, searchTerms);
    renderRows(visibleRows);
    renderSelectedPreview();
    updateSelectionControls();
  };

  renderSummary = function renderFieldSummary() {
    const visibleMeters = state.meters.filter(m => !MeterVisibility.hidden(state.labels[m.id]));
    const counts = {
      meters: visibleMeters.length,
      dispatch: visibleMeters.filter((meter) => meter.category === "dispatch").length,
      watch: visibleMeters.filter((meter) => meter.category === "watch").length,
      suspect: visibleMeters.filter((meter) => meter.category === "suspect_auto").length,
      customer: visibleMeters.filter((meter) => meter.category === "customer_side").length,
      confirmed: visibleMeters.filter((meter) => meter.category === "confirmed").length,
      repaired: visibleMeters.filter((meter) => meter.category === "repaired").length,
      seasonal: visibleMeters.filter((meter) => meter.category === "seasonal").length,
      noise: visibleMeters.filter((meter) => meter.category === "noise").length,
      ignored: visibleMeters.filter((meter) => meter.category === "ignored").length,
      stale: visibleMeters.filter((meter) => meter.staleContact || meter.staleReadDays >= 14).length,
    };
    els.summary.innerHTML = `
      <div><b>${counts.meters}</b><span>mätare</span></div>
      <div><b>${counts.dispatch}</b><span>åk ut</span></div>
      <div><b>${counts.suspect + counts.watch}</b><span>misstänkt</span></div>
      <div><b>${counts.confirmed}</b><span>aktiva läckor</span></div>
    `;
    renderListTabs(counts);
    renderMapConsole(counts);
  };

  function ensureMapConsole() {
    document.getElementById("mapConsole")?.remove();
  }

  function renderMapConsole(counts) {
    ensureMapConsole();
  }

  function renderListTabs(counts) {
    const tabs = document.getElementById("listTabs");
    if (!tabs) return;
    const active = els.filter.value;
    const values = {
      all: state.meters.length, dispatch: counts.dispatch, suspect: counts.suspect, watch: counts.watch, customer_side: counts.customer,
      seasonal: counts.seasonal, confirmed: counts.confirmed, repaired: counts.repaired, ignored: counts.ignored, stale_contact: counts.stale, noise: counts.noise,
    };
    const secondary = ["seasonal", "noise", "ignored", "stale_contact"];
    Object.keys(values).forEach(key => { values[key] = state.meters.filter(m => matchesFilter(m, key)).length; });
    values.hidden = state.meters.filter(m => MeterVisibility.hidden(state.labels[m.id])).length;
    const moreCount = secondary.reduce((sum, key) => sum + (values[key] || 0), 0);
    tabs.querySelectorAll("button[data-filter]").forEach((button) => {
      const filter = button.dataset.filter;
      button.classList.toggle("active", filter === active);
      button.setAttribute("aria-pressed", String(filter === active));
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
      <tr data-meter-row="${escapeAttr(r.id)}" class="${selectedMeters.has(r.id) ? "row-selected" : ""}" tabindex="0">
        <td data-label="Välj" class="select-cell">
          <label class="row-check">
            <input type="checkbox" class="row-select" aria-label="Markera ${escapeAttr(r.address || r.id)}" data-id="${escapeAttr(r.id)}" ${selectedMeters.has(r.id) ? "checked" : ""}>
            <span>Välj</span>
          </label>
        </td>
        <td data-label="Beslut" class="decision-cell">
          <span class="pill ${r.category}">${decisionText(r)}</span>
          <div class="score">${r.risk}</div>
          <div class="small">underlag: ${r.confidence}</div>
        </td>
        <td data-label="Adress" class="address-cell">
          <div class="address-line"><b>${escapeHtml(r.address || "-")}</b>${customerSideMark(r)}<button class="copy-address secondary" title="Kopiera adress" onclick="copyAddress(${inlineArg(r.id)}, event)">Kopiera</button><button class="copy-address secondary" title="Öppna GPS" onclick="openMeterNavigation(${inlineArg(r.id)}, event)">GPS</button></div>
          <div class="small">${escapeHtml(r.serial || r.id)} · ${escapeHtml(r.area || "ÖVRIGT")}</div>
          ${tagLine(r)}
        </td>
        <td data-label="E/F/P" class="metrics-cell">
          <div class="reading-pair"><span>${r.engine?.previousValue == null ? "—" : r.engine.previousValue}</span><i>→</i><b>${r.last.current}</b></div>
          <div class="change-badge${r.engine?.newRise ? " new-rise" : ""}">${signedPct(r.engine?.latestPercent)} <small>${r.engine?.latestDelta == null ? "jämförelse saknas" : (r.engine.latestDelta >= 0 ? "+" : "") + r.engine.latestDelta + " i värde"}</small></div>
          <div class="small">F ${round(r.last.average)} · P ${signedPct(r.pDeviation)}</div>
        </td>
        <td data-label="Trend" class="trend-cell">
          <b>${signedPct(r.lastJump)}</b> senast
          <div class="small">${signedPct(r.firstChange)} från första filen</div>
        </td>
        <td data-label="Historik" class="history-cell">
          <svg class="spark" viewBox="0 0 160 42" onclick="openDetail(${inlineArg(r.id)})">${sparkPath(r.points)}</svg>
          <div class="small">${readingTimeline(r.points).points.length} avläsningar · senast ${readingTimeline(r.points).lastReadingDate}</div>
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
      dispatch: ["leak", "suspect", "customer_contact", "ignored"],
      confirmed: ["repaired", "manual_dispatch", "suspect", "ignored"],
      repaired: ["manual_dispatch", "suspect", "ignored"],
      watch: ["manual_dispatch", "suspect", "leak", "customer_contact", "ignored"],
      suspect_auto: ["manual_dispatch", "leak", "suspect", "customer_contact", "ignored"],
      customer_side: ["customer_contact", "manual_dispatch", "suspect", "ignored"],
      seasonal: ["manual_dispatch", "suspect", "ignored"],
      ignored: ["manual_dispatch", "suspect"],
      noise: ["manual_dispatch", "suspect", "ignored"],
      stale_contact: ["manual_dispatch", "suspect", "ignored"],
      learning: ["manual_dispatch", "suspect", "ignored"],
      new_high: ["manual_dispatch", "suspect", "ignored"],
      new_unknown: ["manual_dispatch", "suspect", "ignored"],
      normal: ["manual_dispatch", "suspect", "customer_contact", "ignored"],
    };
    const types = active === "all"
      ? ["manual_dispatch", "suspect", "leak", "customer_contact", "seasonal", "ignored"]
      : (sets[active] || sets[category] || ["manual_dispatch", "suspect", "ignored"]);
    const address = escapeAttr(meter?.address || id);
    return `
      <select class="row-action" aria-label="Flytta ${address}" onchange="if(this.value){quickGroupMeter(${inlineArg(id)},this.value);this.value=\'\'}">
        <option value="">Välj grupp...</option>
        <option value="auto">Ta bort manuell grupp</option>
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
    return matchingRows();
  }

  function overviewMapMeters() {
    const priority = { dispatch: 1, confirmed: 2, suspect_auto: 3, customer_side: 4, watch: 5, learning: 6, seasonal: 7, noise: 8, normal: 9, repaired: 10, ignored: 11 };
    return currentRowsForOverview()
      .filter((meter) => mapFilterMatch(meter))
      .sort((a, b) => (priority[a.category] || 20) - (priority[b.category] || 20) || (b.enginePriority || b.risk || 0) - (a.enginePriority || a.risk || 0));
  }

  function mapFilterMatch(meter) {
    return Boolean(meter);
  }

  function mapFilterLabel() {
    return listLabels[els.filter.value] || "Alla mätare";
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

  function parseMapAddress(meter) {
    const raw = String(meter.address || "").replace(/[,]+/g, " ").replace(/\s+/g, " ").trim();
    const atEnd = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)\s+(.+?)\s+(\d{5})$/i);
    const beforeTown = raw.match(/^(.+?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)\s+(\d{5})\s+(.+)$/i);
    const match = atEnd || beforeTown;
    if (!match) return null;
    return atEnd
      ? { street: `${match[1]} ${match[2]}`, road: match[1], house: match[2], city: match[3], postcode: match[4] }
      : { street: `${match[1]} ${match[2]}`, road: match[1], house: match[2], city: match[4], postcode: match[3] };
  }

  function geocodeHitIsExact(hit, parsed) {
    if (!hit || !parsed) return false;
    const address = hit.address || {};
    const hitHouse = normalize(address.house_number || "").replace(/\s/g, "");
    const expectedHouse = normalize(parsed.house).replace(/\s/g, "");
    if (!hitHouse || hitHouse !== expectedHouse) return false;
    const hitRoad = normalize(address.road || address.pedestrian || address.residential || address.footway || "");
    if (!hitRoad) return false;
    const expectedRoad = normalize(parsed.road);
    const roadWords = expectedRoad.split(" ").filter((word) => word.length > 2);
    const roadMatches = hitRoad === expectedRoad
      || hitRoad.includes(expectedRoad)
      || expectedRoad.includes(hitRoad)
      || (roadWords.length > 0 && roadWords.every((word) => hitRoad.includes(word)));
    if (!roadMatches) return false;
    const postcode = String(address.postcode || "").replace(/\s/g, "");
    return !postcode || postcode === parsed.postcode;
  }

  function geocodeKey(meter) {
    return normalize(addressForMap(meter));
  }

  function isInsideBotkyrka(point) {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= BOTKYRKA_BOUNDS[0][0] && lat <= BOTKYRKA_BOUNDS[1][0]
      && lng >= BOTKYRKA_BOUNDS[0][1] && lng <= BOTKYRKA_BOUNDS[1][1];
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
    if (isInsideBotkyrka(cached)) {
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
      url.searchParams.set("limit", "5");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("countrycodes", "se");
      url.searchParams.set("accept-language", "sv");
      url.searchParams.set("viewbox", `${BOTKYRKA_BOUNDS[0][1]},${BOTKYRKA_BOUNDS[1][0]},${BOTKYRKA_BOUNDS[1][1]},${BOTKYRKA_BOUNDS[0][0]}`);
      url.searchParams.set("bounded", "1");
      const parsed = parseMapAddress(meter);
      if (parsed) {
        url.searchParams.set("street", parsed.street);
        url.searchParams.set("city", parsed.city);
        url.searchParams.set("postalcode", parsed.postcode);
        url.searchParams.set("country", "Sverige");
      } else {
        url.searchParams.set("q", addressForMap(meter));
      }
      const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`GPS-sökning misslyckades (${response.status})`);
      const results = await response.json();
      const hit = Array.isArray(results)
        ? (parsed ? results.find((candidate) => geocodeHitIsExact(candidate, parsed)) : null)
        : null;
      const lat = Number(hit?.lat);
      const lng = Number(hit?.lon);
      if (!hit || !isInsideBotkyrka({ lat, lng })) {
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
    document.getElementById("mapCategoryControls")?.remove();
  }

  function applyMapCategoryFilter(filter) {
    const mapping = { field: "all", dispatch: "dispatch", suspect: "suspect", confirmed: "confirmed", customer_side: "customer_side", all: "all" };
    els.filter.value = mapping[filter] || "all";
    mapCategoryFilter = "all";
    selectedMeters.clear();
    selectedPreviewId = "";
    clearSelectionRectangle();
    updateMapCategoryButtons();
    render();
  }

  function updateMapCategoryButtons() {
    document.querySelectorAll("[data-map-filter]").forEach((button) => button.remove());
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
      <button type="button" class="secondary clear-map-marks" data-map-tool="clear" title="Rensa ventil och läckpunkt">Rensa</button>
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
      scrollWheelZoom: false,
      wheelDebounceTime: 110,
      wheelPxPerZoomLevel: 240,
      zoomDelta: 1,
      zoomSnap: 1,
      dragging: true,
      boxZoom: true,
      minZoom: 11,
      maxBounds: BOTKYRKA_BOUNDS,
      maxBoundsViscosity: 1,
    }).setView(BOTKYRKA_CENTER, 12);
    previewBaseLayer = previewMapLayers[previewMapStyle];
    previewBaseLayer.addTo(previewMap);
    previewMarkerLayer = L.layerGroup().addTo(previewMap);
    previewAnnotationLayer = L.layerGroup().addTo(previewMap);
    previewMap.on("click", handleMapClick);
    previewMap.on("mousedown", startAreaSelection);
    previewMap.on("mousemove", moveAreaSelection);
    previewMap.on("mouseup", finishAreaSelection);
    // Layout and visibility change after the map is constructed. Resize the actual
    // Leaflet instance after its container changes, including initial display.
    let resizeFrame = 0;
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          if (mapElement.clientWidth && mapElement.clientHeight) previewMap.invalidateSize({ pan:false, debounceMoveend:true });
        });
      });
      observer.observe(mapElement);
    }
    requestAnimationFrame(() => previewMap.invalidateSize({ pan:false }));
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
        if (overviewMode) previewMap.setView(BOTKYRKA_CENTER, 12);
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
        <button type="button" class="secondary" data-inspector-action="clear-selection">Avmarkera</button>
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
    inspector.addEventListener("contextmenu", (event) => {
      const card = event.target.closest("[data-map-inspector-meter]");
      if (!card) return;
      event.preventDefault();
      openMeterContextMenu(card.dataset.mapInspectorMeter, event.clientX, event.clientY);
    });
  }

  function mapMeterCard(meter, selected) {
    const status = decisionText(meter);
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

    const rows = meter ? selectedMeterList() : [];
    eyebrow.textContent = "MARKERADE MÄTARE";
    title.textContent = meter
      ? (rows.length > 1 ? `${rows.length} markerade` : "Vald mätare")
      : "Ingen vald mätare";
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
      list.innerHTML = `<p class="map-inspector-empty">Klicka på en rad eller kartpunkt för att visa mätaren och grafen här.</p>`;
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
      previewAnnotationLayer?.clearLayers();
      setMapStatus("");
      return;
    }
  
    const overviewMode = !selectedMeters.size && !selectedPreviewId;
    const cachedLocated = [];
    for (const meter of meters) {
      const cached = geocodeCache[geocodeKey(meter)];
      if (isInsideBotkyrka(cached)) {
        cachedLocated.push({ meter, coordinates: { lat: cached.lat, lng: cached.lng, label: cached.label || addressForMap(meter) } });
      }
    }
    const geocodeLimit = overviewMode ? cachedLocated.length + 12 : meters.length;
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
      marker.bindTooltip(escapeHtml(shortMapLabel(meter)), {
        permanent: !overviewMode && located.length <= 8,
        direction: "top",
        offset: [0, -7],
        className: "meter-map-label",
      });
      marker.bindPopup(`
        <b>${escapeHtml(meter.address || meter.id)}</b><br>
        ${escapeHtml(decisionText(meter))} · prioritet ${meter.risk}/100<br>
        <button type="button" onclick="openMeterNavigation(${inlineArg(meter.id)}, event)">Kör hit</button>
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
      previewMap.setView(BOTKYRKA_CENTER, 12);
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

  function renderLeakSignalChart(container, meter, compact = false) {
    if (!container || !meter?.points?.length) return;
    container.classList.add("signal-chart-ready");
    let host = container.querySelector(".leak-signal-chart");
    if (!host) {
      host = document.createElement("div");
      host.className = "leak-signal-chart";
      container.appendChild(host);
    }

    const timeline = readingTimeline(meter.points);
    const allPoints = timeline.points.filter(point => point.current !== null && point.current !== "" && Number.isFinite(Number(point.current)) && Number(point.current) >= 0).map(point => ({ ...point, date: point.readingDate }));
    if (!allPoints.length) return;
    const rangeKey = `${container.id || "signal"}:${meter.id}`;
    const timelineSignature = `${allPoints.length}:${localDate(allPoints[0].date)}:${localDate(allPoints.at(-1).date)}:${round(allPoints.at(-1).current)}:${timeline.endDate ? localDate(timeline.endDate) : ""}`;
    if (host.dataset.timelineSignature && host.dataset.timelineSignature !== timelineSignature) signalRanges.delete(rangeKey);
    const maxStart = Math.max(0, allPoints.length - 2);
    const startIndex = clamp(Number(signalRanges.get(rangeKey)) || 0, 0, maxStart);
    const points = allPoints.slice(startIndex);
    const comparisonPeriod = host.dataset.comparisonPeriod || "previous";
    const comparison = LeakHistory.compare(comparisonPeriod === "export" ? meter.points.map(p => ({ ...p, exportDate: p.date, readingDate: p.readAt || p.date })) : allPoints, comparisonPeriod);
    const values = points.map(point => Number(point.current));
    const maxValue = Math.max(10, ...values, comparison.reference?.value || 0);
    const roughStep = maxValue * 1.1 / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const tickStep = [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= roughStep);
    const chartMax = Math.ceil(maxValue * 1.08 / tickStep) * tickStep;
    const stageBounds = host.querySelector(".signal-chart-stage")?.getBoundingClientRect?.();
    const containerBounds = container.getBoundingClientRect();
    const width = Math.max(240, Math.round(stageBounds?.width || containerBounds.width - 24));
    const height = Math.max(120, Math.round(stageBounds?.height || containerBounds.height - (compact ? 122 : 175)));
    const left = 44, right = width - 18, top = 16, bottom = height - 30;
    const times = points.map(point => point.date.getTime());
    const minTime = times[0];
    const maxTime = Math.max(times.at(-1), timeline.endDate.getTime());
    const span = Math.max(86400000, maxTime - minTime);
    const timeX = time => maxTime === minTime ? (left+right)/2 : left + (time - minTime) / span * (right - left);
    const x = index => timeX(times[index]);
    const y = value => bottom - Math.max(0, value) / chartMax * (bottom - top);
    // A gap is a lack of observations, never a flat line or invented zero.
    const segments = [];
    const gapConnectors = [];
    points.forEach((point, i) => {
      if (!i || times[i] - times[i - 1] > 14 * 86400000) {
        segments.push([]);
        if (i) gapConnectors.push([i - 1, i, "Datalucka mellan avläsningar"]);
      }
      segments.at(-1).push(i);
    });
    const path = indices => indices.map((i,j) => `${j ? "L" : "M"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(" ");
    const gradientId = `signal-fill-${container.id || "chart"}`;
    const areas = segments.filter(indices => indices.length > 1).map(indices => `<path d="${path(indices)} L${x(indices.at(-1))},${bottom} L${x(indices[0])},${bottom} Z" fill="url(#${gradientId})"/>`).join("");
    const lines = segments.map(indices => `<path d="${path(indices)}" class="signal-line current"/>`).join("");
    const gaps = gapConnectors.map(([fromIndex,toIndex,label]) => `<path d="M${x(fromIndex).toFixed(1)},${y(values[fromIndex]).toFixed(1)} L${x(toIndex).toFixed(1)},${y(values[toIndex]).toFixed(1)}" class="signal-gap-connector"><title>${label}</title></path>`).join("");
    const staleLabel = timeline.gapDays >= 14
      ? `<text x="${right}" y="${top + 13}" text-anchor="end" class="signal-gap-label">Senaste avläsning ${timeline.lastReadingDate}</text>`
      : "";
    const yGrid = Array.from({length: Math.round(chartMax / tickStep) + 1}, (_,i) => {
      const value = tickStep * i;
      return `<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" class="signal-grid"/><text x="${left-9}" y="${y(value)+4}" class="signal-axis" text-anchor="end">${round(value)}</text>`;
    }).join("");
    const tickCount = maxTime === minTime ? 1 : Math.max(2, Math.min(7, Math.floor((maxTime - minTime) / 86400000) + 1, Math.floor((right-left)/115) + 1));
    const dateFormat = new Intl.DateTimeFormat("sv-SE", {day:"numeric",month:"short", ...(span > 180 * 86400000 ? {year:"2-digit"} : {})});
    const displayedDates = new Set();
    const xGrid = Array.from({length:tickCount}, (_,i) => {
      const time = minTime + (maxTime-minTime) * i / Math.max(1,tickCount-1);
      const dateLabel = dateFormat.format(new Date(time));
      if (displayedDates.has(dateLabel)) return "";
      displayedDates.add(dateLabel);
      const px = timeX(time);
      return `<line x1="${px}" y1="${top}" x2="${px}" y2="${bottom}" class="signal-grid vertical"/><text x="${px}" y="${height-8}" class="signal-date" text-anchor="${!i ? "start" : i === tickCount-1 ? "end" : "middle"}">${escapeHtml(dateLabel)}</text>`;
    }).join("");
    const dots = values.map((value,i) => `<circle cx="${x(i)}" cy="${y(value)}" r="${i === values.length-1 ? 4 : values.length > 90 ? 1 : 2}" class="signal-dot${i >= values.length-5 ? " recent" : ""}${i === values.length-1 ? " latest" : ""}"><title>${localDate(points[i].date)} · Brus ${round(value)}</title></circle>`).join("");
    const latest = values.at(-1);
    const changeText = comparison.percent === null ? "—" : `${comparison.percent >= 0 ? "+" : ""}${Math.round(comparison.percent)}%`;
    const comparisonText = comparison.reference
      ? `${round(comparison.reference.value)} den ${localDate(new Date(comparison.reference.time))}`
      : "Avläsning saknas för jämförelsen";
    const comparisonLine = comparison.reference ? `<line x1="${left}" y1="${y(comparison.reference.value)}" x2="${right}" y2="${y(comparison.reference.value)}" class="signal-reference"><title>Jämförelse: ${escapeHtml(comparisonText)}</title></line>` : "";
    const topline = `<span><i class="signal-key"></i>Brusnivå</span><span><i class="signal-key reference"></i>Jämförelse</span><strong>${round(latest)} <small>senast</small></strong>`;
    const summary = `<span><b>${changeText}</b> <em>${comparison.delta === null ? "" : (comparison.delta >= 0 ? "+" : "") + comparison.delta.toLocaleString("sv-SE") + " i värde"}</em> <small>${comparison.reference ? `mot ${escapeHtml(comparisonText)}` : comparisonText}</small></span><small>Avläst ${localDate(points.at(-1).date)}</small>`;
    const svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Brusnivå och historisk jämförelse för ${escapeAttr(meter.address || meter.id)}">
      <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0babc7" stop-opacity=".16"/><stop offset="1" stop-color="#0babc7" stop-opacity=".01"/></linearGradient></defs>
      <rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}" class="signal-plot-bg"/>
      ${yGrid}${xGrid}${areas}${gaps}${comparisonLine}${lines}${dots}${staleLabel}
      <line class="signal-cursor" y1="${top}" y2="${bottom}" visibility="hidden"/>
    </svg>`;
    const sameMeter = host.dataset.meterId === String(meter.id) && host.dataset.pointCount === String(allPoints.length) && host.dataset.timelineSignature === timelineSignature;
    if (!sameMeter || !host.querySelector(".signal-range-start")) {
      host.dataset.meterId = meter.id;
      host.dataset.pointCount = String(allPoints.length);
      host.dataset.timelineSignature = timelineSignature;
      host.innerHTML = `
        <div class="signal-chart-topline">${topline}</div>
        <div class="signal-comparison-summary" aria-live="polite">${summary}</div>
        <div class="signal-chart-stage" ${compact ? 'role="button" tabindex="0" aria-label="Förstora graf"' : ''}>${svg}</div>
        <div class="signal-range-panel">
          <label class="signal-comparison-control">Jämför <select class="signal-comparison-period" aria-label="Jämför med tidigare avläsning"><option value="previous">Föregående avläsning</option><option value="export">Föregående Excel</option><option value="7">7 dagar bakåt</option><option value="30">30 dagar bakåt</option><option value="90">90 dagar bakåt</option><option value="365">1 år bakåt</option></select></label>
          <div class="signal-range-labels"><span class="signal-range-dates"></span></div>
          <div class="signal-range-track"><input class="signal-range-start" type="range" min="0" max="${maxStart}" step="1" value="${startIndex}" aria-label="Startdatum för grafen"><i class="signal-range-end" aria-hidden="true"></i></div>
          <div class="signal-range-presets" aria-label="Snabbval för tidsperiod">
            <button type="button" data-signal-days="all">Allt</button>
            <button type="button" data-signal-days="90">90 dagar</button>
            <button type="button" data-signal-days="30">30 dagar</button>
            <button type="button" data-signal-days="10points">Senaste 10</button>
          </div>
        </div>`;
      const input = host.querySelector(".signal-range-start");
      const comparisonSelect = host.querySelector(".signal-comparison-period");
      comparisonSelect.value = comparisonPeriod;
      comparisonSelect.addEventListener("change", () => {
        host.dataset.comparisonPeriod = comparisonSelect.value;
        renderLeakSignalChart(container, meter, compact);
      });
      if (compact) {
        const stage = host.querySelector(".signal-chart-stage");
        stage.addEventListener("click", () => window.openDetail(meter.id));
        stage.addEventListener("keydown", event => {
          if (["Enter", " "].includes(event.key)) { event.preventDefault(); window.openDetail(meter.id); }
        });
      }
      input.addEventListener("input", () => {
        signalRanges.set(rangeKey, Number(input.value));
        renderLeakSignalChart(container, meter, compact);
      });
      host.querySelectorAll("[data-signal-days]").forEach((button) => button.addEventListener("click", () => {
        const preset = button.dataset.signalDays;
        let nextStart = 0;
        if (preset === "10points") nextStart = Math.max(0, allPoints.length - 10);
        else if (preset !== "all") {
          const cutoff = allPoints.at(-1).date.getTime() - Number(preset) * 86400000;
          const found = allPoints.findIndex((point) => point.date.getTime() >= cutoff);
          nextStart = found < 0 ? 0 : found;
        }
        signalRanges.set(rangeKey, clamp(nextStart, 0, maxStart));
        renderLeakSignalChart(container, meter, compact);
      }));
    } else {
      host.dataset.timelineSignature = timelineSignature;
      host.querySelector(".signal-chart-topline").innerHTML = topline;
      host.querySelector(".signal-comparison-summary").innerHTML = summary;
      host.querySelector(".signal-chart-stage").innerHTML = svg;
    }
    const stage = host.querySelector(".signal-chart-stage");
    host.dataset.plotSize = `${width}:${height}`;
    if (typeof ResizeObserver === "function" && !host.signalObserver) {
      host.signalObserver = new ResizeObserver(() => {
        if (!host.isConnected) { host.signalObserver.disconnect(); return; }
        const rect = host.querySelector(".signal-chart-stage").getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20 || `${Math.round(rect.width)}:${Math.round(rect.height)}` === host.dataset.plotSize) return;
        requestAnimationFrame(() => renderLeakSignalChart(container, host.signalMeter, compact));
      });
      host.signalObserver.observe(container);
    }
    host.signalMeter = meter;
    // Tooltip follows actual dates, including when the imported observations are sparse.
    stage.onpointermove = event => {
      if (event.pointerType === "touch") return;
      const rect = stage.getBoundingClientRect();
      const px = (event.clientX - rect.left) * width / rect.width;
      let index = 0;
      for (let i=1; i<times.length; i++) if (Math.abs(x(i)-px) < Math.abs(x(index)-px)) index=i;
      let tooltip = stage.querySelector(".signal-hover");
      if (!tooltip) { tooltip = document.createElement("div"); tooltip.className="signal-hover"; stage.appendChild(tooltip); }
      tooltip.textContent = `${localDate(points[index].date)} · Brus ${round(values[index])}`;
      tooltip.style.left = `${Math.max(4, Math.min(rect.width-180, event.clientX-rect.left+12))}px`;
      tooltip.style.top = "6px";
      const cursor = stage.querySelector(".signal-cursor");
      cursor.setAttribute("x1",x(index)); cursor.setAttribute("x2",x(index)); cursor.setAttribute("visibility","visible");
    };
    stage.onpointerleave = () => {
      stage.querySelector(".signal-hover")?.remove();
      stage.querySelector(".signal-cursor")?.setAttribute("visibility","hidden");
    };
    const rangeInput = host.querySelector(".signal-range-start");
    const rangePercent = maxStart ? (startIndex / maxStart) * 100 : 0;
    rangeInput.max = String(maxStart);
    rangeInput.value = String(startIndex);
    rangeInput.style.setProperty("--range-start", `${rangePercent}%`);
    rangeInput.disabled = maxStart === 0;
    host.querySelector(".signal-range-dates").textContent = `${localDate(points[0].date)} → ${localDate(points.at(-1).date)} · ${points.length} avläsningar`;
    host.querySelectorAll("[data-signal-days]").forEach((button) => {
      button.classList.toggle("active", (button.dataset.signalDays === "all" && startIndex === 0)
        || (button.dataset.signalDays === "10points" && startIndex === Math.max(0, allPoints.length - 10)));
    });
  }

  function renderSelectedPreview() {
    const box = document.getElementById("meterPreview");
    const canvas = document.getElementById("selectedChart");
    if (!box || !canvas) return;
    const meter = state.meters.find((item) => item.id === selectedPreviewId);
    const chartVersion = ++previewChartRenderVersion;
    if (previewChartResizeObserver) previewChartResizeObserver.disconnect();
    previewChartResizeObserver = null;
    box.hidden = state.meters.length === 0;
    box.classList.toggle("overview-map", !meter);
    document.body.dataset.meterSelected = String(Boolean(meter));
    const column = box.closest(".content-column");
    if (column) column.dataset.meterSelected = String(Boolean(meter));
    if (!meter) {
      canvas.closest(".preview-chart")?.querySelector(".leak-signal-chart")?.remove();
      if (state.previewChart) state.previewChart.destroy();
      state.previewChart = null;
      const rows = overviewMapMeters();
      document.getElementById("previewTitle").textContent = "Översikt";
      document.getElementById("previewMeta").textContent = rows.length
        ? `${mapFilterLabel()} · välj en mätare i kartan eller listan för att jämföra historiken`
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
    document.getElementById("previewMeta").textContent = `${decisionText(meter)} · prioritet ${meter.risk}/100 · ${dates.firstDate} till ${dates.lastDate}${staleDays >= 14 ? ` · tappad kontakt ${staleDays} dagar` : ""}${selectedCount > 1 ? ` · ${selectedCount} mätare på kartan` : ""}`;
    if (state.previewChart) state.previewChart.destroy();
    state.previewChart = null;
    const labels = meter.points.map((point) => localDate(point.date));
    const createChartAfterLayout = () => {
      if (chartVersion !== previewChartRenderVersion || selectedPreviewId !== meter.id) return;
      const container = canvas.closest(".preview-chart");
      if (!container || container.getBoundingClientRect().width < 20 || container.getBoundingClientRect().height < 20) {
        if (container && typeof ResizeObserver === "function") {
          previewChartResizeObserver = new ResizeObserver(() => {
            if (container.getBoundingClientRect().width < 20 || container.getBoundingClientRect().height < 20) return;
            previewChartResizeObserver.disconnect();
            previewChartResizeObserver = null;
            requestAnimationFrame(createChartAfterLayout);
          });
          previewChartResizeObserver.observe(container);
        }
        return;
      }
      renderLeakSignalChart(container, meter, true);
      if (typeof ResizeObserver === "function") {
        let lastWidth = Math.round(container.getBoundingClientRect().width);
        previewChartResizeObserver = new ResizeObserver(() => {
          const nextWidth = Math.round(container.getBoundingClientRect().width);
          if (nextWidth < 20 || Math.abs(nextWidth - lastWidth) < 2) return;
          lastWidth = nextWidth;
          requestAnimationFrame(() => {
            if (chartVersion === previewChartRenderVersion) renderLeakSignalChart(container, meter, true);
          });
        });
        previewChartResizeObserver.observe(container);
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(createChartAfterLayout));
    renderMapInspector(meter);
    renderSelectedMap().catch((error) => {
      setMapStatus(error.message || "Kartan kunde inte uppdateras.");
    });
  }

  window.selectLeakMeter = function selectLeakMeter(id) {
    if (!state.meters.some(m => m.id === id)) return;
    selectedMeters.clear();
    selectedMeters.add(id);
    selectedPreviewId = id;
    render();
  };

  window.openDetail = function openDetailFieldWorkflow(id) {
    const meter = state.meters.find((m) => m.id === id);
    if (!meter) return;
    const { firstDate, lastDate, lastReadDate } = meterDates(meter);
    const staleDays = meter.staleReadDays || 0;
    els.detailTitle.textContent = meter.address || meter.id;
    els.detailMeta.textContent = `${meter.serial || meter.id} · ${meter.area || "ÖVRIGT"} · ${firstDate} till ${lastDate} · prioritet ${meter.risk}/100 · ${decisionText(meter)}`;
    els.detailText.innerHTML = `
      <div class="detail-actions">
        <button class="secondary" onclick="copyAddress(${inlineArg(meter.id)}, event)">Kopiera adress</button>
        <button class="secondary" onclick="openMeterNavigation(${inlineArg(meter.id)}, event)">Kör hit</button>
        ${feedbackActions(meter.id)}
      </div>
      <details class="detail-analysis"><summary>Visa analys och underlag</summary>
      <p><b>Period:</b> första fil ${firstDate} · sista fil ${lastDate} · senaste mätaravläsning ${lastReadDate}${staleDays >= 14 ? ` · tappad/gammal kontakt ${staleDays} dagar` : ""}</p>
      <p><b>Motivering:</b> ${meter.reasons.map(escapeHtml).join(" · ")}</p>
      <p><b>Mönster:</b> värme=${meter.profile.heating ? "ja" : "nej"}, årsupprepning=${meter.profile.annualRepeat ? `${meter.profile.annualRepeat.months} jämförda månader` : "nej"}, fladdrig=${meter.profile.fluctuating ? "ja" : "nej"}, ny nivå=${meter.profile.newLevel ? "ja" : "nej"}.</p>
      <p><b>Miljö:</b> fjärrvärme=${meter.infrastructure.districtHeating ? "ja" : "nej"}, undercentral/höghus=${meter.infrastructure.largeSubstation ? "ja" : "nej"}, efter mätaren=${meter.infrastructure.customerSide ? "ja" : "nej"}, sommarvattenmätare=${meter.infrastructure.summerWaterMeter ? "ja" : "nej"}${meter.networkContext?.sharedSignal ? `, gemensam signal på ${meter.networkContext.meterCount} mätare` : ""}.</p>
      ${meter.label ? `<p><b>Facit:</b> ${escapeHtml(labelTypes[meter.label.type] || meter.label.type)} · ${escapeHtml(labelSummary(meter.label))}</p>` : ""}
      </details>
    `;
    if (state.chart) state.chart.destroy();
    state.chart = null;
    const detailVersion = ++detailChartRenderVersion;
    els.detailDialog.showModal();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (detailVersion !== detailChartRenderVersion || !els.detailDialog.open) return;
      renderLeakSignalChart(document.querySelector("#detailDialog .chart-box"), meter, false);
    }));
  };

  window.labelMeter = function labelMeterField(id, type) {
    const meter = state.meters.find((item) => item.id === id);
    if (!meter) return;
    feedbackBatchIds = [id];
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

  async function saveFieldFeedback(event) {
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
      next.lineType = document.querySelector('input[name="lineType"]:checked')?.value || "Vet ej";
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
    if (type === "reset_baseline") next.resetAfter = next.at;
    const ids = feedbackBatchIds.length ? feedbackBatchIds : [id];
    for (const meterId of ids) {
      const target = state.meters.find(m => m.id === meterId);
      if (!target) continue;
      const fields = { type: next.type, note: next.note, at: next.at, source: next.source };
      for (const key of type === "leak" ? ["confirmedDate","confirmedDateUncertain","lineType"] :
        type === "repaired" ? ["repairedDate","lineType","distanceMeters","distanceUncertain"] :
        ["notedDate","noiseTags","resetAfter"]) if (key in next) fields[key] = next[key];
      state.labels[meterId] = meterId === id ? next : {
        ...(state.labels[meterId] || {}), ...fields, address: target.address, serial: target.serial
      };
    }
    feedbackBatchIds = [];
    const saveButton = document.getElementById("saveFeedback");
    saveButton.disabled = true;
    saveButton.textContent = "Sparar…";
    const saved = await saveLabels();
    saveButton.disabled = false;
    saveButton.textContent = "Spara facit";
    if (saved) document.getElementById("feedbackDialog").close();
    else {
      let message = document.getElementById("feedbackSaveStatus");
      if (!message) {
        message = document.createElement("p");
        message.id = "feedbackSaveStatus";
        message.setAttribute("role", "alert");
        saveButton.before(message);
      }
      message.textContent = state.storageError;
    }
    analyze();
  }

  document.getElementById("feedbackForm")?.addEventListener("submit", saveFieldFeedback, true);
  document.getElementById("rows")?.addEventListener("click", (event) => {
    const row = event.target.closest?.("tr[data-meter-row]");
    if (!row || event.target.closest?.("button, input, label, a, select, textarea, svg")) return;
    const id = row.dataset.meterRow;
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      if (selectedMeters.has(id)) selectedMeters.delete(id);
      else selectedMeters.add(id);
      selectedPreviewId = selectedMeters.has(id) ? id : ([...selectedMeters].at(-1) || "");
    } else {
      const deselectOnly = selectedMeters.size === 1 && selectedMeters.has(id);
      selectedMeters.clear();
      if (deselectOnly) selectedPreviewId = "";
      else {
        selectedMeters.add(id);
        selectedPreviewId = id;
      }
    }
    render();
  });
  document.getElementById("rows")?.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key) || event.target.tagName !== "TR") return;
    event.preventDefault();
    event.target.click();
  });
  document.getElementById("rows")?.addEventListener("dblclick", (event) => {
    const row = event.target.closest?.("tr[data-meter-row]");
    if (!row || event.target.closest?.("button, input, label, a, select, textarea")) return;
    window.openDetail(row.dataset.meterRow);
  });
  document.getElementById("rows")?.addEventListener("contextmenu", (event) => {
    const row = event.target.closest?.("tr[data-meter-row]");
    if (!row) return;
    event.preventDefault();
    openMeterContextMenu(row.dataset.meterRow, event.clientX, event.clientY);
  });
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
  els.filter?.addEventListener("change", () => {
    currentPage = 1;
    selectedMeters.clear();
    selectedPreviewId = "";
    clearSelectionRectangle();

    render();
  });
  document.getElementById("areaFilter")?.addEventListener("change", () => {
    currentPage = 1;
    selectedMeters.clear();
    selectedPreviewId = "";
    render();
  });
  document.getElementById("excludeFilter")?.addEventListener("change", () => {
    const count = document.querySelectorAll("#excludeFilter input:checked").length;
    document.getElementById("excludedCount").textContent = count ? `(${count})` : "";
    currentPage = 1;
    selectedMeters.clear();
    selectedPreviewId = "";
    render();
  });
  document.getElementById("clearExcluded")?.addEventListener("click", () => {
    document.querySelectorAll("#excludeFilter input").forEach((input) => { input.checked = false; });
    document.getElementById("excludeFilter").dispatchEvent(new Event("change"));
  });
  document.addEventListener("click", (event) => {
    const menu = document.getElementById("excludeFilter");
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
  });
  document.getElementById("excludeFilter")?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary").focus();
  });
  document.querySelector("thead")?.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-sort-table]");
    if (!button) return;
    const sort = button.dataset.sortTable;
    if (sort === "select") {
      const allSelected = lastFilteredRows.length > 0 && lastFilteredRows.every((row) => selectedMeters.has(row.id));
      if (allSelected) {
        selectedMeters.clear();
        selectedPreviewId = "";
      } else {
        lastFilteredRows.forEach((row) => selectedMeters.add(row.id));
        selectedPreviewId = lastFilteredRows[0]?.id || "";
      }
      render();
      return;
    }
    els.sort.value = sort;
    currentPage = 1;
    render();
  });
  document.getElementById("clearSelection")?.addEventListener("click", () => {
    selectedMeters.clear();
    selectedPreviewId = "";
    clearSelectionRectangle();
    setMapToolMode("");
    render();
  });
  document.getElementById("selectAllMatches")?.addEventListener("click", () => {
    selectedMeters.clear();
    lastFilteredRows.forEach((meter) => selectedMeters.add(meter.id));
    selectedPreviewId = lastFilteredRows[0]?.id || selectedPreviewId;
    render();
  });
  document.getElementById("clearAllSelection")?.addEventListener("click", () => {
    selectedMeters.clear();
    selectedPreviewId = "";
    clearSelectionRectangle();
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
    if (event.key !== "Escape") return;
    if (!document.getElementById("meterContextMenu")?.hidden) closeMeterContextMenu();
    if (mapToolMode) {
      clearSelectionRectangle();
      setMapToolMode("");
      setMapStatus("Kartverktyget avbröts.");
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("#meterContextMenu")) closeMeterContextMenu();
  });
  document.getElementById("bulkSave")?.addEventListener("click", () => {
    const searchTerms = terms(els.search.value);
    const type = document.getElementById("bulkType").value;
    const rows = selectedMeters.size > 0
      ? state.meters.filter((meter) => selectedMeters.has(meter.id))
      : matchingRows();
    if (!rows.length) return;
    quickAssignMeters(rows.map(m => m.id), type);
  });

  analyze();
}());
