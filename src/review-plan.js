/* Rank the whole local workspace before choosing a bounded, identity-free
   shortlist. The list is a queue for human review, not an AI diagnosis. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakReviewPlan = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_CASES = 24;
  const ALGORITHM = 'review-20261113';
  const MAX_RELATIONS = 36;
  const FIELD_PREVIEW = 5;
  const VENDOR_RESERVE = 8;
  const stockholm = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" });
  const dayKey = (date = new Date()) => stockholm.format(date);
  const hasHistory = m => !!(m?.latest && m.series?.length);
  const fresh = m => m.latest?.ageDays <= 1 && !m.history?.missedExports;
  const available = (m, labels = {}) => hasHistory(m) && (labels[m.id]?.hidden ?? m.label?.hidden) !== true && m.category !== "ignored";
  const customer = m => m.category === "customer_side";
  const vendor = m => m.category === 'suspect_auto' && Number.isSafeInteger(m.excel?.interestRank) && m.excel.interestRank > 0;
  const areaCheck = m => !!m.areaSignal && !['dispatch', 'confirmed', 'repaired', 'ignored', 'noise', 'seasonal', 'customer_side', 'stale_contact'].includes(m.category);
  const fieldCheck = (m, labels = {}) => available(m, labels) && (m.field?.state === "check" || areaCheck(m));
  const fieldOrder = (a, b) => {
    const wait = m => (m.field?.blockers || []).reduce((n, b) => n + ({ fresh: 4, dry: 4, coverage: 3, repeat: 2, size: 2, drift: 1, support: 1 }[b.key] || 1), 0);
    const area = m => !m.areaSignal?.broad ? m.areaSignal?.stage === 'repeated' ? 2 : areaCheck(m) ? 1 : 0 : 0;
    return area(b) - area(a) || wait(a) - wait(b) || b.priority - a.priority || String(a.address).localeCompare(String(b.address), "sv", { numeric: true });
  };
  const lane = (m, labels) => m.category === "dispatch" ? 0 : fieldCheck(m, labels) ? 1 : customer(m) ? 2 : m.isNewToday ? 3 : 4;
  const rank = (a, b, labels) => lane(a, labels) - lane(b, labels)
    || Number(Boolean(b.codes?.burst)) - Number(Boolean(a.codes?.burst))
    || (lane(a, labels) === 1 ? fieldOrder(a, b) : b.priority - a.priority)
    || String(a.id).localeCompare(String(b.id), "sv", { numeric: true });

  function diverse(queue, limit, perGroup = 3) {
    const chosen = [], deferred = [], addresses = new Set(), groups = new Map();
    for (const m of queue) {
      if (chosen.length >= limit) break;
      const address = String(m.address || m.id).trim().replace(/\s+/g, ' ').toLocaleLowerCase("sv-SE");
      const group = m.areaSignal?.id;
      if (addresses.has(address) || (group && (groups.get(group) || 0) >= perGroup)) { deferred.push(m); continue; }
      addresses.add(address);
      if (group) groups.set(group, (groups.get(group) || 0) + 1);
      chosen.push(m);
    }
    return chosen.concat(deferred.slice(0, Math.max(0, limit - chosen.length)));
  }

  function fieldPreview(meters) {
    return diverse([...meters].sort(fieldOrder), FIELD_PREVIEW, 1);
  }

  // A local cache identity, not a credential or security hash. Histories are
  // immutable between imports; changing a decision does not rehash every day.
  const seriesKeys = new WeakMap();
  function digest(value) {
    const canonical = value => value instanceof Date ? value.toISOString()
      : Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
    const text = JSON.stringify(canonical(value));
    let a = 2166136261, b = 2246822507;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = Math.imul(b ^ text.charCodeAt(i), 1597334677);
    }
    return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
  }
  function seriesKey(series) {
    if (!seriesKeys.has(series)) seriesKeys.set(series, digest([series.length, series.slice(-1460).map(p => [p.date, p.value])]));
    return seriesKeys.get(series);
  }
  function decision(label = {}) {
    const keys = ['type', 'hidden', 'confirmedDate', 'confirmedDateUncertain', 'repairedDate', 'lineType', 'resetAfter', 'notedDate', 'noiseTags'];
    return [...keys.map(k => label[k] ?? null), label.source === 'inbyggt facit', (Array.isArray(label.leakCases) ? label.leakCases : []).map(decision)];
  }
  function contextKey(meters, context = {}) {
    const values = [...meters].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0).map(m => [
      m.id, m.address, seriesKey(context.histories?.get(m.id)?.series || m.series || []),
      m.category, m.priority, m.latest, m.excel, m.codes, m.history, m.interference,
      decision(context.labels?.[m.id] || m.label || {}),
      m.areaSignal ? [m.areaSignal.id, m.areaSignal.stage, m.areaSignal.basis, m.areaSignal.broad, m.areaSignal.stats, m.areaSignal.neighborhood] : null,
    ]);
    return `${ALGORITHM}|${digest([context.latestExport || null, context.coordinatesKey || '', values])}`;
  }

  function shortlist(meters, mode = "daily", labels = {}) {
    const eligible = meters.filter(m => mode === "selection" ? hasHistory(m)
      : available(m, labels) && (m.category === "dispatch" || (fresh(m) && !m.codes?.dry
        && (fieldCheck(m, labels) || customer(m) || m.isNewToday)))).sort((a, b) => rank(a, b, labels));
    // Reserve a few customer-side checks without making LEAK evidence for a
    // supply-side trip. Several neighbouring cases can still be reviewed together.
    const follow = mode === "daily" ? diverse(eligible.filter(customer), 4) : [];
    // A vendor's current recommendations must not disappear behind hundreds
    // of local checks. Reserve a bounded share, keeping our own assessment.
    const recommendations = mode === 'daily' ? diverse(eligible.filter(vendor).sort((a,b)=>a.excel.interestRank-b.excel.interestRank||rank(a,b,labels)), VENDOR_RESERVE) : [];
    const reserved = new Set([...follow,...recommendations]);
    const chosen = diverse(eligible.filter(m => !reserved.has(m)), MAX_CASES - reserved.size).concat([...reserved]).sort((a, b) => rank(a, b, labels));
    return { mode, examined: meters.length, candidates: eligible.length, meters: chosen,
      vendorSelected: chosen.filter(vendor).length };
  }
  // Memory between days. Yesterday's saved plan stays on this device; only the
  // place in that plan and the decision recorded since then leave it, bound to
  // today's anonymous case order. No address, serial number or comment.
  const DECISIONS = ['manual_dispatch','interesting','customer_contact','leak','repaired','seasonal','known_noise','new_install','reset_baseline','ignored','district_heating','large_building','pump','false_alarm'];
  function memory(report, meters, labels = {}, today = dayKey()) {
    const order = report?.result?.review?.order;
    if (!report || !/^\d{4}-\d{2}-\d{2}$/.test(report.day || '') || report.day >= today) return null;
    if (report.result && !Array.isArray(order)) return null;
    const links = new Map(Array.isArray(report.links) ? report.links : []), ranks = new Map();
    (order || []).forEach((caseId, i) => { const id = links.get(caseId)?.id; if (id != null && !ranks.has(String(id))) ranks.set(String(id), i + 1); });
    const selected = (order || []).length, madeAt = Date.parse(report.createdAt);
    if (selected > MAX_CASES) return null;
    return { previousPlan: { day: report.day, selected }, cases: meters.map(m => {
      const rank = ranks.get(String(m.id));
      if (!rank) return null;
      const label = labels[m.id] || m.label || {}, at = Date.parse(label.at);
      const type = ['watch','suspect'].includes(label.type) ? 'interesting' : label.type;
      const decided = DECISIONS.includes(type) && label.source !== 'inbyggt facit' && Number.isFinite(at) && Number.isFinite(madeAt) && at > madeAt && at <= Date.now();
      return { rank, decisionSince: decided ? type : 'none', decisionDate: decided ? dayKey(new Date(at)) : null };
    }) };
  }
  // Only traceable cases still present in the workspace qualify for the batch action.
  function actionable(review, links, byId, labels = {}) {
    const cases = new Map(review.cases.map(item => [item.caseId, item]));
    return [...new Set(review.order.flatMap(id => {
      const item = cases.get(id), local = links.get(id), meter = local && byId.get(local.id);
      return item && !item.untraceable && item.evidenceIds?.length && meter
        && !(labels[meter.id]?.hidden ?? meter.label?.hidden)
        && !['ignored', 'repaired'].includes(meter.category) ? [meter.id] : [];
    }))].slice(0, FIELD_PREVIEW);
  }
  return { ALGORITHM, MAX_CASES, MAX_RELATIONS, FIELD_PREVIEW, dayKey, fieldCheck, fieldOrder, fieldPreview, contextKey, shortlist, memory, actionable };
}));

