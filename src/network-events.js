/* Relative, time-aligned signals. This is a watch rule, not a leak probability. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LeakNetworkEvents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DAY = 86400000;
  const median = xs => { const a = [...xs].sort((x,y) => x-y); return a.length % 2 ? a[a.length >> 1] : (a[a.length/2-1]+a[a.length/2])/2; };
  const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  function location(meter) {
    const address = normalize(meter.address);
    const match = address.match(/^(.+?)\s+(\d+\S*)(.*)$/);
    if (!match) return null;
    // Require locality as well as street. Never cluster a whole town or guessed GPS.
    const area = normalize(meter.area || match[3]);
    return area ? { key: match[1] + '|' + area, street: match[1], address } : null;
  }
  function readings(points) {
    const days = new Map();
    for (const p of points || []) {
      if (p.current == null || p.current === '') continue;
      const value = Number(p.current), time = Date.parse(p.readAt);
      const exported = Date.parse(p.date);
      if (!Number.isFinite(value) || value < 0 || !Number.isFinite(time) || !Number.isFinite(exported) || time > exported) continue;
      // Local calendar date in the source, so browser timezone cannot split peers.
      const date = new Date(time);
      const day = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
      const old = days.get(day);
      if (!old || value < old.value || (value === old.value && exported > old.exported)) days.set(day, { value, time, exported, day });
    }
    return [...days.values()].sort((a,b) => a.time-b.time);
  }
  function detect(meters) {
    const prepared = meters.map(m => ({ meter:m, place:location(m), points:readings(m.points) }));
    let reference = 0;
    for (const {meter} of prepared) for (const p of meter.points || []) {
      const date = Date.parse(p.date); if (Number.isFinite(date)) reference = Math.max(reference, date);
    }
    const candidates = [];
    for (const {meter,place,points} of prepared) {
      if (!place || points.length < 3) continue;
      const latest = points.at(-1);
      if (reference-latest.time > 3*DAY) continue;
      for (let i=points.length-1; i>=2; i--) {
        const onset = points[i], before = points[i-1];
        if (reference-onset.time > 3*DAY) break;
        if (onset.time-before.time > 2*DAY) continue;
        const history = points.slice(0,i).filter(p => onset.time-p.time <= 14*DAY).slice(-5);
        if (history.length < 2) continue;
        const base = median(history.map(p=>p.value));
        const threshold = Math.max(base*1.5, base+3);
        if (base <= 0 || before.value >= threshold || onset.value < threshold) continue;
        if (points.slice(i).some(p=>p.value < threshold)) continue;
        candidates.push({ id:meter.id, address:meter.address, place, baseline:base,
          before:before.value, latest:latest.value, rise:(latest.value/base-1)*100,
          from:before.time, onset:onset.time, day:onset.day, lastDay:latest.day,
          observedDays:points.length-i });
        break;
      }
    }
    const groups = new Map();
    for (const c of candidates) {
      const key = c.place.key+'|'+c.day;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const events = [];
    for (const [key,members] of groups) {
      if (new Set(members.map(m=>m.place.address)).size < 2) continue;
      // Reading intervals must overlap: same export date alone is insufficient.
      const from = Math.max(...members.map(m=>m.from));
      const to = Math.min(...members.map(m=>m.onset));
      if (from >= to) continue;
      events.push({ key, street:members[0].place.street, day:members[0].day, from, to,
        members:members.sort((a,b)=>b.rise-a.rise),
        persistent:members.every(m=>m.observedDays>=2) });
    }
    return events.sort((a,b)=>b.to-a.to || b.members.length-a.members.length);
  }
  return { detect, readings, location };
});
