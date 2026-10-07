/* LeakSök app: state, import, analysis orchestration and the work list UI.
   Analysis lives in engine.js; this file only presents and records decisions. */
(function () {
  const Engine = window.LeakEngine;
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
    { group: true, key: "noise", label: "Störning / tillfällig", test: (m) => m.category === "noise", more: true },
    { group: true, key: "seasonal", label: "Säsong", test: (m) => m.category === "seasonal", more: true },
    { key: "learning", label: "Kort historik", test: (m) => m.category === "learning", more: true },
    { key: "stale_contact", label: "Utan färsk avläsning", test: (m) => m.category === "stale_contact", more: true },
    { group: true, key: "ignored", label: "Ignorerade", test: (m) => m.category === "ignored", more: true },
    { key: "hidden", label: "Dolda", test: () => true, more: true },
  ];
  const LIST = Object.fromEntries(LISTS.map((l) => [l.key, l]));

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
    areaSignals: [], coordinatesKey: "", prepared: null, cache: new Map(), meters: [], byId: new Map(), latestExport: null,
    list: "all", search: "", sort: "priority", sortReverse: false, area: "all", excluded: new Set(DEFAULT_HIDDEN),
    page: 1, pageSize: 50, marked: new Set(), focusId: "", chartHidden: false, expanded: new Set(),
    view: readView(), importing: false, storageError: "", visible: [],
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
      await (full ? LeakStorage.saveAll(state.profileId, snapshot) : LeakStorage.saveState(state.profileId, snapshot));
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
    let added = 0, duplicates = 0, updated = 0;
    const next = [...state.files];
    const signature = (rows) => rows.map((r) => `${r.id}|${r.readAt?.getTime?.() ?? ""}|${r.current}`).join(";");
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
            const rows = existing.rows.map((row, index) => {
              const patch = Object.fromEntries(Object.entries(parsed.rows[index]).filter(([key, value]) => value !== undefined && !["source", "exportDate"].includes(key)));
              const merged = { ...row, ...patch };
              if (JSON.stringify(merged) === JSON.stringify(row)) return row;
              changed = true;
              return merged;
            });
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
      state.files = next.sort((a, b) => a.exportDate - b.exportDate || a.name.localeCompare(b.name));
      setImportStatus("Analyserar…");
      await new Promise((r) => setTimeout(r, 0));
      try { reanalyze(true); }
      catch (error) {
        // Never keep (or save) an import the engine cannot analyse.
        state.files = previous;
        reanalyze(true);
        setImportStatus(`Importen avbröts, inget sparades: ${error.message}`);
        return { saved: false, accepted: [] };
      }
      const saved = added || updated || state.storageError ? await persist(true) : true;
      const outcome = [added ? `${added} nya exporter` : "", updated ? `${updated} uppdaterade exporter` : "", duplicates && !updated ? `${duplicates} redan i historiken` : ""].filter(Boolean).join(" · ") || "Inga exporter kunde läsas";
      setImportStatus(`${outcome} · ${state.meters.length.toLocaleString("sv-SE")} mätare. ${saved ? "Sparat på denna enhet." : state.storageError}`);
      renderImportLog(warnings, errors);
      renderSource();
      return { saved, accepted: saved ? accepted : [], added, updated, duplicates, errors };
    } finally {
      state.importing = false;
      els.pickFiles.disabled = false;
      els.fileInput.value = "";
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
    for (const id of [...state.marked]) if (!state.byId.has(id)) state.marked.delete(id);
    if (state.focusId && !state.byId.has(state.focusId)) state.focusId = "";
    render();
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
    const rows = state.meters.filter((m) => {
      if (!inList(m, state.list)) return false;
      if (state.area !== "all" && districtOf(m) !== state.area) return false;
      if (terms.length && !terms.some((t) => norm(`${m.address} ${m.serial} ${m.id} ${m.area}`).includes(t))) return false;
      return true;
    });
    const by = {
      priority: (a, b) => b.sortRank - a.sortRank,
      change: (a, b) => (b.changePrev?.pct ?? -Infinity) - (a.changePrev?.pct ?? -Infinity) || (b.changePrev?.delta ?? -Infinity) - (a.changePrev?.delta ?? -Infinity),
      baseline: (a, b) => (b.finding?.pct ?? -Infinity) - (a.finding?.pct ?? -Infinity),
      lastRead: (a, b) => (b.latest?.date?.getTime() ?? 0) - (a.latest?.date?.getTime() ?? 0),
      value: (a, b) => (b.latest?.value ?? -1) - (a.latest?.value ?? -1),
      address: (a, b) => a.address.localeCompare(b.address, "sv", { numeric: true }),
      area: (a, b) => districtOf(a).localeCompare(districtOf(b), "sv") || a.address.localeCompare(b.address, "sv", { numeric: true }),
    }[state.sort] || ((a, b) => b.sortRank - a.sortRank);
    const sortValue = (m) => ({ change: m.changePrev?.pct, baseline: m.finding?.pct, lastRead: m.latest?.date?.getTime(), value: m.latest?.value })[state.sort];
    return rows.sort((a, b) => {
      if (["change", "baseline", "lastRead", "value"].includes(state.sort)) {
        const missing = Number(sortValue(a) == null) - Number(sortValue(b) == null);
        if (missing) return missing;
      }
      return (state.sortReverse ? -1 : 1) * by(a, b) || b.sortRank - a.sortRank || a.address.localeCompare(b.address, "sv");
    });
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
    const more = LISTS.filter((l) => l.more && !l.group);
    const moreOpen = more.some((l) => l.key === state.list) || !!els.rail.querySelector(".rail-more[open]");
    els.rail.innerHTML = `
      <div class="rail-lists">${LISTS.filter((l) => !l.more && !l.group).map(button).join("")}</div>
      <details class="rail-more"${moreOpen ? " open" : ""}><summary aria-label="Fler listor"><i class="rail-icon" aria-hidden="true">⋯</i><span>Fler listor</span><b>${more.reduce((s, l) => s + (l.key === "hidden" ? 0 : counts[l.key]), 0).toLocaleString("sv-SE")}</b></summary><div class="rail-lists">${more.map(button).join("")}</div></details>
      <label class="rail-select"><span class="sr-only">Lista</span><select id="listSelect">${LISTS.filter((l) => !l.group).map((l) => `<option value="${l.key}"${state.list === l.key ? " selected" : ""}>${esc(l.label)} (${counts[l.key]})</option>`).join("")}</select></label>`;
  }

  function areaSignalHtml(signal, detailed = false) {
    const stage = signal.stage === "early" ? "Preliminär" : "Upprepad ökning";
    return `<div class="area-signal">
      <div><b>${esc(signal.anchorAddress)}</b><span class="sub">${esc(stage)} · ${signal.count} mätare / ${signal.buildingCount} adresser · ${esc(Engine.fmtPeriod(signal.onsetFrom, signal.onsetTo, state.latestExport?.getFullYear()))}</span></div>
      <p>${esc(signal.summary)} ${signal.basis === "position" ? `Högst ca ${signal.diameterMeters} m mellan kartpunkterna.` : "Närhet enligt adress – kartpositioner behöver verifieras."}</p>
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
    const items = report.newToday.slice(0, 4).map((m) => {
      const f = m.upFinding;
      return `<button type="button" class="brief-item" data-focus="${esc(m.id)}"><span>${esc(shortAddress(m))}</span><b>${num(f.ref.level)} → ${num(f.now.level)}</b><em>${f.pct != null ? Engine.fmtPct(f.pct) : Engine.fmtSigned(f.delta)}</em></button>`;
    }).join("");
    els.brief.innerHTML = `
      <div class="brief-row">
        <div class="brief-heading"><p class="eyebrow">Läget i nätet</p><h2>${esc(LIST[state.list]?.label || "Alla mätare")}</h2><p class="brief-date${ageHours > 30 ? " is-old" : ""}">${ageHours > 30 ? "Äldre export" : "Senaste export"} <b>${esc(time)}</b> · ${report.fresh.toLocaleString("sv-SE")} av ${report.total.toLocaleString("sv-SE")} avlästa senaste exportdygnet</p></div>
        <div class="brief-stats">
          <button type="button" data-list="today"><b>${report.newToday.length}</b> nya signaler</button>
          <button type="button" data-list="dispatch"><b>${report.dispatch}</b> åk ut</button>
          <button type="button" data-list="suspect"><b>${report.suspect}</b> misstänk</button>
          <button type="button" data-list="stale_contact"><b>${report.stale}</b> utan färsk avläsning</button>
        </div>
      </div>
      ${items ? `<div class="brief-items">${items}${report.newToday.length > 4 ? `<button type="button" class="brief-more" data-list="today">Alla ${report.newToday.length} →</button>` : ""}</div>` : ""}`;
    if (state.areaSignals.length) {
      els.brief.insertAdjacentHTML("beforeend", `<details class="area-signals"${areaOpen ? " open" : ""}><summary>${state.areaSignals.length} områdessignal${state.areaSignals.length > 1 ? "er" : ""} · flera mätare ökar tillsammans</summary><div class="area-signal-list">${state.areaSignals.map((signal) => areaSignalHtml(signal)).join("")}</div></details>`);
    }
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
    const c = m.changePrev;
    if (!m.latest) return `<span class="muted">Inga avläsningar</span>`;
    const old = m.latest.ageDays >= Engine.RULES.oldDays;
    const value = `<span class="val">${num(m.latest.value)}</span><span class="date${old ? " old" : ""}" title="Avläsningsdatum">${esc(Engine.fmtDate(m.latest.date))}${old ? ` · ${m.latest.ageDays} d` : ""}</span>`;
    if (!c) return `${value}<span class="chg muted">ingen tidigare</span>`;
    const dir = c.delta > 0 ? "up" : c.delta < 0 ? "down" : "flat";
    const pct = c.pct != null ? Engine.fmtPct(c.pct) : c.from === 0 ? "ingen %, från 0" : "–";
    return `${value}<span class="chg ${dir}" title="Sedan föregående avläsning ${esc(Engine.fmtDate(c.fromDate))}: ${num(c.from)}">${Engine.fmtSigned(c.delta)} (${pct})</span><span class="sub">från ${num(c.from)} · ${esc(Engine.fmtDate(c.fromDate))}</span>`;
  }

  function rowHtml(m) {
    const marked = state.marked.has(m.id);
    const expanded = state.expanded.has(m.id);
    const tags = [];
    if (m.excel.interestRank) tags.push(`<span class="tag" title="Kamstrups mätare av intresse i exporten ${esc(Engine.fmtDate(m.excel.exportDate, true))}">Kamstrup · rang ${m.excel.interestRank}</span>`);
    if (m.learnedLeakMatch) tags.push(`<span class="tag area-tag">Likt tidigare ${esc(m.learnedLeakMatch.lineType)}-läcka</span>`);
    if (m.areaSignal) tags.push(`<span class="tag area-tag">Områdessignal · ${m.areaSignal.count} mätare</span>`);
    if (m.label?.type) tags.push(`<span class="tag manual">${esc(Engine.LABELS[m.label.type] || m.label.type)}</span>`);
    if (m.codes.leak || m.codes.burst || m.codes.dry) tags.push(`<span class="tag code">Infokod ${esc(m.codes.infoCode)}</span>`);
    if (m.codes.acousticLeak || m.codes.acousticOther || m.codes.acousticUndetermined) tags.push(`<span class="tag code">Händelse: ${esc(m.codes.activeEvents)}</span>`);
    if (m.codes.follow) tags.push(`<span class="tag">Följs i Kamstrup</span>`);
    if (hidden(m)) tags.push(`<span class="tag">Gömd</span>`);
    if (state.tripList.some((e) => e.id === m.id)) tags.push(`<span class="tag">I arbetslista</span>`);
    return `<tr data-id="${esc(m.id)}" class="row${marked ? " is-marked" : ""}${state.focusId === m.id ? " is-focus" : ""}">
      <td class="c-check"><input type="checkbox" data-mark ${marked ? "checked" : ""} aria-label="Markera ${esc(m.address)}"></td>
      <td class="c-status"><span class="pill cat-${esc(m.category)}">${esc(m.status)}</span><span class="prio" title="Prioritet: rangordning 0–100, inte sannolikhet för läcka">${m.priority}</span><span class="conf">underlag ${esc(m.confidence)}</span></td>
      <td class="c-addr"><span class="addr-line"><button type="button" class="addr" data-act="focus">${esc(shortAddress(m))}</button>${copyButton(m)}</span><span class="sub">${esc(m.serial || m.id)} · ${esc(districtOf(m))}</span>${tags.length ? `<span class="tags">${tags.join("")}</span>` : ""}</td>
      <td class="c-latest">${changeHtml(m)}</td>
      <td class="c-reason"><p class="summary">${esc(m.summary)}</p><p class="action">${esc(m.action)}</p></td>
      <td class="c-spark" data-act="chart" title="Öppna graf">${Chart.sparkline(m, { width: state.sparkWidth || 120 })}</td>
      <td class="c-menu"><button type="button" class="row-info" data-act="expand" aria-expanded="${expanded}" aria-label="${expanded ? "Dölj" : "Visa"} underlag" title="${expanded ? "Dölj" : "Visa"} underlag">i</button><button type="button" class="icon" data-act="menu" aria-label="Åtgärder för ${esc(m.address)}">⋯</button></td>
    </tr>${expanded ? `<tr class="detail-row" data-detail="${esc(m.id)}"><td colspan="7">${detailHtml(m)}</td></tr>` : ""}`;
  }

  function comparisonRows(m) {
    const rows = [];
    const c = m.changePrev;
    const year = state.latestExport?.getFullYear();
    const D = (d) => Engine.fmtDate(d, d && d.getFullYear() !== year);
    if (c) rows.push(["Sedan föregående avläsning", `${D(c.fromDate)} → ${D(c.toDate)}`, `${num(c.from)} → ${num(c.to)}`, Engine.fmtSigned(c.delta), c.pct != null ? Engine.fmtPct(c.pct) : "ingen procent"]);
    const f = m.finding;
    if (f?.ref && f.now) {
      const label = { new_signal: "Mot nuvarande nivå", level_shift: "Mot nivån före förändringen", trend: "Trend senaste 60 dagarna", stable: "Nuvarande nivå", transient: "Mot normal nivå" }[f.type] || "Jämförelse";
      rows.push([`${label}<span class="sub">${esc(m.baseline?.definition || "")}</span>`, `${Engine.fmtPeriod(f.ref.from, f.ref.to, year)} (${f.ref.n} avl.)`, `${num(f.ref.level)} → ${num(f.now.level)}`, Engine.fmtSigned(f.delta), f.pct != null ? Engine.fmtPct(f.pct) : "ingen procent"]);
    }
    if (f?.older) rows.push(["Äldre nivå", `${Engine.fmtPeriod(f.older.from, f.older.to, year)} (${f.older.n} avl.)`, num(f.older.level), "", ""]);
    if (m.excel.E != null) rows.push(["P = E/F − 1 (senaste exportraden)", m.excel.exportDate ? D(m.excel.exportDate) : "", `F ${num(m.excel.F)} · E ${num(m.excel.E)} · G ${num(m.excel.G)}`, "", m.excel.P != null ? Engine.fmtPct(m.excel.P) : "beräknas inte"]);
    if (m.season?.sameTimeLastYear) rows.push(["Samma tid i fjol", Engine.fmtPeriod(m.season.sameTimeLastYear.from, m.season.sameTimeLastYear.to, 0), num(m.season.sameTimeLastYear.level), "", ""]);
    return rows.map((r) => `<tr><th scope="row">${r[0]}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`).join("");
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
    return `<div class="detail">
      <section>
        ${m.areaSignal ? `<h4>Möjlig gemensam källa i området</h4>${areaSignalHtml(m.areaSignal, true)}` : ""}
        ${caseEvidenceHtml(m)}
        <h4>Observation</h4>${list(m.observations)}
        <h4>Möjlig förklaring</h4>${list(m.explanations)}
        <h4>Rekommenderad åtgärd</h4><p>${esc(m.action)}</p>
      </section>
      <section>
        <h4>Jämförelser</h4>
        <table class="cmp"><thead><tr><th>Mått</th><th>Period</th><th>Värden</th><th>Skillnad</th><th>%</th></tr></thead><tbody>${comparisonRows(m)}</tbody></table>
        <h4>Datakvalitet</h4>${list(m.dataQuality)}
        ${m.missing.length ? `<h4>Vad saknas för säkrare slutsats</h4>${list(m.missing)}` : ""}
        <h4>Prioritet ${m.priority} (rangordning, inte sannolikhet)</h4><p class="parts">${m.priorityParts.map((p) => `${esc(p.name)} ${p.points > 0 ? "+" : ""}${p.points}`).join(" · ")}</p>
      </section>
      <section>
        <h4>Beslut</h4><p>${m.label ? esc(Engine.LABELS[m.label.type] || m.label.type) + (m.label.at ? ` · ${esc(String(m.label.at).slice(0, 10))}` : "") : "Inget manuellt beslut – automatisk bedömning."}</p>
        <button type="button" class="secondary" data-act="menu">Flytta till…</button>
        <label class="stack">Kommentar<textarea data-comment rows="3" placeholder="Följer med i arbetslistan och Excel">${esc(comment)}</textarea></label>
        <div class="detail-actions"><button type="button" class="secondary" data-act="chart">Stor graf</button><button type="button" class="secondary" data-act="worklist">Lägg i arbetslista</button></div>
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
      els.rows.innerHTML = `<tr><td colspan="7" class="empty">Inga mätare i ${esc(LIST[state.list].label)} med nuvarande sökning och filter.</td></tr>`;
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
    els.selection.classList.toggle("has-marked", marked > 0);
    els.selection.innerHTML = !state.files.length ? "" : `
      <p><b>${marked ? `${marked.toLocaleString("sv-SE")} markerade` : "Inga markerade"}</b>${outside ? ` <span class="muted">(${outside} syns inte i nuvarande lista/filter)</span>` : ""}</p>
      <div class="sel-actions">
        ${marked ? `<button type="button" class="secondary" data-sel="move">Flytta till…</button>
        <button type="button" class="primary" data-sel="excel">Excel</button>` : ""}
        <details class="menu selection-menu"${menuOpen ? " open" : ""}><summary>${marked ? "Mer" : "Markera"}</summary>
          <div class="menu-panel">
            <button type="button" data-sel="page" ${pageCount ? "" : "disabled"}>Markera sidan (${pageCount})</button>
            <button type="button" data-sel="all" ${total && !allMarked ? "" : "disabled"}>Markera alla ${total.toLocaleString("sv-SE")} träffar</button>
            ${marked ? `<button type="button" data-sel="worklist">Lägg i arbetslista (${marked})</button>
            <button type="button" data-sel="hide">${state.list === "hidden" ? "Visa igen" : "Göm"} (${marked})</button>
            <button type="button" data-sel="clear">Avmarkera</button>` : ""}
          </div>
        </details>
      </div>
      <div class="list-sort" role="group" aria-label="Sortera efter"><button type="button" data-sort="address">Adress</button><button type="button" data-sort="value">Nivå</button><button type="button" data-sort="change">Förändring</button><button type="button" data-sort="priority">Prioritet</button></div>`;
    renderSortControls();
  }

  function renderSortControls() {
    document.querySelectorAll("[data-sort]").forEach((b) => {
      const active = b.dataset.sort === state.sort;
      const ascending = ["address", "area"].includes(state.sort) !== state.sortReverse;
      b.dataset.sortLabel ||= b.textContent;
      b.textContent = `${b.dataset.sortLabel}${active ? ascending ? " ↑" : " ↓" : ""}`;
      b.setAttribute("aria-pressed", String(active));
      if (b.closest("th")) b.closest("th").setAttribute("aria-sort", active ? ascending ? "ascending" : "descending" : "none");
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
  function ensureMap() {
    if (mapView || !window.LeakMap) return mapView;
    mapView = LeakMap.create({
      element: els.map, statusElement: els.mapStatus,
      onFocus: (id) => setFocus(id, { scroll: false }),
      onMarkMany: (ids) => { ids.forEach((id) => state.marked.add(id)); render(); },
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
    document.body.classList.toggle("has-focus", !els.focus.hidden);
    if (els.focus.hidden) return;
    if (m) {
      const maxLevel = m.series?.length ? Math.max(...m.series.map((p) => p.value)) : null;
      $("meterSummary").innerHTML = `<b>${esc(shortAddress(m))}</b><span class="sub">${esc(m.serial || m.id)} · ${m.latest ? esc(Engine.fmtDate(m.latest.date)) : "Ingen avläsning"}</span><span class="pill cat-${esc(m.category)}">${esc(m.status)}</span><dl><div><dt>Senaste nivå</dt><dd>${num(m.latest?.value)}</dd></div><div><dt>Max i historiken</dt><dd>${num(maxLevel)}</dd></div><div><dt>Jämförelsenivå</dt><dd>${num(m.finding?.ref?.level)}</dd></div><div><dt>Förändring</dt><dd>${m.changePrev?.pct != null ? esc(Engine.fmtPct(m.changePrev.pct)) : "–"}</dd></div></dl><p>${esc(m.summary)}</p><button type="button" class="secondary" data-focus-enlarge="${esc(m.id)}">Öppna större graf</button>`;
      els.focusTitle.textContent = m.address;
      $("focusCopy").dataset.copy = m.id;
      $("focusCopy").hidden = false;
      els.focusMeta.textContent = ` · ${m.serial || m.id} · ${m.status} · prioritet ${m.priority}`;
      const cases = (state.leakCases || []).filter((r) => r.anchorId === m.id);
      if (cases.length) els.focusMeta.textContent += caseGeocoding ? " · söker grannmätarnas kartpositioner…" : ` · ${cases.at(-1).profiles.filter((p) => p.validated).length} jämförelsemönster (Visa underlag)`;
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
    const mode = state.search.trim() ? "results" : "overview";
    // Keep every filtered result on the map, even when a chart is open.
    const meters = [...new Set([...state.visible, ...(m ? [m] : []), ...[...state.marked].map((id) => state.byId.get(id)).filter(Boolean)])];
    const key = `${mode}|${focusRequest}|${state.focusId}|${[...state.marked].join(",")}|${state.list}|${state.search}|${state.area}|${meters.map((meter) => `${meter.id}:${meter.category}`).join(",")}`;
    if (key === lastMapKey) return;
    lastMapKey = key;
    requestAnimationFrame(() => { view.invalidate(); Promise.resolve(view.update({ meters, focusId: state.focusId, focusRequest, marked: state.marked, mode, resultIds: state.visible.map((m) => m.id) })).then(() => {
      if (!state.prepared) return;
      const coords = LeakMap.coordinates([...state.prepared.histories.values()]);
      const key = JSON.stringify([...coords].sort(([a], [b]) => a.localeCompare(b)));
      if (key !== state.coordinatesKey) reanalyze();
    }).catch(() => { /* Map status already reports address lookup failures. */ }); });
  }

  // Selecting a meter only updates the focus panel; the table is not rebuilt.
  function setFocus(id, { scroll = true, keepRow = null } = {}) {
    if (id !== state.focusId) state.chartHidden = false;
    state.focusId = id;
    focusRequest++;
    els.rows.querySelectorAll("tr.row").forEach((tr) => tr.classList.toggle("is-focus", tr.dataset.id === id));
    const rowTop = keepRow?.isConnected ? keepRow.getBoundingClientRect().top : null;
    renderFocus();
    if (rowTop != null && window.matchMedia("(min-width: 761px)").matches) {
      const list = keepRow.closest(".table-wrap");
      list.scrollTop += keepRow.getBoundingClientRect().top - rowTop;
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
    $("chartDialogMeta").textContent = `${m.serial || m.id} · ${m.status} · prioritet ${m.priority} (rangordning) · ${m.summary}`;
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
        <h3>Avläsningar</h3><p>Kurvan byggs på avläsningsdatum, inte exportdatum. Samma avläsning i flera exporter räknas en gång. Luckor över ${R.gapDays} dagar ritas som saknat underlag och räknas inte som observerad tid.</p>
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
    state.files = [];
    if (!await persist(true)) { state.files = previous; renderSource(); return; }
    reanalyze(true);
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
    const listButton = t.closest("[data-list]");
    if (listButton) {
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

  function setList(key) {
    if (!LIST[key]) return;
    state.list = key;
    state.page = 1;
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
        if (state.view === "list") openChart(id);
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
    render();
  });
  els.search.addEventListener("input", () => { state.search = els.search.value; state.page = 1; render(); });
  els.sort.addEventListener("change", () => { state.sort = els.sort.value; state.sortReverse = false; state.page = 1; render(); });
  els.area.addEventListener("change", () => { state.area = els.area.value; state.page = 1; render(); });
  els.groupFilter.addEventListener("change", () => {
    state.excluded = new Set([...els.groupFilter.querySelectorAll("input:not(:checked)")].map((i) => i.value));
    state.page = 1;
    render();
  });
  document.addEventListener("click", (event) => {
    const b = event.target.closest("[data-sort]");
    if (!b) return;
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
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.menu.hidden) closeMenu();
  });

  window.LeakApp = { state, reanalyze, render, applyDecision, setHidden, openChart, setFocus, worklist, handleFiles, folderImport };

  // ---------------- start ----------------
  if (window.indexedDB && window.LeakStorage) showProfile();
  reanalyze(true);
}());
