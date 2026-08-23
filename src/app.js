const knownCases = {
  "53843859": {
    type: "repaired",
    address: "ALHAGSVÄGEN 58 -60 NORSBORG 14559",
    serial: "53843859",
    note: "Bekräftad läcka cirka 50-55 m från servisventilen vid nr 58. Lagad 2026-08-23 cirka 12:30; avläsning 17 kl. 13:01.",
    at: "2026-08-23T12:30:00+02:00",
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
};

const categoryText = {
  dispatch: "ÅK UT",
  leak_likely: "TROLIG LÄCKA",
  watch: "BEVAKA",
  new_high: "NY MÄTARE - HÖG",
  new_unknown: "NY MÄTARE - OKLAR",
  seasonal: "SÄSONG / KÄND",
  repaired: "LAGAD",
  noise: "PUMP / STÖRNING",
  customer_side: "KUNDSIDA",
  normal: "NORMAL",
};

const labelTypes = {
  leak: "Bekräftad läcka",
  repaired: "Lagad",
  seasonal: "Säsong/känd",
  pump: "Pump/störning",
  false_alarm: "Falsklarm",
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
};

els.pickFiles.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", (event) => handleFiles([...event.target.files]));
els.search.addEventListener("input", render);
els.filter.addEventListener("change", render);
els.sort.addEventListener("change", render);
els.closeDetail.addEventListener("click", () => els.detailDialog.close());
els.resetAll.addEventListener("click", resetAll);
els.exportJson.addEventListener("click", exportLabels);

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
}

async function handleFiles(files) {
  const excelFiles = files.filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name));
  if (!excelFiles.length) {
    els.importStatus.textContent = "Ingen Excel- eller CSV-fil vald.";
    return;
  }
  if (typeof XLSX === "undefined") {
    els.importStatus.textContent = "Excel-läsaren kunde inte laddas. Kontrollera internetanslutningen och ladda om sidan.";
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
  const meterRows = state.files.reduce((sum, file) => sum + file.rows.length, 0);
  els.importStatus.textContent = `${imported} filer inlästa, ${meterRows.toLocaleString("sv-SE")} mätarrader.${errors.length ? ` Kunde inte läsa ${errors.length}: ${errors.join(" | ")}` : ""}`;
  els.fileInput.value = "";
}

async function parseWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
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

  const exportDate = findExportDate(rows) || dateFromFile(file);
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
      info: [row[col.info], row[col.activeEvents], row[col.closedEvents]].map(cleanText).filter(Boolean).join(" · "),
      source: file.name,
    });
  }
  return { exportDate, rows: parsed };
}

function findHeaderIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
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
  const text = String(value);
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 0), +(iso[5] || 0));
  return null;
}

function dateFromFile(file) {
  const match = file.name.match(/(\d{4})-(\d{2})-(\d{2})[ _-](\d{2})-(\d{2})/);
  if (match) return new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  return new Date(file.lastModified || Date.now());
}

function analyze() {
  const byId = new Map();
  for (const file of state.files) {
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

  state.meters = [...byId.values()].map((meter) => {
    meter.points = dedupePoints(meter.points);
    return scoreMeter(meter);
  });
  render();
}

function dedupePoints(points) {
  const byKey = new Map();
  [...points].sort((a, b) => a.date - b.date).forEach((point) => {
    const key = point.date.toISOString().slice(0, 16);
    byKey.set(key, point);
  });
  return [...byKey.values()].sort((a, b) => a.date - b.date);
}

function scoreMeter(meter) {
  const points = meter.points;
  const values = points.map((p) => p.current);
  const last = points[points.length - 1];
  const prev = points[points.length - 2] || null;
  const first = points[0];
  const pDeviation = last.average ? (last.current / last.average) - 1 : 0;
  const firstChange = first.current ? (last.current / first.current) - 1 : 0;
  const lastJump = prev && prev.current ? (last.current / prev.current) - 1 : 0;
  const maxSeen = Math.max(...points.map((p) => p.max || p.current));
  const label = state.labels[meter.id];
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
  if (profile.repeatedPattern) { risk -= 25; reasons.push("Återkommande årsmönster"); }
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
    if (label.type === "repaired") risk += freshAnomaly ? -5 : -45;
    if (label.type === "seasonal" || label.type === "pump" || label.type === "false_alarm") risk -= freshAnomaly ? 8 : 35;
    if (freshAnomaly && label.type !== "leak") reasons.push("Ny ihållande avvikelse trots tidigare facit");
  }

  risk = clamp(Math.round(risk), 0, 100);
  if ((label?.type === "repaired" && !freshAnomaly) || profile.repairedDrop) category = "repaired";
  else if ((label?.type === "seasonal" && !freshAnomaly) || (profile.repeatedPattern && !freshAnomaly)) category = "seasonal";
  else if (infrastructure.customerSide && !/burst|rörbrott/i.test(meter.info)) category = "customer_side";
  else if ((label?.type === "pump" && !freshAnomaly) || ((profile.fluctuating || infrastructure.districtHeating || infrastructure.largeSubstation || infrastructure.summerWaterMeter) && !freshAnomaly)) category = "noise";
  else if (shortHistory && last.current >= 40) category = "new_high";
  else if (shortHistory) category = "new_unknown";
  else if (lowRelativeRise && last.current < 15 && !profile.slowRise && !/burst|rörbrott|leak|läcka/i.test(meter.info)) category = "watch";
  else if (risk >= 78) category = "dispatch";
  else if (risk >= 58) category = "leak_likely";
  else if (risk >= 38 || lowRelativeRise) category = "watch";
  else category = "normal";

  const confidence = confidenceFor(points, profile);
  return { ...meter, last, prev, first, pDeviation, firstChange, lastJump, lowRelativeRise, maxSeen, profile, infrastructure, risk, reasons, category, confidence, label };
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
  const values = points.map((p) => p.current);
  const mean = avg(values);
  const cv = mean ? stdev(values) / mean : 0;
  const months = new Map();
  for (const p of points) {
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
  const heating = cold > warm * 1.45 && cold > 12;
  const annualRepeat = LeakIntelligence.detectAnnualRepeat(points);
  const repeatedPattern = Boolean(annualRepeat && (heating || summerWater) && Math.max(...values) < 80);
  const fluctuating = points.length >= 5 && cv > 0.55 && !isLastPartElevated(values);
  const newLevel = detectNewLevel(points);
  const repairedDrop = detectRepairedDrop(values);
  const slowRise = detectSlowRise(values);
  return {
    mean,
    cv,
    heating,
    summerWater,
    summerWaterPattern,
    annualRepeat,
    repeatedPattern,
    fluctuating,
    newLevel,
    repairedDrop,
    slowRise,
    coverage: {
      points: points.length,
      seasons,
      months: activeMonths.length,
      years: new Set(points.map((point) => point.date.getFullYear())).size,
      days: Math.max(0, Math.round((points[points.length - 1].date - points[0].date) / (24 * 60 * 60 * 1000))),
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
      const candidate = { split, ratio, date: points[split].date.toISOString().slice(0, 10) };
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
  if (filter !== "all") rows = rows.filter((r) => r.category === filter);
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
    likely: state.meters.filter((m) => m.category === "leak_likely").length,
    seasonal: state.meters.filter((m) => ["seasonal", "noise", "repaired"].includes(m.category)).length,
    short: state.meters.filter((m) => ["new_high", "new_unknown"].includes(m.category)).length,
  };
  els.summary.innerHTML = `
    <div><b>${counts.files}</b><span>filer</span></div>
    <div><b>${counts.meters}</b><span>mätare</span></div>
    <div><b>${counts.dispatch}</b><span>åk ut</span></div>
    <div><b>${counts.likely}</b><span>trolig läcka</span></div>
    <div><b>${counts.seasonal}</b><span>säsong/känd</span></div>
    <div><b>${counts.short}</b><span>kort historik</span></div>
  `;
}

function renderLabels() {
  const entries = Object.entries(state.labels);
  if (!entries.length) {
    els.labels.innerHTML = `<p class="small">Inga facit sparade ännu.</p>`;
    return;
  }
  els.labels.innerHTML = entries.slice(-12).reverse().map(([id, label]) => `
    <div class="label-item">
      <b>${labelTypes[label.type] || label.type}</b>
      <div class="small">${escapeHtml(label.address || id)}</div>
      <div class="small">${escapeHtml(label.note || "")}</div>
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
      <td data-label="Beslut">
        <span class="pill ${r.category}">${categoryText[r.category]}</span>
        <div class="score">${r.risk}</div>
        <div class="small">säkerhet: ${r.confidence}</div>
      </td>
      <td data-label="Adress">
        <b>${escapeHtml(r.address || "-")}</b>
        <div class="small">${escapeHtml(r.serial || r.id)} · ${escapeHtml(r.area || "ÖVRIGT")}</div>
        ${tagLine(r)}
      </td>
      <td data-label="E/F/P">
        <b>E ${round(r.last.current)}</b> · F ${round(r.last.average)} · G ${round(r.maxSeen)}
        <div class="small">P ${(r.pDeviation * 100).toFixed(0)}%</div>
      </td>
      <td data-label="Trend">
        <b>${signedPct(r.lastJump)}</b> senast
        <div class="small">${signedPct(r.firstChange)} från första filen</div>
      </td>
      <td data-label="Historik">
        <svg class="spark" viewBox="0 0 160 42" onclick="openDetail('${escapeAttr(r.id)}')">${sparkPath(r.points)}</svg>
        <div class="small">${r.points.length} punkter · ${r.profile.coverage.days} dagar · ${r.profile.coverage.months} månader · ${r.profile.coverage.seasons} säsonger</div>
      </td>
      <td data-label="Varför">
        <ul class="reasons">${r.reasons.slice(0, 5).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      </td>
      <td data-label="Facit"><div class="feedback">${Object.entries(labelTypes).map(([type, text]) => `<button class="secondary" onclick="labelMeter('${escapeAttr(r.id)}','${type}')">${text}</button>`).join("")}</div></td>
    </tr>
  `).join("");
}

function tagLine(row) {
  const tags = [];
  if (row.infrastructure?.districtHeating) tags.push("fjärrvärme");
  if (row.infrastructure?.largeSubstation) tags.push("undercentral/höghus");
  if (row.infrastructure?.customerSide) tags.push("kundsida");
  if (row.infrastructure?.summerWaterMeter) tags.push("sommarvatten");
  return tags.length ? `<div class="tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : "";
}

function sparkPath(points) {
  if (points.length < 2) return "";
  const values = points.map((p) => p.current);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xy = values.map((v, i) => {
    const x = 4 + (i / (values.length - 1)) * 152;
    const y = 38 - ((v - min) / range) * 34;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = values[values.length - 1] >= values[values.length - 2] ? "#ff8a3d" : "#2dd36f";
  return `<polyline points="${xy.join(" ")}" fill="none" stroke="${color}" stroke-width="2"/><line x1="0" y1="22" x2="160" y2="22" stroke="#344354" stroke-width="1"/>`;
}

window.labelMeter = function labelMeter(id, type) {
  const meter = state.meters.find((m) => m.id === id);
  const note = prompt("Kort notering, datum, avstånd, vad hittades?", state.labels[id]?.note || "");
  state.labels[id] = {
    type,
    address: meter?.address,
    serial: meter?.serial,
    note: note || "",
    at: new Date().toISOString(),
  };
  saveLabels();
  analyze();
};

window.openDetail = function openDetail(id) {
  const meter = state.meters.find((m) => m.id === id);
  if (!meter) return;
  els.detailTitle.textContent = meter.address || meter.id;
  els.detailMeta.textContent = `${meter.serial || meter.id} · ${meter.area || "ÖVRIGT"} · risk ${meter.risk} · ${categoryText[meter.category]}`;
  els.detailText.innerHTML = `
    <p><b>Motivering:</b> ${meter.reasons.map(escapeHtml).join(" · ")}</p>
    <p><b>Mönster:</b> värme=${meter.profile.heating ? "ja" : "nej"}, sommarvatten=${meter.profile.summerWater ? "ja" : "nej"}, årsupprepning=${meter.profile.annualRepeat ? `${meter.profile.annualRepeat.months} jämförda månader` : "nej"}, fladdrig=${meter.profile.fluctuating ? "ja" : "nej"}, ny nivå=${meter.profile.newLevel ? "ja" : "nej"}.</p>
    <p><b>Miljö:</b> fjärrvärme=${meter.infrastructure.districtHeating ? "ja" : "nej"}, undercentral/höghus=${meter.infrastructure.largeSubstation ? "ja" : "nej"}, kundsida=${meter.infrastructure.customerSide ? "ja" : "nej"}, sommarvatten=${meter.infrastructure.summerWaterMeter ? "ja" : "nej"}.</p>
  `;
  const ctx = document.getElementById("detailChart");
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: meter.points.map((p) => p.date.toISOString().slice(0, 10)),
      datasets: [
        { label: "Senaste värde E", data: meter.points.map((p) => p.current), borderColor: "#2dd36f", tension: .25 },
        { label: "Genomsnitt F", data: meter.points.map((p) => p.average), borderColor: "#4cb3ff", borderDash: [5, 4], tension: .2 },
        { label: "Max G", data: meter.points.map((p) => p.max), borderColor: "#ff8a3d", borderDash: [2, 4], tension: .2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: {
          position: "top",
          labels: { color: "#d7e0ec", boxWidth: 18, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            afterBody(items) {
              const point = meter.points[items[0].dataIndex];
              return point?.info ? `Info: ${point.info}` : "";
            },
          },
        },
      },
      elements: {
        line: { borderWidth: 3 },
        point: { radius: 3, hoverRadius: 6 },
      },
      scales: {
        x: {
          ticks: { color: "#9da8b6", maxRotation: 35, minRotation: 0 },
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

function resetAll() {
  if (!confirm("Rensa importerade filer och sparade facit i denna webbläsare?")) return;
  state.files = [];
  state.meters = [];
  state.labels = { ...knownCases };
  saveLabels();
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
  const number = parseFloat(String(value).replace(",", ".").replace(/[^0-9.-]/g, ""));
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
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
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

render();
