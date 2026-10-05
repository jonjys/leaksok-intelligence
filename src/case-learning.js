/* Local evidence from registered leak/repair dates. Acoustic similarity never
   proves pipe connectivity or confirms a new leak. No remote model or service. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LeakCaseLearning = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const RULES = Object.freeze({ windowDays: 14, minDays: 3, maxGapDays: 3, radiusMeters: 250, maxHouseSpan: 20 });
  const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  function dateDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const n = Date.parse(`${value}T00:00:00Z`) / 86400000;
    return Number.isFinite(n) && new Date(n * 86400000).toISOString().slice(0, 10) === value ? n : null;
  }
  const median = (a) => { const s = [...a].sort((a, b) => a - b), n = s.length; return n ? (s[(n - 1) >> 1] + s[n >> 1]) / 2 : null; };
  function daily(m) {
    const map = new Map();
    for (const p of m.series || []) if (p.date instanceof Date && Number.isFinite(+p.date) && Number.isFinite(p.value)) map.set(day(p.date), { day: day(p.date), value: p.value });
    return [...map.values()].sort((a, b) => a.day - b.day);
  }
  function stats(points) {
    const level = median(points.map((p) => p.value));
    return { level, n: points.length, spread: level == null ? null : median(points.map((p) => Math.abs(p.value - level))) * 1.4826,
      sufficient: points.length >= RULES.minDays && points.every((p, i) => !i || p.day - points[i - 1].day <= RULES.maxGapDays) };
  }
  const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  function distance(a, b) {
    const rad = (v) => v * Math.PI / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  function relation(anchor, m, incident, coordinates, placeOf) {
    if (anchor.id === m.id) return { basis: 'registered', meters: 0 };
    const a = valid(incident.mapMarks?.leak) ? incident.mapMarks.leak : coordinates.get(anchor.id), b = coordinates.get(m.id);
    if (valid(a) && valid(b)) {
      const meters = distance(a, b);
      return meters <= RULES.radiusMeters ? { basis: 'position', meters: Math.round(meters) } : null;
    }
    const ap = placeOf?.(anchor.address, anchor.area), bp = placeOf?.(m.address, m.area);
    return ap && bp && ap.streetKey === bp.streetKey && Math.abs(ap.number - bp.number) <= RULES.maxHouseSpan
      ? { basis: 'address', meters: null } : null;
  }
  function build(meters, { labels = {}, coordinates = new Map(), placeOf } = {}) {
    const cases = [], matches = [], byId = new Map(meters.map((m) => [m.id, m])), series = new Map();
    for (const [id, label] of Object.entries(labels)) {
      const anchor = byId.get(id);
      if (!anchor) continue;
      const incidents = [...(Array.isArray(label.leakCases) ? label.leakCases : []), ...(['leak', 'repaired'].includes(label.type) ? [label] : [])];
      const seen = new Set();
      for (const incident of incidents) {
        const start = dateDay(incident.confirmedDate), repair = dateDay(incident.repairedDate);
        if (start == null || (repair != null && repair < start)) continue;
        const caseId = `${id}|${incident.confirmedDate}|${incident.repairedDate || 'active'}`;
        if (seen.has(caseId)) continue;
        seen.add(caseId);
        const record = { id: caseId, anchorId: id, address: anchor.address, confirmedDate: incident.confirmedDate, repairedDate: incident.repairedDate || null,
          lineType: incident.lineType || 'Vet ej', radiusMeters: RULES.radiusMeters, profiles: [] };
        for (const m of meters) {
          const near = relation(anchor, m, incident, coordinates, placeOf);
          if (!near) continue;
          if (!series.has(m.id)) series.set(m.id, daily(m));
          const points = series.get(m.id), end = repair ?? (points.at(-1)?.day + 1);
          const before = stats(points.filter((p) => p.day >= start - RULES.windowDays && p.day < start));
          const during = stats(points.filter((p) => p.day >= start && p.day < end));
          // Repair-day exports may contain both pre- and post-repair noise.
          const after = stats(repair == null ? [] : points.filter((p) => p.day > repair && p.day <= repair + RULES.windowDays));
          const rise = before.level == null || during.level == null ? null : during.level - before.level;
          const drop = after.level == null || during.level == null ? null : during.level - after.level;
          const threshold = Math.max(2, (before.level || 0) * 0.25, (before.spread || 0) * 3);
          const excluded = m.codes?.dry || m.codes?.leak || m.codes?.burst || m.codes?.afterMeterText;
          const shape = rise >= threshold && drop >= rise * 0.5 && after.level <= before.level + threshold;
          const validated = Boolean(repair != null && ['AV', 'SV'].includes(incident.lineType) && !incident.confirmedDateUncertain && near.basis !== 'address'
            && before.sufficient && during.sufficient && after.sufficient && shape && !excluded);
          let reason = validated ? 'Förhöjning under läckan och återgång efter lagning.' : repair == null ? 'Inväntar lagdatum och avläsningar efter lagning.'
            : incident.confirmedDateUncertain ? 'Osäkert läckdatum – preliminär jämförelse.' : near.basis === 'address' ? 'Adressnärhet – kartpositioner behöver verifieras.'
            : !['AV', 'SV'].includes(incident.lineType) ? 'Ledningstyp saknas.' : !before.sufficient || !during.sufficient || !after.sufficient ? 'Minst tre avläsningsdagar behövs i varje period, utan stora luckor.'
            : excluded ? 'Infokod efter mätare eller torr mätare – används inte för inlärning.' : 'Ingen tydlig förhöjning med återgång i de angivna perioderna.';
          const profile = { id: m.id, address: m.address, ...near, before, during, after, rise, drop, validated, reason };
          record.profiles.push(profile);
          // Recognize a later sustained rise in this meter's own validated profile.
          if (validated && m.latest?.ageDays <= 1) {
            const tail = points.slice(-RULES.minDays), current = stats(tail);
            const gate = Math.max(2, rise * 0.5, (after.spread || 0) * 3);
            if (current.sufficient && tail[0].day > repair + RULES.windowDays && current.level - after.level >= gate
              && tail.every((p) => p.value - after.level >= gate)) {
              matches.push({ id: m.id, caseId, anchorId: id, lineType: record.lineType, baseline: after.level, current: current.level, confirmedDate: record.confirmedDate, repairedDate: record.repairedDate });
            }
          }
        }
        cases.push(record);
      }
    }
    return { cases, matches };
  }
  return { RULES, build };
}));
