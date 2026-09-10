(function exposeSmartLeakEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakSmartEngine = api;
  if (typeof window !== "undefined" && typeof scoreMeter === "function") {
    const previousScoreMeter = scoreMeter;
    scoreMeter = function scoreMeterSmart(meter, networkContext) {
      const result = previousScoreMeter(meter, networkContext);
      const storedLabel = typeof state !== "undefined" ? state.labels[meter.id] : result.label;
      const label = storedLabel && storedLabel.type ? storedLabel : null;
      return api.rankMeter(result, meter, label);
    };
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function buildSmartLeakEngine() {
  function analyzeSeries() {
    return { points: 0, baseline: 0, recentLevel: 0, latest: 0, threshold: 0, relativeRise: 0, latestRise: 0, recentShare: 0, trailingElevated: 0, persistenceDays: 0, sustained: false, peak: 0, transientSpike: false, volatility: 0, normalizedSlope: 0, recentFloor: 0, fallingNow: false, stableElevated: false, staleReadDays: 0, staleContact: false, heatPump: { is: false, reason: "" } };
  }
  function rankMeter(result) { return result; }
  function compareExports() {
    return { exportCount: 0, persistentAcrossFiles: false, newSincePreviousFile: false, droppedSincePreviousFile: false, excelConfirmed: false, trailingHighFiles: 0 };
  }
  function detectHeatPumpSeasonality() { return { is: false, reason: "" }; }
  return { analyzeSeries, rankMeter, compareExports, detectHeatPumpSeasonality };
}));
