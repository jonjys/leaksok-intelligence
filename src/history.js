/* Meter history from imported exports. One export row is not one reading:
   the same reading (same timestamp) re-exported on later days is merged, and the
   curve uses reading dates, never export dates. Pure functions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakHistory = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DAY = 86400000;

  function validDate(value) {
    if (value == null || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function dayKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function calendarDays(from, to) {
    if (!from || !to) return null;
    const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / DAY);
  }
  function finite(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function toDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    return validDate(value);
  }

  /* files: [{ name, exportDate, rows: [...] }] → Map id → history.
     Files are ordered by export date, then file name, so import order never
     changes the result. Rows are kept as imported and read lazily. */
  function buildHistories(files) {
    const ordered = (files || [])
      .map((file) => ({ file, exportDate: toDate(file.exportDate) }))
      .filter((entry) => entry.exportDate)
      .sort((a, b) => a.exportDate - b.exportDate || (a.file.name < b.file.name ? -1 : a.file.name > b.file.name ? 1 : 0));
    const byId = new Map();
    const exportDays = new Set();
    let latestExport = null;
    for (const { file, exportDate } of ordered) {
      exportDays.add(dayKey(exportDate));
      if (!latestExport || exportDate > latestExport) latestExport = exportDate;
      const source = String(file.name || "");
      for (const raw of file.rows || []) {
        let id = raw.id;
        if (typeof id !== "string") id = String(id ?? "");
        if (id.charCodeAt(id.length - 1) === 32 || id.charCodeAt(0) === 32) id = id.trim();
        if (!id) continue;
        let entry = byId.get(id);
        if (!entry) { entry = { rows: [], exports: [], sources: [] }; byId.set(id, entry); }
        entry.rows.push(raw);
        entry.exports.push(exportDate);
        entry.sources.push(source);
      }
    }
    const histories = new Map();
    for (const [id, entry] of byId) histories.set(id, summarize(id, entry.rows, entry.exports, entry.sources));
    return { histories, latestExport, exportDayCount: exportDays.size };
  }

  function normalizeRow(raw, exportDate, source) {
    const current = finite(raw.current);
    const readAt = raw.readAtUnknown ? null : toDate(raw.readAt);
    return {
      exportDate,
      readAt: readAt && readAt.getTime() <= exportDate.getTime() + DAY ? readAt : null,
      current: current != null && current >= 0 ? current : null,
      average: finite(raw.average),
      max: finite(raw.max),
      minimumFlow: finite(raw.minimumFlow) != null && finite(raw.minimumFlow) >= 0 ? finite(raw.minimumFlow) : null,
      minimumFlowAt: toDate(raw.minimumFlowAt),
      infoCode: String(raw.infoCode ?? "").trim(),
      activeEvents: String(raw.activeEvents ?? "").trim(),
      closedEvents: String(raw.closedEvents ?? "").trim(),
      follow: raw.follow === true,
      interestRank: Number.isSafeInteger(raw.interestRank) && raw.interestRank > 0 ? raw.interestRank : null,
      source: String(raw.source || source || ""),
      serial: String(raw.serial ?? "").trim(),
      address: String(raw.address ?? "").trim(),
      area: String(raw.area ?? "").trim(),
    };
  }

  function summarize(id, rawRows, exports, sources) {
    const count = rawRows.length;
    const latestRow = normalizeRow(rawRows[count - 1], exports[count - 1], sources[count - 1]);
    let identity = latestRow;
    for (let i = count - 1; i >= 0 && !identity.address; i--) {
      if (rawRows[i].address) identity = normalizeRow(rawRows[i], exports[i], sources[i]);
    }
    // Unique readings keyed by the meter's reading timestamp. The newest export
    // of the same reading wins; rows are already in export order.
    const readings = new Map();
    let conflicts = 0, undated = 0, missingValues = 0;
    for (let i = 0; i < count; i++) {
      const raw = rawRows[i];
      const value = finite(raw.current);
      if (value == null || value < 0) { missingValues++; continue; }
      const readAt = raw.readAtUnknown ? null : toDate(raw.readAt);
      const exportDate = exports[i];
      if (!readAt || readAt.getTime() > exportDate.getTime() + DAY) { undated++; continue; }
      const key = readAt.getTime();
      const existing = readings.get(key);
      if (!existing) {
        readings.set(key, { readAt, value, firstExport: exportDate, lastExport: exportDate, exports: 1 });
        continue;
      }
      if (existing.value !== value) conflicts++;
      existing.value = value;
      existing.lastExport = exportDate;
      existing.exports++;
    }
    // One point per reading day: the lowest value, as in Kamstrup's daily noise value.
    const days = new Map();
    for (const reading of [...readings.values()].sort((a, b) => a.readAt - b.readAt)) {
      const r = reading.readAt;
      const key = r.getFullYear() * 512 + r.getMonth() * 32 + r.getDate();
      const day = days.get(key);
      if (!day) { days.set(key, { date: reading.readAt, value: reading.value, readings: 1, exports: reading.exports, firstExport: reading.firstExport, lastExport: reading.lastExport }); continue; }
      day.readings++;
      day.exports += reading.exports;
      if (reading.lastExport > day.lastExport) day.lastExport = reading.lastExport;
      if (reading.value < day.value) { day.value = reading.value; day.date = reading.readAt; }
    }
    const series = [...days.values()];
    return {
      id,
      serial: identity.serial || (/^\d+$/.test(id) ? id : ""),
      address: identity.address || id,
      area: identity.area || "",
      rowCount: count,
      latestRow,
      series,
      readingCount: readings.size,
      reexports: count - readings.size - missingValues - undated,
      conflicts,
      undated,
      missingValues,
      firstExport: exports[0],
      lastExport: exports[count - 1],
    };
  }

  /* Comparison used by charts: latest reading against the previous reading or a
     reading close to N days earlier. Never interpolates; zero gives no percent. */
  function compare(series, period = "previous") {
    const rows = (series || []).filter((p) => finite(p.value) != null && validDate(p.date)).sort((a, b) => a.date - b.date);
    const latest = rows[rows.length - 1];
    if (!latest) return { latest: null, reference: null, delta: null, percent: null, note: "Inga avläsningar" };
    const earlier = rows.slice(0, -1);
    let reference = earlier[earlier.length - 1] || null;
    let note = reference ? "" : "Ingen tidigare avläsning";
    if (period !== "previous") {
      const days = Number(period);
      const target = latest.date.getTime() - days * DAY;
      const tolerance = Math.min(14, Math.max(2, days * 0.15)) * DAY;
      reference = earlier.filter((p) => p.date.getTime() <= target + DAY / 2 && target - p.date.getTime() <= tolerance).pop() || null;
      if (!reference) note = `Ingen avläsning nära ${days} dagar före senaste`;
    }
    const delta = reference ? latest.value - reference.value : null;
    return { latest, reference, delta, percent: reference && reference.value > 0 ? (delta / reference.value) * 100 : null, note };
  }

  /* Coverage means days represented in these imports. It does not establish
     that the meter/Kamstrup had no readings on the other days. */
  function coverage(series, from, to) {
    const dates = (series || []).map(p => validDate(p.date)).filter(Boolean).sort((a, b) => a - b);
    from = validDate(from) || dates[0];
    to = validDate(to) || dates[dates.length - 1];
    if (!from || !to || to < from) return { readingDays: 0, expectedDays: 0, missingDays: 0, coverage: 0, maxGap: 0, from: from || null, to: to || null };
    const firstKey = dayKey(from), lastKey = dayKey(to), seen = new Set();
    const included = dates.filter(date => {
      const key = dayKey(date);
      if (key < firstKey || key > lastKey || seen.has(key)) return false;
      seen.add(key); return true;
    });
    const expectedDays = calendarDays(from, to) + 1;
    let maxGap = 0;
    for (let i = 1; i < included.length; i++) maxGap = Math.max(maxGap, calendarDays(included[i - 1], included[i]));
    return { readingDays: included.length, expectedDays, missingDays: Math.max(0, expectedDays - included.length),
      coverage: included.length / expectedDays, maxGap, from, to };
  }

  return { buildHistories, summarize, compare, coverage, dayKey, calendarDays, validDate };
}));

