(function kamstrupCodes(root) {
  const CODE = {
    LEAK: /\bLEAK\b/i,
    BURST: /\bBURST\b/i,
    DRY: /\bDRY\b/i,
    REVERSE: /\bREVERSE\b/i,
    TAMPER: /\bTAMPER\b/i,
    NOISE: /annat\s*brus/i,
    UNSET: /ej\s*fastställt/i,
    EVENT_LEAK: /\bläckage\b/i,
  };

  function codesOf(meter) {
    const text = meter.infoCode ?? meter.info ?? "";
    const events = meter.activeEvents ?? "";
    return {
      leak: CODE.LEAK.test(text),
      burst: CODE.BURST.test(text),
      dry: CODE.DRY.test(text),
      reverse: CODE.REVERSE.test(text),
      tamper: CODE.TAMPER.test(text),
      noise: CODE.NOISE.test(events || text),
      unset: CODE.UNSET.test(text),
      eventLeak: CODE.EVENT_LEAK.test(events),
      raw: text.trim(),
    };
  }

  function uniq(list) {
    return [...new Set(list.filter(Boolean))];
  }

  function applyCodes(meter) {
    const codes = codesOf(meter);
    meter.kamstrup = codes;
    // A saved field assessment wins over automatic info-code sorting.
    if (typeof state !== "undefined" && state.labels?.[meter.id]?.type) return meter;
    const reasons = Array.isArray(meter.reasons) ? meter.reasons.slice() : [];
    if (codes.burst) {
      reasons.unshift("flowIQ BURST: hög sammanhängande förbrukning – kontrollera installation efter mätaren");
      return Object.assign({}, meter, {
        category: "customer_side",
        infrastructure: Object.assign({}, meter.infrastructure || {}, { customerSide: true }),
        risk: Math.max(meter.risk || 0, 72),
        confidence: "låg",
        reasons: uniq(reasons).slice(0, 8),
      });
    }
    if (codes.leak) {
      reasons.unshift("flowIQ LEAK: kontinuerligt flöde – kontrollera möjlig läcka efter mätaren");
      return Object.assign({}, meter, {
        category: "customer_side",
        infrastructure: Object.assign({}, meter.infrastructure || {}, { customerSide: true }),
        risk: Math.max(meter.risk || 0, 40),
        reasons: uniq(reasons).slice(0, 8),
      });
    }
    if (codes.dry) {
      reasons.unshift("flowIQ DRY: mätaren är inte vattenfylld");
      return Object.assign({}, meter, {
        category: "normal",
        dryMeter: true,
        risk: Math.min(meter.risk || 0, 8),
        confidence: "hög",
        reasons: uniq(reasons).slice(0, 8),
      });
    }
    if (codes.noise) {
      reasons.unshift("Leak Detector: Annat brus");
      return Object.assign({}, meter, {
        category: meter.category === "dispatch" ? "noise" : meter.category,
        reasons: uniq(reasons).slice(0, 8),
      });
    }
    if (codes.tamper || codes.reverse) {
      reasons.unshift(codes.tamper ? "flowIQ TAMPER" : "flowIQ REVERSE");
      return Object.assign({}, meter, {
        category: ["normal", "learning"].includes(meter.category) ? "suspect_auto" : meter.category,
        reasons: uniq(reasons).slice(0, 8),
      });
    }
    return meter;
  }

  (root.LeakAnalysisSteps ||= []).push(() => {
    state.meters = state.meters.map(applyCodes);
  });
  root.KamstrupCodes = { codesOf, applyCodes };
}(typeof globalThis !== "undefined" ? globalThis : this));
