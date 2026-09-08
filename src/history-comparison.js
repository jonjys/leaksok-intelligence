(function (root) {
  const DAY = 86400000;
  function compare(points, period = "previous") {
    const rows = points.filter(p => p.current !== null && p.current !== "" && Number.isFinite(Number(p.current)) && Number(p.current) >= 0 && Number.isFinite(new Date(p.readingDate || p.date).getTime()))
      .map(p => ({ ...p, time: new Date(p.readingDate || p.date).getTime(), value: Number(p.current) }))
      .sort((a, b) => a.time - b.time);
    const latest = rows.at(-1);
    if (!latest) return { latest: null, reference: null, percent: null, delta: null };
    const earlier = rows.filter(p => p.time < latest.time);
    let reference = earlier.at(-1) || null;
    if (period !== "previous") {
      const days = Number(period);
      const target = latest.time - days * DAY;
      // Never silently compare a week-old value with a months-old reading.
      const tolerance = Math.min(14, Math.max(2, days * .15)) * DAY;
      reference = earlier.filter(p => p.time <= target && target - p.time <= tolerance).at(-1) || null;
    }
    const delta = reference ? latest.value - reference.value : null;
    return { latest, reference, delta, percent: reference && reference.value > 0 ? delta / reference.value * 100 : null };
  }
  const api = { compare };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakHistory = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
