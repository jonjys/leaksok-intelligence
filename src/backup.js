/* Versioned portable backups. Merge by dates, preserve existing history and
   newer manual decisions. Directory handles and profile codes never export. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakBackup = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  const validDate = (v) => v != null && Number.isFinite(new Date(v).getTime());
  function parse(text) {
    const data = JSON.parse(text);
    if (!object(data) || (data.format && data.format !== "leaksok-backup") || (data.version != null && data.version !== 1)) throw new Error("Filen är inte en stödd LeakSök-säkerhetskopia.");
    if (!object(data.labels) || !Array.isArray(data.tripList) || (data.files != null && !Array.isArray(data.files))) throw new Error("Säkerhetskopian saknar giltiga beslut eller arbetslista.");
    for (const [id, label] of Object.entries(data.labels)) if (!id || !object(label)) throw new Error("Ett beslut i säkerhetskopian är ogiltigt.");
    for (const entry of data.tripList) if (!object(entry) || typeof entry.id !== "string" || !entry.id) throw new Error("Arbetslistan i säkerhetskopian är ogiltig.");
    for (const file of data.files || []) {
      if (!object(file) || typeof file.name !== "string" || !validDate(file.exportDate) || !Array.isArray(file.rows)) throw new Error("En export i säkerhetskopian är ogiltig.");
      for (const row of file.rows) {
        if (!object(row) || typeof row.id !== "string" || !row.id || (row.readAt != null && !validDate(row.readAt)) || (row.current != null && (typeof row.current !== "number" || !Number.isFinite(row.current) || row.current < 0))) throw new Error("Säkerhetskopian innehåller en ogiltig mätarrad.");
      }
    }
    return { files: data.files || [], labels: data.labels, tripList: data.tripList };
  }
  const time = (value) => Date.parse(value || "") || 0;
  function mergeLabel(current, incoming) {
    if (!current) return incoming;
    const result = { ...(time(incoming.at) >= time(current.at) ? incoming : current) };
    for (const [dateKey, fields] of [["commentAt", ["comment", "commentAt"]], ["visibilityUpdatedAt", ["hidden", "visibilityUpdatedAt"]]]) {
      const winner = time(incoming[dateKey] || incoming.at) >= time(current[dateKey] || current.at) ? incoming : current;
      // The chosen decision may not carry the most recently edited comment
      // or visibility. Compare these edits separately rather than discarding them.
      if (fields.some(key => Object.hasOwn(winner, key))) for (const key of fields) result[key] = winner[key];
    }
    return result;
  }
  const fileKey = (f) => JSON.stringify([f.name, new Date(f.exportDate).toISOString(), f.rows.map(row => Object.fromEntries(Object.keys(row).filter(key => key !== "exportDate" && row[key] !== undefined).sort().map(key => [key, key === "readAt" && row[key] != null ? new Date(row[key]).toISOString() : row[key]])))]);
  function merge(current, incoming) {
    const files = [...current.files], seen = new Set(files.map(fileKey));
    for (const file of incoming.files) {
      const key = fileKey(file);
      if (!seen.has(key)) { files.push(file); seen.add(key); }
    }
    const labels = { ...current.labels };
    for (const [id, label] of Object.entries(incoming.labels)) {
      Object.defineProperty(labels, id, { value: mergeLabel(Object.hasOwn(labels, id) ? labels[id] : null, label), enumerable: true, configurable: true, writable: true });
    }
    const tripList = [...current.tripList], ids = new Set(tripList.map(e => e.id));
    for (const entry of incoming.tripList) if (!ids.has(entry.id)) { tripList.push(entry); ids.add(entry.id); }
    return { files, labels, tripList };
  }
  function stringify(snapshot) {
    return JSON.stringify({ format: "leaksok-backup", version: 1, exportedAt: new Date().toISOString(), files: snapshot.files, labels: snapshot.labels, tripList: snapshot.tripList });
  }
  return { parse, merge, stringify };
}));
