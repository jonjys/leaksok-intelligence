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
    const text = (meter.info || "") + " " + (meter.closedEvents || "");
    return {
      leak: CODE.LEAK.test(text),
      burst: CODE.BURST.test(text),
      dry: CODE.DRY.test(text),
      reverse: CODE.REVERSE.test(text),
      tamper: CODE.TAMPER.test(text),
      noise: CODE.NOISE.test(text),
      unset: CODE.UNSET.test(text),
      eventLeak: CODE.EVENT_LEAK.test(text),
      raw: text.trim(),
    };
  }

  function uniq(list) {
    return [...new Set(list.filter(Boolean))];
  }

  function applyCodes(meter) {
    const codes = codesOf(meter);
    meter.kamstrup = codes;
    const reasons = Array.isArray(meter.reasons) ? meter.reasons.slice() : [];
    if (codes.burst) {
      reasons.unshift("flowIQ BURST: rörbrott efter mätaren (30 min högt flöde)");
      return Object.assign({}, meter, {
        category: "customer_side",
        infrastructure: Object.assign({}, meter.infrastructure || {}, { customerSide: true }),
        risk: Math.max(meter.risk || 0, 72),
        confidence: "hög",
        reasons: uniq(reasons).slice(0, 8),
      });
    }
    if (codes.leak || codes.eventLeak) {
      reasons.unshift("flowIQ LEAK: läckage efter mätaren (inget stillastående flöde 24 h)");
      return Object.assign({}, meter, {
        category: "customer_side",
        infrastructure: Object.assign({}, meter.infrastructure || {}, { customerSide: true }),
        risk: Math.max(meter.risk || 0, 40),
        reasons: uniq(reasons).slice(0, 8),
      });
    }
    if (codes.dry) {
      reasons.unshift("flowIQ DRY: mätaren är inte vattenfylld, ingen mätning");
      return Object.assign({}, meter, {
        category: "stale_contact",
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
        category: ["normal", "learning"].includes(meter.category) ? "suspect" : meter.category,
        reasons: uniq(reasons).slice(0, 8),
      });
    }
    return meter;
  }

  function wrapAnalyze() {
    if (typeof analyze !== "function" || analyze.__codesWrapped) return;
    const previous = analyze;
    analyze = function analyzeWithCodes() {
      previous();
      if (!state || !Array.isArray(state.meters)) return;
      state.meters = state.meters.map(applyCodes);
      if (typeof render === "function") render();
    };
    analyze.__codesWrapped = true;
  }

  wrapAnalyze();
  if (typeof state !== "undefined" && Array.isArray(state.meters) && state.meters.length) {
    state.meters = state.meters.map(applyCodes);
  }
  root.KamstrupCodes = { codesOf, applyCodes };
}(typeof globalThis !== "undefined" ? globalThis : this));
