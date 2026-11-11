/* Supplemental area evidence. Never changes individual categories or decisions.
   No pipe topology is inferred from addresses or acoustic noise. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakAreaSignals = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RULES = Object.freeze({ minAddresses: 3, maxMeters: 250, maxHouseSpan: 20,
    onsetSpreadDays: 3, recentDays: 14, maxGapDays: 3, maxAgeDays: 1,
    minBaselineDays: 3, shortBaselineDays: 2, shortMinDelta: 3, shortMinRatio: 0.5, shortSigmaFactor: 3,
    minDelta: 2, minRatio: 0.25, sigmaFactor: 2,
    minSupport: 0.75, subtleBaselineDays: 7, subtleReadings: 3,
    subtleMinDelta: 5, subtleMinRatio: 0.1, subtleSigmaFactor: 3 });
  const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const validPosition = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  function distance(a, b) {
    const rad = (d) => d * Math.PI / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  function eligible(m, label) {
    if (label?.hidden || ["ignored", "repaired", "new_install"].includes(label?.type)) return null;
    if (["ignored", "repaired", "seasonal", "noise", "customer_side", "stale_contact"].includes(m.category)) return null;
    if (!m.latest || m.latest.ageDays > RULES.maxAgeDays || m.codes.dry || m.codes.leak || m.codes.burst || m.codes.afterMeterText || m.codes.minimumFlowContinuous) return null;
    return m.excel.E != null;
  }
  function candidate(m, label, place, position) {
    if (!eligible(m, label) || (!place && !validPosition(position))) return null;
    // Use at most one reading per calendar day; same-day exports add no evidence.
    const daily = new Map();
    for (const p of m.series) daily.set(day(p.date), p);
    const series = [...daily.values()].sort((a, b) => a.date - b.date);
    if (series.length < RULES.shortBaselineDays + 1) return null;
    const last = series.at(-1), cutoff = day(last.date) - RULES.recentDays;
    for (let i = Math.max(RULES.shortBaselineDays, series.length - 30); i < series.length; i++) {
      const at = series[i], before = series.slice(Math.max(0, i - 14), i), after = series.slice(i);
      if (day(at.date) < cutoff) continue;
      const window = [...before, ...after];
      if (window.some((p, k) => k && day(p.date) - day(window[k - 1].date) > RULES.maxGapDays)) continue;
      const base = median(before.map((p) => p.value));
      const spread = median(before.map((p) => Math.abs(p.value - base))) * 1.4826;
      // Estimate variation only before the change. Including the event in
      // its own noise estimate can hide a small, sustained common rise.
      const diffs = before.slice(1).map((p, k) => Math.abs(p.value - before[k].value));
      const sigma = Math.max(2 / 3, spread, 1.4826 * median(diffs) / Math.SQRT2);
      const shortBaseline = before.length < RULES.minBaselineDays;
      let threshold = shortBaseline
        ? Math.max(RULES.shortMinDelta, RULES.shortMinRatio * base, RULES.shortSigmaFactor * sigma)
        : Math.max(RULES.minDelta, RULES.minRatio * base, RULES.sigmaFactor * sigma);
      const current = median(after.map((p) => p.value));
      const subtle = current - base < threshold;
      if (subtle) {
        if (before.length < RULES.subtleBaselineDays || after.length < RULES.subtleReadings) continue;
        threshold = Math.max(RULES.subtleMinDelta, RULES.subtleMinRatio * base, RULES.subtleSigmaFactor * sigma);
      }
      // With only two previous days, require a steady reference and a stronger
      // rise. Two exports of one reading are never two reference days.
      if (shortBaseline && before.some((p) => Math.abs(p.value - base) > Math.max(RULES.minDelta, base * RULES.minRatio))) continue;
      if (before.some((p) => Math.abs(p.value - base) > threshold)) continue;
      const elevated = after.filter((p) => p.value - base >= threshold);
      if (at.value - base < threshold) continue;
      if (current - base < threshold || elevated.length / after.length < RULES.minSupport) continue;
      // An isolated middle dip is allowed, a recent return to baseline is
      // not. A single elevated reading remains explicitly preliminary.
      if (after.slice(-Math.min(2, after.length)).some((p) => p.value - base < threshold)) continue;
      // An older same-season change is not a new event just because nearby meters moved.
      if (m.upFinding?.onset?.at && day(at.date) - day(m.upFinding.onset.at) > RULES.onsetSpreadDays) continue;
      return { id: m.id, address: m.address, place, position: validPosition(position) ? position : null,
        baseline: base, current, delta: current - base, pct: base > 0 ? current / base - 1 : null,
        from: before[0].date, beforeTo: before.at(-1).date, onset: at.date, lastDate: last.date,
        beforeReadings: before.length, readings: elevated.length, observedReadings: after.length,
        support: elevated.length / after.length, elevatedDays: elevated.map((p) => day(p.date)),
        shortBaseline, subtle, meter: m };
    }
    return null;
  }

  function relation(a, b) {
    if (Math.abs(day(a.onset) - day(b.onset)) > RULES.onsetSpreadDays) return null;
    return spatialRelation(a, b);
  }
  function spatialRelation(a, b) {
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
      const commonDays = members[0].elevatedDays.filter((d) => members.every((m) => m.elevatedDays.includes(d))).length;
      const repeated = commonDays >= 2 && members.every((m) => m.readings >= 2);
      const shortBaseline = members.some((m) => m.shortBaseline);
      const subtle = members.some((m) => m.subtle);
      if (subtle && !repeated) continue;
      const eligibleMeters = meters.filter((m) => eligible(m, labels[m.id] || m.label));
      const broad = candidates.length >= 10 && candidates.length / Math.max(1, eligibleMeters.length) >= 0.2;
      const nearby = eligibleMeters.map((m) => ({ id: m.id, place: placeOf(m.address, m.area), position: validPosition(coordinates.get(m.id)) ? coordinates.get(m.id) : null }))
        .filter((m) => spatialRelation(anchor, m));
      const rising = nearby.filter((m) => members.some((r) => r.id === m.id));
      const neighborhood = { rising: addressCount(rising), total: addressCount(nearby) };
      const stats = { medianDelta: median(members.map((m) => m.delta)),
        medianPct: members.some((m) => m.pct != null) ? median(members.filter((m) => m.pct != null).map((m) => m.pct)) : null,
        support: median(members.map((m) => m.support)), simultaneousDays: commonDays };
      const notes = [
        "Möjlig gemensam ljudkälla: läcka på huvudledning eller annan gemensam ledning, pump, spolning eller ändrad drift. Läckans plats och ledningstyp är inte fastställda.",
        allLocated ? "Avstånd avser husens kartpunkter, inte ledningssträckning eller mätarnas exakta placering." : "Grupperad efter gata, ort och närliggande husnummer. Fysisk närhet är inte verifierad utan kartpositioner.",
        repeated ? "Förhöjningen har observerats minst två avläsningsdagar per mätare; det är inte samma sak som bekräftad läcka." : "Preliminär områdessignal: minst en mätare har bara en förhöjd avläsningsdag. Följ nästa avläsning.",
      ];
      if (shortBaseline) notes.push("Kort referens: minst en mätare har bara två tidigare avläsningsdagar. Gruppen kräver då en större ökning, men jämförelsen är fortfarande preliminär.");
      if (subtle) notes.push("Liten men samstämmig ökning: minst sju tidigare avläsningsdagar och tre nya observationer per mätare med liten relativ ökning. Minst två gemensamma förhöjda dagar krävs i gruppen.");
      notes.push("Procenten jämför varje mätares avläsningsvärde med dess egen referens och summeras som median. Den anger inte ljudenergi eller läcksannolikhet.");
      if (broad) notes.push("Många mätare i det importerade urvalet stiger samtidigt. Kontrollera gemensam drift- eller säsongspåverkan innan lokal läcka antas.");
      if (members.some((m) => m.meter.interference.any || m.meter.season?.status !== "none" && m.meter.season?.status)) notes.push("Störmiljö eller säsongsindikation finns i gruppen; jämför med drift och värmesystem.");
      const signal = { id: members.map((m) => m.id).sort().join("|"), ids: members.map((m) => m.id),
        anchorId: anchor.id, anchorAddress: anchor.address, buildingCount: buildings, count: members.length,
        basis: allLocated ? "position" : "address", diameterMeters: diameter == null ? null : Math.round(diameter),
        stage: repeated && !shortBaseline ? "repeated" : "early", shortBaseline, subtle, stats, neighborhood, onsetFrom: new Date(Math.min(...members.map((m) => +m.onset))),
        onsetTo: new Date(Math.max(...members.map((m) => +m.onset))), broad,
        summary: `${members.length} mätare på ${buildings} adresser ökar under samma period. Möjlig gemensam källa.`,
        action: broad ? "Kontrollera först gemensam drift, spolning och säsong i det importerade urvalet. Jämför med områden som inte har stigit innan en lokal fältkontroll planeras."
          : `Läcksök området runt ${anchor.address}. Jämför mätarna och lyssna vid åtkomliga ventiler längs gemensam ledningssträcka. Adressen är en startpunkt för kontroll, inte en utpekad läckplats.`,
        notes, members: members.map(({ meter, position, place, elevatedDays, ...m }) => m) };
      signals.push(signal);
      for (const m of members) assigned.add(m.id);
    }
    return signals.sort((a, b) => Number(b.stage === "repeated") - Number(a.stage === "repeated") || b.buildingCount - a.buildingCount || a.id.localeCompare(b.id));
  }
  return { RULES, build };
}));

