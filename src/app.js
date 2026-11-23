/* LeakSök app: state, import, analysis orchestration and the work list UI.
   Analysis lives in engine.js; this file only presents and records decisions. */
(function () {
  const Engine = window.LeakEngine;
  const MeterView = window.LeakMeterView;
  const ReviewPlan = window.LeakReviewPlan;
  const History = window.LeakHistory;
  const Parse = window.LeakParse;
  const Chart = window.LeakChart;
  const LABEL_BACKUP_KEY = "leaksok-intelligence-labels";
  const PROFILE_KEY = "leaksok-intelligence-profile";
  const VIEW_KEY = "leaksok_workspace_view_v1";

  // Field facts registered before the app existed. Saved decisions override them.
  const knownCases = {
    "53843859": { type: "repaired", address: "ALHAGSVÄGEN 58 -60 NORSBORG 14559", serial: "53843859", note: "Bekräftad läcka cirka 50-55 m från servisventilen vid nr 58. Lagad 2026-08-23 cirka 12:30; avläsning 17 kl. 13:01.", at: "2026-08-23T12:30:00+02:00", confirmedDate: "2026-08-23", repairedDate: "2026-08-23", distanceMeters: 55, lineType: "SV", source: "inbyggt facit" },
    "23571762": { type: "seasonal", address: "ALICE TEGNÉRS VÄG 23 TULLINGE 14638", serial: "23571762", note: "Känt värmepanne-/säsongsmönster.", at: "2026-08-23T00:00:00+02:00", notedDate: "2026-08-23", source: "inbyggt facit" },
    "23571905": { type: "repaired", address: "BROÄNGSVÄGEN 22 TUMBA 14732", serial: "23571905", note: "Historisk läcka lagad. Högt gammalt max ska inte ensamt ge aktiv varning.", at: "2026-08-23T00:00:00+02:00", repairedDate: "2026-08-23", source: "inbyggt facit" },
    "12777229": { type: "leak", address: "VATTRAVÄGEN 8 UTTRAN 14763", serial: "12777229", note: "Bekräftat aktivt exempel i träningsunderlaget.", at: "2026-08-23T00:00:00+02:00", confirmedDate: "2026-08-23", source: "inbyggt facit" },
  };

  const LISTS = [
    { key: "today", label: "Nytt i dag", test: (m) => m.isNewToday, hint: "Nya signaler i senaste exporten" },
    { key: "all", label: "Alla mätare", test: () => true },
    { key: "dispatch", label: "Åk ut", test: (m) => m.category === "dispatch" },
    { key: "suspect", label: "Misstänk", test: (m) => m.category === "suspect_auto", hint: "Automatisk upptäckt" },
    { key: "watch", label: "Bevaka", test: (m) => m.category === "watch", hint: "Din manuella lista" },
    { group: true, key: "customer_side", label: "Efter mätare", test: (m) => m.category === "customer_side" },
    { key: "confirmed", label: "Aktiva läckor", test: (m) => m.category === "confirmed" },
    { key: "repaired", label: "Lagade", test: (m) => m.label?.type === "repaired" },
    { key: "stable_high", label: "Stabilt hög", test: (m) => m.category === "stable_high", more: true },
    { key: "sparse_history", label: "Glest underlag", test: (m) => m.category === "sparse_history", more: true },
    { group: true, key: "noise", label: "Störning / tillfällig", test: (m) => m.category === "noise", more: true },
    { group: true, key: "seasonal", label: "Säsong", test: (m) => m.category === "seasonal" || m.season?.status === "possible" || m.season?.status === "verified", hint: "Möjliga och återkommande säsongsmönster; nya avvikelser behåller sin varning", more: true },
    { key: "learning", label: "Kort historik", test: (m) => m.category === "learning", more: true },
    { key: "stale_contact", label: "Utan färsk avläsning", test: (m) => m.category === "stale_contact", more: true },
    { group: true, key: "ignored", label: "Ignorerade", test: (m) => m.category === "ignored", more: true },
    { key: "hidden", label: "Dolda", test: () => true, more: true },
  ];
  const LIST = Object.fromEntries(LISTS.map((l) => [l.key, l]));
  const PRIMARY_LISTS = ["today", "dispatch", "suspect", "all"];

  const DEFAULT_HIDDEN = ["customer_side", "noise", "seasonal", "ignored"];
  const DECISIONS = [
    { type: "manual_dispatch", label: "Åk ut" },
    { type: "interesting", label: "Bevaka" },
    { type: "customer_contact", label: "Efter mätare / kontakta FÄ" },
    { type: "leak", label: "Läcka…", form: true },
    { type: "repaired", label: "Lagad…", form: true },
    { type: "seasonal", label: "Säsong / känd värmepanna" },
    { type: "known_noise", label: "Störning / falsklarm" },
    { type: "new_install", label: "Nyuppsatt, avvakta" },
    { type: "reset_baseline", label: "Nollställ…", form: true },
    { type: "ignored", label: "Ignorera" },
  ];
  const DECISION_FIELDS = ["confirmedDate", "confirmedDateUncertain", "repairedDate", "lineType", "distanceMeters", "distanceUncertain", "valveToLeakMeters", "mapMarks", "resetAfter", "noiseTags", "notedDate"];

  const state = {
    files: [], labels: loadLabelBackup(), tripList: [], profileId: null, profileName: null,
    areaSignals: [], coordinatesKey: "", reviewKey: "", prepared: null, cache: new Map(), meters: [], byId: new Map(), latestExport: null,
    list: "all", fieldLane: null, fieldLaneEffective: "ready", fieldCounts: { ready: 0, check: 0 },
    search: "", sort: "suspicion", sortReverse: false, area: "all", excluded: new Set(DEFAULT_HIDDEN),
    page: 1, pageSize: 50, marked: new Set(), focusId: "", chartHidden: false, expanded: new Set(),
    view: readView(), importing: false, historyDirty: false, storageError: "", visible: [],
  };
  window.state = state; // read-only inspection in tests and the browser console

  const $ = (id) => document.getElementById(id);
  const els = {
    rail: $("rail"), brief: $("brief"), rows: $("rows"), search: $("search"), sort: $("sort"), area: $("areaFilter"),
    groupFilter: $("groupFilter"), groupFilterCount: $("groupFilterCount"), selection: $("selectionBar"), pager: $("pager"),
    pageSize: $("pageSize"), pageInfo: $("pageInfo"), prev: $("prevPage"), next: $("nextPage"), checkPage: $("checkPage"),
    focus: $("focus"), focusTitle: $("focusTitle"), focusMeta: $("focusMeta"), focusChart: $("focusChart"), map: $("map"), mapStatus: $("mapStatus"),
    fileInput: $("fileInput"), pickFiles: $("pickFiles"), importLine: $("importLine"), importStatus: $("importStatus"),
    importLog: $("importLog"), importLogSummary: $("importLogSummary"), importLogEntries: $("importLogEntries"),
    menu: $("contextMenu"), toast: $("toast"), worklistCount: $("worklistCount"),
    profileDialog: $("profileDialog"), profileForm: $("profileForm"), profileName: $("profileName"), profileCode: $("profileCode"),
    profileStatus: $("profileStatus"), profileTitle: $("profileTitle"), profileHelp: $("profileHelp"), profileButton: $("profileButton"),
    decisionDialog: $("decisionDialog"), decisionForm: $("decisionForm"), decisionTitle: $("decisionTitle"), decisionTarget: $("decisionTarget"),
    decisionFields: $("decisionFields"), decisionComment: $("decisionComment"), decisionError: $("decisionError"),
    chartDialog: $("chartDialog"), rulesDialog: $("rulesDialog"),
  };

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const num = Engine.fmtNum;
  // One set of five choices feeds the toolbar and the row menu.
  els.sort.innerHTML = MeterView.sortOptions.map(o => `<option value="${o.key}">${esc(o.label)}</option>`).join("");
  $("sortOptions").innerHTML = MeterView.sortOptions.map(o => `<button type="button" role="menuitemradio" aria-checked="false" data-sort-option="${o.key}"><span>${esc(o.label)}</span><i aria-hidden="true">✓</i></button>`).join("");

  // ---------------- storage ----------------
  function loadLabelBackup() {
    try { return { ...knownCases, ...JSON.parse(localStorage.getItem(LABEL_BACKUP_KEY) || "{}") }; }
    catch { return { ...knownCases }; }
  }
  function readView() { try { return localStorage.getItem(VIEW_KEY) === "map" ? "map" : "list"; } catch { return "list"; } }
  function profileConfig() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch { return null; } }

  async function persist(full = false) {
    try { localStorage.setItem(LABEL_BACKUP_KEY, JSON.stringify(state.labels)); } catch { /* IndexedDB is primary */ }
    if (!state.profileId || !window.LeakStorage?.available) {
      state.storageError = "Historiken sparas inte i en lokal profil. Spara en säkerhetskopia.";
      renderSource();
      return false;
    }
    try {
      const snapshot = { files: state.files, labels: state.labels, tripList: state.tripList };
      const saveHistory = full || state.historyDirty;
      await (saveHistory ? LeakStorage.saveAll(state.profileId, snapshot) : LeakStorage.saveState(state.profileId, snapshot));
      if (saveHistory) state.historyDirty = false;
      state.storageError = "";
      renderSource();
      return true;
    } catch (error) {
      state.storageError = `Kunde inte spara lokalt: ${error.message}`;
      toast(state.storageError);
      renderSource();
      return false;
    }
  }

  function hydrateFiles(files) {
    return (files || []).map((file) => {
      const stored = History.validDate(file.exportDate);
      const fromName = Parse.dateFromFileName(file.name);
      const exportDate = fromName && (!stored || fromName >= stored) ? fromName : stored || fromName;
      if (!exportDate) return null;
      return { ...file, exportDate, rows: (file.rows || []).map((row) => ({ ...row, exportDate, readAt: row.readAt ? new Date(row.readAt) : null })) };
    }).filter(Boolean);
  }

  // ---------------- profile ----------------
  async function hashCode(value) {
    if (window.crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    return String(hash);
  }
  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const profileKey = (name) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lokal";

  function showProfile() {
    if (state.importing || folderImport?.isBusy()) { toast("Vänta tills importen är klar innan du låser arbetsytan."); return; }
    folderImport?.pause();
    window.LeakAI?.lock();
    const config = profileConfig();
    els.profileTitle.textContent = config ? "Öppna LeakSök" : "Skapa lokal profil";
    els.profileHelp.textContent = config ? "Ange din kod. Historik och beslut ligger kvar på denna enhet." : "Välj namn och en kod med minst fyra tecken för din lokala arbetsyta.";
    els.profileName.value = config?.name || "";
    els.profileName.readOnly = Boolean(config);
    els.profileCode.value = "";
    els.profileStatus.textContent = "";
    if (!els.profileDialog.open) els.profileDialog.showModal();
  }
  els.profileDialog.addEventListener("cancel", (e) => e.preventDefault());
  els.profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = els.profileName.value.trim();
    const code = els.profileCode.value;
    const config = profileConfig();
    if (!name || code.length < 4) { els.profileStatus.textContent = "Skriv namn och en kod med minst fyra tecken."; return; }
    const salt = config?.salt || randomSalt();
    const hash = await hashCode(`${name.toLowerCase()}|${code}|${salt}`);
    if (config && (config.name.toLowerCase() !== name.toLowerCase() || config.hash !== hash)) { els.profileStatus.textContent = "Fel kod."; return; }
    const next = config || { name, salt, hash, profileId: profileKey(name) };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    state.profileId = next.profileId;
    state.profileName = next.name;
    els.profileButton.textContent = `Lås (${next.name})`;
    try {
      els.profileStatus.textContent = "Öppnar historik…";
      const snapshot = await LeakStorage.load(state.profileId);
      if (snapshot) {
        state.files = hydrateFiles(snapshot.files);
        state.historyDirty = false;
        state.tripList = Array.isArray(snapshot.tripList) ? snapshot.tripList : [];
        const local = state.labels;
        state.labels = { ...knownCases, ...(snapshot.labels || {}) };
        const time = (l) => Math.max(Date.parse(l?.at || "") || 0, Date.parse(l?.visibilityUpdatedAt || "") || 0, Date.parse(l?.commentAt || "") || 0);
        for (const [id, label] of Object.entries(local)) if (time(label) > time(state.labels[id])) state.labels[id] = label;
      }
    } catch (error) {
      state.profileId = null;
      els.profileStatus.textContent = `Historiken kunde inte öppnas: ${error.message}. Inget har skrivits över.`;
      return;
    }
    els.profileDialog.close();
    if (state.files.length) {
      setImportStatus(`Analyserar ${state.files.length} exporter…`);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    reanalyze(true);
    if (state.files.length) setImportStatus(`${state.files.length} exporter i historiken · ${state.meters.length.toLocaleString("sv-SE")} mätare.`);
    window.LeakAI?.onWorkspace();
    await folderImport.open(state.profileId);
  });

  // ---------------- import ----------------
  function tableFromWorkbook(buffer) {
    if (typeof XLSX === "undefined") throw new Error("Excel-läsaren är inte laddad; ladda om sidan eller använd CSV");
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    for (const name of workbook.SheetNames) {
      const table = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, raw: true });
      if (Parse.findHeaderIndex(table) >= 0) return table;
    }
    throw new Error("hittade inget blad med Kamstrup-rubriker");
  }

  async function handleFiles(list) {
    const files = [...list].filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (state.importing) { setImportStatus("En import pågår redan."); return { saved: false, accepted: [] }; }
    if (!files.length) { setImportStatus("Ingen Excel- eller CSV-fil vald."); return { saved: false, accepted: [] }; }
    state.importing = true;
    els.pickFiles.disabled = true;
    const warnings = [], errors = [], accepted = [];
    let added = 0, duplicates = 0, updated = 0, reviewAfter = false;
    const next = [...state.files];
    const signature = LeakComparison.fingerprint;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setImportStatus(`Läser ${i + 1}/${files.length}: ${file.name}`);
        try {
          const table = /\.csv$/i.test(file.name) ? Parse.parseCsvRows(await file.text()) : tableFromWorkbook(await file.arrayBuffer());
          const parsed = Parse.parseTable(table, { name: file.name, lastModified: file.lastModified });
          if (!parsed.rows.length) throw new Error("inga mätarrader hittades");
          const sig = signature(parsed.rows);
          const duplicateIndex = next.findIndex((f) => f.exportDate.getTime() === parsed.exportDate.getTime() && f.rows.length === parsed.rows.length && signature(f.rows) === sig);
          if (duplicateIndex >= 0) {
            duplicates++;
            const existing = next[duplicateIndex];
            let changed = false;
            const rows = LeakComparison.mergeRows(existing.rows, parsed.rows);
            changed = JSON.stringify(rows) !== JSON.stringify(existing.rows);
            // Copy, do not mutate: failed analysis can still roll back safely.
            if (changed) { next[duplicateIndex] = { ...existing, rows }; updated++; }
            accepted.push(file.name);
            continue;
          }
          // A same-named file from another day, or with other content, is kept: history is never dropped.
          next.push({ name: file.name, exportDate: parsed.exportDate, exportDateSource: parsed.exportDateSource, importedAt: new Date().toISOString(), rows: parsed.rows });
          parsed.warnings.forEach((w) => warnings.push(`${file.name}: ${w}`));
          added++;
          accepted.push(file.name);
        } catch (error) { errors.push(`${file.name}: ${error.message}`); }
      }
      const previous = state.files;
      const previousDirty = state.historyDirty;
      state.files = next.sort((a, b) => a.exportDate - b.exportDate || a.name.localeCompare(b.name));
      state.historyDirty ||= Boolean(added || updated);
      setImportStatus("Analyserar…");
      await new Promise((r) => setTimeout(r, 0));
      try { reanalyze(true); }
      catch (error) {
        // Never keep (or save) an import the engine cannot analyse.
        state.files = previous;
        state.historyDirty = previousDirty;
        reanalyze(true);
        setImportStatus(`Importen avbröts, inget sparades: ${error.message}`);
        return { saved: false, accepted: [] };
      }
      const saved = state.historyDirty || state.storageError ? await persist(true) : true;
      const outcome = [added ? `${added} nya exporter` : "", updated ? `${updated} uppdaterade exporter` : "", duplicates && !updated ? `${duplicates} redan i historiken` : ""].filter(Boolean).join(" · ") || "Inga exporter kunde läsas";
      setImportStatus(`${outcome} · ${state.meters.length.toLocaleString("sv-SE")} mätare. ${saved ? "Sparat på denna enhet." : state.storageError}`);
      renderImportLog(warnings, errors);
      renderSource();
      reviewAfter = saved && Boolean(added || updated);
      return { saved, accepted: saved ? accepted : [], added, updated, duplicates, errors };
    } finally {
      state.importing = false;
      els.pickFiles.disabled = false;
      els.fileInput.value = "";
      if (reviewAfter) window.LeakAI?.onWorkspace();
    }
  }
  function setImportStatus(text) { els.importLine.hidden = !text; els.importStatus.textContent = text; }
  function renderImportLog(warnings, errors) {
    els.importLogEntries.replaceChildren(...[...errors.map((e) => `Kunde inte läsa: ${e}`), ...warnings.map((w) => `Varning: ${w}`)].map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
    els.importLog.hidden = !warnings.length && !errors.length;
    els.importLog.open = false;
    els.importLogSummary.textContent = `Importlogg · ${warnings.length} varningar · ${errors.length} filer kunde inte läsas`;
  }

  // One source, one status. The directory handle stays local in IndexedDB.
  const folderSupported = typeof window.showDirectoryPicker === "function" && window.isSecureContext;
  const folderImport = LeakFolderImport.create({
    storage: LeakStorage,
    pickDirectory: folderSupported ? (options) => window.showDirectoryPicker(options) : null,
    onFiles: handleFiles,
    onStatus: renderSource,
    isReady: () => Boolean(state.profileId) && !els.profileDialog.open && !state.importing && !document.hidden,
  });
  function renderSource() {
    const source = folderImport.getStatus();
    const connected = ["connected", "scanning"].includes(source.phase);
    const needsPermission = source.phase === "permission";
    const button = $("folderButton");
    button.textContent = connected ? "Autoimport aktiv" : needsPermission ? "Återanslut mapp" : source.name ? "Mappimport" : "Anslut mapp";
    button.dataset.phase = source.phase;
    button.title = source.name ? `Exportmapp: ${source.name}` : "Läs nya exporter automatiskt från en mapp";
    const last = source.lastChecked ? new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(new Date(source.lastChecked)) : "";
    const message = connected ? `Automatisk import från ${source.name}${last ? ` · kontrollerad ${last}` : ""}` : source.message || (source.name ? `Mappimport pausad · ${source.name}` : "");
    $("sourceLine").hidden = !message && !state.storageError;
    $("sourceLine").classList.toggle("is-error", Boolean(state.storageError) || ["error", "permission"].includes(source.phase));
    $("sourceLine").replaceChildren();
    if (state.storageError) {
      const warning = document.createElement("span"); warning.textContent = state.storageError; $("sourceLine").append(warning);
    } else if (message) {
      const label = document.createElement("span"); label.textContent = message; $("sourceLine").append(label);
      if (needsPermission || source.phase === "error") {
        const action = document.createElement("button"); action.className = "link"; action.textContent = needsPermission ? "Tillåt läsning" : "Visa datakälla";
        action.addEventListener("click", () => { if (needsPermission) folderImport.resume(); else openSource(); });
        $("sourceLine").append(action);
      }
    }
    $("sourceStatus").textContent = !folderSupported ? "Automatisk mappimport stöds inte här. Använd Chrome eller Edge på dator, eller knappen Importera Excel." : source.name ? message : "Ingen exportmapp ansluten. Välj mappen där du sparar dina exporter.";
    $("sourceConnect").hidden = !folderSupported || needsPermission;
    $("sourceConnect").textContent = source.name ? "Byt exportmapp" : "Välj exportmapp";
    $("sourceResume").hidden = !needsPermission;
    $("sourceCheck").hidden = !source.name || needsPermission || source.phase === "paused";
    $("sourceDisconnect").hidden = !source.name;
    for (const id of ["sourceConnect", "sourceResume", "sourceCheck", "sourceDisconnect"]) $(id).disabled = folderImport.isBusy() || state.importing;
  }
  function openSource() { renderSource(); $("sourceDialog").showModal(); }
  $("folderButton").addEventListener("click", openSource);
  $("sourceConnect").addEventListener("click", async () => { await folderImport.connect(); renderSource(); });
  $("sourceResume").addEventListener("click", async () => { await folderImport.resume(); renderSource(); });
  $("sourceCheck").addEventListener("click", async () => { await folderImport.scan(); renderSource(); });
  $("sourceDisconnect").addEventListener("click", async () => {
    try { await folderImport.disconnect(); renderSource(); } catch (error) { toast(`Kunde inte koppla från: ${error.message}`); }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) folderImport.scan(); });
  window.addEventListener("focus", () => folderImport.scan());

  // ---------------- analysis ----------------
  let caseGeocoding = false;
  const caseLookups = new Set();
  function resolveCaseNeighbors() {
    if (caseGeocoding || !window.LeakMap?.resolvePositions) return;
    const ids = new Set();
    for (const c of state.leakCases || []) {
      if (!c.repairedDate || !["AV", "SV"].includes(c.lineType)) continue;
      for (const p of c.profiles) if (p.basis === "address" && p.before.sufficient && p.during.sufficient && p.after.sufficient) {
        ids.add(c.anchorId); ids.add(p.id);
      }
    }
    const pending = [...ids].map(id => state.byId.get(id)).filter(m => m && !LeakMap.cachedPosition(m) && !caseLookups.has(`${m.id}|${m.address}`)).slice(0, 12);
    if (!pending.length) return;
    pending.forEach(m => caseLookups.add(`${m.id}|${m.address}`));
    caseGeocoding = true;
    renderFocus();
    LeakMap.resolvePositions(pending).then(() => {
      caseGeocoding = false;
      reanalyze();
    }).catch(() => { caseGeocoding = false; renderFocus(); });
  }
  function reanalyze(filesChanged = false) {
    if (filesChanged || !state.prepared) state.prepared = Engine.prepare(state.files);
    const coords = window.LeakMap ? LeakMap.coordinates([...state.prepared.histories.values()]) : new Map();
    const result = Engine.analyzePrepared(state.prepared, state.labels, { cache: state.cache, coordinates: coords });
    state.meters = result.meters;
    state.areaSignals = result.areaSignals;
    state.leakCases = result.leakCases;
    state.coordinatesKey = JSON.stringify([...coords].sort(([a], [b]) => a.localeCompare(b)));
    state.byId = new Map(result.meters.map((m) => [m.id, m]));
    state.latestExport = result.latestExport;
    state.reviewKey = ReviewPlan.contextKey(state.meters, { latestExport: state.latestExport, histories: state.prepared.histories,
      labels: state.labels, coordinatesKey: state.coordinatesKey });
    for (const id of [...state.marked]) if (!state.byId.has(id)) state.marked.delete(id);
    if (state.focusId && !state.byId.has(state.focusId)) state.focusId = "";
    render();
    window.LeakAI?.refreshContext();
    resolveCaseNeighbors();
  }

  // ---------------- filtering ----------------
  const districtCache = new Map();
  function districtOf(m) {
    const key = `${m.area}|${m.address}`;
    if (!districtCache.has(key)) districtCache.set(key, Parse.districtOf(m.area, m.address));
    return districtCache.get(key);
  }
  const hidden = (m) => state.labels[m.id]?.hidden === true || (state.excluded.has(m.category) && state.labels[m.id]?.hidden !== false);

  function inList(m, key) {
    if (key === "hidden") return hidden(m);
    if (state.labels[m.id]?.hidden === true) return false;
    if (state.excluded.has(m.category) && state.labels[m.id]?.hidden !== false && !LIST[key]?.group) return false;
    return LIST[key].test(m);
  }

  function visibleRows() {
    const terms = state.search.split(/[\n,;]+/).map(norm).filter(Boolean);
    const scoped = state.meters.filter((m) => {
      if (state.area !== "all" && districtOf(m) !== state.area) return false;
      if (terms.length && !terms.some((t) => norm(`${m.address} ${m.serial} ${m.id} ${m.area}`).includes(t))) return false;
      return true;
    });
    const order = MeterView.comparator(state.sort, state.sortReverse, districtOf);
    if (state.list !== "dispatch") return scoped.filter(m => inList(m, state.list)).sort(order);
    const ready = scoped.filter(m => inList(m, "dispatch"));
    const check = scoped.filter(m => !hidden(m) && ReviewPlan.fieldCheck(m, state.labels));
    state.fieldCounts = { ready: ready.length, check: check.length };
    state.fieldLaneEffective = state.fieldLane || (!ready.length && check.length ? "check" : "ready");
    if (state.fieldLaneEffective === "ready") return ready.sort(order);
    const short = ReviewPlan.fieldPreview(check);
    return state.sort === "suspicion" ? (state.sortReverse ? short.reverse() : short) : short.sort(order);
  }

  // ---------------- render ----------------
  function render() {
    document.body.dataset.view = state.view;
    document.querySelectorAll("[data-view]").forEach((b) => b.tagName === "BUTTON" && b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
    state.visible = visibleRows();
    const pages = Math.max(1, Math.ceil(state.visible.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    renderRail();
    renderBrief();
    renderAreas();
    renderTable();
    renderSelection();
    renderPager(pages);
    renderFocus();
    if (els.chartDialog.open && $("chartDialogDetail").dataset.id) {
      const open = state.byId.get($("chartDialogDetail").dataset.id);
      if (open) $("chartDialogDetail").innerHTML = detailHtml(open);
    }
    els.worklistCount.textContent = String(state.tripList.filter((e) => state.byId.has(e.id)).length);
  }

  function renderRail() {
    const counts = Object.fromEntries(LISTS.map((l) => [l.key, 0]));
    for (const m of state.meters) for (const l of LISTS) if (inList(m, l.key)) counts[l.key]++;
    const icons = { today: "✦", all: "◉", dispatch: "!", suspect: "?", watch: "◎", confirmed: "●", repaired: "✓", stable_high: "↔", learning: "◷", stale_contact: "○", hidden: "⊘" };
    const button = (l) => `<button type="button" data-list="${l.key}" aria-label="${esc(l.label)} (${counts[l.key]})" aria-pressed="${state.list === l.key}" title="${esc(l.hint || l.label)}"><i class="rail-icon" aria-hidden="true">${icons[l.key] || "○"}</i><span>${esc(l.label)}</span><b>${counts[l.key].toLocaleString("sv-SE")}</b></button>`;
    const main = PRIMARY_LISTS.map(key => LIST[key]);
    const more = LISTS.filter(l => !PRIMARY_LISTS.includes(l.key));
    const activeMore = more.find((l) => l.key === state.list);
    const moreOpen = (activeMore && !matchMedia("(max-width: 760px)").matches) || !!els.rail.querySelector(".rail-more[open]");
    const option = (l) => `<option value="${l.key}"${state.list === l.key ? " selected" : ""}>${esc(l.label)} (${counts[l.key]})</option>`;
    els.rail.innerHTML = `
      <div class="rail-lists">${main.map(button).join("")}</div>
      <details class="rail-more"${moreOpen ? " open" : ""}><summary aria-label="Fler listor"><i class="rail-icon" aria-hidden="true">⋯</i><span>Fler listor</span></summary><div class="rail-lists">${more.map(button).join("")}</div></details>
      <label class="rail-select"><span class="sr-only">Lista</span><select id="listSelect">${main.map(option).join("")}${activeMore ? option(activeMore) : ""}</select></label>`;
  }

  function areaSignalHtml(signal, detailed = false) {
    const stage = signal.stage === "early" ? "Preliminär" : "Upprepad ökning";
    const stats = signal.stats, near = signal.neighborhood;
    return `<div class="area-signal${signal.broad ? " is-broad" : ""}">
      <div class="area-signal-head"><div><b>${esc(signal.anchorAddress)}</b><span class="sub">${esc(stage)} · ${signal.count} mätare / ${signal.buildingCount} adresser · ${esc(Engine.fmtPeriod(signal.onsetFrom, signal.onsetTo, state.latestExport?.getFullYear()))}</span></div><span class="area-kind">${signal.broad ? "Kontrollera drift" : signal.subtle ? "Liten gemensam ökning" : "Gemensam ökning"}</span></div>
      ${stats ? `<div class="area-metrics"><div><strong>${esc(Engine.fmtSigned(stats.medianDelta))}</strong><span>medianökning i nivå</span></div><div><strong>${stats.medianPct == null ? "–" : esc(Engine.fmtPct(stats.medianPct))}</strong><span>mot egen referens</span></div><div><strong>${stats.simultaneousDays}</strong><span>gemensamma avläsningsdagar</span></div><div><strong>${near.rising} / ${near.total}</strong><span>adresser med samma ökning nära startpunkten</span></div></div>` : ""}
      <p>${esc(signal.summary)} ${signal.basis === "position" ? `Högst ca ${signal.diameterMeters} m mellan kartpunkterna.` : "Närhet enligt adress – kartpositioner behöver verifieras."}</p>
      ${signal.broad ? '<p class="area-drift">Många i urvalet stiger samtidigt. Kontrollera gemensam drift och säsong först.</p>' : ""}
      <button type="button" class="secondary" data-area-signal="${esc(signal.id)}">Markera ${signal.count} och visa området</button>
      ${detailed ? `<p>${esc(signal.action)}</p>${list(signal.notes)}<ul class="area-members">${signal.members.map((m) => `<li><button type="button" class="link" data-focus="${esc(m.id)}">${esc(m.address)}</button>: ${num(m.baseline)} → ${num(m.current)} (${m.pct == null ? "ingen procent" : Engine.fmtPct(m.pct)}) · ${m.readings} avläsningsdagar · referens ${esc(Engine.fmtPeriod(m.from, m.beforeTo, state.latestExport?.getFullYear()))}</li>`).join("")}</ul>` : ""}
    </div>`;
  }

  function renderBrief() {
    if (!state.files.length) {
      els.brief.innerHTML = `<div class="brief-empty"><p class="eyebrow">Från signal till åtgärd</p><h2>Se förändringen. Hitta nästa kontroll.</h2><p>Jämför dina Kamstrup-exporter med mätarens egen historik. Få en prioriterad lista, se utvecklingen på kartan och ta arbetslistan med ut.</p><div class="empty-actions"><button type="button" class="primary" data-act="source">Anslut exportmapp</button><button type="button" class="secondary" data-act="import">Importera Excel</button></div><p class="small">Historik och beslut sparas på den här enheten. Du kan börja med en fil och bygga historiken över tid.</p></div>`;
      return;
    }
    const areaOpen = els.brief.querySelector(".area-signals")?.open;
    const report = Engine.morning(state.meters, state.labels, state.latestExport);
    const exportAt = state.latestExport;
    const ageHours = exportAt ? (Date.now() - exportAt.getTime()) / 3600000 : Infinity;
    const time = exportAt ? `${Engine.fmtDate(exportAt, true)} ${String(exportAt.getHours()).padStart(2, "0")}:${String(exportAt.getMinutes()).padStart(2, "0")}` : "okänt";
    const fieldChecks = state.meters.filter(m => !hidden(m) && ReviewPlan.fieldCheck(m, state.labels)).length;
    els.brief.innerHTML = `
      <div class="brief-row">
        <div class="brief-heading"><span class="workspace-kicker">FÄLTCENTRAL / LÄGESBILD</span><h2>${esc(LIST[state.list]?.label || "Alla mätare")}</h2><p class="brief-date${ageHours > 30 ? " is-old" : ""}">${ageHours > 30 ? "Äldre export" : "Export"} <b>${esc(time)}</b><span title="Avlästa under senaste exportdygnet"> · ${report.fresh.toLocaleString("sv-SE")}/${report.total.toLocaleString("sv-SE")} avlästa</span></p></div>
        <div class="brief-stats" role="group" aria-label="Lägesbild"><button type="button" data-list="today"><b>${report.newToday.length.toLocaleString("sv-SE")}</b><span>Nya signaler</span></button>
          <button type="button" data-list="dispatch"><b>${report.dispatch.toLocaleString("sv-SE")}</b><span>Åk ut</span></button>
          <button type="button" data-field-lane="check"><b>${fieldChecks.toLocaleString("sv-SE")}</b><span>Kontrollera först</span></button></div>
        <div class="daily-tile"><div><b>Dagens granskning</b><small id="dailyStatusLine">Från mätdata till nästa kontroll</small></div><button type="button" class="primary" id="dailyButton">Granska idag</button></div>
      </div>`;
    if (state.list === "dispatch") {
      const { ready, check } = state.fieldCounts, lane = state.fieldLaneEffective;
      let note = "Inga kontrollförslag matchar nuvarande sökning och filter.";
      if (check) note = lane === "check"
        ? `Visar ${Math.min(check, ReviewPlan.FIELD_PREVIEW)} av ${check} förslag. Olika områden och adresser visas först. Granska underlaget innan du åker ut.`
        : "Kontrollera först visar vilka uppgifter som saknas inför fältbesök.";
      els.brief.insertAdjacentHTML("beforeend", `<div class="field-overview"><div><b>${ready ? `${ready} redo för fältkontroll` : "Inga redo för fältkontroll i urvalet"}</b><p>${note}</p></div><div class="field-lanes" role="group" aria-label="Fältberedskap"><button type="button" data-field-lane="ready" aria-pressed="${lane === "ready"}">Åk ut <b>${ready}</b></button><button type="button" data-field-lane="check" aria-pressed="${lane === "check"}">Kontrollera först <b>${check}</b></button></div></div>`);
    }
    if (state.list === "seasonal") {
      const verified = state.visible.filter(m => m.season?.status === "verified" || m.label?.type === "seasonal").length;
      const possible = state.visible.filter(m => m.season?.status === "possible" && m.label?.type !== "seasonal").length;
      els.brief.insertAdjacentHTML("beforeend", `<p class="season-notice">${verified} återkommande eller manuellt markerade · ${possible} möjliga säsongsmönster i urvalet. Möjlig säsong är en jämförelse mellan varma och kalla månader. Nya avvikelser behåller sin varning.</p>`);
    }
    if (state.areaSignals.length) {
      const top = state.areaSignals[0];
      const preview = top.stats ? `${Engine.fmtSigned(top.stats.medianDelta)} i nivå · ${top.stats.medianPct == null ? "referens 0" : Engine.fmtPct(top.stats.medianPct)} · ${top.buildingCount} adresser` : top.anchorAddress;
      const primary = state.areaSignals.slice(0, 5), extra = state.areaSignals.slice(5);
      els.brief.insertAdjacentHTML("beforeend", `<details class="area-signals"${areaOpen ? " open" : ""}><summary><span>Områdeskollen · ${state.areaSignals.length} områdessignal${state.areaSignals.length > 1 ? "er" : ""}</span><b>${esc(preview)}</b></summary><div class="area-signal-list">${primary.map((signal) => areaSignalHtml(signal)).join("")}${extra.length ? `<details class="area-more"><summary>Visa ${extra.length} fler områden</summary>${extra.map((signal) => areaSignalHtml(signal)).join("")}</details>` : ""}</div></details>`);
    }
    window.LeakAI?.refreshBadge();
  }

  function renderAreas() {
    const wanted = ["all", ...Parse.DISTRICTS.map(([n]) => n), "Övrigt"];
    if (els.area.options.length !== wanted.length) {
      els.area.innerHTML = wanted.map((v) => `<option value="${esc(v)}">${v === "all" ? "Alla" : esc(v)}</option>`).join("");
    }
    els.area.value = state.area;
    els.search.value !== state.search && document.activeElement !== els.search && (els.search.value = state.search);
    els.sort.value = state.sort;
    els.pageSize.value = String(state.pageSize);
    const shown = DEFAULT_HIDDEN.length - state.excluded.size;
    els.groupFilterCount.textContent = shown ? `(${shown} visas)` : "";
    els.groupFilter.querySelectorAll("input").forEach((i) => { i.checked = !state.excluded.has(i.value); });
  }

  const COPY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></svg>';
  for (const id of ["focusCopy", "chartCopy"]) document.getElementById(id).innerHTML = COPY_ICON;
  function copyButton(m) {
    return `<button type="button" class="copy-addr" data-copy="${esc(m.id)}" title="Kopiera adress" aria-label="Kopiera adress ${esc(shortAddress(m))}">${COPY_ICON}</button>`;
  }
  function shortAddress(m) { return String(m.address || m.id).replace(/\s+\d{3}\s?\d{2}$/, ""); }

  function changeHtml(m) {
    const baselineSort = state.sort === "baseline";
    const c = baselineSort ? (m.finding?.ref && m.finding?.now && m.finding.delta != null ? {
      from: m.finding.ref.level, delta: m.finding.delta, pct: m.finding.pct,
      fromDate: m.finding.ref.to,
    } : null) : m.changePrev;
    if (!m.latest) return `<span class="muted">Inga avläsningar</span>`;
    const old = m.latest.ageDays >= Engine.RULES.oldDays;
    const value = `<span class="val">${num(m.latest.value)}</span><span class="date${old ? " old" : ""}" title="Avläsningsdatum">${esc(Engine.fmtDate(m.latest.date))}${old ? ` · ${m.latest.ageDays} d` : ""}</span>`;
    if (!c) return `${value}<span class="chg muted">${baselineSort ? "jämförelse saknas" : "ingen tidigare"}</span>`;
    const dir = c.delta > 0 ? "up" : c.delta < 0 ? "down" : "flat";
    const pct = c.pct != null ? Engine.fmtPct(c.pct) : c.from === 0 ? "ingen %, från 0" : "–";
    return `${value}<span class="chg ${dir}" title="${baselineSort ? "Mot jämförelsenivå" : "Sedan föregående avläsning"} ${esc(Engine.fmtDate(c.fromDate))}: ${num(c.from)}">${Engine.fmtSigned(c.delta)} (${pct})</span><span class="sub">från ${num(c.from)} · ${esc(Engine.fmtDate(c.fromDate))}</span>`;
  }

  function rowHtml(m) {
    const marked = state.marked.has(m.id);
    const expanded = state.expanded.has(m.id);
    const field = state.list === "dispatch" ? m.field || (ReviewPlan.fieldCheck(m, state.labels) ? { state: "check", reason: m.areaSignal.action } : null) : null;
    const tags = [];
    if (m.excel.interestRank) tags.push(`<span class="tag" title="Kamstrups mätare av intresse i exporten ${esc(Engine.fmtDate(m.excel.exportDate, true))}">Kamstrup · rang ${m.excel.interestRank}</span>`);
    if (m.learnedLeakMatch) tags.push(`<span class="tag area-tag">Likt tidigare ${esc(m.learnedLeakMatch.lineType)}-läcka</span>`);
    if (m.areaSignal) tags.push(`<span class="tag area-tag">Områdessignal · ${m.areaSignal.count} mätare</span>`);
    if (m.season?.status === "possible") tags.push('<span class="tag season-tag" title="Skillnad mellan varma och kalla månader. Återkommande säsong är ännu inte verifierad; nya ökningar behåller sin varning.">Möjlig säsong</span>');
    if (m.label?.type) tags.push(`<span class="tag manual">${esc(Engine.LABELS[m.label.type] || m.label.type)}</span>`);
    if (m.codes.leak || m.codes.burst || m.codes.dry) tags.push(`<span class="tag code">Infokod ${esc(m.codes.infoCode)}</span>`);
    if (m.codes.acousticLeak || m.codes.acousticOther || m.codes.acousticUndetermined) tags.push(`<span class="tag code">Händelse: ${esc(m.codes.activeEvents)}</span>`);
    if (m.codes.follow) tags.push(`<span class="tag">Följs i Kamstrup</span>`);
    if (hidden(m)) tags.push(`<span class="tag">Gömd</span>`);
    if (state.tripList.some((e) => e.id === m.id)) tags.push(`<span class="tag">I arbetslista</span>`);
    return `<tr data-id="${esc(m.id)}" data-category="${esc(m.category)}" style="--meter-color:${MeterView.statuses[m.category]?.color || MeterView.statuses.normal.color}" class="row${marked ? " is-marked" : ""}${state.focusId === m.id ? " is-focus" : ""}">
      <td class="c-check"><input type="checkbox" data-mark ${marked ? "checked" : ""} aria-label="Markera ${esc(m.address)}"></td>
      <td class="c-status"><span class="pill cat-${esc(m.category)}">${esc(field?.state === "check" ? "KONTROLLERA FÖRST" : m.status)}</span>${state.sort === "excelP" ? "" : sortMetricHtml(m)}<span class="conf">underlag ${esc(m.confidence)}</span></td>
      <td class="c-addr"><span class="addr-line"><button type="button" class="addr" data-act="focus">${esc(shortAddress(m))}</button>${copyButton(m)}</span><span class="sub">${esc(m.serial || m.id)} · ${esc(districtOf(m))}</span>${tags.length ? `<span class="tags">${tags.join("")}</span>` : ""}</td>
      <td class="c-latest">${changeHtml(m)}${state.sort === "excelP" ? excelPHtml(m, true) : ""}${field ? `<span class="field-cue">${esc(field.reason)}</span>` : ""}</td>
      <td class="c-reason"><p class="summary">${esc(m.summary)}</p><p class="action">${esc(m.action)}</p></td>
      <td class="c-spark" data-act="chart" title="Öppna graf">${Chart.sparkline(m, { width: state.sparkWidth || 120 })}</td>
      <td class="c-menu"><button type="button" class="row-info" data-act="expand" aria-expanded="${expanded}" aria-label="${expanded ? "Dölj" : "Visa"} underlag" title="${expanded ? "Dölj" : "Visa"} underlag">i</button><button type="button" class="icon" data-act="menu" aria-label="Åtgärder för ${esc(m.address)}">⋯</button></td>
    </tr>${expanded ? `<tr class="detail-row" data-detail="${esc(m.id)}"><td colspan="7">${detailHtml(m)}</td></tr>` : ""}`;
  }

  function excelPHtml(m, compact = false) {
    const { E, F, P } = m.excel;
    const valid = Number.isFinite(P);
    const values = `E ${num(E)} / F ${num(F)} − 1`;
    return `<div class="excel-p${compact ? " compact" : ""}" data-state="${valid ? P > 0 ? "up" : P < 0 ? "down" : "flat" : "missing"}"><div><span>${compact ? "Mot snitt (P)" : "P · E/F − 1"}</span><strong>${valid ? esc(Engine.fmtPct(P)) : "–"}</strong></div><small>${valid ? esc(values) : F === 0 ? "F = 0 · procent saknas" : "E eller F saknas"}</small>${compact ? "" : '<p>Senaste värdet mot genomsnittet i samma exportrad. Nivåavvikelse, inte läcksannolikhet.</p>'}</div>`;
  }

  function sortMetricHtml(m) {
    const metrics = {
      excelP: m.excel.P != null ? [Engine.fmtPct(m.excel.P), "P = E/F − 1 · samma exportrad"] : null,
      suspicion: m.latest ? [`${m.priority} p`, "Analyspoäng 0–100 · rangordning, inte sannolikhet för läcka"] : null,
      priority: m.latest ? [`${m.priority} p`, "Analyspoäng inom arbetsordningen"] : null,
      kamstrup: m.excel.interestRank > 0 ? [`#${m.excel.interestRank}`, "Kamstrups rang i senaste exporten"] : null,
      persistence: m.upFinding ? [`${m.upFinding.persistence?.n ?? m.upFinding.now?.n ?? 0} avl.dagar`, "Faktiska avläsningsdagar i signalen"] : null,
      neighbors: m.areaSignal ? [`${m.areaSignal.buildingCount} adresser`, "Separata adresser i områdessignalen"] : null,
      confidence: [m.confidence, "Analysunderlag"],
      maxValue: m.series.length ? [`max ${num(Math.max(...m.series.map(p => p.value)))}`, "Högsta importerade brusvärde"] : null,
    };
    const metric = metrics[state.sort];
    return metric ? `<span class="sort-metric" title="${esc(metric[1])}">${esc(metric[0])}</span>` : "";
  }

  function comparisonHtml(m, compact = false) {
    const result = LeakComparison.windows(m.series, state.latestExport);
    if (!result) return "";
    const rows = result.periods.map(p => `<div class="comparison-cell${p.reliable ? "" : " is-preliminary"}"><span>Mot tidigare ${p.days} dagar</span><b>${p.reference == null ? "Saknas" : `${num(p.reference)} → ${num(result.current.level)}`}</b><small>${p.delta == null ? "Inga jämförbara värden" : `${Engine.fmtSigned(p.delta)} · ${p.percent == null ? "ingen procent" : esc(Engine.fmtPct(p.percent / 100))}`}</small><span class="comparison-quality">${p.n}/${p.days} dagar · ${p.reliable ? "jämförbart" : "preliminärt"}</span></div>`).join("");
    return `<section class="comparison-panel${compact ? " is-compact" : ""}" aria-label="Jämförelse av brusnivå"><div class="comparison-heading"><b>Nivåjämförelse</b><span>Senaste ${result.current.n}/3 dagar · median ${num(result.current.level)}</span></div><div class="comparison-grid">${rows}</div><p>Median mot skilda perioder före de senaste tre dagarna. ${result.ageDays >= 2 ? "Äldre avläsning. " : ""}Preliminärt vid glest underlag. Visar nivåskillnad, inte läcksannolikhet.</p></section>`;
  }

  function comparisonRows(m) {
    const rows = [];
    const c = m.changePrev;
    const year = state.latestExport?.getFullYear();
    const D = (d) => Engine.fmtDate(d, d && d.getFullYear() !== year);
    if (c) rows.push(["Sedan föregående avläsning", `${D(c.fromDate)} → ${D(c.toDate)}`, `${num(c.from)} → ${num(c.to)}`, Engine.fmtSigned(c.delta), c.pct != null ? Engine.fmtPct(c.pct) : "ingen procent"]);
    const f = m.finding;
    if (f?.ref && f.now) {
      const label = f.type === "stable" && m.sampling?.referenceReliable === false ? "Median av glesa observationer" : { new_signal: "Mot nuvarande nivå", level_shift: "Mot nivån före förändringen", trend: "Trend senaste 60 dagarna", stable: "Nuvarande nivå", transient: "Mot normal nivå" }[f.type] || "Jämförelse";
      const observationOnly = f.type === "stable" && m.sampling?.referenceReliable === false;
      rows.push([`${label}<span class="sub">${esc(m.baseline?.definition || "")}</span>`, `${Engine.fmtPeriod(f.ref.from, f.ref.to, year)} (${f.ref.n} avl.)`, observationOnly ? num(f.ref.level) : `${num(f.ref.level)} → ${num(f.now.level)}`, observationOnly ? "–" : Engine.fmtSigned(f.delta), observationOnly ? "–" : f.pct != null ? Engine.fmtPct(f.pct) : "ingen procent"]);
    }
    if (f?.older) rows.push(["Äldre nivå", `${Engine.fmtPeriod(f.older.from, f.older.to, year)} (${f.older.n} avl.)`, num(f.older.level), "", ""]);
    if (m.excel.E != null) rows.push(["P = E/F − 1 (senaste exportraden)", m.excel.exportDate ? D(m.excel.exportDate) : "", `F ${num(m.excel.F)} · E ${num(m.excel.E)} · G ${num(m.excel.G)}`, "", m.excel.P != null ? Engine.fmtPct(m.excel.P) : "beräknas inte"]);
    rows.push(["Minimiflöde (inte brus)", m.excel.minimumFlowAt ? D(m.excel.minimumFlowAt) : "Datum saknas", m.excel.minimumFlow == null ? "Saknas i exporten" : `${num(m.excel.minimumFlow)} l/h`, "", ""]);
    if (m.season?.sameTimeLastYear) rows.push(["Samma tid i fjol", Engine.fmtPeriod(m.season.sameTimeLastYear.from, m.season.sameTimeLastYear.to, 0), num(m.season.sameTimeLastYear.level), "", ""]);
    return rows.map((r) => `<tr><th scope="row">${r[0]}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`).join("");
  }

  function importTraceHtml(m) {
    const h = m.history;
    const rows = m.series.slice(-30).map(p => `<tr><td>${esc(Engine.fmtDate(p.date, true))}</td><td>${num(p.value)}</td><td>${num(p.exports)}</td><td>${esc(Engine.fmtDate(p.firstExport, true))}–${esc(Engine.fmtDate(p.lastExport, true))}</td></tr>`).join("");
    return `<details class="import-trace"><summary>${num(h.assessedReadings)} avläsningsdagar från ${num(h.exportRows)} exportrader · visa importspårning</summary><p>Appen använder avläsningsdatum i Excel. Samma avläsning i flera dagsexporter blir en punkt, även om exportdatum är nytt. Dagsexporten innehåller senaste värdet, inte hela Kamstrup-kurvan. ${num(h.reexports)} återexporterade rader, ${num(h.missingValues)} utan värde och ${num(h.undated)} utan giltigt avläsningsdatum. ${num(h.conflicts)} värdekonflikter för samma tidsstämpel.</p><p>Jämför dessa datum med Excel-raderna för mätaren. Tabellen visar högst 30 senaste avläsningsdagar i den analyserade historiken.</p><table class="cmp"><thead><tr><th>Avläsningsdag</th><th>Brusvärde</th><th>Exporter</th><th>Första–senaste export</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }

  function list(items) { return items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="muted">–</p>`; }

  function caseEvidenceHtml(m) {
    const records = (state.leakCases || []).filter((r) => r.anchorId === m.id);
    if (!records.length && !m.leakProfiles?.length) return "";
    const value = (p) => p.level == null ? "–" : `${num(p.level)} (${p.n} d)`;
    if (!records.length) return `<h4>Registrerade läckfall i närheten</h4>${list(m.leakProfiles.map((p) => `${p.lineType} · ${p.confirmedDate}: ${value(p.before)} → ${value(p.during)} → ${value(p.after)}. ${p.reason}`))}`;
    return records.map((r) => `<details class="case-evidence"><summary>${esc(r.lineType)}-läcka ${esc(r.confirmedDate)} · ${r.profiles.filter((p) => p.validated).length} jämförelsemönster</summary>
      <p class="hint">${r.repairedDate ? `Lagad ${esc(r.repairedDate)}` : "Inväntar lagdatum"}. Före → under → efter, median och avläsningsdagar. Kartnärhet upp till ${r.radiusMeters} m är ingen uppgift om ledningskoppling.</p>
      <ul>${r.profiles.map((p) => `<li><button type="button" class="link" data-focus="${esc(p.id)}">${esc(p.address)}</button><span class="sub">${value(p.before)} → ${value(p.during)} → ${value(p.after)}${p.basis === "position" ? ` · ca ${p.meters} m` : ""}. ${esc(p.reason)}</span></li>`).join("")}</ul></details>`).join("");
  }

  function detailHtml(m) {
    const label = state.labels[m.id] || {};
    const comment = label.comment ?? label.note ?? "";
    const qualityOpen = m.confidence === "tunt" || !m.latest || m.latest.ageDays >= Engine.RULES.oldDays || m.history.conflicts > 0 || m.codes.dry;
    return `<div class="detail">
      <section class="detail-analysis">
        ${comparisonHtml(m)}
        ${excelPHtml(m)}
        <div class="next-step"><h4>Nästa steg</h4><p>${esc(m.action)}</p></div>
        ${m.areaSignal ? `<h4>Möjlig gemensam källa i området</h4>${areaSignalHtml(m.areaSignal, true)}` : ""}
        ${caseEvidenceHtml(m)}
        <details class="evidence-section detail-assessment"><summary>Bedömning &amp; förklaringar <span>${esc(m.confidence)} underlag</span></summary><p class="assessment-summary">${esc(m.summary)}</p><h4>Observation</h4>${list(m.observations)}<h4>Möjlig förklaring</h4>${list(m.explanations)}</details>
        <details class="evidence-section detail-comparisons"><summary>Jämförelser</summary><table class="cmp"><thead><tr><th>Mått</th><th>Period</th><th>Värden</th><th>Skillnad</th><th>%</th></tr></thead><tbody>${comparisonRows(m)}</tbody></table></details>
        <details class="evidence-section detail-quality"${qualityOpen ? " open" : ""}><summary>Datakvalitet${qualityOpen ? ' <span class="quality-warning">Kontrollera underlaget</span>' : ""}</summary>${list(m.dataQuality)}${m.missing.length ? `<h4>Saknas för säkrare slutsats</h4>${list(m.missing)}` : ""}</details>
        ${importTraceHtml(m)}
        <details class="evidence-section detail-score"><summary>Analyspoäng <span>${m.priority}/100</span></summary><p class="hint">Rangordning, inte sannolikhet för läcka.</p><p class="parts">${m.priorityParts.map((p) => `${esc(p.name)} ${p.points > 0 ? "+" : ""}${p.points}`).join(" · ")}</p></details>
      </section>
      <section class="detail-decision">
        <h4>Beslut</h4><p>${m.label ? esc(Engine.LABELS[m.label.type] || m.label.type) + (m.label.at ? ` · ${esc(String(m.label.at).slice(0, 10))}` : "") : "Automatisk bedömning"}</p>
        <button type="button" class="secondary" data-act="menu">Ändra beslut</button>
        <label class="stack">Kommentar<textarea data-comment rows="3" placeholder="Följer med i arbetslistan och Excel">${esc(comment)}</textarea></label>
        <div class="detail-actions"><button type="button" class="secondary" data-act="chart">Stor graf</button><button type="button" class="secondary" data-act="ai"${m.series.length ? "" : " disabled"}>Claude-bedömning</button><button type="button" class="secondary" data-act="worklist">Lägg i arbetslista</button></div>
      </section>
    </div>`;
  }

  // The 60-day graph is drawn at the column's real width (no scaling of the page).
  function sparkWidthNow() {
    const th = document.querySelector(".meters thead th.c-spark");
    const w = th && th.offsetParent ? th.clientWidth - 16 : 0;
    return w > 40 ? Math.round(w / 20) * 20 : 120;
  }
  function renderTable() {
    state.sparkWidth = sparkWidthNow();
    const start = (state.page - 1) * state.pageSize;
    const page = state.visible.slice(start, start + state.pageSize);
    if (!state.files.length) {
      els.rows.innerHTML = `<tr><td colspan="7" class="empty">Importera Kamstrup-exporter för att starta.</td></tr>`;
    } else if (!page.length) {
      const empty = state.list === "dispatch" ? (state.fieldLaneEffective === "check" ? "Inga fall att kontrollera i det här urvalet." : "Inga redo för fältkontroll. Byt till Kontrollera först för att se möjliga nästa steg.")
        : `Inga mätare i ${esc(LIST[state.list].label)} med nuvarande sökning och filter.`;
      els.rows.innerHTML = `<tr><td colspan="7" class="empty">${empty}</td></tr>`;
    } else {
      els.rows.innerHTML = page.map(rowHtml).join("");
    }
    const onPage = page.filter((m) => state.marked.has(m.id)).length;
    els.checkPage.checked = page.length > 0 && onPage === page.length;
    els.checkPage.indeterminate = onPage > 0 && onPage < page.length;
    document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)));
  }

  function renderSelection() {
    const menuOpen = !!els.selection.querySelector(".selection-menu[open]");
    const total = state.visible.length;
    const start = (state.page - 1) * state.pageSize;
    const pageCount = Math.min(state.pageSize, Math.max(0, total - start));
    const marked = state.marked.size;
    const visibleIds = new Set(state.visible.map((m) => m.id));
    const outside = [...state.marked].filter((id) => !visibleIds.has(id)).length;
    const allMarked = total > 0 && state.visible.every((m) => state.marked.has(m.id));
    const resultCount = state.list === "dispatch" && state.fieldLaneEffective === "check"
      ? `${total} av ${state.fieldCounts.check} kontrollförslag` : `${total.toLocaleString("sv-SE")} träffar`;
    els.selection.classList.toggle("has-marked", marked > 0);
    els.selection.innerHTML = !state.files.length ? "" : `
      <p><b>${marked ? `${marked.toLocaleString("sv-SE")} markerade` : resultCount}</b>${outside ? ` <span class="muted" title="Markerade mätare utanför filtret finns kvar på kartan">· ${outside} utanför filtret</span>` : ""}</p>
      <div class="sort-shortcuts" role="group" aria-label="Sortera mätare"><button type="button" data-sort="value">Brus</button><button type="button" data-sort="change" title="Förändring sedan föregående avläsning">%</button><button type="button" data-sort="excelP" title="E/F − 1 från samma exportrad">Mot snitt (P)</button></div>
      <div class="sel-actions">
        ${marked ? `<button type="button" class="secondary" data-sel="move">Beslut</button>
        <button type="button" class="primary" data-sel="excel">Excel</button>` : ""}
        ${marked ? `<button type="button" class="secondary" data-sel="ai">AI-plan</button>` : ""}
        <details class="menu selection-menu"${menuOpen ? " open" : ""}><summary aria-label="${marked ? "Fler markeringsverktyg" : "Markera mätare"}">${marked ? "⋯" : "Markera"}</summary>
          <div class="menu-panel">
            <button type="button" data-sel="page" ${pageCount ? "" : "disabled"}>Markera sidan (${pageCount})</button>
            <button type="button" data-sel="all" ${total && !allMarked ? "" : "disabled"}>Markera alla ${total.toLocaleString("sv-SE")} träffar</button>
            ${marked ? `<button type="button" data-sel="worklist">Lägg i arbetslista (${marked})</button>
            <button type="button" data-sel="hide">${state.list === "hidden" ? "Visa igen" : "Göm"} (${marked})</button>
            <button type="button" data-sel="clear">Avmarkera</button>` : ""}
          </div>
        </details>
      </div>`;
    renderSortControls();
  }

  function renderSortControls() {
    const ascending = MeterView.ascendingSorts.has(state.sort) !== state.sortReverse;
    $("sortHelp").textContent = MeterView.sortHelp[state.sort] || "";
    $("sortLabel").textContent = MeterView.sortOptions.find(o => o.key === state.sort)?.label || "Mest misstänkt";
    $("sortOptions").querySelectorAll("[data-sort-option]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.sortOption === state.sort)));
    const directionButton = $("sortDirection");
    directionButton.textContent = ascending ? "↑" : "↓";
    directionButton.setAttribute("aria-label", `Byt sorteringsriktning · ${ascending ? "stigande" : "fallande"}`);
    directionButton.title = `${ascending ? "Stigande" : "Fallande"} · klicka för att vända`;
    directionButton.setAttribute("aria-pressed", String(state.sortReverse));
    document.querySelectorAll("[data-sort]").forEach((b) => {
      const active = b.dataset.sort === state.sort;
      const ascending = MeterView.ascendingSorts.has(state.sort) !== state.sortReverse;
      b.dataset.sortLabel ||= b.textContent;
      b.textContent = `${b.dataset.sortLabel}${active ? ascending ? " ↑" : " ↓" : ""}`;
      b.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".meters th").forEach(th => {
      if (th.querySelector('[data-sort]')) th.setAttribute('aria-sort', th.querySelector(`[data-sort="${state.sort}"]`) ? ascending ? 'ascending' : 'descending' : 'none');
    });
  }

  function renderPager(pages) {
    const total = state.visible.length;
    const start = total ? (state.page - 1) * state.pageSize + 1 : 0;
    const end = Math.min(total, state.page * state.pageSize);
    els.pageInfo.textContent = total ? `Visar ${start.toLocaleString("sv-SE")}–${end.toLocaleString("sv-SE")} av ${total.toLocaleString("sv-SE")} träffar · sida ${state.page}/${pages}` : "Inga träffar";
    els.prev.disabled = state.page <= 1;
    els.next.disabled = state.page >= pages;
  }

  // ---------------- focus: chart + map ----------------
  let mapView = null;
  let lastMapKey = "";
  let focusRequest = 0;
  let mapRenderVersion = 0;
  function ensureMap() {
    if (mapView || !window.LeakMap) return mapView;
    mapView = LeakMap.create({
      element: els.map, statusElement: els.mapStatus, legendElement: $("mapLegend"), missingElement: $("mapMissing"),
      onFocus: (id) => setFocus(id, { scroll: false }),
      onMarkMany: (ids) => { ids.forEach((id) => state.marked.add(id)); if (ids.length) setFocus(ids.includes(state.focusId) ? state.focusId : ids[0], { scroll: false }); render(); },
      label: (m) => shortAddress(m),
    });
    return mapView;
  }
  function renderFocus() {
    const m = state.byId.get(state.focusId);
    const showMap = state.view === "map";
    els.focus.hidden = !state.files.length || !showMap;
    els.focus.classList.toggle("no-meter", !m);
    els.focus.classList.toggle("chart-hidden", state.chartHidden);
    els.focusChart.hidden = state.chartHidden || !m;
    $("showFocusChart").hidden = !m || !state.chartHidden;
    $("correctMapAddress").disabled = !m;
    $("focusAI").disabled = !m?.series?.length;
    document.body.classList.toggle("has-focus", !els.focus.hidden);
    if (els.focus.hidden) { mapRenderVersion++; lastMapKey = ""; return; }
    if (m) {
      const change = m.changePrev;
      $("meterSummary").innerHTML = `<div class="meter-reading"><div><span class="sub">Senaste brusvärde</span><strong>${num(m.latest?.value)}</strong></div><span class="pill cat-${esc(m.category)}" style="background:${MeterView.statuses[m.category]?.color || MeterView.statuses.normal.color}">${esc(m.status)}</span></div><p class="meter-change" title="Sedan föregående avläsning">${change ? `${Engine.fmtSigned(change.delta)} (${change.pct == null ? "ingen procent" : esc(Engine.fmtPct(change.pct))}) <span>sedan ${esc(Engine.fmtDate(change.fromDate))}</span>` : "Ingen tidigare avläsning"}</p><dl><div><dt>Analyspoäng</dt><dd>${m.priority}<small>/100</small></dd></div><div><dt>Underlag</dt><dd>${esc(m.confidence)}</dd></div></dl><p class="meter-next">${esc(m.action)}</p><button type="button" class="secondary" data-focus-enlarge="${esc(m.id)}">Visa graf &amp; underlag ↗</button>`;
      $("meterSummary").insertAdjacentHTML("afterbegin", excelPHtml(m));
      $("meterSummary").insertAdjacentHTML("beforeend", comparisonHtml(m, true));
      els.focusTitle.textContent = m.address;
      $("focusCopy").dataset.copy = m.id;
      $("focusCopy").hidden = false;
      els.focusMeta.textContent = `${m.serial || m.id} · ${m.latest ? Engine.fmtDate(m.latest.date) : "Ingen avläsning"}${m.latest?.ageDays >= 2 ? ` · ${m.latest.ageDays} d sedan` : ""}`;
      const cases = (state.leakCases || []).filter((r) => r.anchorId === m.id);
    if (cases.length) els.focusMeta.textContent += caseGeocoding ? " · söker grannmätarnas adresspositioner…" : ` · ${cases.at(-1).profiles.filter((p) => p.validated).length} jämförelsemönster (Visa underlag)`;
      if (!state.chartHidden && (els.focusChart.__chart?.id !== m.id || els.focusChart.__version !== m)) {
        Chart.render(els.focusChart, m, { compact: true, onEnlarge: openChart });
        const close = document.createElement("button");
        close.type = "button";
        close.className = "chart-close";
        close.dataset.chartAction = "close";
        close.setAttribute("aria-label", "Stäng graf");
        close.title = "Stäng graf";
        close.textContent = "×";
        els.focusChart.appendChild(close);
        els.focusChart.__version = m;
      }
    } else {
      els.focusTitle.textContent = `Karta · ${LIST[state.list].label}`;
      $("focusCopy").hidden = true;
      els.focusMeta.textContent = ` · ${state.visible.length.toLocaleString("sv-SE")} mätare i listan`;
    }
    const view = ensureMap();
    if (!view) return;
    const mode = "results";
    const markedButton = $("showMarkedOnMap");
    markedButton.disabled = !state.marked.size;
    markedButton.textContent = `Visa markerade (${state.marked.size})`;
    // The list may change, but marked addresses remain on the map across tabs,
    // search, hidden groups and pagination. Focus only moves the camera.
    const markedMeters = [...state.marked].map((id) => state.byId.get(id)).filter(Boolean);
    const meters = [...new Map([...state.visible, ...markedMeters, ...(m ? [m] : [])].map((meter) => [meter.id, meter])).values()];
    const resultIds = [...new Set([...state.visible.map((meter) => meter.id), ...markedMeters.map((meter) => meter.id)])];
    const key = `${mode}|${focusRequest}|${state.focusId}|${[...state.marked].join(",")}|${state.list}|${state.search}|${state.area}|${JSON.stringify(meters.map(MeterView.mapRevision))}`;
    if (key === lastMapKey) return;
    lastMapKey = key;
    const run = ++mapRenderVersion;
    const snapshot = { meters, focusId: state.focusId, focusRequest, marked: new Set(state.marked), mode, resultIds };
    requestAnimationFrame(() => {
      if (run !== mapRenderVersion) return;
      const updating = view.update(snapshot);
      view.invalidate();
      Promise.resolve(updating).then(() => {
        if (run !== mapRenderVersion || !state.prepared) return;
        const coords = LeakMap.coordinates([...state.prepared.histories.values()]);
        const key = JSON.stringify([...coords].sort(([a], [b]) => a.localeCompare(b)));
        if (key !== state.coordinatesKey) reanalyze();
      }).catch(() => { /* Map status already reports address lookup failures. */ });
    });
  }

  let addressMeter = null;
  function openAddressDialog(meter) {
    if (!meter) return;
    addressMeter = meter;
    $("addressOriginal").textContent = `Från Excel: ${meter.address}`;
    $("addressInput").value = LeakMap.correctionFor(meter) || meter.address;
    $("addressSuggestions").replaceChildren();
    $("addressError").textContent = "";
    $("addressDialog").showModal();
    $("addressInput").focus();
  }
  $("correctMapAddress").addEventListener("click", () => openAddressDialog(state.byId.get(state.focusId)));
  $("mapMissing").addEventListener("click", event => {
    const button = event.target.closest("[data-correct-address]");
    if (button) openAddressDialog(state.byId.get(button.dataset.correctAddress));
  });
  $("addressInput").addEventListener("input", () => {
    $("addressError").textContent = "";
    $("addressSuggestions").innerHTML = LeakAddressIndex.suggestions($("addressInput").value).map(s => `<option value="${esc(s)}"></option>`).join("");
  });
  async function saveAddress(address) {
    if (!addressMeter) return;
    try {
      await LeakMap.correctAddress(addressMeter, address);
      $("addressDialog").close();
      lastMapKey = "";
      setFocus(addressMeter.id, { scroll: false });
      reanalyze();
    } catch (error) { $("addressError").textContent = error.message; }
  }
  $("addressForm").addEventListener("submit", event => { event.preventDefault(); saveAddress($("addressInput").value); });
  $("addressReset").addEventListener("click", () => saveAddress(""));

  // Selecting a meter only updates the focus panel; the table is not rebuilt.
  function setFocus(id, { scroll = true, keepRow = null } = {}) {
    clearTimeout(focusTimer);
    if (id) state.chartHidden = false;
    const switchToMap = Boolean(id) && state.view !== "map";
    if (switchToMap) {
      state.view = "map";
      try { localStorage.setItem(VIEW_KEY, state.view); } catch { /* optional */ }
    }
    state.focusId = id;
    focusRequest++;
    els.rows.querySelectorAll("tr.row").forEach((tr) => tr.classList.toggle("is-focus", tr.dataset.id === id));
    const rowTop = keepRow?.isConnected ? keepRow.getBoundingClientRect().top : null;
    if (switchToMap) render(); else renderFocus();
    if (rowTop != null && keepRow?.isConnected && window.matchMedia("(min-width: 761px)").matches) {
      const list = keepRow.closest(".table-wrap");
      if (list) list.scrollTop += keepRow.getBoundingClientRect().top - rowTop;
    }
    if (scroll && window.matchMedia("(max-width: 760px)").matches) {
      els.focus.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function openChart(id) {
    const m = state.byId.get(id);
    if (!m) return;
    $("chartDialogTitle").textContent = m.address;
    $("chartCopy").dataset.copy = m.id;
    $("chartDialogMeta").textContent = `${m.serial || m.id} · ${m.status} · ${m.confidence} underlag`;
    $("chartDialogDetail").innerHTML = detailHtml(m);
    $("chartDialogDetail").dataset.id = m.id;
    if (!els.chartDialog.open) els.chartDialog.showModal();
    requestAnimationFrame(() => Chart.render($("chartDialogChart"), m, { compact: false }));
  }

  // ---------------- decisions ----------------
  let undo = null;
  function applyDecision(ids, type, fields = {}, comment) {
    const before = Object.fromEntries(ids.map((id) => [id, state.labels[id] ? structuredClone(state.labels[id]) : null]));
    const now = new Date().toISOString();
    for (const id of ids) {
      const m = state.byId.get(id);
      const existing = { ...(state.labels[id] || {}) };
      // Keep the replaced decision with its details; undo covers immediate mistakes.
      if (existing.type) existing.previous = Object.fromEntries(["type", "at", "source", ...DECISION_FIELDS].filter((k) => existing[k] !== undefined).map((k) => [k, existing[k]]));
      if (type === "leak" && before[id]?.type === "repaired" && before[id]?.confirmedDate) {
        const prior = Object.fromEntries(DECISION_FIELDS.filter((k) => before[id][k] !== undefined).map((k) => [k, before[id][k]]));
        existing.leakCases = [...(existing.leakCases || []), prior];
      }
      for (const key of DECISION_FIELDS) delete existing[key];
      const incident = type === "repaired" && ["leak", "repaired"].includes(before[id]?.type)
        ? Object.fromEntries(["confirmedDate", "confirmedDateUncertain", "lineType", "mapMarks"].filter((k) => before[id][k] !== undefined).map((k) => [k, before[id][k]])) : {};
      const next = type === "auto"
        ? (() => { delete existing.type; delete existing.at; delete existing.source; return existing; })()
        : { ...existing, ...incident, ...fields, type, at: now, source: "fältbeslut", address: m?.address || existing.address, serial: m?.serial || existing.serial };
      if (type === "ignored") delete next.hidden;
      if (type !== "auto" && !next.notedDate && !["leak", "repaired"].includes(type)) next.notedDate = today();
      if (comment !== undefined) { next.comment = comment; next.commentAt = now; }
      state.labels[id] = next;
    }
    undo = before;
    persist();
    reanalyze();
    const label = type === "auto" ? "automatisk bedömning" : Engine.LABELS[type] || type;
    toast(`${ids.length} mätare → ${label}.`, true);
  }

  function setHidden(ids, value) {
    const before = Object.fromEntries(ids.map((id) => [id, state.labels[id] ? structuredClone(state.labels[id]) : null]));
    for (const id of ids) state.labels[id] = { ...(state.labels[id] || {}), hidden: value, visibilityUpdatedAt: new Date().toISOString() };
    undo = before;
    ids.forEach((id) => state.marked.delete(id));
    persist();
    render();
    toast(value ? `${ids.length} mätare gömda. Beslut och historik finns kvar under Gömda.` : `${ids.length} mätare visas igen.`, true);
  }

  function setComment(id, text) {
    state.labels[id] = { ...(state.labels[id] || {}), comment: text, commentAt: new Date().toISOString() };
    persist();
  }

  function openDecision(ids, type) {
    const meters = ids.map((id) => state.byId.get(id)).filter(Boolean);
    if (!meters.length) return;
    const first = meters[0];
    const existing = state.labels[first.id] || {};
    const mark = window.LeakMap?.markFor(first.id);
    els.decisionForm.dataset.ids = JSON.stringify(ids);
    els.decisionForm.dataset.type = type;
    els.decisionTarget.textContent = meters.length > 1 ? `${meters.length} markerade mätare – samma uppgifter sparas på alla` : first.address;
    els.decisionComment.value = existing.comment ?? existing.note ?? "";
    els.decisionError.textContent = "";
    if (type === "leak") {
      els.decisionTitle.textContent = "Konstaterad läcka";
      els.decisionFields.innerHTML = `
        <label class="stack">Datum konstaterad<input type="date" name="confirmedDate" required value="${esc(existing.confirmedDate || today())}"></label>
        <label class="check"><input type="checkbox" name="confirmedDateUncertain" ${existing.confirmedDateUncertain ? "checked" : ""}> Osäkert datum</label>
        <fieldset class="inline"><legend>Ledning</legend>${["AV", "SV", "Vet ej"].map((v) => `<label><input type="radio" name="lineType" value="${v}" ${existing.lineType === v ? "checked" : ""}> ${v === "AV" ? "AV · huvudledning" : v === "SV" ? "SV · servis" : v}</label>`).join("")}</fieldset>
        <label class="stack">Lagdatum (valfritt)<input type="date" name="repairedDate" value="${esc(existing.repairedDate || "")}"></label>
        <p class="hint">Lagdatum flyttar fallet till Lagade. Ljudnivåerna före, under och efter jämförs även hos närliggande mätare.</p>`;
    } else if (type === "repaired") {
      els.decisionTitle.textContent = "Lagad";
      const distance = existing.distanceMeters ?? mark?.distanceFromMeter ?? "";
      els.decisionFields.innerHTML = `
        <label class="stack">Datum konstaterad<input type="date" name="confirmedDate" value="${esc(existing.confirmedDate || "")}"></label>
        <label class="check"><input type="checkbox" name="confirmedDateUncertain" ${existing.confirmedDateUncertain ? "checked" : ""}> Osäkert läckdatum</label>
        <label class="stack">Reparationsdatum<input type="date" name="repairedDate" required value="${esc(existing.repairedDate || today())}"></label>
        <fieldset class="inline"><legend>Ledning</legend>${["AV", "SV"].map((v) => `<label><input type="radio" name="lineType" value="${v}" ${existing.lineType === v ? "checked" : ""}> ${v === "AV" ? "AV · huvudledning" : "SV · servis"}</label>`).join("")}</fieldset>
        <p class="hint">Vid känt läckdatum jämförs närliggande mätare automatiskt. Samma dag räcker inte för att mäta en nivå under läckan.</p>
        <label class="stack">Ungefärligt avstånd från mätaren (m)<input type="number" name="distanceMeters" min="0" step="1" inputmode="numeric" value="${esc(distance)}" placeholder="t.ex. 55"></label>
        <label class="check"><input type="checkbox" name="distanceUncertain" ${existing.distanceUncertain || (mark?.distanceFromMeter != null && existing.distanceMeters == null) ? "checked" : ""}> Avstånd osäkert${mark?.distanceFromMeter != null ? " (förifyllt från kartans läckpunkt, fågelväg)" : ""}</label>`;
    } else if (type === "reset_baseline") {
      const now = new Date();
      els.decisionTitle.textContent = "Nollställ";
      els.decisionFields.innerHTML = `<p>Från och med <b>${esc(Engine.fmtDate(now, true))} kl. ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}</b> bedöms bara avläsningar som tas efter denna tidpunkt. Äldre historik finns kvar i grafen men påverkar inte bedömningen.</p><p class="hint">Minst två nya avläsningar behövs innan förändringar kan upptäckas.</p>`;
    }
    els.decisionDialog.showModal();
  }

  els.decisionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const ids = JSON.parse(els.decisionForm.dataset.ids || "[]");
    let type = els.decisionForm.dataset.type;
    const data = new FormData(els.decisionForm);
    const fields = {};
    if (type === "leak") {
      fields.confirmedDate = data.get("confirmedDate");
      if (!fields.confirmedDate) { els.decisionError.textContent = "Ange datum (markera Osäkert datum vid behov)."; return; }
      fields.confirmedDateUncertain = data.get("confirmedDateUncertain") === "on";
      if (data.get("lineType")) fields.lineType = data.get("lineType");
      if (data.get("repairedDate")) type = "repaired";
    }
    if (type === "repaired") {
      fields.confirmedDate = data.get("confirmedDate") || undefined;
      fields.confirmedDateUncertain = data.get("confirmedDateUncertain") === "on";
      fields.repairedDate = data.get("repairedDate");
      if (!fields.repairedDate) { els.decisionError.textContent = "Ange reparationsdatum."; return; }
      if (data.get("lineType")) fields.lineType = data.get("lineType");
      const distance = Parse.parseNumber(data.get("distanceMeters"));
      if (distance != null) fields.distanceMeters = distance;
      fields.distanceUncertain = data.get("distanceUncertain") === "on";
      const mark = window.LeakMap?.markFor(ids[0]);
      if (mark?.leak) fields.mapMarks = { valve: mark.valve || null, leak: mark.leak };
    }
    if (fields.confirmedDate && fields.repairedDate && fields.repairedDate < fields.confirmedDate) {
      els.decisionError.textContent = "Lagdatum kan inte ligga före läckdatum."; return;
    }
    if (type === "reset_baseline") fields.resetAfter = new Date().toISOString();
    applyDecision(ids, type, fields, els.decisionComment.value.trim());
    els.decisionDialog.close();
  });

  function decide(ids, type) {
    if (!ids.length) return;
    const def = DECISIONS.find((d) => d.type === type);
    if (def?.form) openDecision(ids, type);
    else applyDecision(ids, type);
  }

  // ---------------- context menu (one place for "Flytta till") ----------------
  let menuIds = [];
  function openMenu(ids, x, y, anchor) {
    menuIds = ids;
    const single = ids.length === 1 ? state.byId.get(ids[0]) : null;
    const hasManual = ids.some((id) => state.labels[id]?.type);
    const isHidden = ids.every((id) => state.labels[id]?.hidden);
    els.menu.innerHTML = `
      <p class="menu-title">${single ? esc(shortAddress(single)) : `${ids.length} markerade mätare`}</p>
      ${single ? `<button type="button" role="menuitem" data-menu="navigate">Kör hit</button>` : ""}
      <button type="button" role="menuitem" data-menu="worklist">Lägg i arbetslista</button>
      <p class="menu-sub">Flytta till</p>
      ${DECISIONS.filter((d) => ["manual_dispatch", "interesting", "leak", "repaired"].includes(d.type)).map((d) => `<button type="button" role="menuitem" data-decision="${d.type}">${esc(d.label)}</button>`).join("")}
      <details class="menu-sort menu-decisions"><summary>Övriga beslut</summary>
        ${DECISIONS.filter((d) => !["manual_dispatch", "interesting", "leak", "repaired"].includes(d.type)).map((d) => `<button type="button" role="menuitem" data-decision="${d.type}">${esc(d.label)}</button>`).join("")}
        <button type="button" role="menuitem" data-menu="${isHidden ? "unhide" : "hide"}">${isHidden ? "Visa igen" : "Göm manuellt"}</button>
      </details>
      ${hasManual ? `<button type="button" role="menuitem" data-decision="auto">Ta bort manuellt beslut</button>` : ""}
      <details class="menu-sort"><summary>Sortera efter</summary>
        ${[...els.sort.options].map((o) => `<button type="button" role="menuitemradio" aria-checked="${state.sort === o.value}" data-menu-sort="${esc(o.value)}">${esc(o.text)}${state.sort === o.value ? " ✓" : ""}</button>`).join("")}
      </details>`;
    els.menu.hidden = false;
    const w = els.menu.offsetWidth, h = els.menu.offsetHeight;
    if (anchor) { const r = anchor.getBoundingClientRect(); x = r.right - w; y = r.bottom + 4; }
    els.menu.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
    els.menu.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
    els.menu.querySelector("button")?.focus();
  }
  els.menu.addEventListener("toggle", (event) => {
    if (!event.target.matches(".menu-sort") || els.menu.hidden) return;
    const top = Math.min(parseFloat(els.menu.style.top) || 8, innerHeight - els.menu.offsetHeight - 8);
    els.menu.style.top = `${Math.max(8, top)}px`;
  }, true);
  function closeMenu() { els.menu.hidden = true; menuIds = []; }
  els.menu.addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    const ids = menuIds;
    closeMenu();
    if (b.dataset.menuSort) { state.sort = b.dataset.menuSort; state.sortReverse = false; els.sort.value = state.sort; state.page = 1; render(); return; }
    if (b.dataset.decision) decide(ids, b.dataset.decision);
    const act = b.dataset.menu;
    if (act === "focus") setFocus(ids[0]);
    if (act === "navigate") window.open(LeakMap.navigationUrl(state.byId.get(ids[0])), "_blank", "noopener,noreferrer");
    if (act === "worklist") addToWorklist(ids);
    if (act === "copy") copyAddress(state.byId.get(ids[0]));
    if (act === "hide") setHidden(ids, true);
    if (act === "unhide") setHidden(ids, false);
  });
  els.menu.addEventListener("keydown", (event) => {
    const items = [...els.menu.querySelectorAll("button, .menu-sort summary")].filter((el) => el.getClientRects().length);
    const i = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") { event.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (event.key === "ArrowUp") { event.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  // Row actions apply to all marked meters when the row itself is marked.
  const targetIds = (id) => (state.marked.has(id) ? [...state.marked] : [id]);

  async function copyAddress(m, button) {
    if (!m) return;
    const text = shortAddress(m).replace(new RegExp(`\\s+(${Parse.DISTRICTS.flatMap(([, n]) => n).join("|")})\\s*$`, "i"), "").trim();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      // Fallback for browsers without the async clipboard (e.g. plain http).
      const area = document.createElement("textarea");
      area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      area.remove();
    }
    toast(ok ? `Kopierat: ${text}` : `Kunde inte kopiera automatiskt: ${text}`);
    if (ok && button) {
      button.classList.add("copied");
      setTimeout(() => button.classList.remove("copied"), 1200);
    }
  }
  // Visible copy buttons next to addresses (list, focus, chart, work list).
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    event.preventDefault();
    copyAddress(state.byId.get(button.dataset.copy), button);
  });

  // ---------------- toast ----------------
  let toastTimer = 0;
  function toast(text, withUndo = false) {
    els.toast.innerHTML = `<span>${esc(text)}</span>${withUndo ? '<button type="button" class="link" data-undo>Ångra</button>' : ""}`;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, withUndo ? 9000 : 5000);
  }
  els.toast.addEventListener("click", (event) => {
    if (!event.target.closest("[data-undo]") || !undo) return;
    for (const [id, label] of Object.entries(undo)) { if (label) state.labels[id] = label; else delete state.labels[id]; }
    undo = null;
    persist();
    reanalyze();
    toast("Ändringen ångrades.");
  });

  // ---------------- worklist ----------------
  const worklist = LeakWorklist.create({
    dialog: $("worklistDialog"), exportDialog: $("exportDialog"),
    getEntries: () => state.tripList, setEntries: (list) => { state.tripList = list; },
    getMeter: (id) => state.byId.get(id), getLabels: () => state.labels, copyButton,
    onFocus: (id, ids) => { ids.forEach((pickedId) => state.marked.add(pickedId)); setFocus(id); render(); },
    getComment: (id) => state.labels[id]?.comment ?? state.labels[id]?.note ?? "",
    setComment: (id, text) => { setComment(id, text); },
    persist: () => persist(), onChange: () => render(), notify: (t) => toast(t),
  });
  function addToWorklist(ids) {
    const { added, already } = worklist.add(ids);
    toast(`${added} mätare lagda i arbetslistan${already ? ` (${already} fanns redan)` : ""}.`);
  }

  // ---------------- info menu ----------------
  function openRules() {
    const R = Engine.RULES;
    els.rulesDialog.innerHTML = `
      <div class="dialog-head"><div><h2 id="rulesTitle">Om analysen</h2><p class="small">Lokal, regelbaserad motor. Inga mätardata skickas till någon språkmodell eller ny extern tjänst.</p></div><button type="button" class="secondary" data-close>Stäng</button></div>
      <div class="rules">
        <h3>Värden</h3><p>Kamstrup Leak Detectors exporterade brusvärde (dagens lägsta filtrerade värde). Kamstrup anger ingen enhet; procent är procent av exportvärdet, inte förändring av ljudintensitet.</p>
        <h3>Avläsningar</h3><p>Kurvan byggs på avläsningsdatum, inte exportdatum. Samma avläsning i flera exporter räknas en gång. Grafen bryts när en mellanliggande dag saknas. Grått betyder att avläsningar saknas i appens importerade filer; Kamstrup kan ha fler värden. Medianen är ett räknat jämförelsemått, inte avläsningar mellan punkterna.</p>
        <p>Glest underlag får inte beskrivas som stabilitet: jämförelseperioden behöver minst ${Math.round(R.stableMinCoverage * 100)} % importerade avläsningsdagar och högst ${R.gapDays} dagar mellan punkterna. Detta är appens egna regler för underlag, inte Kamstrups läckalgoritm. Manuella beslut och verkliga uppåtgående signaler behålls.</p>
        <h3>Jämförelser</h3><ul>
          <li><b>Sedan föregående avläsning</b>: senaste värde mot föregående avläsningsdag, (nytt / tidigare) − 1.</li>
          <li><b>Mot jämförelsenivå</b>: median av mätarens egna avläsningar före förändringen, med angiven period.</li>
          <li><b>P = E/F − 1</b>: Senaste värde och Genomsnittsvärde från samma rad i senaste exporten. Används bara som stöd när egen historik är kort (under ${R.longTermDays} dagar): en ökning som stannar under F dämpas om mätaren före ökningen aldrig nått F, och en nivå på minst dubbla F lyfts som Misstänk med kort historik.</li>
          <li>Tidigare värde 0 ger ingen procentsats. Saknat värde är inte noll.</li></ul>
        <h3>Förändringar</h3><ul>
          <li>En nivåförändring måste vara större än max(${R.absMin}, ${R.sigmaK} × mätarens normala dag-till-dag-variation, ${Math.round(R.relMin * 100)} % av nivån). Med färre än ${R.minOwnPairs} jämförbara avläsningspar används ${Math.round(R.priorSigmaRel * 100)} % av nivån som variation.</li>
          <li><b>Ny signal</b>: en enda avläsning större än max(${R.signalAbs}, ${R.sigmaK} × variationen, ${Math.round(R.signalRel * 100)} % av nivån) – kontrollera nästa.</li>
          <li><b>Ny nivå</b>: minst två avläsningar på samma sida; en återgång inom fyra avläsningar gör den till tillfällig topp. Bestående först efter minst fem avläsningar under minst fem dagar.</li>
          <li><b>Gradvis ökning</b>: robust trend (Theil–Sen) över ${R.trendWindowDays} dagar.</li>
          <li><b>Tillfällig topp</b>: bara när återgången faktiskt har observerats.</li>
          <li>Återkommande kortvariga toppar jämförs med mätarens eget toppmönster.</li>
          <li>En nivå som höjts ligger kvar som jämförelse – den absorberas inte i baslinjen. Nollställ för att börja om.</li></ul>
        <h3>Prioritet 0–100</h3><p>Rangordning av vad som bör kontrolleras först: förändringens storlek, antal avläsningar och varaktighet, aktualitet, absolut nivå, infokoder, störmiljö och säsong. Samma händelse räknas en gång. Inte en sannolikhet för läcka.</p>
        <h3>Infokoder och händelser</h3><ul>
          <li>LEAK: vattnet har inte stått still en sammanhängande timme senaste dygnet – läcka efter mätaren möjlig (lista Efter mätare).</li>
          <li>BURST: högt flöde i 30 minuter – rörbrott efter mätaren möjligt.</li>
          <li>DRY: mätaren är inte vattenfylld. Inte kommunikationsfel.</li>
          <li>Leak Detector-händelse Läckage anger inte om läckan ligger före eller efter mätaren. Ej fastställt och Annat brus är händelser, inte läcka.</li>
          <li>Stängda händelser och Kamstrups Följ-markering visas som information.</li></ul>
        <h3>Säsong och grannar</h3><p>Verifierat årsmönster kräver minst två växlingar vinter/sommar. En vinter och en sommar räknas bara som möjligt mönster. Samtidig ökning på samma adress eller gata visas som möjlig gemensam påverkan – det visar inte läckans plats. Avstånd visas bara när båda adresserna har exakt kartposition.</p>
        <h3>Manuella beslut</h3><p>Konstaterad läcka och Lagad sätts bara manuellt. Automatiken markerar aldrig en läcka som lagad för att värdet sjunker. Bevaka är din manuella lista; Misstänk är automatisk upptäckt. Säsong/störning dämpar ett känt mönster men en tydlig ny avvikelse visas ändå.</p>
      </div>`;
    els.rulesDialog.showModal();
  }
  function backup() {
    const blob = new Blob([LeakBackup.stringify(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `leaksok-arbetsyta-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  let pendingRestore = null;
  $("backupInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    pendingRestore = null;
    try {
      pendingRestore = LeakBackup.parse(await file.text());
      $("restoreSummary").textContent = `${pendingRestore.files.length} exporter · ${Object.keys(pendingRestore.labels).length} beslut · ${pendingRestore.tripList.length} mätare i arbetslistan.`;
      $("restoreError").textContent = "";
      $("restoreApply").disabled = false;
      $("restoreDialog").showModal();
    } catch (error) { toast(`Kunde inte öppna säkerhetskopian: ${error.message}`); }
    finally { event.target.value = ""; }
  });
  $("restoreApply").addEventListener("click", async () => {
    if (!pendingRestore || state.importing || folderImport.isBusy()) { $("restoreError").textContent = "Vänta tills pågående import är klar."; return; }
    $("restoreApply").disabled = true;
    state.importing = true;
    const previous = { files: state.files, labels: state.labels, tripList: state.tripList };
    try {
      const merged = LeakBackup.merge(previous, { ...pendingRestore, files: hydrateFiles(pendingRestore.files) });
      // Analyse before committing the transaction; a failed restore leaves
      // both the on-disk snapshot and the current workspace intact.
      const prepared = Engine.prepare(merged.files);
      Engine.analyzePrepared(prepared, merged.labels);
      await LeakStorage.saveAll(state.profileId, merged);
      Object.assign(state, merged);
      state.historyDirty = false;
      state.storageError = "";
      reanalyze(true);
      try { localStorage.setItem(LABEL_BACKUP_KEY, JSON.stringify(state.labels)); } catch { /* IndexedDB saved */ }
      pendingRestore = null;
      $("restoreDialog").close();
      renderSource();
      setImportStatus(`${state.files.length} exporter i historiken · arbetsytan återställd och sparad.`);
      toast("Säkerhetskopian tillagd. Befintlig historik och nyare beslut har behållits.");
    } catch (error) { $("restoreError").textContent = `Kunde inte återställa: ${error.message}. Befintlig arbetsyta finns kvar.`; }
    finally { state.importing = false; $("restoreApply").disabled = false; }
  });
  async function clearFiles() {
    if (state.importing || folderImport.isBusy()) { toast("Vänta tills importen är klar."); return; }
    if (!confirm(`Rensa ${state.files.length} importerade filer på den här enheten? Manuella beslut, kommentarer och arbetslistan behålls.`)) return;
    try { await folderImport.disconnect(); }
    catch (error) { toast(`Kunde inte stoppa mappimporten: ${error.message}. Inget har rensats.`); return; }
    const previous = state.files;
    const previousDirty = state.historyDirty;
    state.files = [];
    state.historyDirty = true;
    if (!await persist(true)) { state.files = previous; state.historyDirty = previousDirty; renderSource(); return; }
    reanalyze(true);
    await window.LeakAI?.clearDaily(state.profileId);
    setImportStatus("");
    renderImportLog([], []);
    toast("Importerade filer rensade och mappimport frånkopplad. Beslut och kommentarer finns kvar.");
  }

  // ---------------- events ----------------
  els.pickFiles.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (e) => handleFiles(e.target.files));
  const drop = $("dropzone");
  ["dragenter", "dragover"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add("is-drag"); }));
  ["dragleave", "drop"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove("is-drag"); }));
  drop.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));

  document.addEventListener("click", (event) => {
    const t = event.target;
    if (t.closest("#dailyButton")) { window.LeakAI?.openDaily(); return; }
    const aiButton = t.closest('[data-act="ai"], #focusAI, [data-sel="ai"]');
    if (aiButton) {
      const id = aiButton.closest('[data-detail]')?.dataset.detail || aiButton.closest('#chartDialogDetail')?.dataset.id || state.focusId;
      const meters=(aiButton.dataset.sel==='ai'?[...state.marked].map(id=>state.byId.get(id)):[state.byId.get(id)]).filter(Boolean);
      if(!meters.some(m=>m.series.length)){toast('Välj en mätare med avläsningar.');return;}
      window.LeakAI?.open(meters,{histories:state.prepared?.histories,latestExport:state.latestExport});
      return;
    }
    if (!t.closest("#contextMenu") && !els.menu.hidden && !t.closest("[data-act='menu']") && !t.closest("#focusMenu") && !t.closest("[data-sel='move']")) closeMenu();
    document.querySelectorAll("details.menu[open]").forEach((d) => { if (!d.contains(t)) d.open = false; });
    const areaButton = t.closest("[data-area-signal]");
    if (areaButton) {
      const signal = state.areaSignals.find((s) => s.id === areaButton.dataset.areaSignal);
      if (!signal) return;
      signal.ids.forEach((id) => state.marked.add(id));
      state.focusId = signal.anchorId;
      state.expanded.add(signal.anchorId);
      lastMapKey = "";
      render();
      toast(`${signal.count} mätare i området markerade. Tidigare markeringar finns kvar.`);
      return;
    }
    const fieldButton = t.closest("[data-field-lane]");
    if (fieldButton) { setList("dispatch", fieldButton.dataset.fieldLane); return; }
    const listButton = t.closest("[data-list]");
    if (listButton) {
      if (matchMedia("(max-width: 760px)").matches) listButton.closest(".rail-more")?.removeAttribute("open");
      if (event.detail) els.rail.classList.add("is-dismissed");
      setList(listButton.dataset.list); return;
    }
    const focusButton = t.closest("[data-focus]");
    if (focusButton) { setFocus(focusButton.dataset.focus); return; }
    if (t.closest("[data-act='import']")) els.fileInput.click();
    if (t.closest("[data-act='source']")) openSource();
    const viewButton = t.closest("button[data-view]");
    if (viewButton) {
      state.view = viewButton.dataset.view;
      try { localStorage.setItem(VIEW_KEY, state.view); } catch { /* optional */ }
      render();
      if (state.view === "map" && window.matchMedia("(max-width: 760px)").matches) els.focus.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (t.closest("[data-close]")) t.closest("dialog")?.close();
    const info = t.closest("[data-info]")?.dataset.info;
    if (info) document.querySelectorAll("details.menu[open]").forEach((d) => { d.open = false; });
    if (info === "rules") openRules();
    if (info === "backup") backup();
    if (info === "restore") $("backupInput").click();
    if (info === "lock") showProfile();
    if (info === "clear") clearFiles();
  });
  $("openWorklist").addEventListener("click", () => worklist.open());
  $("rail").addEventListener("change", (e) => { if (e.target.id === "listSelect") setList(e.target.value); });
  els.rail.addEventListener("pointerleave", () => els.rail.classList.remove("is-dismissed"));

  function setList(key, lane = null) {
    if (!LIST[key]) return;
    clearTimeout(focusTimer);
    state.list = key;
    state.fieldLane = key === "dispatch" ? lane : null;
    state.view = "map";
    try { localStorage.setItem(VIEW_KEY, state.view); } catch { /* optional */ }
    state.page = 1;
    if (!state.marked.has(state.focusId) || !state.byId.has(state.focusId)) state.focusId = "";
    focusRequest++;
    lastMapKey = "";
    render();
  }

  // Window resize: keep selection and scroll; redraw only the row graphs when their
  // column width changes. Chart and map follow their containers via ResizeObserver.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.files.length || sparkWidthNow() === state.sparkWidth) return;
      const y = window.scrollY;
      renderTable();
      window.scrollTo(0, y);
    }, 150);
  });

  let focusTimer = 0;
  els.rows.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-id]");
    const detail = event.target.closest("tr[data-detail]");
    const id = row?.dataset.id || detail?.dataset.detail;
    if (!id) return;
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (event.target.matches("[data-mark]")) return;
    if (act === "menu") { openMenu(targetIds(id), 0, 0, event.target.closest("[data-act]")); return; }
    if (act === "expand") { state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); renderTable(); return; }
    if (act === "chart") { openChart(id); return; }
    if (act === "worklist") { addToWorklist([id]); return; }
    if (detail) return;
    if (act === "focus" || !event.target.closest("button, input, textarea, select, a, label")) {
      // Highlight at once; open the panel after the double-click window so a
      // double-click on the row opens the large chart instead.
      clearTimeout(focusTimer);
      if (event.detail > 1) return;
      els.rows.querySelectorAll("tr.row").forEach((tr) => tr.classList.toggle("is-focus", tr.dataset.id === id));
      focusTimer = setTimeout(() => {
        setFocus(id, { keepRow: row });
      }, event.detail === 0 ? 0 : 230);
    }
  });
  els.rows.addEventListener("change", (event) => {
    if (event.target.matches("[data-mark]")) {
      const id = event.target.closest("tr").dataset.id;
      if (event.target.checked) state.marked.add(id); else state.marked.delete(id);
      event.target.closest("tr").classList.toggle("is-marked", event.target.checked);
      renderSelection();
      const page = state.visible.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
      const onPage = page.filter((m) => state.marked.has(m.id)).length;
      els.checkPage.checked = onPage === page.length;
      els.checkPage.indeterminate = onPage > 0 && onPage < page.length;
      if (event.target.checked) setFocus(id, { scroll: false, keepRow: event.target.closest("tr") });
      else renderFocus();
    }
    if (event.target.matches("[data-comment]")) {
      setComment(event.target.closest("tr").dataset.detail, event.target.value);
      toast("Kommentaren sparad.");
    }
  });
  els.rows.addEventListener("dblclick", (event) => {
    const id = event.target.closest("tr[data-id]")?.dataset.id;
    if (id && !event.target.closest('button:not([data-act="focus"]), input, textarea')) {
      clearTimeout(focusTimer);
      openChart(id);
      setFocus(id, { scroll: false, keepRow: event.target.closest("tr[data-id]") });
    }
  });
  els.rows.addEventListener("contextmenu", (event) => {
    const id = event.target.closest("tr[data-id]")?.dataset.id;
    if (!id) return;
    event.preventDefault();
    openMenu(targetIds(id), event.clientX, event.clientY);
  });
  // Long press on touch opens the same menu.
  let pressTimer = 0, pressed = false;
  els.rows.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    const id = event.target.closest("tr[data-id]")?.dataset.id;
    if (!id) return;
    pressed = false;
    pressTimer = setTimeout(() => { pressed = true; openMenu(targetIds(id), event.clientX, event.clientY); }, 550);
  });
  ["pointerup", "pointercancel", "pointermove"].forEach((n) => els.rows.addEventListener(n, (e) => { if (n !== "pointermove" || Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clearTimeout(pressTimer); }));
  els.rows.addEventListener("click", (event) => { if (pressed) { event.stopImmediatePropagation(); event.preventDefault(); pressed = false; } }, true);

  $("chartDialogDetail").addEventListener("click", (event) => {
    const id = $("chartDialogDetail").dataset.id;
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "menu") openMenu(targetIds(id), 0, 0, event.target.closest("[data-act]"));
    if (act === "worklist") addToWorklist([id]);
  });
  $("chartDialogDetail").addEventListener("change", (event) => {
    if (event.target.matches("[data-comment]")) { setComment($("chartDialogDetail").dataset.id, event.target.value); toast("Kommentaren sparad."); }
  });

  els.checkPage.addEventListener("change", () => {
    const page = state.visible.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    page.forEach((m) => (els.checkPage.checked ? state.marked.add(m.id) : state.marked.delete(m.id)));
    if (els.checkPage.checked && page.length) {
      setFocus(state.marked.has(state.focusId) ? state.focusId : page[0].id);
      render();
      return;
    }
    render();
  });
  els.selection.addEventListener("click", (event) => {
    const act = event.target.closest("[data-sel]")?.dataset.sel;
    if (!act) return;
    const page = state.visible.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    if (act === "page") page.forEach((m) => state.marked.add(m.id));
    if (act === "all") state.visible.forEach((m) => state.marked.add(m.id));
    if (act === "clear") state.marked.clear();
    if (act === "move") { openMenu([...state.marked], 0, 0, event.target.closest("button")); return; }
    if (act === "worklist") { addToWorklist([...state.marked]); return; }
    if (act === "excel") { worklist.exportMeters([...state.marked], `${state.marked.size} markerade i listan`); return; }
    if (act === "hide") { setHidden([...state.marked], state.list !== "hidden"); return; }
    if ((act === "page" || act === "all") && state.marked.size) {
      const first = state.visible.find((m) => state.marked.has(m.id));
      if (first) { setFocus(state.marked.has(state.focusId) ? state.focusId : first.id); render(); return; }
    }
    render();
  });
  els.search.addEventListener("input", () => { state.search = els.search.value; state.page = 1; render(); });
  $("sortDirection").addEventListener("click", () => { state.sortReverse = !state.sortReverse; state.page = 1; render(); });
  function chooseSort(key) {
    if (!MeterView.sortOptions.some(o => o.key === key)) return;
    state.sort = key; state.sortReverse = false; state.page = 1;
    $("sortMenu").open = false; $("sortInfo").open = false;
    render();
  }
  els.sort.addEventListener("change", () => chooseSort(els.sort.value));
  $("sortOptions").addEventListener("click", event => {
    const button = event.target.closest("[data-sort-option]");
    if (button) { chooseSort(button.dataset.sortOption); $("sortMenu").querySelector("summary").focus({ preventScroll: true }); }
  });
  $("sortMenu").addEventListener("toggle", () => {
    if (!$("sortMenu").open) return;
    const panel = $("sortOptions");
    panel.style.maxHeight = `${Math.max(160, innerHeight - panel.getBoundingClientRect().top - 12)}px`;
  });
  $("sortMenu").addEventListener("keydown", event => {
    const menu = $("sortMenu"), buttons = [...menu.querySelectorAll("[data-sort-option]")];
    if (event.key === "Escape") { event.preventDefault(); menu.open = false; menu.querySelector("summary").focus(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); menu.open = true;
    const current = buttons.indexOf(document.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : current < 0 ? Math.max(0, buttons.findIndex(b => b.dataset.sortOption === state.sort)) : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index].focus();
  });
  els.area.addEventListener("change", () => { state.area = els.area.value; state.page = 1; render(); });
  els.groupFilter.addEventListener("change", () => {
    state.excluded = new Set([...els.groupFilter.querySelectorAll("input:not(:checked)")].map((i) => i.value));
    state.page = 1;
    render();
  });
  document.addEventListener("click", (event) => {
    const b = event.target.closest("[data-sort]");
    if (!b || !MeterView.sortOptions.some(o => o.key === b.dataset.sort)) return;
    state.sortReverse = state.sort === b.dataset.sort ? !state.sortReverse : false;
    state.sort = b.dataset.sort;
    els.sort.value = state.sort;
    state.page = 1;
    render();
  });
  els.pageSize.addEventListener("change", () => { state.pageSize = Number(els.pageSize.value); state.page = 1; render(); });
  els.prev.addEventListener("click", () => { state.page--; render(); els.rows.closest(".table-wrap").scrollIntoView({ block: "start" }); });
  els.next.addEventListener("click", () => { state.page++; render(); els.rows.closest(".table-wrap").scrollIntoView({ block: "start" }); });
  $("focusClose").addEventListener("click", () => { setFocus("", { scroll: false }); });
  $("focusNavigate").addEventListener("click", () => { const m = state.byId.get(state.focusId); if (m) window.open(LeakMap.navigationUrl(m), "_blank", "noopener,noreferrer"); });
  $("focusMenu").addEventListener("click", (event) => { if (state.focusId) openMenu(targetIds(state.focusId), 0, 0, event.currentTarget); });
  els.focus.addEventListener("click", (event) => {
    const enlarge = event.target.closest("[data-focus-enlarge]")?.dataset.focusEnlarge;
    if (enlarge) { openChart(enlarge); return; }
    const chartAction = event.target.closest("[data-chart-action]")?.dataset.chartAction;
    if (chartAction) { state.chartHidden = chartAction === "close"; renderFocus(); return; }
    const style = event.target.closest("[data-map-style]")?.dataset.mapStyle;
    const tool = event.target.closest("[data-map-tool]")?.dataset.mapTool;
    const view = ensureMap();
    if (!view) return;
    if (style) view.setStyle(style);
    if (tool) view.setTool(event.target.closest("button").getAttribute("aria-pressed") === "true" ? "" : tool);
    if (event.target.closest("[data-map-action='locate']")) view.locate();
    if (event.target.closest("[data-map-action='results']")) view.fitResults();
    if (event.target.closest("[data-map-action='marked']")) view.fitMarked();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.menu.hidden) closeMenu();
  });

  window.LeakApp = { state, reanalyze, render, applyDecision, setHidden, openChart, setFocus, worklist, handleFiles, folderImport, addToWorklist };

  // ---------------- start ----------------
  if (window.indexedDB && window.LeakStorage) showProfile();
  reanalyze(true);
}());



