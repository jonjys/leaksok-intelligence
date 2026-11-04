/* Descriptive comparisons only: no change to leak classification or decisions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LeakComparison = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const day = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  const median = values => { const a = [...values].sort((a, b) => a - b); const i = Math.floor(a.length / 2); return a.length ? a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2 : null; };
  function windows(series, asOf) {
    const daily = new Map();
    for (const p of series || []) {
      const date = new Date(p.date);
      if (!Number.isFinite(date.getTime()) || typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value < 0) continue;
      const key = day(date);
      if (asOf && key > day(new Date(asOf))) continue;
      const existing = daily.get(key);
      if (!existing || p.value < existing.value) daily.set(key, { ...p, date, key });
    }
    const points = [...daily.values()].sort((a, b) => a.key - b.key);
    if (!points.length) return null;
    const last = points.at(-1), end = last.key;
    const current = points.filter(p => p.key >= end - 2);
    const level = median(current.map(p => p.value));
    const ageDays = asOf ? Math.max(0, day(new Date(asOf)) - end) : 0;
    return { current: { level, n: current.length, from: current[0].date, to: last.date }, ageDays,
      periods: [7, 30, 90].map(days => {
        // Disjoint windows: the latest three calendar days never train their own reference.
        const ref = points.filter(p => p.key >= end - 2 - days && p.key < end - 2);
        const reference = median(ref.map(p => p.value));
        const reliable = current.length === 3 && ref.length >= Math.ceil(days / 2) && ref.length >= 3 && ageDays < 2;
        const delta = reference == null ? null : level - reference;
        return { days, reference, n: ref.length, coverage: ref.length / days, reliable,
          from: ref[0]?.date || null, to: ref.at(-1)?.date || null,
          delta, percent: reference > 0 ? 100 * delta / reference : null,
          reason: ageDays >= 2 ? 'Äldre avläsning' : current.length < 3 ? 'Färre än tre senaste avläsningsdagar' : ref.length < Math.max(3, Math.ceil(days / 2)) ? 'Glest jämförelseunderlag' : 'Medianer av skilda perioder' };
      }) };
  }
  const readingKey = row => JSON.stringify([row.id, row.readAt?.getTime?.() ?? row.readAt ?? null, row.current]);
  function fingerprint(rows) { return rows.map(readingKey).sort().join('\n'); }
  function mergeRows(existing, incoming) {
    const patches = new Map(incoming.map(row => [readingKey(row), row]));
    return existing.map(row => ({ ...row, ...Object.fromEntries(Object.entries(patches.get(readingKey(row)) || {}).filter(([key, value]) => value !== undefined && !['source', 'exportDate'].includes(key))) }));
  }
  return { windows, fingerprint, mergeRows };
}));
