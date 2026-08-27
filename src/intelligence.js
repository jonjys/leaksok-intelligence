(function exposeLeakIntelligence(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakIntelligence = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function buildLeakIntelligence() {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function detectLowRelativeRise(points) {
    if (!Array.isArray(points) || points.length < 2) return null;

    const ordered = points
      .map((point) => ({ date: new Date(point.date), current: Number(point.current) }))
      .filter((point) => Number.isFinite(point.current) && !Number.isNaN(point.date.getTime()))
      .sort((a, b) => a.date - b.date);
    if (ordered.length < 2) return null;

    let best = null;
    for (let split = 1; split < ordered.length; split++) {
      const before = ordered.slice(0, split);
      const after = ordered.slice(split);
      const baseline = median(before.map((point) => point.current));
      const latest = ordered[ordered.length - 1].current;
      if (!baseline || baseline > 15 || latest >= 30) continue;

      const baselineRange = Math.max(...before.map((point) => point.current)) - Math.min(...before.map((point) => point.current));
      const baselineIsStable = before.length < 3 || baselineRange <= Math.max(3, baseline * 0.7);
      const elevatedThreshold = Math.max(8, baseline + 3);
      const clearStepThreshold = Math.max(8, baseline + 4, baseline * 1.8);
      const elevatedReadings = after.filter((point) => point.current >= elevatedThreshold).length;
      const elevatedShare = elevatedReadings / after.length;
      const afterAverage = average(after.map((point) => point.current));
      const change = (latest / baseline) - 1;

      if (!baselineIsStable || latest < clearStepThreshold || afterAverage < elevatedThreshold || change < 0.8) continue;

      const persistenceDays = Math.max(0, Math.round((ordered[ordered.length - 1].date - after[0].date) / DAY_MS));
      const persistent = persistenceDays >= 7 && elevatedReadings >= 3 && elevatedShare >= 0.75;
      const candidate = {
        from: baseline,
        to: latest,
        change,
        changedAt: after[0].date.toISOString().slice(0, 10),
        persistenceDays,
        elevatedReadings,
        persistent,
      };

      if (!best || Number(candidate.persistent) > Number(best.persistent) || candidate.change > best.change) {
        best = candidate;
      }
    }
    return best;
  }

  function detectAnnualRepeat(points) {
    if (!Array.isArray(points) || points.length < 8) return null;
    const monthly = new Map();
    for (const point of points) {
      const date = new Date(point.readAt || point.date);
      const current = Number(point.current);
      if (!Number.isFinite(current) || Number.isNaN(date.getTime())) continue;
      const year = date.getFullYear();
      const month = date.getMonth();
      if (!monthly.has(year)) monthly.set(year, new Map());
      const yearMap = monthly.get(year);
      if (!yearMap.has(month)) yearMap.set(month, []);
      yearMap.get(month).push(current);
    }

    const years = [...monthly.keys()].sort();
    let best = null;
    for (let i = 0; i < years.length - 1; i++) {
      for (let j = i + 1; j < years.length; j++) {
        const first = monthly.get(years[i]);
        const second = monthly.get(years[j]);
        const commonMonths = [...first.keys()].filter((month) => second.has(month));
        if (commonMonths.length < 4) continue;
        const a = commonMonths.map((month) => average(first.get(month)));
        const b = commonMonths.map((month) => average(second.get(month)));
        const correlation = pearson(a, b);
        if (correlation >= 0.7 && (!best || correlation > best.correlation)) {
          best = { years: [years[i], years[j]], months: commonMonths.length, correlation };
        }
      }
    }
    return best;
  }

  function detectHeatingSeason(points) {
    if (!Array.isArray(points) || points.length < 12) return null;
    const monthly = new Map();
    for (const point of points) {
      const date = new Date(point.readAt || point.date);
      const current = Number(point.current);
      if (!Number.isFinite(current) || Number.isNaN(date.getTime())) continue;
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (!monthly.has(key)) monthly.set(key, []);
      monthly.get(key).push(current);
    }

    const monthValue = (year, month) => {
      const values = monthly.get(`${year}-${month}`) || [];
      return values.length ? median(values) : null;
    };
    const period = (pairs, minimumMonths) => {
      const values = pairs.map(([year, month]) => monthValue(year, month)).filter(Number.isFinite);
      return values.length >= minimumMonths ? average(values) : null;
    };
    const years = [...new Set([...monthly.keys()].map((key) => Number(key.split("-")[0])))].sort();
    const cycles = [];

    for (const year of years) {
      const summer = period([[year, 4], [year, 5], [year, 6], [year, 7]], 2);
      const autumn = period([[year, 8], [year, 9], [year, 10]], 2);
      const winter = period([[year, 11], [year + 1, 0], [year + 1, 1], [year + 1, 2]], 2);
      const spring = period([[year + 1, 3], [year + 1, 4], [year + 1, 5]], 2);
      if (![summer, autumn, winter, spring].every(Number.isFinite)) continue;

      const risesInAutumn = autumn >= summer * 1.3 && autumn - summer >= 4;
      const staysHighInWinter = winter >= summer * 1.25 && winter >= autumn * 0.72;
      const fallsInSpring = spring <= winter * 0.76 && winter - spring >= 4;
      if (risesInAutumn && staysHighInWinter && fallsInSpring) {
        cycles.push({ year, summer, autumn, winter, spring });
      }
    }

    if (!cycles.length) return null;
    return {
      cycles: cycles.length,
      years: cycles.map((cycle) => `${cycle.year}/${cycle.year + 1}`),
      confidence: cycles.length >= 2 ? "high" : "medium",
      pattern: "upp september–november, ner april–juni",
    };
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function pearson(a, b) {
    const meanA = average(a);
    const meanB = average(b);
    const deviationsA = a.map((value) => value - meanA);
    const deviationsB = b.map((value) => value - meanB);
    const denominator = Math.sqrt(
      deviationsA.reduce((sum, value) => sum + value ** 2, 0)
      * deviationsB.reduce((sum, value) => sum + value ** 2, 0)
    );
    if (!denominator) return 0;
    return deviationsA.reduce((sum, value, index) => sum + value * deviationsB[index], 0) / denominator;
  }

  return { detectAnnualRepeat, detectHeatingSeason, detectLowRelativeRise };
}));
