/* Import of Kamstrup Leak Detector exports (XLSX/XLS/CSV tables).
   Pure functions: no DOM, usable from Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakParse = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DAY = 86400000;
  const AREAS = ["ALBY", "FITTJA", "HALLUNDA", "TULLINGE", "NORSBORG", "TUMBA", "STORVRETEN", "GRÖDINGE", "VÅRSTA", "UTTRAN"];

  function cleanText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

  // Swedish and international number formats. Missing is null, never zero.
  function parseNumber(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    let text = String(value).trim()
      .replace(/[−‒–—]/g, "-")
      .replace(/[\s  ]/g, "")
      .replace(/(\d)[a-zA-Z%]{1,4}$/, "$1");
    if (!/^[-+]?[\d.,]+$/.test(text) || !/\d/.test(text)) return null;
    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? "," : ".";
      text = text.replace(decimal === "," ? /\./g : /,/g, "");
      if (decimal === ",") text = text.replace(",", ".");
    } else if (comma >= 0) {
      text = (text.match(/,/g).length > 1) ? text.replace(/,/g, "") : text.replace(",", ".");
    } else if ((text.match(/\./g) || []).length > 1) {
      text = text.replace(/\./g, "");
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  // Excel serials and wall-clock strings become local wall-clock dates. Components
  // are set directly, so daylight saving changes cannot shift the reading hour.
  function fromExcelSerial(serial) {
    if (!Number.isFinite(serial)) return null;
    const utc = new Date(Math.round((serial - 25569) * DAY / 1000) * 1000);
    const date = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds());
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function validParts(y, m, d, h = 0, mi = 0, s = 0) {
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
    const date = new Date(y, m - 1, d, h, mi, s);
    return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  }

  function parseDate(value, { serialRange = [32874, 73051] } = {}) {
    if (value == null || value === "") return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "number") {
      return value >= serialRange[0] && value <= serialRange[1] ? fromExcelSerial(value) : null;
    }
    const text = String(value).trim();
    if (/^\d+(?:[.,]\d+)?$/.test(text)) return parseDate(parseNumber(text), { serialRange });
    const zoned = text.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/);
    if (zoned) {
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/);
    if (iso) return validParts(+iso[1], +iso[2], +iso[3], +(iso[4] || 0), +(iso[5] || 0), +(iso[6] || 0));
    const swedish = text.match(/(?:^|\D)(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?(?:\D|$)/);
    if (swedish) return validParts(+swedish[3], +swedish[2], +swedish[1], +(swedish[4] || 0), +(swedish[5] || 0), +(swedish[6] || 0));
    return null;
  }

  function dateFromFileName(name) {
    const match = String(name || "").match(/(\d{4})-(\d{2})-(\d{2})(?:[ _T-]+(\d{2})[-.:](\d{2}))?/);
    return match ? validParts(+match[1], +match[2], +match[3], +(match[4] || 0), +(match[5] || 0)) : null;
  }

  function parseCsvRows(text) {
    const source = String(text || "").replace(/^﻿/, "");
    const lines = source.split(/\r?\n/).slice(0, 60);
    const headerLine = lines.find((line) => /serie|mätar|meter/i.test(line) && /värde|noise|brus|value/i.test(line)) || lines[0] || "";
    const separator = [";", "\t", ","]
      .map((value) => ({ value, count: headerLine.split(value).length - 1 }))
      .sort((a, b) => b.count - a.count)[0].value;
    const rows = [];
    let row = [], value = "", quoted = false;
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') { value += '"'; index++; }
        else quoted = !quoted;
      } else if (char === separator && !quoted) {
        row.push(value); value = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && source[index + 1] === "\n") index++;
        row.push(value);
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = []; value = "";
      } else value += char;
    }
    row.push(value);
    if (row.some((cell) => cell !== "")) rows.push(row);
    return rows;
  }

  function findHeaderIndex(rows) {
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const cells = (rows[i] || []).map((value) => String(value ?? "").toLowerCase());
      const hasId = cells.some((cell) => /adress|address|serie|mätarnummer|meter/.test(cell));
      const hasValue = cells.some((cell) => /senaste värde|brus|noise|value/.test(cell));
      if (hasId && hasValue) return i;
    }
    return -1;
  }

  function findColumn(header, names, exclude = []) {
    for (const name of names) {
      const exact = header.findIndex((cell, i) => cell === name && !exclude.includes(i));
      if (exact >= 0) return exact;
    }
    for (const name of names) {
      const partial = header.findIndex((cell, i) => cell.includes(name) && !exclude.includes(i));
      if (partial >= 0) return partial;
    }
    return -1;
  }

  function mapColumns(headerRow) {
    const header = headerRow.map((value) => String(value ?? "").trim().toLowerCase());
    const col = {};
    col.serial = findColumn(header, ["serienummer", "serienr", "mätarnummer", "serial", "meter"]);
    col.address = findColumn(header, ["adress", "address", "installationsadress", "plats"]);
    col.current = findColumn(header, ["senaste värde", "brusvärde", "brus", "noise", "value"]);
    col.average = findColumn(header, ["genomsnittsvärde", "genomsnitt", "medelvärde", "average", "avg"], [col.current]);
    col.max = findColumn(header, ["maxvärde", "max", "högsta"], [col.current]);
    col.readAt = findColumn(header, ["senaste avläsning", "avläsningstid", "avläsning", "tidpunkt", "date", "datum"]);
    col.info = findColumn(header, ["infokod", "info code", "infocode"]);
    col.activeEvents = findColumn(header, ["aktiva händelser", "active events"]);
    col.closedEvents = findColumn(header, ["stängda händelser", "closed events"]);
    col.area = findColumn(header, ["område", "ort", "area", "kommundel"]);
    return col;
  }

  function areaOf(text) {
    const upper = String(text || "").toUpperCase();
    return AREAS.find((area) => new RegExp(`(^|[^A-ZÅÄÖ])${area}([^A-ZÅÄÖ]|$)`).test(upper)) || "ÖVRIGT";
  }

  // Municipal districts for filtering. The locality column wins over street names.
  const DISTRICTS = [
    ["Alby", ["ALBY"]], ["Fittja", ["FITTJA", "FITJA"]], ["Hallunda-Norsborg", ["HALLUNDA", "NORSBORG"]],
    ["Tullinge", ["TULLINGE"]], ["Tumba-Storvreten", ["TUMBA", "STORVRETEN"]], ["Vårsta-Grödinge", ["VÅRSTA", "GRÖDINGE"]],
  ];
  function districtOf(area, address) {
    const find = (text) => {
      const upper = ` ${String(text || "").toUpperCase()} `;
      return DISTRICTS.find(([, names]) => names.some((n) => new RegExp(`[^A-ZÅÄÖ]${n}[^A-ZÅÄÖ]`).test(upper)))?.[0];
    };
    return find(area) || find(address) || "Övrigt";
  }

  function normalizeAddressId(address) {
    return cleanText(address).toUpperCase().replace(/\b\d{5}\b/g, "").replace(/\s+/g, " ").trim();
  }

  function latestHeaderDate(rows) {
    let latest = null;
    for (const row of rows.slice(0, 12)) {
      for (const cell of row || []) {
        const date = parseDate(cell, { serialRange: [40179, 73051] });
        if (date && (!latest || date > latest)) latest = date;
      }
    }
    return latest;
  }

  /* table: array of rows (arrays). file: { name, lastModified }.
     Returns { exportDate, exportDateSource, rows, warnings, stats }. */
  function parseTable(table, file = {}, { now = new Date() } = {}) {
    const rows = Array.isArray(table) ? table : [];
    const headerIndex = findHeaderIndex(rows);
    if (headerIndex < 0) throw new Error("hittade ingen rubrikrad med Serienummer/Adress och Senaste värde");
    const col = mapColumns(rows[headerIndex]);
    if (col.current < 0 || (col.serial < 0 && col.address < 0)) {
      throw new Error("Kamstrup-kolumnerna Serienummer/Adress/Senaste värde saknas");
    }
    const warnings = [];
    const fromName = dateFromFileName(file.name);
    const fromHeader = latestHeaderDate(rows.slice(0, headerIndex));
    let exportDate = fromName || fromHeader || (file.lastModified ? new Date(file.lastModified) : null);
    let exportDateSource = fromName ? "filnamn" : fromHeader ? "rapporthuvud" : "filens ändringstid";
    const latestAllowed = new Date(now.getTime() + DAY);
    const parsed = [];
    const stats = { rows: 0, missingValue: 0, invalidValue: 0, unknownReadDate: 0, futureReadDate: 0 };
    let maxReadAt = null;
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const serial = col.serial >= 0 ? cleanText(row[col.serial]) : "";
      const address = col.address >= 0 ? cleanText(row[col.address]) : "";
      if (!serial && !address) continue;
      stats.rows++;
      const raw = row[col.current];
      let current = parseNumber(raw);
      if (raw == null || cleanText(raw) === "") { current = null; stats.missingValue++; }
      else if (current == null || current < 0) { current = null; stats.invalidValue++; }
      let readAt = col.readAt >= 0 ? parseDate(row[col.readAt]) : null;
      if (readAt && readAt > latestAllowed) { readAt = null; stats.futureReadDate++; }
      if (!readAt) stats.unknownReadDate++;
      if (readAt && (!maxReadAt || readAt > maxReadAt)) maxReadAt = readAt;
      const infoCode = col.info >= 0 ? cleanText(row[col.info]) : "";
      const activeEvents = col.activeEvents >= 0 ? cleanText(row[col.activeEvents]) : "";
      parsed.push({
        id: serial || normalizeAddressId(address),
        serial,
        address,
        area: areaOf(`${col.area >= 0 ? cleanText(row[col.area]) : ""} ${address}`),
        readAt,
        current,
        average: col.average >= 0 ? parseNumber(row[col.average]) : null,
        max: col.max >= 0 ? parseNumber(row[col.max]) : null,
        infoCode,
        activeEvents,
        closedEvents: col.closedEvents >= 0 ? cleanText(row[col.closedEvents]) : "",
        source: file.name || "",
      });
    }
    if (!exportDate) { exportDate = maxReadAt || now; exportDateSource = "senaste avläsning i filen"; }
    // A file cannot contain readings taken after it was exported.
    if (maxReadAt && maxReadAt > new Date(exportDate.getTime() + DAY)) {
      warnings.push(`exportdatum ${localDate(exportDate)} (${exportDateSource}) är äldre än filens senaste avläsning ${localDate(maxReadAt)}; exportdatum satt till avläsningen`);
      exportDate = maxReadAt;
      exportDateSource = "senaste avläsning i filen";
    }
    for (const row of parsed) row.exportDate = exportDate;
    if (stats.missingValue) warnings.push(`${stats.missingValue} rader saknar Senaste värde (räknas inte som noll)`);
    if (stats.invalidValue) warnings.push(`${stats.invalidValue} rader har ogiltigt eller negativt Senaste värde`);
    if (stats.unknownReadDate) warnings.push(`${stats.unknownReadDate} rader saknar giltigt avläsningsdatum och används inte i kurvan`);
    if (stats.futureReadDate) warnings.push(`${stats.futureReadDate} avläsningsdatum låg i framtiden och ignorerades`);
    return { exportDate, exportDateSource, rows: parsed, warnings, stats };
  }

  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  return { DISTRICTS, districtOf, parseNumber, parseDate, fromExcelSerial, dateFromFileName, parseCsvRows, findHeaderIndex, mapColumns, parseTable, areaOf, cleanText, normalizeAddressId, localDate };
}));
