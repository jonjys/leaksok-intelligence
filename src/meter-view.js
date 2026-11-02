/* Presentation shared by list, map and tests. No imported meter settings or GPS. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakMeterView = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const statuses = Object.freeze({
    dispatch: { label: "Åk ut", color: "#c62828" },
    confirmed: { label: "Aktiv läcka", color: "#8e1b1b" },
    suspect_auto: { label: "Misstänk", color: "#b86e00" },
    watch: { label: "Bevaka", color: "#2f6fd6" },
    customer_side: { label: "Efter mätare", color: "#0b7d8f" },
    stable_high: { label: "Stabilt hög", color: "#6d3fb8" },
    repaired: { label: "Lagad", color: "#2e7d4f" },
    normal: { label: "Normal", color: "#5e6b78" },
    learning: { label: "Kort historik", color: "#64748b" },
    stale_contact: { label: "Ej färsk", color: "#94a3b8" },
    noise: { label: "Störning", color: "#5e6b78" },
    seasonal: { label: "Säsong", color: "#5e6b78" },
    ignored: { label: "Ignorerad", color: "#94a3b8" },
  });
  const addressOrder = (a, b) => String(a.address || "").localeCompare(String(b.address || ""), "sv", { numeric: true }) || String(a.id).localeCompare(String(b.id), "sv", { numeric: true });
  const numeric = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
  function comparator(sort = "priority", reverse = false, districtOf = (m) => m.area || "") {
    const value = (m) => ({
      priority: numeric(m.sortRank), change: numeric(m.changePrev?.pct),
      changeAbs: numeric(m.changePrev?.delta), baseline: numeric(m.finding?.pct),
      lastRead: numeric(m.latest?.date?.getTime()), value: numeric(m.latest?.value),
    })[sort];
    const direction = reverse ? -1 : 1;
    return (a, b) => {
      if (sort === "address") return direction * addressOrder(a, b);
      if (sort === "area") return direction * (String(districtOf(a)).localeCompare(String(districtOf(b)), "sv") || addressOrder(a, b));
      const av = value(a), bv = value(b);
      // Missing percentages (including a zero reference) must stay at the end,
      // in both directions. Never calculate Infinity - Infinity or invent 0%.
      const missing = Number(av == null) - Number(bv == null);
      if (missing) return missing;
      const difference = av != null && bv != null ? bv - av : 0;
      const tie = sort === "change" && av != null && bv != null
        ? (numeric(b.changePrev?.delta) ?? 0) - (numeric(a.changePrev?.delta) ?? 0) : 0;
      return direction * (difference || tie) || (numeric(b.sortRank) ?? 0) - (numeric(a.sortRank) ?? 0) || addressOrder(a, b);
    };
  }
  function mapRevision(meter) {
    return [meter.id, meter.address, meter.area, meter.category, meter.status,
      meter.latest?.value, meter.latest?.date?.getTime(), meter.series?.length,
      meter.series?.length ? Math.max(...meter.series.map((p) => p.value)) : null];
  }
  return { statuses, comparator, mapRevision };
}));
