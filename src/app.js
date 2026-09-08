const knownCases = {
  "53843859": {
    type: "repaired",
    address: "ALHAGSVÄGEN 58 -60 NORSBORG 14559",
    serial: "53843859",
    note: "Bekräftad läcka cirka 50-55 m från servisventilen vid nr 58. Lagad 2026-08-23 cirka 12:30; avläsning 17 kl. 13:01.",
    at: "2026-08-23T12:30:00+02:00",
    confirmedDate: "2026-08-23",
    repairedDate: "2026-08-23",
    distanceMeters: 55,
    lineType: "SV",
    source: "inbyggt facit",
  },
  "23571762": {
    type: "seasonal",
    address: "ALICE TEGNÉRS VÄG 23 TULLINGE 14638",
    serial: "23571762",
    note: "Känt värmepanne-/säsongsmönster.",
    at: "2026-08-23T00:00:00+02:00",
    source: "inbyggt facit",
  },
  "23571905": {
    type: "repaired",
    address: "BROÄNGSVÄGEN 22 TUMBA 14732",
    serial: "23571905",
    note: "Historisk läcka lagad. Högt gammalt max ska inte ensamt ge aktiv varning.",
    at: "2026-08-23T00:00:00+02:00",
    source: "inbyggt facit",
  },
  "12777229": {
    type: "leak",
    address: "VATTRAVÄGEN 8 UTTRAN 14763",
    serial: "12777229",
    note: "Bekräftat aktivt exempel i träningsunderlaget.",
    at: "2026-08-23T00:00:00+02:00",
    source: "inbyggt facit",
  },
};

const state = {
  files: [],
  meters: [],
  labels: loadLabels(),
  chart: null,
  profileId: null,
  profileName: null,
};

const categoryText = {
  dispatch: "TROLIG LÄCKA - ÅK UT",
  leak_likely: "TROLIG LÄCKA - ÅK UT",
  watch: "BEVAKA",
  learning: "UNDER INLÄRNING",
  new_high: "UNDER INLÄRNING",
  new_unknown: "UNDER INLÄRNING",
  seasonal: "SÄSONG / KÄND",
  repaired: "LAGAD",
  noise: "PUMP / STÖRNING",
  normal: "NORMAL",
};

const labelTypes = {
  leak: "Konstaterad läcka",
  repaired: "Lagad",
  seasonal: "Säsong/känd",
  known_noise: "Störning/falsklarm",
  pump: "Störning/falsklarm",
  false_alarm: "Störning/falsklarm",
};

const feedbackButtons = {
  leak: "Konstaterad läcka",
  repaired: "Lagad",
  seasonal: "Säsong/känd",
  known_noise: "Störning/falsklarm",
};

const els = {
  fileInput: document.getElementById("fileInput"),
  pickFiles: document.getElementById("pickFiles"),
  dropzone: document.getElementById("dropzone"),
  rows: document.getElementById("rows"),
  summary: document.getElementById("summary"),
  search: document.getElementById("search"),
  filter: document.getElementById("filter"),
  sort: document.getElementById("sort"),
  labels: document.getElementById("labels"),
  resetAll: document.getElementById("resetAll"),
  exportJson: document.getElementById("exportJson"),
  importStatus: document.getElementById("importStatus"),
  detailDialog: document.getElementById("detailDialog"),
  detailTitle: document.getElementById("detailTitle"),
  detailMeta: document.getElementById("detailMeta"),
  detailText: document.getElementById("detailText"),
  closeDetail: document.getElementById("closeDetail"),
  profileButton: document.getElementById("profileButton"),
  profileDialog: document.getElementById("profileDialog"),
  profileForm: document.getElementById("profileForm"),
  profileTitle: document.getElementById("profileTitle"),
  profileHelp: document.getElementById("profileHelp"),
  profileName: document.getElementById("profileName"),
  profileCode: document.getElementById("profileCode"),
  profileStatus: document.getElementById("profileStatus"),
  feedbackDialog: document.getElementById("feedbackDialog"),
  feedbackForm: document.getElementById("feedbackForm"),
  feedbackTitle: document.getElementById("feedbackTitle"),
  feedbackAddress: document.getElementById("feedbackAddress"),
  feedbackMeterId: document.getElementById("feedbackMeterId"),
  feedbackType: document.getElementById("feedbackType"),
  confirmedDateField: document.getElementById("confirmedDateField"),
  feedbackDateLabel: document.getElementById("feedbackDateLabel"),
  confirmedDate: document.getElementById("confirmedDate"),
  repairFields: document.getElementById("repairFields"),
  repairedDate: document.getElementById("repairedDate"),
  distanceMeters: document.getElementById("distanceMeters"),
  feedbackNote: document.getElementById("feedbackNote"),
  cancelFeedback: document.getElementById("cancelFeedback"),
};

els.pickFiles.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", (event) => handleFiles([...event.target.files]));
els.search.addEventListener("input", render);
els.filter.addEventListener("change", render);
els.sort.addEventListener("change", render);
els.closeDetail.addEventListener("click", () => els.detailDialog.close());
els.resetAll.addEventListener("click", resetAll);
els.exportJson.addEventListener("click", exportLabels);
els.profileButton.addEventListener("click", lockProfile);
els.profileForm.addEventListener("submit", unlockProfile);
els.feedbackForm.addEventListener("submit", saveFeedback);
els.cancelFeedback.addEventListener("click", () => els.feedbackDialog.close());

["dragenter", "dragover"].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("drag");
  });
});
["dragleave", "drop"].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("drag");
  });
});
els.dropzone.addEventListener("drop", (event) => handleFiles([...event.dataTransfer.files]));

function loadLabels() {
  try {
    const saved = JSON.parse(localStorage.getItem("leaksok-intelligence-labels") || "{}");
    return { ...knownCases, ...saved };
  } catch {
    return { ...knownCases };
  }
}

function saveLabels() {
  localStorage.setItem("leaksok-intelligence-labels", JSON.stringify(state.labels));
  persistState();
}

function profileConfig() {
  try {
    return JSON.parse(localStorage.getItem("leaksok-intelligence-profile") || "null");
  } catch {
    return null;
  }
}

async function bootstrap() {
  if (!window.indexedDB || !window.LeakStorage) {
    render();
    return;
  }
  const config = profileConfig();
  els.profileTitle.textContent = config ? "Öppna Läcksök" : "Skapa lokal profil";
  els.profileHelp.textContent = config
    ? "Ange din kod. Historik och facit ligger kvar på denna enhet."
    : "Välj namn och minst fyra tecken som kod. Detta låser appen på denna enhet.";
  els.profileName.value = config?.name || "";
  els.profileName.readOnly = Boolean(config);
  els.profileDialog.addEventListener("cancel", (event) => event.preventDefault());
  els.profileDialog.showModal();
}

async function unlockProfile(event) {
  event.preventDefault();
  const name = els.profileName.value.trim();
  const code = els.profileCode.value;
  const config = profileConfig();
  if (!name || code.length < 4) {
    els.profileStatus.textContent = "Skriv namn och en kod med minst fyra tecken.";
    return;
  }

  const salt = config?.salt || randomSalt();
  const hash = await hashCode(`${name.toLowerCase()}|${code}|${salt}`);
  if (config && (config.name.toLowerCase() !== name.toLowerCase() || config.hash !== hash)) {
    els.profileStatus.textContent = "Fel kod.";
    return;
  }

  const nextConfig = config || { name, salt, hash, profileId: profileKey(name) };
  localStorage.setItem("leaksok-intelligence-profile", JSON.stringify(nextConfig));
  state.profileId = nextConfig.profileId;
  state.profileName = nextConfig.name;
  els.profileButton.textContent = `${state.profileName} · Lås`;
  els.profileCode.value = "";
  els.profileStatus.textContent = "";

  try {
    const snapshot = await window.LeakStorage.load(state.profileId);
    if (snapshot) {
      state.files = hydrateFiles(snapshot.files || []);
      state.labels = { ...knownCases, ...(snapshot.labels || {}) };
    }
  } catch (error) {
    els.importStatus.textContent = `Lokal historik kunde inte öppnas: ${error.message}`;
  }
  els.profileDialog.close();
  analyze();
  persistState();
}

function lockProfile() {
  if (!window.indexedDB || !window.LeakStorage) return;
  const config = profileConfig();
  els.profileName.value = config?.name || "";
  els.profileName.readOnly = Boolean(config);
  els.profileCode.value = "";
  els.profileStatus.textContent = "";
  els.profileDialog.showModal();
}

async function persistState() {
  if (!state.profileId || !window.LeakStorage) return;
  try {
    await window.LeakStorage.save(state.profileId, {
      files: state.files,
      labels: state.labels,
      savedAt: new Date(),
    });
  } catch (error) {
    els.importStatus.textContent = `Kunde inte spara lokalt: ${error.message}`;
  }
}

function hydrateFiles(files) {
  return files.map((file) => ({
    ...file,
    exportDate: new Date(file.exportDate),
    rows: (file.rows || []).map((row) => ({
      ...row,
      exportDate: new Date(row.exportDate),
      readAt: new Date(row.readAt),
    })),
  })).filter((file) => !Number.isNaN(file.exportDate.getTime()));
}

async function hashCode(value) {
  if (window.crypto?.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return String(hash);
}

function randomSalt() {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random()}`;
}

function profileKey(name) {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lokal";
}

async function handleFiles(files) {
  const excelFiles = files.filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name));
  if (!excelFiles.length) {
    els.importStatus.textContent = "Ingen Excel- eller CSV-fil vald.";
    return;
  }
  els.importStatus.textContent = `Läser ${excelFiles.length} filer...`;
  let imported = 0;
  const errors = [];
  for (const file of excelFiles) {
    try {
      const parsed = await parseWorkbook(file);
      if (!parsed.rows.length) throw new Error("inga mätarrader hittades");
      state.files = state.files.filter((old) => old.name !== file.name);
      state.files.push({ name: file.name, exportDate: parsed.exportDate, rows: parsed.rows });
      imported++;
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  state.files.sort((a, b) => a.exportDate - b.exportDate);
  analyze();
  await persistState();
  const meterRows = state.files.reduce((sum, file) => sum + file.rows.length, 0);
  els.importStatus.textContent = `${imported} filer inlästa, ${meterRows.toLocaleString("sv-SE")} mätarrader.${errors.length ? ` Kunde inte läsa ${errors.length}: ${errors.join(" | ")}` : ""}`;
  els.fileInput.value = "";
}

async function parseWorkbook(file) {
  let rows;
  if (/\.csv$/i.test(file.name)) {
    rows = parseCsvRows(await file.text());
  } else {
    if (typeof XLSX === "undefined") {
      throw new Error("Excel-läsaren kunde inte laddas; använd CSV eller ladda om sidan");
    }
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  }
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) return { exportDate: dateFromFile(file), rows: [] };

  const header = rows[headerIndex].map((value) => String(value || "").trim().toLowerCase());
  const col = {
    address: findColumn(header, ["adress", "address", "plats"]),
    serial: findColumn(header, ["serienummer", "serienr", "serie", "mätarnummer", "meter"]),
    readAt: findColumn(header, ["senaste avläsning", "avläsning", "date", "datum"]),
    current: findColumn(header, ["senaste värde", "brus", "noise", "value"]),
    average: findColumn(header, ["genomsnittsvärde", "genomsnitt", "average", "avg"]),
    max: findColumn(header, ["maxvärde", "max", "högsta"]),
    info: findColumn(header, ["infokod", "status", "alarm", "larm"]),
    activeEvents: findColumn(header, ["aktiva händelser", "active events"]),
    closedEvents: findColumn(header, ["stängda händelser", "closed events"]),
    area: findColumn(header, ["område", "area", "ort"]),
  };
  if (col.current < 0 || (col.serial < 0 && col.address < 0)) {
    throw new Error("Kamstrup-kolumnerna Serienummer/Adress/Senaste värde saknas");
  }

  const exportDate = dateFromFile(file) || findExportDate(rows);
  const parsed = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const serial = cleanText(row[col.serial]);
    const address = cleanText(row[col.address]);
    if (!serial && !address) continue;
    const current = parseNumber(row[col.current]);
    if (current == null) continue;
    const average = parseNumber(row[col.average]);
    const max = parseNumber(row[col.max]);
    const readAt = parseDate(row[col.readAt]) || exportDate;
    parsed.push({
      id: serial || normalizeAddress(address),
      serial,
      address,
      area: areaOf(`${address} ${cleanText(row[col.area])}`),
      readAt,
      exportDate,
      current,
      average: average ?? current,
      max: max ?? current,
      info: [row[col.info], row[col.activeEvents]].map(cleanText).filter(Boolean).join(" · "),
      closedEvents: cleanText(row[col.closedEvents]),
      source: file.name,
    });
  }
  return { exportDate, rows: parsed };
}

function parseCsvRows(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const candidates = [",", ";", "\t"];
  const separator = candidates
    .map((value) => ({ value, count: firstLine.split(value).length - 1 }))
    .sort((a, b) => b.count - a.count)[0].value;
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function findHeaderIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cells = (rows[i] || []).map((value) => String(value || "").toLowerCase());
    const hasAddress = cells.some((cell) => cell.includes("adress") || cell.includes("address"));
    const hasValue = cells.some((cell) => cell.includes("senaste värde") || cell.includes("brus") || cell.includes("value"));
    const hasSerial = cells.some((cell) => cell.includes("serie") || cell.includes("mätar") || cell.includes("meter"));
    if (hasAddress && hasValue && hasSerial) return i;
  }
  return -1;
}

function findColumn(header, names) {
  return header.findIndex((cell) => names.some((name) => cell.includes(name)));
}

function findExportDate(rows) {
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    for (const cell of rows[r] || []) {
      const date = parseDate(cell);
      if (date) return date;
    }
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100000) {
    const wholeDays = Math.floor(value);
    const fraction = value - wholeDays;
    const date = new Date(1899, 11, 30);
    date.setDate(date.getDate() + wholeDays);
    date.setSeconds(Math.round(fraction * 86400));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value).trim();
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 0), +(iso[5] || 0));
  const swedish = text.match(/(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?(?:\D|$)/);
  if (swedish) return new Date(+swedish[3], +swedish[2] - 1, +swedish[1], +(swedish[4] || 0), +(swedish[5] || 0));
  return null;
}

function dateFromFile(file) {
  const match = file.name.match(/(\d{4})-(\d{2})-(\d{2})(?:[ _-](\d{2})-(\d{2}))?/);
  if (match) return new Date(+match[1], +match[2] - 1, +match[3], +(match[4] || 0), +(match[5] || 0));
  return new Date(file.lastModified || Date.now());
}

function analyze() {
  const byId = new Map();
  for (const file of [...state.files].sort((a, b) => new Date(a.exportDate) - new Date(b.exportDate))) {
    for (const row of file.rows) {
      if (!byId.has(row.id)) {
        byId.set(row.id, {
          id: row.id,
          serial: row.serial,
          address: row.address,
          area: row.area,
          info: row.info,
          points: [],
        });
      }
      const meter = byId.get(row.id);
      meter.address = row.address || meter.address;
      meter.area = row.area || meter.area;
      meter.info = row.info;
      meter.points.push({
        date: row.exportDate,
        readAt: row.readAt,
        current: row.current,
        average: row.average,
        max: row.max,
        info: row.info,
        source: row.source,
      });
    }
  }

  const meters = [...byId.values()].map((meter) => {
    meter.points = dedupePoints(meter.points);
    return meter;
  });
  const sharedContexts = detectSharedSignals(meters);
  state.meters = meters.map((meter) => scoreMeter(meter, sharedContexts.get(meter.id)));
  render();
}

function dedupePoints(points) {
  const byKey = new Map();
  [...points].sort((a, b) => a.date - b.date).forEach((point) => {
    const key = localDate(point.date);
    const existing = byKey.get(key);
    if (!existing || point.current < existing.current || (point.current === existing.current && point.date > existing.date)) {
      byKey.set(key, point);
    }
  });
  return [...byKey.values()].sort((a, b) => a.date - b.date);
}

function scoreMeter(meter, networkContext = null) {
  const points = meter.points;
  const values = points.map((p) => p.current);
  const last = points[points.length - 1];
  const prev = points[points.length - 2] || null;
  const first = points[0];
  const pDeviation = last.average ? (last.current / last.average) - 1 : 0;
  const firstChange = first.current ? (last.current / first.current) - 1 : 0;
  const lastJump = prev && prev.current ? (last.current / prev.current) - 1 : 0;
  const maxSeen = Math.max(...points.map((p) => p.max || p.current));
  const label = state.labels[meter.id]?.type ? state.labels[meter.id] : null;
  const infrastructure = infrastructureProfile(meter);
  const profile = patternProfile(points, infrastructure);
  const shortHistory = profile.coverage.days < 30 || points.length < 3;
  const lowRelativeRise = LeakIntelligence.detectLowRelativeRise(points);
  const freshAnomaly = Boolean(
    profile.newLevel
    || lowRelativeRise?.persistent
    || (last.current >= 30 && lastJump >= 0.6)
    || (last.current >= 50 && pDeviation >= 0.5)
  );

  let risk = 8;
  const reasons = [];
  let category = "normal";

  if (/burst|rörbrott/i.test(meter.info)) {
    risk += 70; reasons.push("Infokod/rörbrott");
  }
  if (/leak|läcka/i.test(meter.info)) {
    risk += infrastructure.customerSide ? 24 : 40;
    reasons.push(infrastructure.customerSide ? "LEAK i Excel: troligen kundsida efter mätaren" : "Infokod LEAK");
  }
  if (/dry|torr/i.test(meter.info)) {
    risk -= infrastructure.summerWaterMeter ? 22 : 10;
    reasons.push(infrastructure.summerWaterMeter ? "DRY/torr: trolig avstängd sommarvattenmätare" : "DRY/torr i Excel - kontrollera driftstatus innan läcksök");
  }

  if (last.current >= 80) { risk += 34; reasons.push(`Mycket högt senaste E=${round(last.current)}`); }
  else if (last.current >= 50) { risk += 22; reasons.push(`Högt senaste E=${round(last.current)}`); }
  else if (last.current >= 30) { risk += 10; reasons.push(`Förhöjt senaste E=${round(last.current)}`); }

  if (maxSeen >= 90) { risk += 12; reasons.push(`Högt historiskt max G=${round(maxSeen)}`); }
  if (pDeviation >= 4) { risk += 18; reasons.push(`P ${(pDeviation * 100).toFixed(0)}% mot genomsnitt`); }
  else if (pDeviation >= 1) { risk += 8; reasons.push(`P ${(pDeviation * 100).toFixed(0)}% mot genomsnitt`); }

  if (lastJump >= 0.6) { risk += 22; reasons.push(`Senaste hopp ${(lastJump * 100).toFixed(0)}%`); }
  else if (lastJump >= 0.25) { risk += 10; reasons.push(`Senaste ökning ${(lastJump * 100).toFixed(0)}%`); }

  if (lowRelativeRise) {
    risk += lowRelativeRise.persistent ? 20 : 10;
    const persistence = lowRelativeRise.persistent
      ? `har hållit ${lowRelativeRise.persistenceDays} dagar över ${lowRelativeRise.elevatedReadings} avläsningar`
      : "ny signal - behöver fler dagar";
    reasons.push(`Låg nivå men stor relativ ökning: ${round(lowRelativeRise.from)} → ${round(lowRelativeRise.to)} (${(lowRelativeRise.change * 100).toFixed(0)}%), ${persistence}`);
  }

  if (profile.newLevel) { risk += 26; reasons.push(`Ny nivå från ${profile.newLevel.date}`); }
  if (profile.slowRise) { risk += 14; reasons.push("Långsam stigande kurva"); }
  if (profile.repeatedPattern) {
    risk -= profile.heatingSeason?.cycles >= 2 ? 34 : 25;
    reasons.push(profile.heatingSeason
      ? `Värmepannemönster: upp höst, ner vår (${profile.heatingSeason.cycles} årscykler)`
      : "Återkommande årsmönster");
  }
  if (profile.fluctuating) { risk -= 12; reasons.push("Fladdrig/pump-lik kurva"); }
  if (profile.repairedDrop) { risk -= 40; reasons.push("Har fallit tillbaka efter hög nivå"); }

  if (infrastructure.districtHeating) {
    const penalty = freshAnomaly ? 6 : 18;
    risk -= penalty;
    reasons.push("Fjärrvärmeområde/känd störkälla - kräver starkare kurvbevis");
  }
  if (infrastructure.largeSubstation) {
    const penalty = freshAnomaly ? 4 : 14;
    risk -= penalty;
    reasons.push("Höghus/större undercentral - kräver annan kontroll på plats");
  }
  if (infrastructure.summerWaterMeter && !freshAnomaly) {
    risk -= 18;
    reasons.push("Sommarvatten/off-season - ska inte läckprioriteras utan ny stark nivå");
  }
  if (networkContext?.sharedSignal) {
    if (freshAnomaly) risk += 6;
    reasons.push(`Samma kurvrörelse på ${networkContext.meterCount} mätare vid ${networkContext.place} - möjlig gemensam servis före mätarna`);
  }

  if (shortHistory) {
    risk -= 10;
    reasons.push(`Kort historik: ${profile.coverage.days} observerade dagar`);
  }
  if (profile.coverage.seasons < 2) {
    reasons.push("Har inte sett tillräckligt många säsonger");
  }

  if (label) {
    reasons.unshift(`Facit: ${labelTypes[label.type] || label.type}`);
    if (label.type === "leak") risk += 24;
    if (label.type === "repaired") risk += freshAnomaly ? -20 : -45;
    if (["seasonal", "known_noise", "pump", "false_alarm"].includes(label.type)) risk -= freshAnomaly ? 8 : 35;
    if (freshAnomaly && label.type !== "leak") reasons.push("Ny ihållande avvikelse trots tidigare facit");
  }

  risk = clamp(Math.round(risk), 0, 100);
  const repairAge = label?.repairedDate
    ? Math.floor((last.date - new Date(`${label.repairedDate}T23:59:59`)) / (24 * 60 * 60 * 1000))
    : 0;
  if (label?.type === "leak") category = "dispatch";
  else if ((label?.type === "repaired" && (!freshAnomaly || repairAge < 7)) || profile.repairedDrop) category = "repaired";
  else if ((label?.type === "seasonal" && !freshAnomaly) || (profile.repeatedPattern && !freshAnomaly)) category = "seasonal";
  else if ((["known_noise", "pump", "false_alarm"].includes(label?.type) && !freshAnomaly) || ((profile.fluctuating || infrastructure.districtHeating || infrastructure.largeSubstation || infrastructure.summerWaterMeter) && !freshAnomaly)) category = "noise";
  else if (shortHistory && risk >= 58 && !infrastructure.customerSide) category = "dispatch";
  else if (shortHistory) category = "learning";
  else if (lowRelativeRise && last.current < 15 && !profile.slowRise && !/burst|rörbrott|leak|läcka/i.test(meter.info)) category = "watch";
  else if (risk >= 58 && !infrastructure.customerSide) category = "dispatch";
  else if (infrastructure.customerSide && risk >= 38) category = "watch";
  else if (networkContext?.sharedSignal && freshAnomaly) category = "watch";
  else if (risk >= 38 || lowRelativeRise) category = "watch";
  else category = "normal";

  const confidence = confidenceFor(points, profile);
  return { ...meter, last, prev, first, pDeviation, firstChange, lastJump, lowRelativeRise, maxSeen, profile, infrastructure, networkContext, risk, reasons, category, confidence, label };
}

function detectSharedSignals(meters) {
  const groups = new Map();
  const result = new Map();
  for (const meter of meters) {
    const key = addressClusterKey(meter.address);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(meter);
  }
  for (const [place, group] of groups) {
    if (group.length < 2) continue;
    for (const meter of group) {
      const matching = group.filter((peer) => peer.id !== meter.id && curveCorrelation(meter.points, peer.points) >= 0.65);
      if (!matching.length) continue;
      result.set(meter.id, {
        sharedSignal: true,
        meterCount: matching.length + 1,
        place,
      });
    }
  }
  return result;
}

function addressClusterKey(address) {
  const cleaned = cleanText(address).toUpperCase().replace(/\b\d{5}\b/g, "").replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.+?\b\d+)\b/);
  return match?.[1] || null;
}

function curveCorrelation(firstPoints, secondPoints) {
  const secondByDate = new Map(secondPoints.map((point) => [localDate(point.date), point.current]));
  const pairs = firstPoints
    .map((point) => [point.current, secondByDate.get(localDate(point.date))])
    .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
  if (pairs.length < 5) return 0;
  const first = pairs.map((pair) => pair[0]);
  const second = pairs.map((pair) => pair[1]);
  const firstMean = avg(first);
  const secondMean = avg(second);
  const numerator = first.reduce((sum, value, index) => sum + (value - firstMean) * (second[index] - secondMean), 0);
  const denominator = Math.sqrt(
    first.reduce((sum, value) => sum + (value - firstMean) ** 2, 0)
    * second.reduce((sum, value) => sum + (value - secondMean) ** 2, 0)
  );
  return denominator ? numerator / denominator : 0;
}

function infrastructureProfile(meter) {
  const text = `${meter.address || ""} ${meter.area || ""} ${meter.info || ""}`.toUpperCase();
  const districtHeating = [
    "ADLER SALVIUS VÄG",
    "BLOCKVÄGEN",
  ].some((name) => text.includes(name));
  const largeSubstation = (
    text.includes("NORSBORG")
    && ["BALDERS VÄG", "LOKES VÄG", "ODENS VÄG", "TORS VÄG", "THORS VÄG"].some((name) => text.includes(name))
  );
  const customerSide = /\bLEAK\b|LÄCKA EFTER|KUNDSIDA|EFTER MÄTAREN/i.test(meter.info || "");
  const summerWaterMeter = /SOMMARVATTEN|SOMMAR\s*VATTEN|\bDRY\b|TORR/i.test(meter.info || "");
  return { districtHeating, largeSubstation, customerSide, summerWaterMeter };
}

function patternProfile(points, infrastructure = {}) {
  const observed = readingTimeline(points).points;
  const signalPoints = observed.length
    ? observed.map((point) => ({ ...point, date: point.readingDate }))
    : points;
  const values = signalPoints.map((p) => p.current);
  const mean = avg(values);
  const cv = mean ? stdev(values) / mean : 0;
  const months = new Map();
  for (const p of signalPoints) {
    const month = p.date.getMonth();
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(p.current);
  }
  const activeMonths = [...months.keys()];
  const seasons = new Set(activeMonths.map((m) => {
    if ([11, 0, 1].includes(m)) return "winter";
    if ([2, 3, 4].includes(m)) return "spring";
    if ([5, 6, 7].includes(m)) return "summer";
    return "autumn";
  })).size;

  const warm = avgMonths(months, [4, 5, 6, 7, 8]);
  const cold = avgMonths(months, [9, 10, 11, 0, 1, 2, 3]);
  const summerWaterPattern = avgMonths(months, [3, 4, 5, 6, 7]) > avgMonths(months, [8, 9, 10, 11, 0, 1, 2]) * 1.45;
  const summerWater = Boolean(infrastructure.summerWaterMeter && summerWaterPattern);
  const heatingSeason = LeakIntelligence.detectHeatingSeason(signalPoints);
  const heating = Boolean(heatingSeason || (cold > warm * 1.45 && cold > 12));
  const annualRepeat = LeakIntelligence.detectAnnualRepeat(signalPoints);
  const repeatedHeating = Boolean(heatingSeason?.cycles >= 2);
  const repeatedPattern = Boolean(
    repeatedHeating
    || (annualRepeat && (heating || summerWater) && Math.max(...values) < 160)
  );
  const fluctuating = signalPoints.length >= 5 && cv > 0.55 && !isLastPartElevated(values);
  const newLevel = detectNewLevel(signalPoints);
  const repairedDrop = detectRepairedDrop(values);
  const slowRise = detectSlowRise(values);
  return {
    mean,
    cv,
    heating,
    heatingSeason,
    summerWater,
    summerWaterPattern,
    annualRepeat,
    repeatedPattern,
    fluctuating,
    newLevel,
    repairedDrop,
    slowRise,
    coverage: {
      points: signalPoints.length,
      seasons,
      months: activeMonths.length,
      years: new Set(signalPoints.map((point) => point.date.getFullYear())).size,
      days: Math.max(0, Math.round((signalPoints[signalPoints.length - 1].date - signalPoints[0].date) / (24 * 60 * 60 * 1000))),
    },
  };
}

function detectNewLevel(points) {
  if (points.length < 4) return null;
  const values = points.map((p) => p.current);
  let best = null;
  for (let split = 2; split <= values.length - 2; split++) {
    const before = values.slice(0, split);
    const after = values.slice(split);
    const beforeAvg = avg(before);
    const afterAvg = avg(after);
    if (beforeAvg <= 0) continue;
    const ratio = afterAvg / beforeAvg;
    const afterStillHigh = avg(after.slice(-Math.min(3, after.length))) >= beforeAvg * 1.7;
    const beforeStable = before.every((v) => v <= Math.max(beforeAvg * 1.7, beforeAvg + 8));
    const meaningfulLevel = afterAvg >= 15 || (beforeAvg <= 12 && afterAvg >= 8 && ratio >= 2.5);
    if (ratio >= 2.3 && meaningfulLevel && afterStillHigh && beforeStable) {
      const candidate = { split, ratio, date: localDate(points[split].date) };
      if (!best || candidate.ratio > best.ratio) best = candidate;
    }
  }
  return best;
}

function detectRepairedDrop(values) {
  if (values.length < 3) return false;
  const max = Math.max(...values);
  const last = values[values.length - 1];
  const earlyQuiet = median(values) || 1;
  return max >= Math.max(50, earlyQuiet * 3) && last <= Math.max(18, earlyQuiet * 1.4) && last <= max * 0.45;
}

function detectSlowRise(values) {
  if (values.length < 5) return false;
  const first = avg(values.slice(0, Math.ceil(values.length / 3)));
  const last = avg(values.slice(-Math.ceil(values.length / 3)));
  return last >= first * 2 && last >= 25 && values[values.length - 1] >= values[0];
}

function isLastPartElevated(values) {
  if (values.length < 5) return false;
  const first = avg(values.slice(0, Math.floor(values.length / 2)));
  const last = avg(values.slice(Math.floor(values.length / 2)));
  return last > first * 1.7;
}

function confidenceFor(points, profile) {
  let score = 0;
  if (points.length >= 12 && profile.coverage.days >= 90) score += 2;
  else if (points.length >= 5 && profile.coverage.days >= 30) score += 1;
  if (profile.coverage.seasons >= 3) score += 2;
  else if (profile.coverage.seasons >= 2) score += 1;
  if (profile.annualRepeat) score += 2;
  if (profile.newLevel || profile.repairedDrop) score += 1;
  if (score >= 4) return "hög";
  if (score >= 2) return "medel";
  return "låg";
}

function render() {
  const q = els.search.value.trim().toLowerCase();
  const filter = els.filter.value;
  const sort = els.sort.value;
  let rows = [...state.meters];
  if (filter !== "all") rows = rows.filter((r) => {
    if (filter === "learning") return ["learning", "new_high", "new_unknown"].includes(r.category);
    return r.category === filter;
  });
  if (q) {
    rows = rows.filter((r) => `${r.address} ${r.serial} ${r.area}`.toLowerCase().includes(q));
  }
  rows.sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
  renderSummary();
  renderLabels();
  renderRows(rows);
}

function sortValue(row, sort) {
  if (sort === "p") return row.pDeviation || 0;
  if (sort === "lastJump") return row.lastJump || 0;
  if (sort === "current") return row.last.current || 0;
  if (sort === "max") return row.maxSeen || 0;
  if (sort === "confidence") return { låg: 1, medel: 2, hög: 3 }[row.confidence] || 0;
  return row.risk || 0;
}

function renderSummary() {
  const counts = {
    files: state.files.length,
    meters: state.meters.length,
    dispatch: state.meters.filter((m) => m.category === "dispatch").length,
    watch: state.meters.filter((m) => m.category === "watch").length,
    seasonal: state.meters.filter((m) => ["seasonal", "noise", "repaired"].includes(m.category)).length,
    short: state.meters.filter((m) => ["learning", "new_high", "new_unknown"].includes(m.category)).length,
  };
  els.summary.innerHTML = `
    <div><b>${counts.files}</b><span>filer</span></div>
    <div><b>${counts.meters}</b><span>mätare</span></div>
    <div><b>${counts.dispatch}</b><span>åk ut</span></div>
    <div><b>${counts.watch}</b><span>bevaka</span></div>
    <div><b>${counts.seasonal}</b><span>säsong/känd</span></div>
    <div><b>${counts.short}</b><span>under inlärning</span></div>
  `;
}

function renderLabels() {
  const entries = Object.entries(state.labels).filter(([, label]) => label?.type);
  if (!entries.length) {
    els.labels.innerHTML = `<p class="small">Inga facit sparade ännu.</p>`;
    return;
  }
  els.labels.innerHTML = entries.slice(-12).reverse().map(([id, label]) => `
    <div class="label-item">
      <b>${labelTypes[label.type] || label.type}</b>
      <div class="small">${escapeHtml(label.address || id)}</div>
      <div class="small">${escapeHtml(labelSummary(label))}</div>
    </div>
  `).join("");
}

function renderRows(rows) {
  if (!rows.length) {
    els.rows.innerHTML = `<tr><td colspan="7" class="empty">Ingen mätare matchar filtret.</td></tr>`;
    return;
  }
  els.rows.innerHTML = rows.map((r) => `
    <tr>
      <td data-label="Beslut" class="decision-cell">
        <span class="pill ${r.category}">${categoryText[r.category]}</span>
        <div class="score">${r.risk}</div>
        <div class="small">säkerhet: ${r.confidence}</div>
      </td>
      <td data-label="Adress" class="address-cell">
        <div class="address-line"><b>${escapeHtml(r.address || "-")}</b>${customerSideMark(r)}<button class="copy-address secondary" title="Kopiera adress" onclick="copyAddress('${escapeAttr(r.id)}', event)">Kopiera</button></div>
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
}

function tagLine(row) {
  const tags = [];
  if (row.infrastructure?.districtHeating) tags.push("fjärrvärme");
  if (row.infrastructure?.largeSubstation) tags.push("undercentral/höghus");
  if (row.infrastructure?.summerWaterMeter) tags.push("sommarvatten");
  if (row.networkContext?.sharedSignal) tags.push(`gemensam signal ${row.networkContext.meterCount} mätare`);
  return tags.length ? `<div class="tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : "";
}

function customerSideMark(row) {
  return row.infrastructure?.customerSide
    ? `<span class="info-mark" title="Leak i Excel: läckage efter mätaren, på kundens sida" aria-label="Läckage efter mätaren">i</span>`
    : "";
}

function feedbackActions(id) {
  return Object.entries(feedbackButtons)
    .map(([type, text]) => `<button class="secondary" onclick="labelMeter('${escapeAttr(id)}','${type}')">${text}</button>`)
    .join("");
}

function readingTimeline(points) {
  if (!points.length) {
    return { points: [], endDate: null, lastReadingDate: "-", gapDays: 0, hasGap: false };
  }
  const validDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());
  const exportDates = points.map((point) => point.date).filter(validDate);
  const endDate = exportDates.length ? new Date(Math.max(...exportDates.map((date) => date.getTime()))) : new Date();
  const byReadingDate = new Map();
  for (const point of points) {
    const readingDate = validDate(point.readAt) && point.readAt <= endDate ? point.readAt : point.date;
    if (!validDate(readingDate)) continue;
    const key = localDate(readingDate);
    const existing = byReadingDate.get(key);
    if (!existing || point.current < existing.current || (point.current === existing.current && point.date > existing.date)) {
      byReadingDate.set(key, { ...point, readingDate });
    }
  }
  const observed = [...byReadingDate.values()].sort((a, b) => a.readingDate - b.readingDate);
  const last = observed[observed.length - 1];
  const gapDays = last ? calendarDaysBetween(last.readingDate, endDate) : 0;
  return {
    points: observed,
    endDate,
    lastReadingDate: last ? localDate(last.readingDate) : "-",
    gapDays,
    hasGap: gapDays >= 14,
  };
}

function sparkPath(points) {
  const timeline = readingTimeline(points);
  if (!timeline.points.length) return "";
  const values = timeline.points.map((point) => point.current);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const startTime = timeline.points[0].readingDate.getTime();
  const endTime = timeline.hasGap
    ? timeline.endDate.getTime()
    : timeline.points[timeline.points.length - 1].readingDate.getTime();
  const duration = Math.max(1, endTime - startTime);
  const xy = timeline.points.map((point) => {
    const x = 4 + ((point.readingDate.getTime() - startTime) / duration) * 152;
    const v = point.current;
    const y = 38 - ((v - min) / range) * 34;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = values.length > 1 && values[values.length - 1] >= values[values.length - 2] ? "#ff9d4d" : "#35e07d";
  const observedLine = xy.length > 1
    ? `<polyline points="${xy.join(" ")}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="${xy[0].split(",")[0]}" cy="${xy[0].split(",")[1]}" r="3" fill="${color}"/>`;
  const last = xy[xy.length - 1].split(",");
  const gapLine = timeline.hasGap
    ? `<line x1="${last[0]}" y1="${last[1]}" x2="156" y2="${last[1]}" stroke="#748196" stroke-width="2" stroke-dasharray="7 5"/>`
    : "";
  return `<line x1="4" y1="38" x2="156" y2="38" stroke="#2a3544" stroke-width="1"/>${observedLine}${gapLine}`;
}

window.labelMeter = function labelMeter(id, type) {
  const meter = state.meters.find((m) => m.id === id);
  if (!meter) return;
  const existing = state.labels[id] || {};
  const today = localDate(new Date());
  els.feedbackMeterId.value = id;
  els.feedbackType.value = type;
  els.feedbackTitle.textContent = feedbackButtons[type] || "Facit";
  els.feedbackAddress.textContent = meter.address || id;
  els.confirmedDateField.hidden = type === "repaired";
  els.repairFields.hidden = type !== "repaired";
  els.feedbackDateLabel.textContent = type === "leak" ? "Datum konstaterad" : "Datum noterat";
  els.confirmedDate.value = existing.confirmedDate || existing.notedDate || today;
  els.repairedDate.value = existing.repairedDate || today;
  els.distanceMeters.value = existing.distanceMeters ?? "";
  els.feedbackNote.value = existing.note || "";
  document.querySelectorAll('input[name="lineType"]').forEach((input) => {
    input.checked = input.value === existing.lineType;
  });
  els.feedbackDialog.showModal();
};

function saveFeedback(event) {
  event.preventDefault();
  const id = els.feedbackMeterId.value;
  const type = els.feedbackType.value;
  const meter = state.meters.find((item) => item.id === id);
  const existing = state.labels[id] || {};
  const lineType = document.querySelector('input[name="lineType"]:checked')?.value || "";
  const next = {
    ...existing,
    type,
    address: meter?.address || existing.address,
    serial: meter?.serial || existing.serial,
    note: els.feedbackNote.value.trim(),
    at: new Date().toISOString(),
    source: "fältfacit",
  };
  if (type === "leak") next.confirmedDate = els.confirmedDate.value || localDate(new Date());
  else if (type === "repaired") {
    next.repairedDate = els.repairedDate.value || localDate(new Date());
    next.distanceMeters = parseNumber(els.distanceMeters.value);
    next.lineType = lineType;
  } else {
    next.notedDate = els.confirmedDate.value || localDate(new Date());
  }
  state.labels[id] = next;
  saveLabels();
  els.feedbackDialog.close();
  analyze();
}

window.openDetail = function openDetail(id) {
  const meter = state.meters.find((m) => m.id === id);
  if (!meter) return;
  const timeline = readingTimeline(meter.points);
  const graphPoints = timeline.points;
  const appendGap = (values) => timeline.hasGap ? [...values, null] : values;
  const labels = graphPoints.map((point) => localDate(point.readingDate));
  if (timeline.hasGap) labels.push(localDate(timeline.endDate));
  const missingData = new Array(labels.length).fill(null);
  if (timeline.hasGap && graphPoints.length) {
    missingData[graphPoints.length - 1] = graphPoints[graphPoints.length - 1].current;
    missingData[graphPoints.length] = graphPoints[graphPoints.length - 1].current;
  }
  els.detailTitle.textContent = meter.address || meter.id;
  els.detailMeta.textContent = `${meter.serial || meter.id} · ${meter.area || "ÖVRIGT"} · risk ${meter.risk} · ${categoryText[meter.category]}`;
  els.detailText.innerHTML = `
    <div class="detail-actions">
      <button class="secondary" onclick="copyAddress('${escapeAttr(meter.id)}', event)">Kopiera adress</button>
      ${feedbackActions(meter.id)}
    </div>
    <p><b>Motivering:</b> ${meter.reasons.map(escapeHtml).join(" · ")}</p>
    <p><b>Mönster:</b> värme=${meter.profile.heating ? "ja" : "nej"}${meter.profile.heatingSeason ? ` (${meter.profile.heatingSeason.pattern}, ${meter.profile.heatingSeason.cycles} årscykler)` : ""}, årsupprepning=${meter.profile.annualRepeat ? `${meter.profile.annualRepeat.months} jämförda månader` : "nej"}, fladdrig=${meter.profile.fluctuating ? "ja" : "nej"}, ny nivå=${meter.profile.newLevel ? "ja" : "nej"}.</p>
    <p><b>Miljö:</b> fjärrvärme=${meter.infrastructure.districtHeating ? "ja" : "nej"}, undercentral/höghus=${meter.infrastructure.largeSubstation ? "ja" : "nej"}, efter mätaren=${meter.infrastructure.customerSide ? "ja" : "nej"}, sommarvattenmätare=${meter.infrastructure.summerWaterMeter ? "ja" : "nej"}${meter.networkContext?.sharedSignal ? `, gemensam signal på ${meter.networkContext.meterCount} mätare` : ""}.</p>
    ${meter.label ? `<p><b>Facit:</b> ${escapeHtml(labelTypes[meter.label.type] || meter.label.type)} · ${escapeHtml(labelSummary(meter.label))}</p>` : ""}
  `;
  const ctx = document.getElementById("detailChart");
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Brus E", data: appendGap(graphPoints.map((point) => point.current)), borderColor: "#35e07d", backgroundColor: "rgba(53,224,125,.14)", fill: true, tension: .28, cubicInterpolationMode: "monotone" },
        { label: "Trend", data: appendGap(rollingAverage(graphPoints.map((point) => point.current))), borderColor: "#ffd166", borderWidth: 2.4, pointRadius: 0, tension: .35 },
        { label: "Genomsnitt F", data: appendGap(graphPoints.map((point) => point.average)), borderColor: "#5ab8ff", borderDash: [6, 5], tension: .24, hidden: true },
        { label: "Max G", data: appendGap(graphPoints.map((point) => point.max)), borderColor: "#ff9d4d", borderDash: [3, 5], tension: .24, hidden: true },
        { label: "Inga avläsningar", data: missingData, borderColor: "#8290a3", borderDash: [10, 7], borderWidth: 2.5, pointRadius: 0, fill: false, tension: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: {
          position: "top",
          labels: { color: "#d7e0ec", boxWidth: 14, usePointStyle: true, padding: 12 },
        },
        subtitle: {
          display: timeline.hasGap,
          text: timeline.hasGap ? `Inga avläsningar ${timeline.lastReadingDate} – ${localDate(timeline.endDate)}` : "",
          color: "#c7d0dc",
          font: { weight: "700", size: 13 },
          padding: { bottom: 12 },
        },
        tooltip: {
          callbacks: {
            afterBody(items) {
              const point = graphPoints[items[0].dataIndex];
              return point?.info ? `Info: ${point.info}` : "";
            },
          },
        },
      },
      elements: {
        line: { borderWidth: 3, borderCapStyle: "round", borderJoinStyle: "round" },
        point: { radius: graphPoints.length > 40 ? 0 : 2.5, hoverRadius: 6, backgroundColor: "#0d1219", borderWidth: 2 },
      },
      scales: {
        x: {
          ticks: { color: "#9da8b6", maxRotation: 0, minRotation: 0, maxTicksLimit: window.innerWidth < 640 ? 5 : 10 },
          grid: { color: "rgba(157,168,182,.08)" },
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#9da8b6" },
          grid: { color: "rgba(157,168,182,.12)" },
        },
      },
    },
  });
  els.detailDialog.showModal();
};

window.copyAddress = async function copyAddress(id, event) {
  event?.stopPropagation?.();
  const meter = state.meters.find((item) => item.id === id);
  if (!meter) return;
  const text = addressForCopy(meter.address);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  const button = event?.currentTarget;
  if (button) {
    const old = button.textContent;
    button.textContent = "Kopierad";
    setTimeout(() => { button.textContent = old; }, 1200);
  }
};

function resetAll() {
  if (!confirm("Rensa importerade filer och sparade facit i denna webbläsare?")) return;
  state.files = [];
  state.meters = [];
  state.labels = { ...knownCases };
  localStorage.removeItem("leaksok-intelligence-labels");
  if (state.profileId && window.LeakStorage) window.LeakStorage.clear(state.profileId).catch(() => {});
  render();
}

function exportLabels() {
  const blob = new Blob([JSON.stringify(state.labels, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leaksok-facit-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function labelSummary(label) {
  const parts = [];
  if (label.confirmedDate) parts.push(`konstaterad ${label.confirmedDate}`);
  if (label.repairedDate) parts.push(`lagad ${label.repairedDate}`);
  if (Number.isFinite(label.distanceMeters)) parts.push(`ca ${label.distanceMeters} m från mätaren`);
  if (label.lineType) parts.push(label.lineType);
  if (label.notedDate) parts.push(label.notedDate);
  if (label.note) parts.push(label.note);
  return parts.join(" · ");
}

function addressForCopy(address) {
  const text = cleanText(address).replace(/\s+/g, " ");
  const withoutPostcode = text.replace(/\s+\d{5}\s*$/, "");
  const areas = ["ALBY", "FITTJA", "TULLINGE", "NORSBORG", "TUMBA", "GRÖDINGE", "UTTRAN"];
  return withoutPostcode.replace(new RegExp(`\\s+(${areas.join("|")})\\s*$`, "i"), "").trim();
}

function rollingAverage(values) {
  const size = values.length >= 30 ? 7 : values.length >= 10 ? 5 : 3;
  return values.map((_, index) => {
    const from = Math.max(0, index - size + 1);
    return avg(values.slice(from, index + 1));
  });
}

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarDaysBetween(from, to) {
  if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const fromDay = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toDay = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.round((toDay - fromDay) / 86400000));
}

function cleanText(value) { return String(value ?? "").trim(); }
function normalizeAddress(value) {
  return cleanText(value).toUpperCase().replace(/\b\d{5}\b/g, "").replace(/\s+/g, " ");
}
function areaOf(value) {
  const upper = String(value || "").toUpperCase();
  for (const area of ["ALBY", "FITTJA", "TULLINGE", "NORSBORG", "TUMBA", "GRÖDINGE", "UTTRAN"]) {
    if (upper.includes(area)) return area;
  }
  return "ÖVRIGT";
}
function parseNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let normalized = String(value).trim()
    .replace(/[\u2212\u2012\u2013\u2014]/g, "-")
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/[^0-9,.-]/g, "");
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? /\./g : /,/g;
    normalized = normalized.replace(thousands, "");
    if (decimal === ",") normalized = normalized.replace(/,/g, ".");
  } else if (comma >= 0) {
    normalized = normalized.replace(/,/g, ".");
  }
  const firstDot = normalized.indexOf(".");
  if (firstDot >= 0) normalized = normalized.slice(0, firstDot + 1) + normalized.slice(firstDot + 1).replace(/\./g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
function avg(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function avgMonths(months, list) {
  const values = list.flatMap((m) => months.get(m) || []);
  return avg(values);
}
function stdev(values) {
  const m = avg(values);
  return Math.sqrt(avg(values.map((v) => (v - m) ** 2)));
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function round(n) { return Number.isFinite(n) ? Math.round(n) : "-"; }
function signedPct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(0)}%`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }

bootstrap();
