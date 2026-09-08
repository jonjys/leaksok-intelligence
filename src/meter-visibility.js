(function (root) {
  const api = {
    hidden(label) { return label?.hidden === true; },
    visible(label, filter) { return filter === "hidden" ? api.hidden(label) : !api.hidden(label); },
    update(label, hidden, at = new Date().toISOString()) {
      return { ...(label || {}), hidden, visibilityUpdatedAt: at };
    },
  };
  root.MeterVisibility = api;
  if (typeof module === "object" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
