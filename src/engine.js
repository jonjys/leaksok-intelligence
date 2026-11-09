/* LeakSök analysis engine. One place computes every number, category and
   explanation shown in the list, charts and Excel export.

   Values are Kamstrup Leak Detector export values (daily lowest filtered noise
   value). Kamstrup documents no unit; percentages are ratios of export values,
   never a change in physical sound intensity. Priority 0–100 is a ranking, not a
   calibrated leak probability. Rule-based and local: no external services. */
(function (root, factory) {
  const api = factory(root.LeakHistory || (typeof require === "function" ? require("./history.js") : null),
    root.LeakAreaSignals || (typeof require === "function" ? require("./area-signals.js") : null),
    root.LeakCaseLearning || (typeof require === "function" ? require("./case-learning.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakEngine = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (History, AreaSignals, CaseLearning) {
  const DAY = 86400000;
  const RULES = Object.freeze({
    absMin: 2,            // smallest change in export units that can count
    relMin: 0.25,         // smallest relative change for a level shift (two or more readings)
    signalAbs: 3,         // a single new reading must exceed max(signalAbs, 3σ, signalRel × level)
    signalRel: 0.5,       // calibrated on real exports: ~p98–p99 of normal reading-to-reading rises
    priorSigmaRel: 0.08,  // normal variation used until a meter has 8 comparable reading pairs
    minOwnPairs: 8,
    longTermDays: 30,     // below this own history, Kamstrup's average F gives longer context
    sigmaK: 3,            // times the meter's normal day-to-day variation
    sigmaFloor: 2 / 3,
    levelWindow: 21,      // readings used for a segment's current level
    referenceWindow: 30,  // readings used for the level before a change
    oldDays: 2,           // latest reading this many days before latest export: not fresh
    staleDays: 14,        // no reading for this long: "Utan färsk avläsning"
    gapDays: 3,           // longer than this without readings is a data gap
    transientDays: 14,
    trendWindowDays: 60,
    trendMinReadings: 8,
    trendMinSpanDays: 14,
    highLevel: 50,
    stableMinCoverage: 0.6, // own evidence rule, not a manufacturer threshold
    newRiseDays: 1,
  });

  const CATEGORY = {
    dispatch: { label: "Åk ut", status: "ÅK UT", rank: 90 },
    confirmed: { label: "Aktiv läcka", status: "AKTIV LÄCKA", rank: 85 },
    suspect_auto: { label: "Misstänk", status: "MISSTÄNK", rank: 70 },
    watch: { label: "Bevaka", status: "BEVAKA", rank: 69 },
    customer_side: { label: "Efter mätare", status: "EFTER MÄTARE", rank: 60 },
    stable_high: { label: "Stabilt hög", status: "STABILT HÖG", rank: 40 },
    sparse_history: { label: "Glest underlag", status: "GLEST UNDERLAG", rank: 45 },
    learning: { label: "Kort historik", status: "KORT HISTORIK", rank: 30 },
    stale_contact: { label: "Utan färsk avläsning", status: "EJ FÄRSK", rank: 25 },
    normal: { label: "Normal", status: "NORMAL", rank: 20 },
    noise: { label: "Störning / tillfällig", status: "STÖRNING", rank: 15 },
    seasonal: { label: "Säsong", status: "SÄSONG", rank: 12 },
    repaired: { label: "Lagad", status: "LAGAD", rank: 10 },
    ignored: { label: "Ignorerad", status: "IGNORERAD", rank: 0 },
  };

  const LABELS = {
    leak: "Konstaterad läcka",
    repaired: "Lagad",
    manual_dispatch: "Åk ut",
    interesting: "Bevaka",
    suspect: "Bevaka",
    watch: "Bevaka",
    customer_contact: "Efter mätare / kontakta FÄ",
    new_install: "Nyuppsatt, avvakta",
    seasonal: "Säsong / känd värmepanna",
    known_noise: "Störning / falsklarm",
    district_heating: "Fjärrvärme",
    large_building: "Höghus / stor byggnad",
    pump: "Undercentral / pump",
    false_alarm: "Störning / falsklarm",
    reset_baseline: "Nollställd",
    ignored: "Ignorera",
  };
  const DAMPENING_LABELS = ["seasonal", "known_noise", "district_heating", "large_building", "pump", "false_alarm"];

  // ---- small helpers -------------------------------------------------------
  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function mad(values) {
    const m = median(values);
    return m == null ? null : median(values.map((v) => Math.abs(v - m)));
  }
  const days = (from, to) => History.calendarDays(from, to);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function ratio(now, ref) { return ref > 0 && Number.isFinite(now) ? now / ref - 1 : null; }
  function round1(v) { return Number.isFinite(v) ? Math.round(v * 10) / 10 : null; }

  const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  function fmtDate(date, withYear = false) {
    if (!date) return "–";
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return "–";
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;
  }
  function fmtNum(v) {
    if (!Number.isFinite(v)) return "–";
    const r = Math.round(v * 10) / 10;
    return String(r).replace(".", ",").replace("-", "−");
  }
  function fmtSigned(v) { return Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmtNum(Math.abs(v))}` : "–"; }
  function fmtPct(r) {
    if (!Number.isFinite(r)) return "–";
    const p = Math.round(r * 100);
    return `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p)} %`;
  }
  function fmtPeriod(from, to, yearCtx) {
    if (!from) return "–";
    const withYear = yearCtx && (from.getFullYear() !== yearCtx || (to && to.getFullYear() !== yearCtx));
    if (!to || History.dayKey(from) === History.dayKey(to)) return fmtDate(from, withYear);
    return `${fmtDate(from, withYear)}–${fmtDate(to, withYear)}`;
  }

  // ---- normal variation ------------------------------------------------------
  // Robust day-to-day variation from successive differences: level shifts and
  // single spikes do not inflate it, a genuinely noisy meter gets a wider band.
  function noiseSigma(series) {
    const diffs = [];
    const recent = series.slice(-90);
    for (let i = 1; i < recent.length; i++) {
      if (days(recent[i - 1].date, recent[i].date) <= RULES.gapDays) diffs.push(Math.abs(recent[i].value - recent[i - 1].value));
    }
    // Too few pairs: one level change dominates the estimate. Use a level-based
    // prior measured on real exports (median day-to-day change ≈ 8 % of level).
    if (diffs.length < RULES.minOwnPairs) {
      const level = median(recent.map((p) => p.value)) || 0;
      return Math.max(RULES.sigmaFloor, RULES.priorSigmaRel * level);
    }
    return Math.max(RULES.sigmaFloor, (1.4826 * median(diffs)) / Math.SQRT2);
  }
  function ownVariation(series) {
    let pairs = 0;
    const recent = series.slice(-90);
    for (let i = 1; i < recent.length; i++) if (days(recent[i - 1].date, recent[i].date) <= RULES.gapDays) pairs++;
    return pairs >= RULES.minOwnPairs;
  }
  // Threshold for calling one reading a new signal (stricter than a level shift).
  function signalTolerance(level, sigma) {
    return Math.max(RULES.signalAbs, RULES.sigmaK * sigma, RULES.signalRel * Math.max(0, level));
  }

  function tolerance(level, sigma) {
    return Math.max(RULES.absMin, RULES.sigmaK * sigma, RULES.relMin * Math.max(0, level));
  }

  // ---- segmentation ----------------------------------------------------------
  // Level and spread of a segment's latest readings, cached until it changes.
  function sortedInsert(sorted, value) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
    sorted.splice(lo, 0, value);
  }
  function sortedRemove(sorted, value) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
    sorted.splice(lo, 1);
  }
  function sortedMedian(sorted) {
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  // Median absolute deviation of a sorted array without sorting again.
  function sortedMad(sorted, center) {
    let i = sorted.length - 1, j = 0;
    let lo = 0;
    while (lo < sorted.length && sorted[lo] < center) lo++;
    i = lo - 1; j = lo;
    const out = [];
    while (out.length < sorted.length) {
      const left = i >= 0 ? center - sorted[i] : Infinity;
      const right = j < sorted.length ? sorted[j] - center : Infinity;
      if (left <= right) { out.push(left); i--; } else { out.push(right); j++; }
    }
    return sortedMedian(out);
  }
  // Level and spread of a segment's latest readings, maintained incrementally
  // while points are appended; rebuilt when the point list is replaced.
  function segStats(seg) {
    const len = seg.points.length;
    if (seg._first !== seg.points[0] || seg._len == null || len < seg._len) {
      const recent = seg.points.slice(-RULES.levelWindow).map((p) => p.value);
      seg._sorted = [...recent].sort((a, b) => a - b);
      seg._len = len;
      seg._first = seg.points[0];
    } else {
      for (let k = seg._len; k < len; k++) {
        sortedInsert(seg._sorted, seg.points[k].value);
        if (k >= RULES.levelWindow) sortedRemove(seg._sorted, seg.points[k - RULES.levelWindow].value);
      }
      seg._len = len;
    }
    if (seg._levelLen !== len) {
      seg._level = sortedMedian(seg._sorted);
      seg._spread = len >= 4 ? 1.4826 * sortedMad(seg._sorted, seg._level) : null;
      seg._levelLen = len;
    }
    return seg;
  }
  function segLevel(seg) { return segStats(seg)._level; }
  function segSigma(seg, globalSigma) {
    return seg.points.length < 4 ? globalSigma : Math.max(globalSigma, segStats(seg)._spread);
  }

  function inBand(seg, value, sigma) {
    const level = segLevel(seg);
    return Math.abs(value - level) <= tolerance(level, segSigma(seg, sigma));
  }

  /* Walks the reading days in order. A reading outside the current level's band
     opens a candidate; two readings on the same side open a new segment. A new
     segment stays provisional until it has RULES.establish readings: a return to
     the previous level turns it into an observed transient instead. */
  function segment(series, sigma) {
    const ESTABLISH = 4;
    const segments = [], transients = [];
    let cur = null, cand = null, provisionalPrev = null;
    for (const p of series) {
      if (!cur) { cur = { points: [p] }; continue; }
      if (inBand(cur, p.value, sigma)) {
        if (cand) transients.push({ points: cand.points, dir: cand.dir, base: segLevel(cur), returnedAt: p });
        cand = null;
        cur.points.push(p);
        if (provisionalPrev && cur.points.length >= ESTABLISH) provisionalPrev = null;
        continue;
      }
      if (provisionalPrev && inBand(provisionalPrev, p.value, sigma)) {
        transients.push({ points: [...cur.points, ...(cand?.points || [])], dir: cur.dir, base: segLevel(provisionalPrev), returnedAt: p });
        segments.pop();
        cur = provisionalPrev;
        cur.points.push(p);
        provisionalPrev = null;
        cand = null;
        continue;
      }
      // While provisional, further readings beyond the old level in the same
      // direction belong to the same elevated episode, whatever their spread.
      if (provisionalPrev && Math.sign(p.value - segLevel(provisionalPrev)) === cur.dir) {
        cur.points.push(p);
        if (cur.points.length >= ESTABLISH) provisionalPrev = null;
        continue;
      }
      const dir = Math.sign(p.value - segLevel(cur));
      if (cand && cand.dir === dir) {
        cand.points.push(p);
        if (cand.points.length >= 2) {
          segments.push(cur);
          provisionalPrev = cur;
          cur = { points: cand.points, dir };
          cand = null;
        }
        continue;
      }
      if (cand) transients.push({ points: cand.points, dir: cand.dir, base: segLevel(cur), returnedAt: null });
      cand = { points: [p], dir };
    }
    // A lone first reading is only kept as reference when the change is clear.
    while (segments.length && segments[0].points.length < 2 && !validShift(segments[0], segments[1] || cur, sigma)) {
      const first = segments.shift();
      (segments[0] || cur).points.unshift(...first.points);
    }
    // Short intermediate segments are transitions, not reference levels.
    for (let i = segments.length - 1; i > 0; i--) {
      if (segments[i].points.length < 3) transients.push({ points: segments.splice(i, 1)[0].points, dir: 0, returnedAt: null });
    }
    return { segments, cur, cand, transients, provisional: Boolean(provisionalPrev) };
  }

  // A reported shift must exceed the reference band with most new readings.
  function validShift(ref, cur, sigma) {
    const refLevel = segLevel(ref);
    const curLevel = segLevel(cur);
    const tol = tolerance(refLevel, segSigma(ref, sigma));
    if (Math.abs(curLevel - refLevel) <= tol) return false;
    const up = curLevel > refLevel;
    const beyond = cur.points.filter((p) => (up ? p.value > refLevel + tol : p.value < refLevel - tol)).length;
    return beyond / cur.points.length >= 0.75;
  }

  function describeSeg(seg, window = RULES.referenceWindow) {
    const pts = seg.points.slice(-window);
    return {
      level: median(pts.map((p) => p.value)),
      from: pts[0].date,
      to: pts[pts.length - 1].date,
      n: pts.length,
      totalN: seg.points.length,
      min: Math.min(...pts.map((p) => p.value)),
      max: Math.max(...pts.map((p) => p.value)),
    };
  }

  function persistenceOf(points) {
    const first = points[0].date, last = points[points.length - 1].date;
    let maxGap = 0;
    for (let i = 1; i < points.length; i++) maxGap = Math.max(maxGap, days(points[i - 1].date, points[i].date));
    const span = days(first, last);
    return { n: points.length, days: span, maxGap, coverage: points.length / (span + 1), from: first, to: last };
  }
  function coveredEnough(coverage) {
    return Boolean(coverage && coverage.coverage >= RULES.stableMinCoverage && coverage.maxGap <= RULES.gapDays);
  }

  // ---- trend (Theil–Sen slope, Kendall-style consistency) -------------------
  function trendOf(series) {
    if (!series.length) return null;
    const lastDate = series[series.length - 1].date;
    const win = series.filter((p) => days(p.date, lastDate) <= RULES.trendWindowDays);
    if (win.length < RULES.trendMinReadings) return null;
    const span = days(win[0].date, lastDate);
    if (span < RULES.trendMinSpanDays) return null;
    const t = win.map((p) => p.date.getTime() / DAY);
    const slopes = [];
    let concordant = 0, discordant = 0, pairs = 0;
    for (let i = 0; i < win.length; i++) {
      for (let j = i + 1; j < win.length; j++) {
        const dt = t[j] - t[i];
        if (dt <= 0) continue;
        const dv = win[j].value - win[i].value;
        slopes.push(dv / dt);
        pairs++;
        if (dv > 0) concordant++; else if (dv < 0) discordant++;
      }
    }
    if (!pairs) return null;
    const slope = median(slopes);
    const intercept = median(win.map((p, i) => p.value - slope * t[i]));
    const start = intercept + slope * t[0];
    const end = intercept + slope * t[t.length - 1];
    return { slope, start, end, tau: (concordant - discordant) / pairs, n: win.length, span, from: win[0].date, to: lastDate };
  }

  // ---- season ----------------------------------------------------------------
  const COLD = [10, 11, 0, 1, 2];
  const WARM = [4, 5, 6, 7];
  function seasonProfile(series, latest) {
    const months = new Map();
    for (const p of series) {
      const key = p.date.getFullYear() * 12 + p.date.getMonth();
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(p.value);
    }
    const monthly = [...months].sort((a, b) => a[0] - b[0]).map(([key, values]) => ({ key, month: key % 12, level: median(values), n: values.length }));
    const phases = monthly.filter((m) => COLD.includes(m.month) || WARM.includes(m.month))
      .map((m) => ({ ...m, phase: WARM.includes(m.month) ? "warm" : "cold" }));
    const runs = [];
    for (const m of phases) {
      const last = runs[runs.length - 1];
      if (!last || last.phase !== m.phase || m.key - last.end > 4) runs.push({ phase: m.phase, start: m.key, end: m.key, levels: [m.level] });
      else { last.end = m.key; last.levels.push(m.level); }
    }
    const contrast = (cold, warm) => cold >= warm * 1.5 && cold - warm >= 5;
    let verified = null, possible = null;
    for (let i = 1; i < runs.length; i++) {
      const a = runs[i - 1], b = runs[i];
      if (a.phase === b.phase || a.levels.length < 2 || b.levels.length < 2) continue;
      const al = median(a.levels), bl = median(b.levels);
      const [cold, warm] = a.phase === "cold" ? [al, bl] : [bl, al];
      if (contrast(cold, warm)) possible = { cold, warm };
      const c = runs[i + 1];
      if (!c || c.phase !== a.phase || c.levels.length < 2) continue;
      const cl = median(c.levels);
      const returns = Math.max(al, cl) <= Math.max(1, Math.min(al, cl)) * 1.6 + 3;
      const [cold2, warm2] = c.phase === "cold" ? [cl, bl] : [bl, cl];
      if (returns && contrast(cold, warm) && contrast(cold2, warm2)) {
        verified = { cold: median([cold, cold2]), warm: median([warm, warm2]) };
      }
    }
    let sameTimeLastYear = null;
    if (latest) {
      const target = new Date(latest.date.getTime() - 365 * DAY);
      const around = series.filter((p) => Math.abs(p.date - target) <= 15 * DAY);
      if (around.length >= 3) sameTimeLastYear = { level: median(around.map((p) => p.value)), n: around.length, from: around[0].date, to: around[around.length - 1].date };
    }
    const status = verified ? "verified" : possible ? "possible" : "none";
    const month = latest ? latest.date.getMonth() : null;
    const phaseNow = month == null ? null : COLD.includes(month) ? "cold" : WARM.includes(month) ? "warm" : "transition";
    const ref = verified || possible;
    const expected = sameTimeLastYear?.level ?? (ref ? (phaseNow === "warm" ? ref.warm : ref.cold) : null);
    return { status, cold: ref?.cold ?? null, warm: ref?.warm ?? null, phaseNow, sameTimeLastYear, expected, months: monthly.length };
  }

  // ---- info codes and events ------------------------------------------------
  function codesOf(row) {
    const info = String(row?.infoCode || "");
    const events = String(row?.activeEvents || "");
    const text = `${info} ${events}`;
    return {
      infoCode: info,
      activeEvents: events,
      leak: /\bLEAK\b/i.test(info),
      burst: /\bBURST\b/i.test(info),
      dry: /\bDRY\b/i.test(info),
      reverse: /\bREVERSE\b/i.test(info),
      tamper: /\bTAMPER\b/i.test(info),
      noConsumption: /no\s*consumption|ingen\s*förbrukning/i.test(info),
      afterMeterText: /läcka\s+efter|kundsida|kundens\s+sida|efter\s+mätar(e|en)|customer\s+side|after\s+(the\s+)?meter/i.test(text),
      acousticLeak: /läckage|\bleak(age)?\b/i.test(events),
      acousticOther: /annat\s*brus|other\s*noise/i.test(events),
      acousticUndetermined: /ej\s*fastställ|undetermined/i.test(events),
      closedEvents: String(row?.closedEvents || "").trim(),
      follow: row?.follow === true,
    };
  }

  // Local knowledge of known interference; never used to hide a clear new change.
  function interferenceOf(address, area) {
    const text = `${address || ""} ${area || ""}`.toUpperCase();
    const districtHeating = ["ADLER SALVIUS VÄG", "BLOCKVÄGEN"].some((name) => text.includes(name));
    const largeSubstation = text.includes("NORSBORG") && ["BALDERS VÄG", "LOKES VÄG", "ODENS VÄG", "TORS VÄG", "THORS VÄG"].some((name) => text.includes(name));
    return { districtHeating, largeSubstation, any: districtHeating || largeSubstation };
  }

  // ---- place keys for neighbour comparisons -----------------------------------
  function placeOf(address, area) {
    const cleaned = String(address || "").toUpperCase().replace(/\b\d{3}\s?\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
    const match = cleaned.match(/^(.+?)\s+(\d+)(\s*[A-Z](?![A-ZÅÄÖ]))?(\s*-\s*\d+)?/);
    if (!match) return null;
    const street = match[1].trim();
    const locality = String(area || "").toUpperCase() || cleaned.slice(match[0].length).trim();
    return {
      street,
      building: `${street} ${match[2]}${match[4] ? match[4].replace(/\s+/g, "") : ""}|${locality}`,
      streetKey: `${street}|${locality}`,
      number: Number(match[2]),
    };
  }

  function parseLabelDate(label, ...keys) {
    for (const key of keys) {
      const raw = label?.[key];
      if (!raw) continue;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59`) : new Date(raw);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }

  // ---- main analysis ---------------------------------------------------------
  /* history: from LeakHistory.summarize; ctx: { latestExport, exportDays (sorted
     day keys), label } */
  function analyzeMeter(history, ctx = {}) {
    const label = ctx.label?.type ? ctx.label : null;
    const latestExport = ctx.latestExport || history.lastExport;
    const yearCtx = latestExport ? latestExport.getFullYear() : null;
    const P = (from, to) => fmtPeriod(from, to, yearCtx);
    const D = (date) => fmtDate(date, date && yearCtx && date.getFullYear() !== yearCtx);
    const obs = [], explain = [], quality = [], missing = [];

    const latestRow = history.latestRow;
    const excel = {
      E: latestRow?.current ?? null,
      F: latestRow?.average ?? null,
      G: latestRow?.max ?? null,
      minimumFlow: latestRow?.minimumFlow ?? null,
      minimumFlowAt: latestRow?.minimumFlowAt || null,
      interestRank: latestRow?.interestRank ?? null,
      exportDate: latestRow?.exportDate || null,
      readAt: latestRow?.readAt || null,
    };
    excel.P = excel.E != null && excel.F > 0 ? excel.E / excel.F - 1 : null;
    const codes = codesOf(latestRow);
    const interference = ctx.interference ? { districtHeating: ctx.interference.districtHeating === true,
      largeSubstation: ctx.interference.largeSubstation === true,
      any: ctx.interference.districtHeating === true || ctx.interference.largeSubstation === true } : interferenceOf(history.address, history.area);

    // Nollställ: only readings strictly after the reset moment are assessed.
    let series = history.series;
    let reset = null;
    if (label?.type === "reset_baseline") {
      const at = parseLabelDate(label, "resetAfter", "at", "notedDate");
      if (at) {
        series = series.filter((p) => p.date > at);
        reset = { at, readingsAfter: series.length };
      }
    }

    const n = series.length;
    const latest = series[n - 1] || null;
    const previous = series[n - 2] || null;
    const ageDays = latest && latestExport ? Math.max(0, days(latest.date, latestExport)) : null;
    // Only a dated, current minimum-flow observation supports customer-side
    // routing. Missing flow/date is unknown, never zero or inferred from Q3.
    const flowAge = excel.minimumFlowAt && latestExport ? days(excel.minimumFlowAt, latestExport) : null;
    codes.minimumFlowContinuous = Boolean(!codes.dry && excel.E != null && excel.readAt && days(excel.readAt, latestExport) >= 0 && days(excel.readAt, latestExport) <= 1
      && excel.minimumFlow > 0 && flowAge != null && flowAge >= 0 && flowAge <= 1
      && excel.exportDate && days(excel.exportDate, latestExport) <= 1 && latest && ageDays <= 1);
    const missedExports = ctx.exportDays && history.lastExport
      ? ctx.exportDays.filter((key) => key > History.dayKey(history.lastExport)).length : 0;

    const result = {
      id: history.id, serial: history.serial, address: history.address, area: history.area,
      label, reset, excel, codes, interference,
      latest: latest ? { value: latest.value, date: latest.date, ageDays, reexports: Math.max(0, latest.exports - 1) } : null,
      previous: previous ? { value: previous.value, date: previous.date } : null,
      changePrev: null,
      finding: { type: n ? "stable" : "none", direction: null },
      baseline: null,
      history: {
        readings: history.series.length,
        assessedReadings: n,
        firstDate: history.series[0]?.date || null,
        lastDate: history.series[history.series.length - 1]?.date || null,
        spanDays: history.series.length ? days(history.series[0].date, history.series[history.series.length - 1].date) : 0,
        exportRows: history.rowCount,
        reexports: history.reexports,
        missingValues: history.missingValues,
        undated: history.undated,
        conflicts: history.conflicts,
        missedExports,
        gaps: [],
        sigma: null,
      },
      season: null, neighbors: null,
      series,
      priority: 0, priorityParts: [],
    };

    if (previous) {
      result.changePrev = {
        from: previous.value, to: latest.value, delta: latest.value - previous.value,
        pct: ratio(latest.value, previous.value), fromDate: previous.date, toDate: latest.date,
        gapDays: days(previous.date, latest.date),
      };
    }

    // Data gaps in the assessed period (last 120 days are shown).
    for (let i = 1; i < n; i++) {
      const gap = days(series[i - 1].date, series[i].date);
      if (gap > RULES.gapDays && days(series[i].date, latest.date) <= 120) result.history.gaps.push({ from: series[i - 1].date, to: series[i].date, days: gap });
    }

    // ---------- findings from the series ----------
    let upFinding = null;
    if (n >= 1) {
      const sigma = noiseSigma(series);
      result.history.sigma = sigma;
      const seg = segment(series, sigma);
      // Drop a final shift that does not clear the band once levels are settled.
      while (seg.segments.length && !validShift(seg.segments[seg.segments.length - 1], seg.cur, sigma)) {
        const prev = seg.segments.pop();
        seg.cur = { points: [...prev.points, ...seg.cur.points], dir: prev.dir };
      }
      const cur = describeSeg(seg.cur, RULES.levelWindow);
      const trend = trendOf(series);
      result.season = seasonProfile(history.series, latest);
      // A peak counts only when it would have been a signal on its own.
      const clearPeak = (t) => Math.max(...t.points.map((p) => p.value)) - t.base > signalTolerance(t.base, sigma);
      const recentTransients = seg.transients.filter((t) => t.returnedAt && t.dir > 0 && days(t.points[0].date, latest.date) <= RULES.transientDays && clearPeak(t));
      // Recurring short peaks that return are this meter's normal pattern (pump-like).
      const patternPeaks = seg.transients.filter((t) => t.returnedAt && t.dir > 0 && days(t.points[0].date, latest.date) <= 30 && clearPeak(t));
      result.intermittent = patternPeaks.length >= 2 ? {
        count: patternPeaks.length,
        peak: Math.max(...patternPeaks.flatMap((t) => t.points.map((p) => p.value))),
        longest: Math.max(...patternPeaks.map((t) => t.points.length)),
      } : null;
      const upShiftsInTrendWindow = seg.segments.length
        ? [...seg.segments, seg.cur].filter((s, i, all) => i > 0 && segLevel(s) > segLevel(all[i - 1]) && days(s.points[0].date, latest.date) <= RULES.trendWindowDays).length : 0;
      const trendUp = trend && trend.slope > 0 && trend.tau >= 0.5 && trend.start >= 0
        && trend.end - trend.start >= Math.max(2 * RULES.absMin, tolerance(Math.max(trend.start, 0), sigma))
        && (trend.start <= 0 || trend.end / trend.start - 1 >= 0.4);

      if (n === 1) {
        result.finding = { type: "single", direction: null, now: { level: latest.value, from: latest.date, to: latest.date, n: 1 } };
      } else if (seg.cand && Math.abs(latest.value - cur.level) <= signalTolerance(cur.level, sigma)) {
        // Outside the level band but within normal variation for one reading.
        result.finding = { type: "stable", direction: null, ref: cur, now: cur, minorChange: latest.value - cur.level };
      } else if (seg.cand) {
        const prevSeg = seg.segments.length ? describeSeg(seg.segments[seg.segments.length - 1]) : null;
        result.finding = {
          type: "new_signal", direction: seg.cand.dir > 0 ? "up" : "down",
          ref: cur, older: prevSeg,
          now: { level: latest.value, from: latest.date, to: latest.date, n: 1 },
        };
      } else if (seg.segments.length) {
        const prevSeg = describeSeg(seg.segments[seg.segments.length - 1]);
        const nowSeg = describeSeg(seg.cur, RULES.levelWindow);
        result.finding = {
          type: "level_shift", direction: nowSeg.level > prevSeg.level ? "up" : "down",
          ref: prevSeg, now: nowSeg,
          onset: { after: prevSeg.to, at: seg.cur.points[0].date, uncertainDays: days(prevSeg.to, seg.cur.points[0].date) },
          persistence: persistenceOf(seg.cur.points),
        };
      } else if (recentTransients.length) {
        const t = recentTransients[recentTransients.length - 1];
        const peak = t.points.reduce((a, b) => (b.value > a.value ? b : a));
        result.finding = { type: "transient", direction: "up", ref: cur, peak, returnedAt: t.returnedAt, count: recentTransients.length };
      } else {
        result.finding = { type: "stable", direction: null, ref: cur, now: cur };
      }
      // A steady climb reads as a staircase of small shifts; call it a trend.
      const f = result.finding;
      if (trendUp && (!(f.type === "level_shift" && f.direction === "up") || upShiftsInTrendWindow >= 2) && f.type !== "new_signal") {
        result.finding = {
          type: "trend", direction: "up",
          ref: { level: Math.max(0, trend.start), from: trend.from, to: trend.from, n: trend.n },
          now: { level: trend.end, from: trend.to, to: trend.to, n: trend.n },
          slopePerDay: trend.slope, tau: trend.tau, span: trend.span,
          persistence: { n: trend.n, days: trend.span, maxGap: 0, coverage: trend.n / (trend.span + 1) },
        };
      }
      if (seg.transients.length && result.finding.type !== "transient") {
        result.finding.transients = recentTransients.length;
      }

      const fnd = result.finding;
      if (fnd.ref && fnd.now) {
        fnd.delta = fnd.now.level - fnd.ref.level;
        fnd.pct = ratio(fnd.now.level, fnd.ref.level);
      }
      if ((fnd.type === "new_signal" || fnd.type === "level_shift") && fnd.direction === "up" && result.intermittent) {
        const run = fnd.type === "new_signal" ? 1 : fnd.persistence.n;
        fnd.withinPattern = run < 5 && run <= result.intermittent.longest + 1 && fnd.now.level <= result.intermittent.peak * 1.25;
      }
      if ((fnd.type === "new_signal" || fnd.type === "level_shift" || fnd.type === "trend") && fnd.direction === "up" && !fnd.withinPattern) upFinding = fnd;
      // Short own history: Kamstrup's average F reflects a longer period.
      // Only when F reflects a period the app has not seen: before the change the own history never reached F.
      if (upFinding && result.history.spanDays < RULES.longTermDays && excel.F > 0 && upFinding.now.level <= excel.F * 1.1
        && Math.max(...series.filter((p) => p.date < upFinding.now.from).map((p) => p.value)) < excel.F) {
        fnd.belowLongTerm = true;
        upFinding = null;
      }
      result.variationSource = ownVariation(series) ? "egen" : "schablon";
      result.baseline = fnd.ref ? { ...fnd.ref, definition: baselineDefinition(fnd) } : null;
      result.level = { current: cur.level, from: cur.from, to: cur.to, n: cur.n };
    }

    const referenceCoverage = result.finding.ref ? History.coverage(series, result.finding.ref.from, result.finding.ref.to) : null;
    const levelCoverage = result.level ? History.coverage(series, result.level.from, result.level.to) : null;
    result.sampling = { all: History.coverage(series), reference: referenceCoverage, level: levelCoverage, referenceReliable: coveredEnough(referenceCoverage) };
    const sparseStable = result.finding.type === "stable" && !coveredEnough(referenceCoverage);
    if (sparseStable) { result.finding.delta = null; result.finding.pct = null; }

    // ---------- text: observation / explanation / action ----------
    const f = result.finding;
    const lv = (v) => fmtNum(v);
    const refSpan = (r) => (r.n === 1 ? `${D(r.from)}, 1 avläsning – osäker referens` : `median ${P(r.from, r.to)}, ${r.n} avläsningar`);
    const pctText = (x) => (x.pct != null ? fmtPct(x.pct) : x.ref && x.ref.level === 0 ? "ingen procent, från 0" : "–");
    let summary = "";
    if (!latest && reset) {
      summary = `Nollställd ${fmtDate(reset.at)} – inväntar nya avläsningar`;
    } else if (!latest) {
      summary = history.missingValues ? "Saknar giltiga värden i importerade exporter" : "Inga daterade avläsningar";
      obs.push(history.missingValues ? `Mätaren finns i ${history.rowCount} exportrader men Senaste värde saknas. Saknat värde räknas inte som noll.` : "Inga avläsningar med giltigt datum.");
    } else if (f.type === "single") {
      summary = `En avläsning (${D(latest.date)}): ${lv(latest.value)} – ingen egen historik att jämföra med`;
      obs.push(`Endast en avläsningsdag i appens historik (${D(latest.date)}), värde ${lv(latest.value)}.`);
    } else if (f.type === "new_signal") {
      const ref = f.ref;
      const word = f.direction === "up" ? "steg" : "sjönk";
      summary = `${f.direction === "up" ? "Ny signal" : "Lägre värde"} ${D(latest.date)}: ${lv(ref.level)} → ${lv(latest.value)} (${pctText(f)})`;
      obs.push(`Senaste avläsningen (${D(latest.date)}) ${word} till ${lv(latest.value)} från nivån ${lv(ref.level)} (${refSpan(ref)}): ${fmtSigned(f.delta)} (${pctText(f)}).`);
      if (f.older && f.direction === "up" && f.older.level > latest.value) {
        obs.push(`Nivån är fortfarande lägre än den äldre nivån ${lv(f.older.level)} (${P(f.older.from, f.older.to)}).`);
      } else if (f.older && f.direction === "up") {
        obs.push(`Äldre nivå ${lv(f.older.level)} (${P(f.older.from, f.older.to)}).`);
      }
      obs.push("Endast en avläsning på den nya nivån – ännu oklart om den består.");
    } else if (f.type === "level_shift") {
      const per = f.persistence;
      const word = f.direction === "up" ? "Ny högre nivå" : "Lägre nivå";
      summary = `${word} sedan ${D(f.onset.at)}: ${lv(f.ref.level)} → ${lv(f.now.level)} (${pctText(f)}), ${per.n} avläsningar på ${per.days + 1} dagar`;
      obs.push(`Nivån före förändringen: ${lv(f.ref.level)} (${refSpan(f.ref)}).`);
      obs.push(`Nivån sedan ${D(f.onset.at)}: ${lv(f.now.level)} (median av ${Math.min(per.n, RULES.levelWindow)} senaste), ${fmtSigned(f.delta)} (${pctText(f)}). Observerad i ${per.n} avläsningar under ${per.days + 1} dagar.`);
      if (f.onset.uncertainDays > RULES.gapDays) obs.push(`Förändringen skedde någon gång mellan ${D(f.onset.after)} och ${D(f.onset.at)} – inga avläsningar däremellan.`);
      if (per.maxGap > RULES.gapDays) quality.push(`Lucka på ${per.maxGap} dagar inom den nya nivån – beständigheten under luckan är okänd.`);
      if (f.direction === "down") obs.push("Automatiken markerar aldrig en mätare som lagad för att värdet sjunker.");
    } else if (f.type === "trend") {
      summary = `Gradvis ökning: ${lv(f.ref.level)} → ${lv(f.now.level)} på ${f.span} dagar (${fmtSigned(f.slopePerDay)} per dag)`;
      obs.push(`Robust trend (Theil–Sen) ${P(f.ref.from, f.now.to)}: från ca ${lv(f.ref.level)} till ca ${lv(f.now.level)} (${pctText(f)}), ${f.persistence.n} avläsningar, ${Math.round(f.tau * 100)} % av jämförda par stiger.`);
    } else if (f.type === "transient") {
      summary = `Tillfällig topp ${lv(f.peak.value)} (${D(f.peak.date)}), tillbaka på ${lv(f.returnedAt.value)} (${D(f.returnedAt.date)})`;
      obs.push(`Toppen ${lv(f.peak.value)} den ${D(f.peak.date)} följdes av ${lv(f.returnedAt.value)} den ${D(f.returnedAt.date)} – återgång observerad. Normalnivå ${lv(f.ref.level)} (${P(f.ref.from, f.ref.to)}).`);
      if (f.count > 1) obs.push(`${f.count} kortvariga toppar senaste ${RULES.transientDays} dagarna.`);
    } else {
      const high = f.ref.level >= RULES.highLevel;
      if (sparseStable) {
        summary = `${high ? "Hög nivå" : "Glest underlag"}: median ${lv(f.ref.level)} från ${f.ref.n} avläsningsdagar – utvecklingen mellan punkterna är okänd`;
        obs.push(`De importerade avläsningarna har median ${lv(f.ref.level)} (${P(f.ref.from, f.ref.to)}, ${f.ref.n} avläsningsdagar). Underlaget räcker inte för att bedöma om nivån varit stabil eller ändrats mellan punkterna.`);
      } else {
        summary = high
          ? `Hög och jämn i avläsningarna ${P(f.ref.from, f.ref.to)}: ca ${lv(f.ref.level)}`
          : `Ingen tydlig förändring i avläsningarna: ca ${lv(f.ref.level)}`;
        obs.push(`Nivå ${lv(f.ref.level)} (${refSpan(f.ref)}). Ingen tydlig förändring i de importerade avläsningarna.`);
      }
    }
    if (f.minorChange) obs.push(`Senaste avläsningen ${lv(latest.value)} (${fmtSigned(f.minorChange)}) ligger inom normal variation för en enstaka avläsning.`);
    if (f.belowLongTerm) {
      obs.push(`Ökningen ${lv(f.ref.level)} → ${lv(f.now.level)} når inte över Kamstrups genomsnitt F ${lv(excel.F)}. Appens egen historik är bara ${result.history.spanDays + 1} dagar, så nivån är inte förhöjd jämfört med mätarens längre period.`);
      summary = `${summary} – inte över Kamstrups snitt F ${lv(excel.F)}`;
    }
    if (f.type === "new_signal" && result.changePrev?.gapDays > RULES.gapDays) {
      obs.push(`Föregående avläsning var ${result.changePrev.gapDays} dagar tidigare (${D(result.changePrev.fromDate)}); avläsningar däremellan finns inte i de importerade exporterna.`);
    }
    if (f.withinPattern) {
      obs.push(`I nivå med mätarens återkommande kortvariga toppar (${result.intermittent.count} st senaste 30 dagarna, högst ${lv(result.intermittent.peak)}).`);
      explain.push("Återkommande toppar som går tillbaka är typiskt för pump eller periodisk förbrukning – följ om mönstret ändras.");
    }
    if (result.intermittent && upFinding) obs.push(`Mätaren har haft ${result.intermittent.count} kortvariga toppar med återgång senaste 30 dagarna (högst ${lv(result.intermittent.peak)}); förändringen är längre än dessa.`);
    if (f.transients && f.type !== "transient") obs.push(`${f.transients} kortvarig${f.transients > 1 ? "a toppar" : " topp"} med återgång senaste ${RULES.transientDays} dagarna.`);

    // Short own history: a level clearly above Kamstrup's longer average F is a
    // signal of its own (a change that may have started before the first import).
    const shortHistory = n < 3 || result.history.spanDays < RULES.longTermDays;
    const recentForF = series.slice(-7).map((p) => p.value);
    const levelForF = median(recentForF);
    const excelSignal = Boolean(!upFinding && shortHistory && latest && excel.F > 0 && levelForF >= Math.max(2 * excel.F, excel.F + 5) && latest.value >= excel.F * 2);
    if (excelSignal) {
      obs.push(`Median av ${recentForF.length} senaste avläsningar ${lv(levelForF)} är ${fmtPct(levelForF / excel.F - 1)} över Kamstrups genomsnitt F ${lv(excel.F)} (P för senaste raden ${fmtPct(excel.P)}). Appens egen historik (${result.history.spanDays + 1} dagar) räcker inte för att se när nivån ändrades.`);
      summary = `Över Kamstrups snitt: nivå ${lv(levelForF)} mot F ${lv(excel.F)} (${fmtPct(levelForF / excel.F - 1)}) – kort egen historik`;
    }
    // Freshness and export coverage.
    const stale = latest && ageDays >= RULES.staleDays;
    const lowerFirst = (text) => text ? text[0].toLowerCase() + text.slice(1) : text;
    if (codes.burst) summary = `Infokod BURST (högt flöde efter mätaren) · ${lowerFirst(summary)}`;
    else if (codes.leak) summary = `Infokod LEAK (flöde utan uppehåll efter mätaren) · ${lowerFirst(summary)}`;
    else if (codes.minimumFlowContinuous) summary = `Positivt minimiflöde ${fmtNum(excel.minimumFlow)} l/h (möjlig påverkan efter mätaren) · ${lowerFirst(summary)}`;
    if (codes.dry) summary = `Infokod DRY (mätaren ej vattenfylld) · ${lowerFirst(summary)}`;
    if (codes.acousticLeak && !upFinding && !codes.leak && !codes.burst) summary = `Leak Detector-händelse ${codes.activeEvents} · ${lowerFirst(summary)}`;
    if (latest && stale) summary = `Ingen ny avläsning sedan ${D(latest.date)} (${ageDays} dagar). Senast: ${lowerFirst(summary)}`;
    else if (latest && ageDays >= RULES.oldDays) summary = `Avläst ${D(latest.date)}, ${ageDays} dagar sedan: ${lowerFirst(summary)}`;
    if (latest && ageDays >= RULES.oldDays) {
      const msg = `Senaste avläsning ${D(latest.date)} är ${ageDays} dagar gammal (senaste export ${D(latestExport)}).`;
      (stale ? obs : quality).unshift(msg);
      if (latest.exports > 1) quality.push(`Samma avläsning har exporterats ${latest.exports} gånger – räknas som en avläsning.`);
    }
    if (missedExports > 0) quality.push(`Mätaren saknas i ${missedExports} senare export${missedExports > 1 ? "er" : ""}. Det bevisar inte förlorad kontakt.`);
    if (history.missingValues && latestRow?.current == null) quality.push("Senaste exporten saknar Senaste värde för mätaren.");
    if (history.conflicts) quality.push(`${history.conflicts} avläsningar exporterades med olika värden; senaste exporten används.`);
    if (excel.minimumFlow == null) missing.push("Minimiflöde saknas i exporten. Brus ensamt avgör inte om läckan är före eller efter mätaren.");
    else {
      obs.push(`Minimiflöde ${fmtNum(excel.minimumFlow)} l/h${excel.minimumFlowAt ? ` (${D(excel.minimumFlowAt)})` : " – datum saknas"}. ${codes.minimumFlowContinuous ? "Färskt positivt minimiflöde tyder på kontinuerligt flöde efter mätaren; kontrollera fastigheten." : excel.minimumFlow === 0 ? "Nollflöde utesluter inte en läcka före mätaren." : "Datum och aktualitet behöver verifieras innan flödet styr bedömningen."}`);
    }
    for (const gap of result.history.gaps.slice(-2)) quality.push(`Lucka i importunderlaget mellan ${D(gap.from)} och ${D(gap.to)} (${gap.days} dagar mellan avläsningarna). Kamstrup kan ha fler historiska värden.`);
    if (referenceCoverage && !coveredEnough(referenceCoverage)) {
      quality.push(`Glest jämförelseunderlag: ${referenceCoverage.readingDays} av ${referenceCoverage.expectedDays} kalenderdagar har importerade avläsningar. Liknande punkter bevisar inte stabilitet under luckorna.`);
      missing.push("Fler daterade avläsningar från Kamstrup för luckorna; kontrollera även råkurvan där. En ny dagsöversikt återskapar inte saknad historik.");
    }
    if (history.undated) quality.push(`${history.undated} exportrader saknar avläsningsdatum och används inte.`);
    if (result.history.readings && result.history.spanDays < 14 && (n < 3 || upFinding)) quality.push(`Historiken i appen omfattar ${result.history.spanDays + 1} ${result.history.spanDays ? "dagar" : "dag"} sedan första import – inte samma sak som mätarens ålder.`);
    if (excel.E != null && !(excel.F > 0)) quality.push(excel.F === 0 ? "Genomsnittsvärde F är 0 – P beräknas inte." : "Genomsnittsvärde F saknas – P beräknas inte.");
    if (result.baseline && result.baseline.n < 3 && upFinding) quality.push(`Tunt underlag: nivån före ökningen bygger på ${result.baseline.n} avläsning${result.baseline.n > 1 ? "ar" : ""}.`);

    // Info codes (flowIQ) and acoustic events (Leak Detector).
    if (codes.burst) obs.push("Infokod BURST: högt flöde i minst 30 minuter – tyder på rörbrott efter mätaren.");
    if (codes.leak) obs.push("Infokod LEAK: vattnet har inte stått still en sammanhängande timme senaste dygnet – tyder på läcka efter mätaren. Många boende kan ge LEAK utan läcka.");
    if (codes.dry) obs.push("Infokod DRY: mätaren är inte vattenfylld (luft i mätaren). Det är inte ett kommunikationsfel; mätvärden kan vara opålitliga.");
    if (codes.reverse) quality.push("Infokod REVERSE: bakåtflöde genom mätaren.");
    if (codes.tamper) quality.push("Infokod TAMPER: manipulationsförsök registrerat.");
    if (codes.noConsumption) quality.push("Infokod: ingen förbrukning senaste 15 dagarna.");
    if (codes.acousticLeak) obs.push(`Leak Detector-händelse: ${codes.activeEvents}. Anger inte om läckan finns före eller efter mätaren.`);
    else if (codes.acousticOther) obs.push(`Leak Detector-händelse: ${codes.activeEvents}.`);
    else if (codes.acousticUndetermined) obs.push("Leak Detector-händelse: Ej fastställt – Kamstrup har inte klassat bruset.");
    if (codes.closedEvents) obs.push(`Stängd Leak Detector-händelse tidigare: ${codes.closedEvents}.`);
    if (codes.follow) obs.push("Markerad Följ i Kamstrup.");
    if (!result.variationSource || result.variationSource === "schablon") {
      if (upFinding) quality.push(`Mätarens egen variation går inte att skatta ännu (färre än ${RULES.minOwnPairs} jämförbara avläsningspar); schablon ${Math.round(RULES.priorSigmaRel * 100)} % av nivån används.`);
    }
    if (interference.any) explain.push(interference.districtHeating ? "Känd störmiljö (fjärrvärme) på adressen – kräver tydligare förändring." : "Höghus/större undercentral – pumpar kan ge brus.");

    // Season.
    const season = result.season;
    if (season?.status === "verified") explain.push(`Återkommande årsmönster: vinter ca ${lv(season.cold)}, sommar ca ${lv(season.warm)} (minst två säsongsväxlingar).`);
    else if (season?.status === "possible") explain.push(`Möjligt säsongsmönster (vinter ca ${lv(season.cold)}, sommar ca ${lv(season.warm)}) – bara en växling observerad, inte verifierat.`);
    if (season?.sameTimeLastYear) obs.push(`Samma tid i fjol (${P(season.sameTimeLastYear.from, season.sameTimeLastYear.to)}): median ${lv(season.sameTimeLastYear.level)}.`);
    else if (upFinding && result.history.spanDays < 300) missing.push("Samma årstid föregående år saknas i historiken.");

    // Excel P as a hint only when own history is too thin.

    // ---------- priority (ranking) ----------
    const parts = [];
    const add = (name, points) => { if (points) parts.push({ name, points: Math.round(points) }); };
    add("Grund", 10);
    let sizeScore = 0;
    if (upFinding) {
      const rel = upFinding.pct != null ? Math.log2(1 + Math.max(0, upFinding.pct)) / 2 : 0;
      const abs = upFinding.delta / 40;
      sizeScore = 30 * Math.min(1, Math.max(rel, abs, 0));
      if (upFinding.type === "new_signal") sizeScore *= 0.7;
      add("Förändringens storlek", sizeScore);
      if (upFinding.persistence) {
        const per = upFinding.persistence;
        let ev = upFinding.type === "trend" ? per.n / 2 + per.days / 2 : 5 * (per.n - 1) + per.days;
        if (per.coverage < 0.5) ev *= 0.6;
        add("Belägg: avläsningar och varaktighet", Math.min(35, ev));
      }
      if (upFinding.type === "level_shift") {
        const onsetAge = days(upFinding.onset.at, latest.date);
        if (onsetAge > 90) add("Förändringen är äldre än 90 dagar", -10);
        else if (onsetAge > 30) add("Förändringen är äldre än 30 dagar", -5);
      }
      if (result.baseline && result.baseline.n < 3) add("Tunt underlag före förändringen", -8);
      if (result.intermittent) add("Mätaren har återkommande kortvariga toppar", -10);
    } else if (f.type === "transient") {
      add("Tillfällig topp med återgång", 3);
    } else if (excelSignal) {
      add("P mot Kamstrups snitt (kort historik)", 12);
    }
    const levelNow = latest ? (upFinding ? upFinding.now.level : result.level?.current ?? latest.value) : 0;
    add("Absolut nivå", levelNow >= 100 ? 10 : levelNow >= RULES.highLevel ? 6 : levelNow >= 25 ? 3 : 0);
    if (latest) add("Aktualitet", ageDays <= 1 ? 0 : ageDays < 4 ? -5 : ageDays < RULES.staleDays ? -12 : -30);
    if (codes.acousticLeak && (upFinding || levelNow >= 25)) add("Leak Detector-händelse Läckage", 8);
    if (codes.burst) add("Infokod BURST", 10);
    else if (codes.leak) add("Infokod LEAK", 5);
    if (codes.dry) add("Infokod DRY (opålitlig mätning)", -15);
    if (interference.any && sizeScore < 25) add("Känd störmiljö", -8);
    if (season?.status === "verified") add("Verifierat säsongsmönster", -12);
    else if (season?.status === "possible") add("Möjligt säsongsmönster", -5);
    result.priorityParts = parts;
    result.sizeScore = sizeScore;

    // ---------- automatic category ----------
    let category = "normal";
    const fresh = latest && ageDays < RULES.oldDays;
    // Kamstrup has its own ranked leak suggestions, sometimes based on
    // readings that predate the user's exports. Keep this evidence separate
    // from our measured change, priority score and area-signal calculation.
    result.kamstrupInterest = Boolean(excel.interestRank && latest && ageDays <= 1
      && latestRow.readAt && days(latestRow.readAt, latestExport) <= 1 && excel.E != null
      && days(history.lastExport, latestExport) <= 1 && !missedExports && !codes.dry
      && (!reset || (latestRow.readAt > reset.at && history.lastExport > reset.at)));
    // A known heating cycle must not hide a new relative increase above that
    // meter's own expected seasonal level, especially at low absolute values.
    const seasonalBand = season?.expected != null ? tolerance(season.expected, result.history.sigma || RULES.sigmaFloor) : null;
    const withinSeason = upFinding && season?.status === "verified" && season.expected != null && upFinding.now.level <= season.expected + seasonalBand;
    const field = assessField(result, upFinding, { fresh, withinSeason, missedExports, referenceCoverage, levelCoverage, provisional: total(parts) });
    if (!latest && reset) category = "normal";
    else if (!latest || stale) category = "stale_contact";
    else if (codes.leak || codes.burst || codes.afterMeterText || codes.minimumFlowContinuous) category = "customer_side";
    else if (upFinding && withinSeason) category = "seasonal";
    else if (upFinding) category = field.ready ? "dispatch" : "suspect_auto";
    else if (codes.acousticLeak && levelNow >= 25) category = "suspect_auto";
    else if (excelSignal) category = "suspect_auto";
    else if (f.type === "single" && latest.value >= 100 && ageDays <= 1) category = "suspect_auto";
    else if (f.type === "transient" || f.withinPattern) category = "noise";
    else if (season?.status === "verified") category = "seasonal";
    else if (n < 3 || result.history.spanDays < 2) category = "learning";
    else if (sparseStable) category = "sparse_history";
    else if ((result.level?.current ?? 0) >= RULES.highLevel) category = "stable_high";

    if (result.kamstrupInterest && !["dispatch", "customer_side", "stale_contact"].includes(category)) category = "suspect_auto";

    // ---------- manual decisions ----------
    let manualNote = "";
    if (label) {
      const t = label.type;
      const labelDate = parseLabelDate(label, "notedDate", "confirmedDate", "at");
      const upAfter = (date) => upFinding && date && (upFinding.type === "new_signal" ? latest.date > date : (upFinding.onset?.at || upFinding.ref.to) > date);
      if (t === "leak") { category = "confirmed"; manualNote = `Konstaterad läcka${label.confirmedDate ? ` ${label.confirmedDate}${label.confirmedDateUncertain ? " (osäkert datum)" : ""}` : ""} – manuellt beslut.`; }
      else if (t === "repaired") {
        const repairedAt = parseLabelDate(label, "repairedDate", "at");
        const newRise = upFinding && upFinding.type !== "new_signal" && upAfter(repairedAt);
        category = newRise ? "suspect_auto" : "repaired";
        manualNote = newRise ? `Ny ökning efter lagning ${label.repairedDate || ""} – kontrollera.` : `Lagad ${label.repairedDate || ""} – manuellt beslut.`;
      } else if (t === "manual_dispatch") { category = "dispatch"; manualNote = "Åk ut – manuellt vald."; }
      else if (t === "interesting" || t === "suspect" || t === "watch") { category = "watch"; manualNote = "Bevaka – manuellt vald."; }
      else if (t === "customer_contact") { category = "customer_side"; manualNote = "Efter mätare / kontakta FÄ – manuellt beslut."; }
      else if (t === "new_install") { category = upFinding && upFinding.type !== "new_signal" ? category : "learning"; manualNote = "Nyuppsatt – manuellt markerad att avvakta."; }
      else if (t === "ignored") { category = "ignored"; manualNote = "Ignorerad manuellt."; }
      else if (DAMPENING_LABELS.includes(t)) {
        const clearNew = upFinding && upFinding.type !== "new_signal" && upAfter(labelDate) && ((upFinding.pct ?? 0) >= 1 && upFinding.delta >= 10);
        category = clearNew ? "suspect_auto" : (t === "seasonal" ? "seasonal" : "noise");
        manualNote = clearNew
          ? `Ny tydlig avvikelse trots markeringen ${LABELS[t]} (${label.notedDate || D(labelDate)}).`
          : `${LABELS[t]} – manuellt markerad${label.notedDate ? ` ${label.notedDate}` : ""}.`;
      } else if (t === "reset_baseline") {
        manualNote = `Nollställd ${reset ? `${D(reset.at)} kl. ${String(reset.at.getHours()).padStart(2, "0")}:${String(reset.at.getMinutes()).padStart(2, "0")}` : ""} – endast avläsningar efter denna tidpunkt bedöms (${n} hittills).`;
        if (n < 2 && category !== "stale_contact") category = "normal";
      }
    }
    if (manualNote) obs.unshift(manualNote);

    if (excel.interestRank) {
      obs.push(`Kamstrup: mätare av intresse, rang ${excel.interestRank} i exporten ${D(excel.exportDate)}. Detta är ett separat läckförslag, inte en konstaterad läcka.`);
      if (result.kamstrupInterest && category === "suspect_auto" && !upFinding) {
        summary = `Kamstrup läckförslag · rang ${excel.interestRank}. ${summary}`;
        explain.push("Kamstrup kan ha äldre avläsningar än de importerade filerna. Ingen observerad ökning i appens historik utesluter därför inte en tidigare förändring. Förslaget anger inte var läckan sitter.");
      }
    }

    // ---------- explanations and action ----------
    if (upFinding?.type === "new_signal") explain.push("En enstaka högre avläsning kan vara tillfällig förbrukning, pump eller början på en läcka.");
    if (upFinding?.type === "level_shift") explain.push("En ny nivå som håller i sig är enligt Kamstrup ett läckmönster, men kan också vara ny pump, värmesystem eller ändrad förbrukning. Brusmätningen täcker ledningar både före och efter mätaren.");
    if (upFinding?.type === "trend") explain.push("Långsamt stigande brus är enligt Kamstrup typiskt för en växande läcka.");
    if (f.type === "transient") explain.push("Kortvarig topp med observerad återgång – oftast en tillfällig ljudkälla.");
    if (f.type === "level_shift" && f.direction === "down") explain.push("Lägre nivå kan bero på lagning, ändrad förbrukning eller mätförhållanden – bekräfta manuellt.");
    if (category === "stable_high") explain.push("Hög men oförändrad nivå kan vara en äldre läcka, pump eller ljudmiljö. Kamstrup anger att kurvans beteende väger tyngre än absolutnivån.");
    if (sparseStable) explain.push("Datagap i appen säger inte att mätaren saknat avläsningar i Kamstrup. En hög nivå kan bero på läcka eller annan ljudkälla; appen saknar kurvans mellanliggande utveckling.");
    if (codes.leak || codes.burst || codes.minimumFlowContinuous) explain.push("Kamstrup rekommenderar att påverkan efter mätaren utesluts innan läcksökning på ledningsnätet. Kontinuerligt flöde kan också bero på legitim förbrukning.");
    if (upFinding && upFinding.type === "new_signal") missing.push("Fler avläsningar på den nya nivån.");
    if (upFinding && upFinding.persistence && upFinding.persistence.n < 5) missing.push("Minst 5 avläsningar under minst 5 dagar för att räknas som bestående.");
    if (!upFinding && n < 3) missing.push("Minst tre avläsningsdagar för egen jämförelse.");

    result.category = category;
    result.categoryLabel = CATEGORY[category].label;
    result.status = category === "dispatch" && label?.type === "manual_dispatch" ? "ÅK UT · MANUELL" : CATEGORY[category].status;
    result.upFinding = upFinding;
    result.summary = summary;
    result.observations = obs;
    result.explanations = explain;
    result.dataQuality = quality;
    result.missing = missing;
    result.confidence = confidenceOf(result, upFinding);
    result.priority = clamp(Math.round(total(parts)), 0, 100);
    result.field = category === "dispatch"
      ? { state: "ready", blockers: [], reason: label?.type === "manual_dispatch" ? "Ditt beslut att kontrollera på plats." : field.reason }
      : category === "suspect_auto" && field.review
        ? { state: "check", blockers: field.blockers, reason: field.blockers[0]?.text || "Jämför kurvan och aktuell drift.", corroboratable: !label?.type && field.corroboratable }
        : null;
    result.action = actionFor(result);
    result.sortRank = CATEGORY[category].rank * 1000 + result.priority;
    // "Nytt i dag": a rise first seen or first confirmed in the latest export.
    result.isNewToday = Boolean(upFinding && fresh && latest && ageDays <= RULES.newRiseDays
      && (upFinding.type === "new_signal" || (upFinding.type === "level_shift" && upFinding.persistence.n === 2))
      && !["customer_side", "seasonal", "noise", "ignored", "confirmed"].includes(category));
    return result;
  }

  function total(parts) { return parts.reduce((sum, p) => sum + p.points, 0); }

  // Separate readiness for a field check from a score used to sort a list.
  // A sustained change or independent support can justify a visit without 70
  // points; a single jump, stale reading or thin reference cannot.
  function assessField(r, rise, context) {
    const { fresh, withinSeason, missedExports, referenceCoverage, levelCoverage, provisional } = context;
    const per = rise?.persistence;
    const strong = rise && ((rise.pct >= 1 && rise.delta >= 8) || (rise.delta >= 20 && (rise.pct == null || rise.pct >= 0.5)));
    const persistent = per && per.coverage >= RULES.stableMinCoverage
      && (rise.type === "trend" ? per.n >= 10 && per.days >= RULES.trendMinSpanDays : per.n >= 5 && per.days >= 4);
    const supported = per && per.coverage >= 0.75 && per.n >= 7 && per.days >= 6;
    const blockers = [];
    const need = (condition, key, text) => { if (!condition) blockers.push({ key, text }); };
    need(fresh && !missedExports, "fresh", "Kontrollera att mätaren har en aktuell avläsning i den senaste exporten.");
    need(!r.codes.dry, "dry", "Kontrollera DRY-koden och att mätaren är vattenfylld.");
    need(!withinSeason, "season", "Jämför med mätarens normala årstidsnivå.");
    if (!rise) {
      need(false, "signal", r.kamstrupInterest ? "Granska Kamstrups förslag och hela bruskurvan." : "Jämför med hela kurvan och närliggande mätare.");
    } else {
      need(persistent, "repeat", rise.type === "new_signal" ? "Bekräfta ökningen med nästa avläsning." : "Följ nivån tills ökningen är upprepad och varaktig.");
      need((rise.ref?.n || 0) >= 3 && coveredEnough(referenceCoverage) && coveredEnough(levelCoverage), "coverage", "Jämför hela kurvan i Kamstrup; det lokala underlaget är för glest.");
      need(!r.intermittent && (!r.interference.any || (rise.pct ?? 0) >= 2), "drift", "Kontrollera kända pumpar, uppvärmning och spolning.");
      need(strong, "size", "Jämför med grannmätare och följ om ökningen består.");
      need(provisional >= 70 || supported || r.codes.acousticLeak, "support", "Följ fler avläsningar eller sök stöd i en oberoende grannsignal.");
    }
    return {
      ready: blockers.length === 0,
      review: !!(fresh && (rise || r.kamstrupInterest || r.codes.acousticLeak || r.latest?.value >= 100)),
      corroboratable: blockers.length === 1 && blockers[0].key === "support",
      blockers,
      reason: r.codes.acousticLeak ? "Bestående ökning med stöd av Leak Detector-händelse." : "Tydlig bestående ökning jämfört med mätarens egen nivå.",
    };
  }

  function baselineDefinition(f) {
    if (f.type === "new_signal") return "Median av nuvarande nivå före senaste avläsningen";
    if (f.type === "level_shift") return "Median av upp till 30 avläsningar före förändringen";
    if (f.type === "trend") return "Trendlinjens startvärde (Theil–Sen) för de senaste 60 dagarna";
    return "Median av upp till 21 senaste avläsningar";
  }

  function confidenceOf(result, up) {
    const n = result.history.assessedReadings;
    if (!result.latest || n < 3 || result.latest.ageDays >= RULES.staleDays) return "tunt";
    if (result.sampling.reference && !coveredEnough(result.sampling.reference)) return "tunt";
    if (up && result.sampling.level && !coveredEnough(result.sampling.level)) return "tunt";
    if (up) {
      const before = result.baseline?.n || 0;
      const after = up.persistence?.n || 1;
      if (before >= 7 && after >= 5 && (up.persistence?.coverage ?? 0) >= 0.6) return "starkt";
      if (before >= 3 && after >= 2) return "medel";
      return "tunt";
    }
    return n >= 14 ? "starkt" : "medel";
  }

  function actionFor(r) {
    switch (r.category) {
      case "dispatch": return r.label?.type === "manual_dispatch" ? "Åk ut enligt manuellt beslut." : "Kontrollera på plats: lyssna vid mätare och servisventil. Uteslut först läcka efter mätaren.";
      case "confirmed": return "Aktiv läcka: följ upp reparationen och markera Lagad manuellt när den är åtgärdad.";
      case "suspect_auto":
        if (r.kamstrupInterest && !r.upFinding) return "Granska Kamstrups läckförslag och jämför grannmätare; kontrollera på plats vid behov.";
        if (r.upFinding?.type === "new_signal") return "Kontrollera nästa avläsning innan åtgärd.";
        if (r.codes.acousticLeak && !r.upFinding) return "Granska Leak Detector-händelsen och kurvan; kontrollera på plats vid behov.";
        return "Jämför med grannmätare och följ nästa avläsningar; kontrollera på plats om nivån består.";
      case "watch": return "Manuellt bevakad: följ nästa avläsningar.";
      case "customer_side": return "Kontakta fastighetsägaren: kontrollera förbrukning och installation efter mätaren.";
      case "stable_high": return "Jämför med grannmätare och följ nästa avläsningar. En hög nivå behöver förklaras även om de importerade värdena är jämna.";
      case "sparse_history": return "Granska hela kurvan i Kamstrup och kontrollera glappet mot Excel-filerna. Bedömningen är osäker; liknande punktvärden utesluter inte en läcka.";
      case "learning": return "Avvakta fler avläsningar.";
      case "stale_contact": return "Ta reda på varför nya avläsningar saknas innan bedömning.";
      case "noise": return "Ingen åtgärd nu; bevaka om toppar återkommer.";
      case "seasonal": return "Ingen åtgärd om nivån följer säsongsmönstret.";
      case "repaired": return "Följ upp att nivån ligger kvar efter lagningen.";
      case "ignored": return "Ignorerad.";
      default: return "Ingen åtgärd.";
    }
  }

  /* Neighbour pass: similar upward changes with overlapping onset on the same
     building or street. Physical distance only from supplied coordinates. */
  function attachNeighbors(results, coordinates = new Map()) {
    const byBuilding = new Map(), byStreet = new Map(), places = new Map();
    for (const r of results) {
      const place = placeOf(r.address, r.area);
      if (!place) continue;
      places.set(r.id, place);
      for (const [map, key] of [[byBuilding, place.building], [byStreet, place.streetKey]]) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(r);
      }
    }
    const onsetWindow = (r) => {
      const u = r.upFinding;
      // Single readings rise together by chance on busy days; only confirmed levels count.
      if (!u || u.type !== "level_shift") return null;
      return [u.onset.after, u.onset.at];
    };
    for (const r of results) {
      const place = places.get(r.id);
      const siblings = place ? byBuilding.get(place.building).filter((x) => x.id !== r.id) : [];
      const silent = siblings.filter((x) => !x.latest || x.latest.ageDays >= RULES.staleDays);
      const window = onsetWindow(r);
      const similar = [];
      if (window && place) {
        for (const other of byStreet.get(place.streetKey)) {
          if (other.id === r.id) continue;
          const w = onsetWindow(other);
          if (!w) continue;
          if (w[0].getTime() - DAY <= window[1].getTime() && window[0].getTime() - DAY <= w[1].getTime()) {
            const a = coordinates.get(r.id), b = coordinates.get(other.id);
            const distance = a && b ? haversine(a, b) : null;
            similar.push({ id: other.id, address: other.address, relation: places.get(other.id)?.building === place.building ? "samma adress/byggnad" : "samma gata", distance });
          }
        }
      }
      r.neighbors = { buildingCount: siblings.length + 1, silentSiblings: silent.map((x) => x.serial || x.id), similar };
      if (siblings.length) r.dataQuality.push(`${siblings.length + 1} mätare på samma adress${silent.length ? ` (${silent.length} utan färsk avläsning)` : ""}.`);
      if (similar.length) {
        const list = similar.slice(0, 3).map((s) => `${s.address}${s.distance != null ? ` (ca ${Math.round(s.distance)} m)` : ""}`).join(", ");
        r.observations.push(`Liknande ökning under samma period på ${similar.length} mätare på ${similar.some((s) => s.relation === "samma gata") ? "samma gata" : "samma adress"}: ${list}${similar.length > 3 ? " …" : ""}.`);
        r.explanations.push("Samtidig ökning hos närliggande mätare kan tyda på gemensam påverkan (läcka på gemensam ledning, spolning eller ändrad drift). Visar inte läckans plats.");
        r.priorityParts.push({ name: "Liknande ökning hos grannar", points: 5 });
        r.priority = clamp(Math.round(total(r.priorityParts)), 0, 100);
        r.sortRank = CATEGORY[r.category].rank * 1000 + r.priority;
      }
    }
    return results;
  }

  function haversine(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  /* Histories are rebuilt only when imported files change. */
  function prepare(files) {
    const { histories, latestExport } = History.buildHistories(files);
    const exportDays = [...new Set((files || []).map((f) => History.validDate(f.exportDate)).filter(Boolean).map(History.dayKey))].sort();
    return { histories, latestExport, exportDays, version: Symbol("prepared") };
  }

  // Only fields that change the assessment; comments and visibility do not.
  function labelKey(label) {
    if (!label?.type) return "";
    return [label.type, label.notedDate, label.confirmedDate, label.confirmedDateUncertain, label.repairedDate, label.resetAfter, label.at].join("|");
  }

  /* prepared → analysed meters. cache: Map reused between calls, so a manual
     decision only re-analyses that meter. */
  function analyzePrepared(prepared, labels = {}, options = {}) {
    const cache = options.cache;
    if (cache && cache.version !== prepared.version) { cache.clear(); cache.version = prepared.version; }
    const results = [];
    for (const history of prepared.histories.values()) {
      const label = labels[history.id];
      const key = labelKey(label);
      let base = cache?.get(history.id);
      if (!base || base.key !== key) {
        base = { key, result: analyzeMeter(history, { latestExport: prepared.latestExport, exportDays: prepared.exportDays, label }) };
        cache?.set(history.id, base);
      }
      const r = base.result;
      // Neighbour notes are added to copies so cached results stay unchanged.
      results.push({ ...r, observations: [...r.observations], explanations: [...r.explanations], dataQuality: [...r.dataQuality], priorityParts: [...r.priorityParts] });
    }
    attachNeighbors(results, options.coordinates);
    results.sort((a, b) => b.sortRank - a.sortRank || String(a.address).localeCompare(String(b.address), "sv"));
    const areaSignals = AreaSignals.build(results, { coordinates: options.coordinates, labels, placeOf });
    const byId = new Map(results.map((m) => [m.id, m]));
    for (const signal of areaSignals) {
      for (const id of signal.ids) {
        const m = byId.get(id);
        m.areaSignal = signal;
        m.observations.push(signal.summary);
        m.explanations.push(...signal.notes);
        if (m.field?.corroboratable && signal.stage === "repeated" && signal.basis === "position" && signal.buildingCount >= 3) {
          m.category = "dispatch";
          m.categoryLabel = CATEGORY.dispatch.label;
          m.status = CATEGORY.dispatch.status;
          m.field = { state: "ready", blockers: [], reason: "Bestående ökning på flera separata närliggande adresser." };
          m.action = actionFor(m);
          m.sortRank = CATEGORY.dispatch.rank * 1000 + m.priority;
        }
      }
    }
    const learning = CaseLearning.build(results, { coordinates: options.coordinates, labels, placeOf });
    for (const record of learning.cases) {
      for (const profile of record.profiles) {
        const m = byId.get(profile.id);
        (m.leakProfiles ||= []).push({ caseId: record.id, anchorId: record.anchorId, lineType: record.lineType, confirmedDate: record.confirmedDate, repairedDate: record.repairedDate, ...profile });
      }
    }
    for (const match of learning.matches) {
      const m = byId.get(match.id);
      m.learnedLeakMatch ||= match;
      m.observations.push(`Ljudmönstret liknar denna mätares respons vid registrerad ${match.lineType}-läcka ${match.confirmedDate}, lagad ${match.repairedDate}.`);
      m.explanations.push("Lokalt jämförelsemönster från ett fältfall; samma ljudbild bevisar inte en ny läcka eller en gemensam ledning.");
      if (!labels[m.id]?.type && ["suspect_auto", "dispatch"].includes(m.category) && !m.priorityParts.some((p) => p.name === "Likt registrerat läckfall")) {
        m.priorityParts.push({ name: "Likt registrerat läckfall", points: Math.min(6, 100 - m.priority) });
        m.priority = Math.min(100, m.priority + 6);
        m.sortRank = CATEGORY[m.category].rank * 1000 + m.priority;
      }
    }
    results.sort((a, b) => b.sortRank - a.sortRank || String(a.address).localeCompare(String(b.address), "sv"));
    return { leakCases: learning.cases, meters: results, areaSignals, latestExport: prepared.latestExport, exportDays: prepared.exportDays };
  }

  /* files → analysed meters. labels: { id: label }. */
  function analyzeAll(files, labels = {}, options = {}) {
    return analyzePrepared(prepare(files), labels, options);
  }

  /* Morning overview, from the same analysis objects. */
  function morning(meters, labels = {}, latestExport = null) {
    const report = { latestExport, fresh: 0, total: 0, newToday: [], confirmedToday: 0, dispatch: 0, suspect: 0, stale: 0, returned: 0 };
    for (const m of meters) {
      if (labels[m.id]?.hidden || m.category === "ignored") continue;
      report.total++;
      if (m.latest && m.latest.ageDays <= 1) report.fresh++;
      if (m.category === "dispatch") report.dispatch++;
      if (m.category === "suspect_auto") report.suspect++;
      if (m.category === "stale_contact") report.stale++;
      if (m.isNewToday) report.newToday.push(m);
      if (m.finding.type === "transient" && m.latest?.ageDays <= 1 && m.finding.returnedAt.date.getTime() === m.latest.date.getTime()) report.returned++;
    }
    report.newToday.sort((a, b) => b.priority - a.priority);
    return report;
  }

  return { RULES, CATEGORY, LABELS, analyzeMeter, analyzeAll, prepare, analyzePrepared, labelKey, attachNeighbors, morning, segment, noiseSigma, trendOf, seasonProfile, codesOf, placeOf, interferenceOf, fmtDate, fmtNum, fmtPct, fmtSigned, fmtPeriod, median };
}));


