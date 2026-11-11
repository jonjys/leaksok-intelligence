/* Rank the whole local workspace before choosing a bounded, identity-free
   shortlist. The list is a queue for human review, not an AI diagnosis. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakReviewPlan = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_CASES = 24;
  const ALGORITHM = 'area-20261111';
  const MAX_RELATIONS = 36;
  const FIELD_PREVIEW = 5;
  const stockholm = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" });
  const dayKey = (date = new Date()) => stockholm.format(date);
  const hasHistory = m => !!(m?.latest && m.series?.length);
  const fresh = m => m.latest?.ageDays <= 1 && !m.history?.missedExports;
  const available = m => hasHistory(m) && !m.label?.hidden && m.category !== "ignored";
  const customer = m => m.category === "customer_side";
  const areaCheck = m => !!m.areaSignal && !['dispatch', 'confirmed', 'repaired', 'ignored', 'noise', 'seasonal', 'customer_side', 'stale_contact'].includes(m.category);
  const fieldCheck = m => available(m) && (m.field?.state === "check" || areaCheck(m));
  const fieldOrder = (a, b) => {
    const wait = m => (m.field?.blockers || []).reduce((n, b) => n + ({ fresh: 4, dry: 4, coverage: 3, repeat: 2, size: 2, drift: 1, support: 1 }[b.key] || 1), 0);
    const area = m => !m.areaSignal?.broad ? m.areaSignal?.stage === 'repeated' ? 2 : areaCheck(m) ? 1 : 0 : 0;
    return area(b) - area(a) || wait(a) - wait(b) || b.priority - a.priority || String(a.address).localeCompare(String(b.address), "sv", { numeric: true });
  };
  const lane = m => m.category === "dispatch" ? 0 : fieldCheck(m) ? 1 : customer(m) ? 2 : m.isNewToday ? 3 : 4;
  const rank = (a, b) => lane(a) - lane(b)
    || Number(Boolean(b.codes?.burst)) - Number(Boolean(a.codes?.burst))
    || (lane(a) === 1 ? fieldOrder(a, b) : b.priority - a.priority)
    || String(a.id).localeCompare(String(b.id), "sv", { numeric: true });

  function diverse(queue, limit) {
    const chosen = [], deferred = [], addresses = new Set(), groups = new Map();
    for (const m of queue) {
      if (chosen.length >= limit) break;
      const address = String(m.address || m.id).trim().toLocaleLowerCase("sv-SE");
      const group = m.areaSignal?.id;
      if (addresses.has(address) || (group && (groups.get(group) || 0) >= 3)) { deferred.push(m); continue; }
      addresses.add(address);
      if (group) groups.set(group, (groups.get(group) || 0) + 1);
      chosen.push(m);
    }
    return chosen.concat(deferred.slice(0, Math.max(0, limit - chosen.length)));
  }

  function shortlist(meters, mode = "daily") {
    const eligible = meters.filter(m => mode === "selection" ? hasHistory(m)
      : available(m) && (m.category === "dispatch" || (fresh(m) && !m.codes?.dry
        && (fieldCheck(m) || customer(m) || m.isNewToday)))).sort(rank);
    // Reserve a few customer-side checks without making LEAK evidence for a
    // supply-side trip. Several neighbouring cases can still be reviewed together.
    const follow = mode === "daily" ? diverse(eligible.filter(customer), 4) : [];
    const chosen = diverse(eligible.filter(m => !follow.includes(m)), MAX_CASES - follow.length).concat(follow).sort(rank);
    return { mode, examined: meters.length, candidates: eligible.length, meters: chosen };
  }
  return { ALGORITHM, MAX_CASES, MAX_RELATIONS, FIELD_PREVIEW, dayKey, fieldCheck, fieldOrder, shortlist };
}));

