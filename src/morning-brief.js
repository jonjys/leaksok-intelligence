/* Local, explainable morning triage. Percent is a ratio of export numbers,
   never a physical sound-intensity ratio or a calibrated leak probability. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakMorning = api;
  if (typeof document === "undefined" || typeof state === "undefined") return;
  const fmt = n => Number.isFinite(n) ? n.toLocaleString("sv-SE", { maximumFractionDigits: 1 }) : "—";
  const date = value => value ? new Intl.DateTimeFormat("sv-SE", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }).format(new Date(value)) : "saknas";
  function draw() {
    const host = document.getElementById("morningBrief");
    if (!host) return;
    const report = api.build(state.meters, state.files, state.labels);
    if (!state.files.length) {
      host.innerHTML = '<div class="morning-intro"><span class="morning-kicker">MORGONANALYS</span><h2>Små förändringar. Tydliga nästa steg.</h2><p>Importera senaste 24 timmarna från Kamstrup. Vi jämför med din sparade historik.</p><span class="morning-example">5 → 10 <b>+100 %</b><small>+5 i exportvärde</small></span></div>';
      return;
    }
    const latestText = report.exportAt ? date(report.exportAt) : "datum saknas";
    host.innerHTML = `
      <div class="morning-heading"><div><span class="morning-kicker">MORGONANALYS</span><h2>Det här har förändrats</h2></div>
        <span class="data-freshness ${report.ageHours > 30 ? "is-old" : ""}">${report.ageHours > 30 ? "Äldre export · " : "Senaste export · "}${escapeHtml(latestText)}</span></div>
      <div class="morning-stats">
        <button type="button" data-morning-filter="suspect"><b>${report.changes.length}</b><span>nya ökningar · 24 h</span></button>
        <button type="button" data-morning-filter="dispatch"><b>${report.dispatch}</b><span>prioriterade att åka till</span></button>
        <button type="button" data-morning-filter="stale_contact"><b>${report.stale}</b><span>utan färsk avläsning ≥14 d</span></button>
        <div><b>${report.fresh}<small> / ${report.total}</small></b><span>avlästa senaste 24 h</span></div>
      </div>
      <div class="morning-signals">${report.changes.slice(0,3).map(m => `
        <button type="button" class="morning-signal" data-morning-meter="${escapeAttr(m.id)}">
          <span class="morning-address">${escapeHtml(m.address || m.id)}</span>
          <strong>${fmt(m.before)} <i>→</i> ${fmt(m.latest)} <em>+${fmt(m.percent)} %</em></strong>
          <small>+${fmt(m.delta)} i värde · ${m.labelType ? "ny förändring trots facit – kontrollera" : m.days ? m.days + " dagar observerad förhöjning" : "första hoppet – följ nästa avläsning"}</small>
          <small>${escapeHtml(date(m.beforeAt))} → ${escapeHtml(date(m.readAt))}</small>
        </button>`).join("") || '<p class="morning-quiet">Ingen ny ökning över +50 % och +2 i senaste dygnets avläsningar. Bestående misstankar finns kvar i arbetslistorna.</p>'}</div>
      <p class="morning-footnote">${state.storageError ? escapeHtml(state.storageError) : "Historik på denna enhet"} · Procent av exportvärdet. Prioriteten väger även in varaktighet, dataluckor och störningar.${report.unknown ? " " + report.unknown + " mätare saknar giltigt avläsningsdatum." : ""}</p>`;
  }
  document.getElementById("morningBrief")?.addEventListener("click", event => {
    const meter = event.target.closest("[data-morning-meter]");
    if (meter) { window.selectLeakMeter?.(meter.dataset.morningMeter); return; }
    const filter = event.target.closest("[data-morning-filter]");
    if (filter) {
      els.filter.value = filter.dataset.morningFilter;
      els.filter.dispatchEvent(new Event("change", { bubbles:true }));
    }
  });
  const previousRender = render;
  render = function renderMorning() { previousRender(); draw(); };
  document.addEventListener("DOMContentLoaded", draw);
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DAY = 86400000;
  function build(meters, files, labels = {}, now = Date.now()) {
    const dates = files.map(f => new Date(f.exportDate).getTime()).filter(Number.isFinite);
    const exportAt = dates.length ? Math.max(...dates) : null;
    const result = { exportAt, ageHours: exportAt == null ? Infinity : Math.max(0,(now-exportAt)/3600000), changes:[], dispatch:0, stale:0, fresh:0, unknown:0, total:0 };
    for (const m of meters) {
      if (labels[m.id]?.hidden || m.category === "ignored") continue;
      result.total++;
      if (m.category === "dispatch") result.dispatch++;
      if (m.staleContact || m.staleReadDays >= 14) result.stale++;
      const e = m.engine || {};
      const readAt = e.latestDate ? new Date(e.latestDate).getTime() : NaN;
      if (!Number.isFinite(readAt)) { result.unknown++; continue; }
      const fresh = exportAt != null && readAt <= exportAt && exportAt-readAt <= DAY;
      if (fresh) result.fresh++;
      if (!fresh || !e.newRise || m.category === "customer_side" || m.dryMeter) continue;
      result.changes.push({ id:m.id, address:m.address, before:e.previousValue, latest:e.latest,
        percent:e.latestPercent*100, delta:e.latestDelta, readAt, beforeAt:e.previousDate,
        days:e.persistenceDays || 0, labelType:labels[m.id]?.type || null,
        priority:m.enginePriority || m.risk || 0 });
    }
    result.changes.sort((a,b)=>b.priority-a.priority || b.percent-a.percent);
    return result;
  }
  return { build };
}));
