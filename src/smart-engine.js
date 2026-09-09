(function exposeSmartLeakEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakSmartEngine = api;

  if (typeof window !== "undefined" && typeof scoreMeter === "function") {
    const previousScoreMeter = scoreMeter;
    scoreMeter = function scoreMeterSmart(meter, networkContext) {
      const result = previousScoreMeter(meter, networkContext);
      const storedLabel = typeof state !== "undefined" ? state.labels[meter.id] : result.label;
      const label = storedLabel?.type ? storedLabel : null;
      return api.rankMeter(result, meter, label);
    };

    const previousSortValue = typeof sortValue === "function" ? sortValue : null;
    sortValue = function sortValueSmart(row, sort) {
      if (sort === "persistence") return row.engine?.persistenceDays || 0;
      if (sort === "robustRise") return row.engine?.relativeRise || 0;
      if (sort === "risk") return row.enginePriority || row.risk || 0;
      return previousSortValue ? previousSortValue(row, sort) : row.risk || 0;
    };
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function buildSmartLeakEngine() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const CATEGORY_WEIGHT = {
    dispatch: 9000,
    confirmed: 8500,
    customer_side: 7000,
    suspect_auto: 6000,
    watch: 5900,
    learning: 3000,
    normal: 2000,
    seasonal: 1200,
    noise: 1100,
    repaired: 500,
    ignored: 0,
  };

  function analyzeSeries(points, context = {}) {
    const exports = (Array.isArray(points) ? points : [])
      .map((point) => ({
        date: validDate(point.date || point.readAt),
        readAt: validDate(point.readAt || point.date),
        current: point.current == null || point.current === "" ? NaN : Number(point.current),
      }))
      .filter((point) => point.date && Number.isFinite(point.current) && point.current >= 0)
      .sort((a, b) => a.date - b.date);
    const days = new Map();
    for (const point of exports) {
      const date = point.readAt && point.readAt <= point.date ? point.readAt : point.date;
      const key = date.toISOString().slice(0, 10);
      const previous = days.get(key);
      if (!previous || point.current < previous.current || (point.current === previous.current && point.date > previous.exportDate)) {
        days.set(key, { ...point, date, exportDate: point.date });
      }
    }
    const ordered = [...days.values()].sort((a, b) => a.date - b.date);

    if (!ordered.length) return emptyAnalysis();
    const values = ordered.map((point) => point.current);
    const desiredRecentCount = Math.max(2, Math.ceil(values.length * 0.3));
    const recentCount = values.length > 1
      ? Math.min(5, values.length - 1, desiredRecentCount)
      : 1;
    const split = Math.max(1, values.length - recentCount);
    const baselineValues = values.slice(0, split);
    const recentValues = values.slice(-recentCount);
    const baseline = median(baselineValues.length ? baselineValues : values);
    const recentLevel = median(recentValues);
    const latest = values[values.length - 1];
    const threshold = Math.max(8, baseline + 4, baseline * 1.55);
    const relativeRise = baseline > 0 ? (recentLevel / baseline) - 1 : 0;
    const latestRise = baseline > 0 ? (latest / baseline) - 1 : 0;
    const recentElevated = recentValues.filter((value) => value >= threshold).length;
    const recentShare = recentElevated / recentValues.length;

    let trailingElevated = 0;
    for (let index = values.length - 1; index >= 0; index--) {
      if (values[index] < threshold) break;
      trailingElevated += 1;
    }
    const elevatedStart = trailingElevated ? ordered[ordered.length - trailingElevated].date : ordered[ordered.length - 1].date;
    const persistenceDays = trailingElevated > 1
      ? calendarDaysBetween(elevatedStart, ordered[ordered.length - 1].date)
      : 0;
    const sustained = trailingElevated >= 3 && persistenceDays >= 7 && recentShare >= 0.6;

    const peak = Math.max(...values);
    const peakIndex = values.indexOf(peak);
    const neighbors = values.filter((_, index) => Math.abs(index - peakIndex) > 1);
    const neighborLevel = median(neighbors.length ? neighbors : values);
    const isolatedPeak = values.length >= 4
      && peak >= Math.max(30, threshold * 2)
      && peak >= Math.max(1, neighborLevel) * 2.4
      && values.filter((value) => value >= peak * 0.7).length <= 1;
    const droppedAfterPeak = peakIndex < values.length - 1 && latest <= Math.max(threshold, peak * 0.45);
    const transientSpike = isolatedPeak && (droppedAfterPeak || trailingElevated <= 1);
    const volatility = coefficientOfVariation(recentValues);
    const normalizedSlope = normalizedLinearSlope(values.slice(-Math.min(8, values.length)), Math.max(1, baseline));
    const recentFloor = percentile(recentValues, 0.25);
    const fallingNow = values.length >= 3
      && (latest < recentLevel * 0.68 || normalizedSlope < -0.12);
    const stableElevated = sustained
      && recentFloor >= threshold
      && volatility <= 0.5
      && !fallingNow;
    const staleReadDays = Math.max(context.staleReadDays || 0,
      calendarDaysBetween(ordered.at(-1).date, exports.at(-1).date));
    const staleContact = staleReadDays >= 14;
    const heatPump = detectHeatPumpSeasonality(ordered);

    return {
      points: ordered.length,
      baseline,
      recentLevel,
      latest,
      threshold,
      relativeRise,
      latestRise,
      recentShare,
      trailingElevated,
      persistenceDays,
      sustained,
      peak,
      transientSpike,
      volatility,
      normalizedSlope,
      recentFloor,
      fallingNow,
      stableElevated,
      staleReadDays,
      staleContact,
      heatPump,
    };
  }

  function rankMeter(result, meter, label) {
    const resetDate = label?.type === "reset_baseline"
      ? validDate(label.resetAfter || label.at || label.notedDate) : null;
    const points = resetDate ? meter.points.filter(p => validDate(p.readAt || p.date) > resetDate) : meter.points;
    const info = String(meter.info ?? result.info ?? "");
    const customerSide = Boolean(result.infrastructure?.customerSide);
    const burst = /burst|rorbrott|rörbrott/i.test(info);
    const leakCode = /leak|lacka|läcka/i.test(info);
    const dryCode = /dry|torr/i.test(info);
    const profile = resetDate ? { coverage: result.profile?.coverage } : (result.profile || {});
    const engine = analyzeSeries(points, { staleReadDays: result.staleReadDays });
    const reference = Number(result.last?.average);
    const referenceRise = !resetDate && reference > 0 ? engine.recentLevel / reference - 1 : 0;
    const referenceSignal = engine.points >= 2 && engine.latest >= reference * 2
      && referenceRise >= 1 && engine.recentLevel >= 15 && !engine.transientSpike && !engine.staleContact;
    const evidence = [];
    let score = 8;

    if (engine.recentLevel >= 100) { score += 28; evidence.push("mycket hög robust nivå"); }
    else if (engine.recentLevel >= 60) { score += 22; evidence.push("hög robust nivå"); }
    else if (engine.recentLevel >= 30) { score += 14; evidence.push("förhöjd robust nivå"); }
    else if (engine.recentLevel >= 15) { score += 7; }

    if (engine.relativeRise >= 2) { score += 25; evidence.push("kraftig robust ökning"); }
    else if (engine.relativeRise >= 1) { score += 19; evidence.push("tydlig robust ökning"); }
    else if (engine.relativeRise >= 0.5) { score += 11; evidence.push("robust ökning"); }

    if (engine.stableElevated) {
      score += 28;
      evidence.push(`stabilt bestående ${engine.persistenceDays} dagar`);
    } else if (engine.trailingElevated >= 2) {
      score += 8;
      evidence.push(`${engine.trailingElevated} förhöjda avläsningar`);
    }
    if (profile.newLevel) { score += 18; evidence.push("ny stabil nivå"); }
    if (profile.slowRise && engine.normalizedSlope > 0.04) { score += 10; evidence.push("långsam stigande trend"); }
    if (!resetDate && result.lowRelativeRise?.persistent) { score += 10; evidence.push("ihållande procentökning"); }
    if (!resetDate && result.networkContext?.sharedSignal) { score += 8; evidence.push("samma rörelse på närliggande mätare"); }
    if (burst && !customerSide) { score += 28; evidence.push("BURST/rörbrott i Excel"); }
    else if (leakCode && !customerSide) { score += 14; evidence.push("LEAK i Excel"); }
    if (referenceSignal) { score += 12; evidence.push("Upprepat hög nivå mot Excel-snitt F; historik behövs för bekräftelse"); }

    if (engine.transientSpike) { score -= 42; evidence.push("enstaka topp nedvägd"); }
    if (engine.fallingNow && !burst) { score -= 28; evidence.push("senaste nivån faller tydligt"); }
    if (engine.volatility > 0.5 && !engine.stableElevated && !burst) { score -= 18; evidence.push("ojämn signal kräver kontroll"); }
    if (engine.heatPump.is) { score -= 38; evidence.push(engine.heatPump.reason); }
    if (profile.repeatedPattern) { score -= 32; evidence.push("återkommande säsongsmönster"); }
    if (profile.fluctuating && !engine.sustained) { score -= 16; evidence.push("fladdrig signal"); }
    if (dryCode && !leakCode) { score -= 20; evidence.push("DRY/torr driftstatus"); }
    if (engine.staleContact) { score -= 55; evidence.push(`gammal avläsning ${engine.staleReadDays} dagar`); }
    score = clamp(Math.round(score), 0, 100);

    const hardEvidence = [
      engine.stableElevated,
      engine.relativeRise >= 0.5,
      engine.recentLevel >= 30,
      Boolean(profile.newLevel),
      Boolean(profile.slowRise && engine.normalizedSlope > 0.04),
      Boolean(result.networkContext?.sharedSignal),
      Boolean(burst || leakCode),
    ].filter(Boolean).length;
    const newMeter = engine.points <= 1 || (profile.coverage?.days || 0) <= 1;
    let category = classifyAutomatic({
      score,
      hardEvidence,
      newMeter,
      customerSide,
      burst,
      leakCode,
      dryCode,
      engine,
      profile,
      referenceSignal,
    });

    if (resetDate && engine.points >= 3) {
      evidence.push("Bedömt enbart på nya avläsningar efter nollställning");
    }
    const manual = applyManualLabel(category, score,
      resetDate && engine.points >= 3 ? null : label);
    category = manual.category;
    score = manual.score;
    if (!label && category === "suspect_auto") score = Math.max(score, 44);
    const confidence = engine.staleContact || engine.points < 3
      ? "låg"
      : score >= 85 && hardEvidence >= 3 && engine.stableElevated ? "hög"
        : hardEvidence >= 2 ? "medel" : "låg";
    const reasons = compactReasons(result.reasons, engine, evidence, label);
    const enginePriority = (CATEGORY_WEIGHT[category] || 0)
      + score * 10
      + Math.min(engine.persistenceDays, 180)
      + Math.min(engine.trailingElevated, 20) * 3;

    return {
      ...result,
      risk: score,
      category,
      confidence: label ? result.confidence || confidence : confidence,
      reasons,
      staleReadDays: engine.staleReadDays,
      staleContact: engine.staleContact,
      engine: { ...engine, hardEvidence, evidence },
      enginePriority,
    };
  }

  function classifyAutomatic(context) {
    const { score, hardEvidence, newMeter, customerSide, burst, leakCode, dryCode, engine, profile } = context;
    if (customerSide || (leakCode && /customer|kund/i.test(String(profile.environment || "")))) return "customer_side";
    if (engine.staleContact) return "normal";
    if (engine.heatPump.is && !burst && !leakCode) return "seasonal";
    if (engine.transientSpike) return "noise";
    if (profile.repeatedPattern && !engine.sustained) return "seasonal";
    if (dryCode && !leakCode) return "normal";
    if (engine.points < 2) return engine.latest >= 100 || burst ? "suspect_auto" : (newMeter ? "learning" : "normal");
    const verifiedPattern = engine.stableElevated
      && engine.persistenceDays >= 14
      && engine.trailingElevated >= 3
      && engine.recentFloor >= 30;
    const networkBackedPattern = engine.stableElevated
      && engine.persistenceDays >= 7
      && Boolean(context.profile?.newLevel || context.referenceSignal)
      && hardEvidence >= 3;
    if (score >= 82 && hardEvidence >= 3 && (verifiedPattern || networkBackedPattern || burst)) return "dispatch";
    if (score >= 44 && hardEvidence >= 2 && (engine.trailingElevated >= 2 || profile.newLevel || profile.slowRise)) return "suspect_auto";
    if (engine.trailingElevated >= 2 && engine.persistenceDays >= 1 && engine.relativeRise >= 1 && engine.recentLevel >= 8) return "suspect_auto";
    if (context.referenceSignal) return "suspect_auto";
    if (engine.recentLevel >= 60 || (leakCode && engine.recentLevel >= 30)) return "suspect_auto";
    if (newMeter) return "learning";
    return "normal";
  }

  function applyManualLabel(category, score, label) {
    if (!label?.type) return { category, score };
    if (label.type === "leak") return { category: "confirmed", score: Math.max(score, 86) };
    if (label.type === "repaired") return { category: "repaired", score: Math.min(score, 18) };
    if (label.type === "manual_dispatch") return { category: "dispatch", score: Math.max(score, 94) };
    if (label.type === "suspect") return { category: "suspect_auto", score: Math.max(score, 48) };
    if (label.type === "interesting") return { category: "watch", score: Math.max(score, 45) };
    if (label.type === "customer_contact") return { category: "customer_side", score: Math.max(Math.min(score, 62), 40) };
    if (label.type === "seasonal") return { category: "seasonal", score: Math.min(score, 22) };
    if (["known_noise", "district_heating", "large_building", "pump", "false_alarm"].includes(label.type)) {
      return { category: "noise", score: Math.min(score, 22) };
    }
    if (label.type === "reset_baseline") return { category: "normal", score: Math.min(score, 15) };
    if (label.type === "ignored") return { category: "ignored", score: 0 };
    return { category, score };
  }

  function compactReasons(existing, engine, evidence, label) {
    const reasons = [];
    if (label?.type) reasons.push(`Manuellt facit: ${label.type}`);
    if (engine.heatPump.is) reasons.push(engine.heatPump.reason);
    if (engine.transientSpike) reasons.push("Enstaka topp: påverkar inte akutlistan");
    else if (engine.sustained) reasons.push(`Bestående nivå i ${engine.persistenceDays} dagar (${engine.trailingElevated} avläsningar)`);
    if (engine.baseline > 0 && Math.abs(engine.relativeRise) >= 0.25) {
      reasons.push(`Robust nivå ${round(engine.baseline)} → ${round(engine.recentLevel)} (${signedPercent(engine.relativeRise)})`);
    }
    if (engine.staleContact) reasons.push(`Kontakt saknas/gammal avläsning: ${engine.staleReadDays} dagar`);
    evidence.forEach((reason) => reasons.push(capitalize(reason)));
    (existing || []).forEach((reason) => reasons.push(reason));
    return [...new Set(reasons)].slice(0, 8);
  }

  function emptyAnalysis() {
    return {
      points: 0, baseline: 0, recentLevel: 0, latest: 0, threshold: 0, relativeRise: 0,
      latestRise: 0, recentShare: 0, trailingElevated: 0, persistenceDays: 0,
      sustained: false, peak: 0, transientSpike: false, volatility: 0,
      normalizedSlope: 0, recentFloor: 0, fallingNow: false, stableElevated: false,
      staleReadDays: 0, staleContact: false,
      heatPump: { is: false, reason: "" },
    };
  }

  function detectHeatPumpSeasonality(points) {
    if (!Array.isArray(points) || points.length < 4) return { is: false, reason: "" };
    const usable = points.filter((point) => point.date instanceof Date && Number.isFinite(point.current));
    if (usable.length < 4 || usable.some((point) => point.current >= 40)) return { is: false, reason: "" };

    const coldMonths = new Set([9, 10, 11, 0, 1, 2, 3]);
    const warmMonths = new Set([4, 5, 6, 7, 8]);
    const cold = usable.filter((point) => coldMonths.has(point.date.getMonth())).map((point) => point.current);
    const warm = usable.filter((point) => warmMonths.has(point.date.getMonth())).map((point) => point.current);
    if (cold.length >= 2 && warm.length >= 2) {
      const coldLevel = median(cold);
      const warmLevel = median(warm);
      if (coldLevel > 12 && warmLevel < 28 && coldLevel >= warmLevel * 1.45 && coldLevel - warmLevel >= 5) {
        return {
          is: true,
          reason: `Värmepanna/säsong: vinter ${round(coldLevel)} mot sommar ${round(warmLevel)}`,
        };
      }
    }

    const first = usable[0];
    const last = usable[usable.length - 1];
    const spanDays = calendarDaysBetween(first.date, last.date);
    const values = usable.map((point) => point.current);
    const gentleRise = values.every((value, index) => index === 0 || value <= values[index - 1] * 1.8 + 5);
    if (spanDays >= 120
      && warmMonths.has(first.date.getMonth())
      && coldMonths.has(last.date.getMonth())
      && gentleRise
      && last.current > 15
      && last.current >= first.current * 1.3) {
      return { is: true, reason: `Värmepanna/säsong: gradvis ${round(first.current)} → ${round(last.current)}` };
    }
    return { is: false, reason: "" };
  }

  function validDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function readAgeDays(point) {
    if (!point?.date || !point?.readAt) return 0;
    return calendarDaysBetween(point.readAt, point.date);
  }

  function calendarDaysBetween(from, to) {
    const fromDay = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const toDay = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.max(0, Math.round((toDay - fromDay) / DAY_MS));
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * ratio;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function coefficientOfVariation(values) {
    const mean = average(values);
    if (!mean) return 0;
    const variance = average(values.map((value) => (value - mean) ** 2));
    return Math.sqrt(variance) / mean;
  }

  function normalizedLinearSlope(values, scale) {
    if (values.length < 2) return 0;
    const meanX = (values.length - 1) / 2;
    const meanY = average(values);
    const numerator = values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0);
    const denominator = values.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0);
    return denominator ? (numerator / denominator) / scale : 0;
  }

  function signedPercent(value) {
    const percent = Math.round(value * 100);
    return `${percent > 0 ? "+" : ""}${percent}%`;
  }

  function round(value) {
    return Math.round(Number(value) || 0);
  }

  function capitalize(value) {
    return value ? value[0].toUpperCase() + value.slice(1) : value;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return { analyzeSeries, rankMeter, detectHeatPumpSeasonality };
}));
