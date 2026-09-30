/* Supplemental area evidence. Never changes individual categories or decisions.
   No pipe topology is inferred from addresses or acoustic noise. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakAreaSignals = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RULES = Object.freeze({ minAddresses: 3, maxMeters: 250, maxHouseSpan: 20,
    onsetSpreadDays: 3, recentDays: 14, maxGapDays: 3, maxAgeDays: 1,
    minBaselineDays: 3, minDelta: 2, minRatio: 0.25, sigmaFactor: 2 });
  const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const validPosition = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  function distance(a, b) {
    const rad = (d) => d * Math.PI / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  function candidate(m, label, place, position) {
    if (label?.hidden || ["ignored", "repaired", "new_install"].includes(label?.type)) return null;
    if (["ignored", "repaired", "seasonal", "noise", "customer_side", "stale_contact"].includes(m.category)) return null;
    if (!m.latest || m.latest.ageDays > RULES.maxAgeDays || m.codes.dry || m.codes.leak || m.codes.burst || m.codes.afterMeterText) return null;
    if (m.excel.E == null || (!place && !validPosition(position))) return null;
    // Use at most one reading per calendar day; same-day exports add no evidence.
    const daily = new Map();
    for (const p of m.series) daily.set(day(p.date), p);
    const series = [...daily.values()];
    if (series.length < RULES.minBaselineDays + 1) return null;
    const last = series.at(-1), cutoff = day(last.date) - RULES.recentDays;
    for (let i = Math.max(3, series.length - 30); i < series.length; i++) {
      const at = series[i], before = series.slice(Math.max(0, i - 14), i), after = series.slice(i);
      if (day(at.date) < cutoff) continue;
      const window = [...before, ...after];
      if (window.some((p, k) => k && day(p.date) - day(window[k - 1].date) > RULES.maxGapDays)) continue;
      const base = median(before.map((p) => p.value));
      const spread = median(before.map((p) => Math.abs(p.value - base))) * 1.4826;
      const sigma = Math.max(2 / 3, m.history.sigma || 0, spread);
      const threshold = Math.max(RULES.minDelta, RULES.minRatio * base, RULES.sigmaFactor * sigma);
      if (before.some((p) => Math.abs(p.value - base) > threshold)) continue;
      if (after.some((p) => p.value - base < threshold)) continue;
      // An older same-season change is not a new event just because nearby meters moved.
      if (m.upFinding?.onset?.at && day(at.date) - day(m.upFinding.onset.at) > RULES.onsetSpreadDays) continue;
      const current = median(after.map((p) => p.value));
      return { id: m.id, address: m.address, place, position: validPosition(position) ? position : null,
        baseline: base, current, delta: current - base, pct: base > 0 ? current / base - 1 : null,
        from: before[0].date, beforeTo: before.at(-1).date, onset: at.date, lastDate: last.date,
        beforeReadings: before.length, readings: after.length, meter: m };
    }
    return null;
  }

  function relation(a, b) {
    if (Math.abs(day(a.onset) - day(b.onset)) > RULES.onsetSpreadDays) return null;
    if (a.position && b.position) {
      const meters = distance(a.position, b.position);
      return meters <= RULES.maxMeters ? { type: "position", meters } : null;
    }
    // Same street AND locality AND a bounded house-number span. Never report this as metres.
    if (a.place && b.place && a.place.streetKey === b.place.streetKey && Math.abs(a.place.number - b.place.number) <= RULES.maxHouseSpan) return { type: "address", meters: null };
    return null;
  }
  function addressCount(members) {
    // Co-located meters cannot provide evidence from multiple buildings.
    const representatives = [];
    for (const m of members) {
      if (!representatives.some((r) => (m.place && r.place && m.place.building === r.place.building)
        || (m.position && r.position && distance(m.position, r.position) < 10))) representatives.push(m);
    }
    return representatives.length;
  }

  function build(meters, { coordinates = new Map(), labels = {}, placeOf } = {}) {
    const candidates = meters.map((m) => candidate(m, labels[m.id] || m.label, placeOf(m.address, m.area), coordinates.get(m.id)))
      .filter(Boolean).sort((a, b) => a.address.localeCompare(b.address, "sv", { numeric: true }) || a.id.localeCompare(b.id));
    const signals = [], assigned = new Set();
    for (const seed of candidates) {
      if (assigned.has(seed.id)) continue;
      const members = [seed];
      // Complete linkage: no kilometre-long chains of individually close neighbours.
      for (const other of candidates) {
        if (other.id === seed.id || assigned.has(other.id)) continue;
        if (members.every((m) => relation(m, other))) members.push(other);
      }
      const buildings = addressCount(members);
      if (buildings < RULES.minAddresses) continue;
      const allLocated = members.every((m) => m.position);
      const allStreet = members.every((m) => m.place?.streetKey && m.place.streetKey === seed.place?.streetKey);
      // Mixed position/address evidence across streets is too ambiguous without all coordinates.
      if (!allLocated && !allStreet) continue;
      const score = (a) => members.reduce((sum, b) => sum + (allLocated ? distance(a.position, b.position) : Math.abs(a.place.number - b.place.number)), 0);
      const anchor = [...members].sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0];
      let diameter = null;
      if (allLocated) { diameter = 0; for (const a of members) for (const b of members) diameter = Math.max(diameter, distance(a.position, b.position)); }
      const repeated = members.every((m) => m.readings >= 2);
      const broad = candidates.length >= 10 && candidates.length / Math.max(1, meters.filter((m) => !labels[m.id]?.hidden && m.latest?.ageDays <= 1).length) >= 0.2;
      const notes = [
        "Möjlig gemensam ljudkälla: läcka på huvudledning eller annan gemensam ledning, pump, spolning eller ändrad drift. Läckans plats och ledningstyp är inte fastställda.",
        allLocated ? "Avstånd avser husens kartpunkter, inte ledningssträckning eller mätarnas exakta placering." : "Grupperad efter gata, ort och närliggande husnummer. Fysisk närhet är inte verifierad utan kartpositioner.",
        repeated ? "Förhöjningen har observerats minst två avläsningsdagar per mätare; det är inte samma sak som bekräftad läcka." : "Preliminär områdessignal: minst en mätare har bara en förhöjd avläsningsdag. Följ nästa avläsning.",
      ];
      if (broad) notes.push("Många mätare i det importerade urvalet stiger samtidigt. Kontrollera gemensam drift- eller säsongspåverkan innan lokal läcka antas.");
      if (members.some((m) => m.meter.interference.any || m.meter.season?.status !== "none" && m.meter.season?.status)) notes.push("Störmiljö eller säsongsindikation finns i gruppen; jämför med drift och värmesystem.");
      const signal = { id: members.map((m) => m.id).sort().join("|"), ids: members.map((m) => m.id),
        anchorId: anchor.id, anchorAddress: anchor.address, buildingCount: buildings, count: members.length,
        basis: allLocated ? "position" : "address", diameterMeters: diameter == null ? null : Math.round(diameter),
        stage: repeated ? "repeated" : "early", onsetFrom: new Date(Math.min(...members.map((m) => +m.onset))),
        onsetTo: new Date(Math.max(...members.map((m) => +m.onset))), broad,
        summary: `${members.length} mätare på ${buildings} adresser ökar under samma period. Möjlig gemensam källa.`,
        action: `Läcksök området runt ${anchor.address}. Jämför mätarna och lyssna vid åtkomliga ventiler längs gemensam ledningssträcka. Adressen är en startpunkt för kontroll, inte en utpekad läckplats.`,
        notes, members: members.map(({ meter, position, place, ...m }) => m) };
      signals.push(signal);
      for (const m of members) assigned.add(m.id);
    }
    return signals.sort((a, b) => Number(b.stage === "repeated") - Number(a.stage === "repeated") || b.buildingCount - a.buildingCount || a.id.localeCompare(b.id));
  }
  return { RULES, build };
}));
