/* Signal charts drawn from the engine's series: real time axis, raw daily
   readings always visible, no line across data gaps, reference levels with
   their periods. Same numbers as the table and export. */
(function (root, factory) {
  const api = factory(root.LeakEngine || (typeof require === "function" ? require("./engine.js") : null),
    root.LeakHistory || (typeof require === "function" ? require("./history.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakChart = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (Engine, History) {
  const DAY = 86400000;
  const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => Engine.fmtNum(v);

  function niceMax(value) {
    if (!(value > 0)) return 10;
    const raw = value * 1.12;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * mag >= raw) * mag;
    return step;
  }
  function ticks(max) {
    const step = [1, 2, 2.5, 5, 10].map((s) => s * 10 ** Math.floor(Math.log10(max / 4))).find((s) => max / s <= 5) || max / 4;
    const out = [];
    for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }
  function dateLabel(date, spanDays, prev) {
    if (spanDays <= 150) return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
    const label = MONTHS[date.getMonth()];
    return !prev || prev.getFullYear() !== date.getFullYear() || date.getMonth() === 0 ? `${label} ${date.getFullYear()}` : label;
  }
  function dayStart(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
  // Calendar-aligned ticks: days, Mondays or first of month.
  function xTicks(t0, t1, stepDays) {
    const out = [];
    const first = new Date(t0);
    if (stepDays >= 30) {
      const months = Math.max(1, Math.round(stepDays / 30.4));
      for (let d = new Date(first.getFullYear(), first.getMonth() + 1, 1); d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth() + months, 1)) out.push(d);
      return out;
    }
    let d = dayStart(first);
    if (d.getTime() < t0) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    if (stepDays >= 7) while (d.getDay() !== 1) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    for (; d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + stepDays)) out.push(d);
    return out;
  }

  function periodStart(series, period, end) {
    if (period === "all" || !series.length) return series[0]?.date || end;
    const start = new Date(end.getTime() - Number(period) * DAY);
    return start < series[0].date ? series[0].date : start;
  }

  /* Pure SVG string. meter: engine result. Returns { svg, points, xOf } */
  function buildSvg(meter, { width = 640, height = 260, period = "all", compare = "previous", compact = false } = {}) {
    const all = meter.series || [];
    const latestExport = meter.excel?.exportDate || all[all.length - 1]?.date;
    const endBase = all.length ? all[all.length - 1].date : latestExport;
    const end = latestExport && latestExport > endBase ? latestExport : endBase;
    if (!all.length || !end) return { svg: `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Inga avläsningar"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="ch-empty">Inga avläsningar att visa</text></svg>`, points: [], comparison: History.compare(all, compare), coverage: History.coverage([]) };
    const start = dayStart(periodStart(all, period, end));
    const visible = all.filter((p) => p.date >= start);
    const cmp = History.compare(all, compare);
    const f = meter.finding || {};
    const refLevels = [f.ref?.level, f.now?.level, cmp.reference?.value].filter(Number.isFinite);
    const yMax = niceMax(Math.max(...visible.map((p) => p.value), ...refLevels, 5));
    const left = 40, right = width - 12, top = 14, bottom = height - (compact ? 24 : 28);
    const t0 = start.getTime(), t1 = Math.max(end.getTime(), t0 + DAY);
    const xOf = (d) => left + ((d.getTime() - t0) / (t1 - t0)) * (right - left);
    const yOf = (v) => bottom - (Math.max(0, v) / yMax) * (bottom - top);
    const parts = [];
    // Grid and y axis.
    for (const v of ticks(yMax)) {
      const y = yOf(v).toFixed(1);
      parts.push(`<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" class="ch-grid"/><text x="${left - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end" class="ch-axis">${num(v)}</text>`);
    }
    // x ticks at whole days, no overlapping labels.
    const spanDays = (t1 - t0) / DAY;
    const minPx = compact ? 64 : 78;
    const stepDays = [1, 2, 7, 14, 30, 61, 91, 182, 365, 730].find((s) => ((right - left) / spanDays) * s >= minPx) || 730;
    let prevTick = null;
    for (const t of xTicks(t0, t1, stepDays)) {
      const x = xOf(t);
      if (x > right - 18) break;
      parts.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${top}" y2="${bottom}" class="ch-grid v"/><text x="${x.toFixed(1)}" y="${bottom + 16}" text-anchor="middle" class="ch-axis">${esc(dateLabel(t, spanDays, prevTick))}</text>`);
      prevTick = t;
    }
    // Missing data: gaps between readings and time since the last reading.
    const gapLimit = 1;
    const missingBand = (from, to, label, title) => {
      const x0 = Math.max(left, xOf(from)), x1 = Math.min(right, xOf(to));
      if (x1 <= x0) return;
      parts.push(`<rect x="${x0.toFixed(1)}" y="${top}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${bottom - top}" class="ch-gap"><title>${esc(title)}</title></rect>`);
      if (x1 - x0 > 100) parts.push(`<text x="${((x0 + x1) / 2).toFixed(1)}" y="${top + 12}" text-anchor="middle" class="ch-gap-label">${esc(label)}</text>`);
    };
    if (visible.length && History.calendarDays(start, visible[0].date) > 0) missingBand(start, visible[0].date, "saknas i importen", "Avläsningar saknas i appens importunderlag före första punkten i perioden; Kamstrup kan ha fler värden.");
    for (let i = 1; i < visible.length; i++) {
      const gap = History.calendarDays(visible[i - 1].date, visible[i].date);
      if (gap > gapLimit) {
        missingBand(visible[i - 1].date, visible[i].date, "saknas i importen", `Lucka i importunderlaget mellan ${Engine.fmtDate(visible[i - 1].date)} och ${Engine.fmtDate(visible[i].date)}: ${gap - 1} mellanliggande dagar saknas. Kamstrup kan ha fler historiska värden.`);
      }
    }
    const lastPoint = visible[visible.length - 1] || all[all.length - 1];
    const staleDays = History.calendarDays(lastPoint.date, end);
    if (staleDays >= 1) {
      const x0 = Math.max(left, xOf(lastPoint.date));
      parts.push(`<rect x="${x0.toFixed(1)}" y="${top}" width="${Math.max(1, right - x0).toFixed(1)}" height="${bottom - top}" class="ch-stale"><title>Ingen ny avläsning i importen ${esc(Engine.fmtDate(lastPoint.date))}–${esc(Engine.fmtDate(end))} (${staleDays} dagar)</title></rect>`);
      if (right - x0 > 90) parts.push(`<text x="${(right - 4).toFixed(1)}" y="${top + 12}" text-anchor="end" class="ch-gap-label">ingen ny importerad punkt · ${staleDays} d</text>`);
    }
    // Reference levels with their periods.
    const line = (from, to, level, cls, label) => {
      if (!Number.isFinite(level) || !from) return;
      const y = yOf(level).toFixed(1);
      const inPeriod = visible.filter(p => p.date >= from && p.date <= (to || from));
      const runs = [];
      for (const p of inPeriod) {
        const last = runs.at(-1);
        if (!last || History.calendarDays(last.at(-1).date, p.date) > gapLimit) runs.push([p]); else last.push(p);
      }
      for (const run of runs) {
        const a = xOf(run[0].date), b = Math.min(right, Math.max(a + 4, xOf(run.at(-1).date)));
        parts.push(`<line x1="${a.toFixed(1)}" x2="${b.toFixed(1)}" y1="${y}" y2="${y}" class="${cls}"><title>${esc(label)}</title></line>`);
      }
      if (runs.length && (!compact || cls.includes("ref"))) {
        const b = Math.min(right, xOf(runs.at(-1).at(-1).date));
        parts.push(`<text x="${(b - 2).toFixed(1)}" y="${(+y - 4).toFixed(1)}" text-anchor="end" class="ch-ref-label">${esc(label.split(" (")[0])}</text>`);
      }
    };
    if (f.type === "trend") {
      const a = { x: xOf(f.ref.from < start ? start : f.ref.from), y: yOf(f.ref.level + (f.ref.from < start ? f.slopePerDay * ((start - f.ref.from) / DAY) : 0)) };
      const b = { x: xOf(f.now.to), y: yOf(f.now.level) };
      parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="ch-trend"><title>Trendlinje (Theil–Sen) ${esc(Engine.fmtPeriod(f.ref.from, f.now.to))}</title></line>`);
    } else if (f.ref) {
      const refLabel = f.type === "level_shift" ? `före ${num(f.ref.level)}` : `median ${num(f.ref.level)}`;
      line(f.ref.from, f.ref.to, f.ref.level, "ch-ref", `${refLabel} (${Engine.fmtPeriod(f.ref.from, f.ref.to)})`);
      if (f.type === "level_shift") line(f.now.from, f.now.to, f.now.level, "ch-now", `nu ${num(f.now.level)} (${Engine.fmtPeriod(f.now.from, f.now.to)})`);
    }
    // Readings: line only between readings without a data gap.
    let path = "";
    visible.forEach((p, i) => {
      const joined = i > 0 && History.calendarDays(visible[i - 1].date, p.date) <= gapLimit;
      path += `${joined ? "L" : "M"}${xOf(p.date).toFixed(1)},${yOf(p.value).toFixed(1)}`;
    });
    parts.push(`<path d="${path}" class="ch-line"/>`);
    const r = visible.length > 120 ? 1.6 : visible.length > 60 ? 2.2 : 3;
    visible.forEach((p, i) => {
      const last = i === visible.length - 1;
      parts.push(`<circle cx="${xOf(p.date).toFixed(1)}" cy="${yOf(p.value).toFixed(1)}" r="${last ? 5 : r}" class="ch-dot${last ? " last" : ""}" data-day="${History.dayKey(p.date)}" data-value="${p.value}"><title>${esc(Engine.fmtDate(p.date))}: ${num(p.value)}${p.readings > 1 ? ` (lägsta av ${p.readings} avläsningar)` : ""}</title></circle>`);
    });
    if (cmp.reference && cmp.reference.date >= start) {
      parts.push(`<circle cx="${xOf(cmp.reference.date).toFixed(1)}" cy="${yOf(cmp.reference.value).toFixed(1)}" r="7" class="ch-compare"><title>Jämförelse: ${esc(Engine.fmtDate(cmp.reference.date))} ${num(cmp.reference.value)}</title></circle>`);
    }
    const aria = `Brusvärde för ${meter.address || meter.id}, ${visible.length} avläsningar ${Engine.fmtPeriod(visible[0]?.date, lastPoint.date)}. Senaste ${num(lastPoint.value)}.`;
    const svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label="${esc(aria)}">${parts.join("")}<line class="ch-cursor" y1="${top}" y2="${bottom}" x1="0" x2="0" visibility="hidden"/></svg>`;
    return { svg, points: visible.map((p) => ({ ...p, x: xOf(p.date), y: yOf(p.value) })), comparison: cmp, coverage: History.coverage(visible, start, end), start, end };
  }

  function compareText(cmp) {
    if (!cmp.reference) return cmp.note || "Ingen jämförelse";
    const pct = cmp.percent == null ? (cmp.reference.value === 0 ? "ingen procent, från 0" : "–") : Engine.fmtPct(cmp.percent / 100);
    return `${Engine.fmtSigned(cmp.delta)} (${pct}) mot ${Engine.fmtDate(cmp.reference.date)}: ${num(cmp.reference.value)}`;
  }

  /* Interactive chart in a container. options.onEnlarge for compact charts. */
  function render(container, meter, options = {}) {
    if (!container) return;
    const state = container.__chart || (container.__chart = { period: options.period || null, compare: "previous", id: null });
    if (state.id !== meter.id) { state.id = meter.id; state.period = options.period || (meter.history?.spanDays > 120 ? "90" : "all"); state.compare = "previous"; }
    const compact = Boolean(options.compact);
    const draw = () => {
      const stage = container.querySelector(".ch-stage");
      const box = stage.getBoundingClientRect();
      const width = Math.max(280, Math.round(box.width || 640));
      const height = Math.max(compact ? 150 : 220, Math.round(box.height || (compact ? 190 : 300)));
      const built = buildSvg(meter, { width, height, period: state.period, compare: state.compare, compact });
      stage.innerHTML = built.svg;
      container.querySelector(".ch-cmp").textContent = compareText(built.comparison);
      const covered = built.coverage;
      const ref = meter.finding?.ref;
      const referenceNote = meter.finding?.type === "trend" ? " Trendlinjen är en beräkning från importerade punkter, inte uppmätta värden under luckorna."
        : Number.isFinite(ref?.level) ? ` Median ${num(ref.level)} (${ref.n} avläsningsdagar, ${Engine.fmtDate(ref.from, true)}–${Engine.fmtDate(ref.to, true)}) är ett räknat jämförelsemått, inte mellanliggande avläsningar.` : "";
      container.querySelector(".ch-coverage-short").textContent = `${covered.readingDays} avläsningsdagar / ${covered.expectedDays} dagar${covered.missingDays ? ` · ${covered.missingDays} saknas i importen` : ""}`;
      container.querySelector(".ch-coverage-explanation").textContent = `Vald period visar de avläsningar som finns i appens importer.${covered.missingDays ? ` ${covered.missingDays} dagar saknar importerade värden; Kamstrup kan ha fler.` : ""}${referenceNote}`;
      container.querySelector(".ch-coverage").dataset.state = covered.missingDays ? "warning" : "ready";
      state.points = built.points;
      state.size = `${width}x${height}`;
    };
    const latest = meter.latest;
    const f = meter.finding || {};
    const legend = [
      '<span><i class="k-dot"></i>importerad avläsning</span>',
      f.type === "trend" ? '<span><i class="k-trend"></i>trendlinje</span>' : f.ref ? `<span><i class="k-ref"></i>${f.type === "level_shift" ? "nivå före / efter förändringen" : "jämförelsenivå"} (median)</span>` : "",
      '<span><i class="k-gap"></i>saknas i appens import</span>',
      '<span><i class="k-cmp"></i>jämförelsepunkt</span>',
    ].join("");
    container.innerHTML = `
      <div class="ch-head">
        <div class="ch-latest">${latest ? `<b>${num(latest.value)}</b> senast · ${esc(Engine.fmtDate(latest.date))}${latest.ageDays >= 2 ? ` <span class="ch-old">(${latest.ageDays} dagar sedan)</span>` : ""}` : "Inga avläsningar"}</div>
        <div class="ch-cmp" aria-live="polite"></div>
      </div>
      <div class="ch-controls">
        <div class="ch-periods" role="group" aria-label="Period">${[["30", "30 d"], ["90", "90 d"], ["365", "1 år"], ["all", "Allt"]].map(([v, l]) => `<button type="button" data-period="${v}" aria-pressed="${state.period === v}">${l}</button>`).join("")}</div>
        <label class="ch-compare-pick">Jämför med <select>${[["previous", "föregående avläsning"], ["7", "7 dagar bakåt"], ["30", "30 dagar bakåt"], ["90", "90 dagar bakåt"], ["365", "1 år bakåt"]].map(([v, l]) => `<option value="${v}"${state.compare === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <div class="ch-stage${compact ? " compact" : ""}"${compact ? ' role="button" tabindex="0" aria-label="Förstora grafen"' : ""}></div>
      <div class="ch-coverage"><span class="ch-coverage-short" role="status"></span><details class="ch-coverage-help"><summary>Så läser du grafen</summary><p class="ch-coverage-explanation"></p></details></div>
      <div class="ch-tip" hidden></div>
      <div class="ch-legend">${legend}</div>`;
    container.querySelectorAll("[data-period]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      state.period = b.dataset.period;
      container.querySelectorAll("[data-period]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw();
    }));
    container.querySelector("select").addEventListener("change", (e) => { state.compare = e.target.value; draw(); });
    const stage = container.querySelector(".ch-stage");
    const tip = container.querySelector(".ch-tip");
    const showTip = (clientX) => {
      const rect = stage.getBoundingClientRect();
      const [w] = (state.size || "640x260").split("x").map(Number);
      const px = ((clientX - rect.left) / rect.width) * w;
      let best = null;
      for (const p of state.points || []) if (!best || Math.abs(p.x - px) < Math.abs(best.x - px)) best = p;
      if (!best) return;
      tip.hidden = false;
      tip.textContent = `${Engine.fmtDate(best.date, true)} · ${num(best.value)}${best.exports > 1 ? ` · exporterad ${best.exports} ggr` : ""}`;
      tip.style.left = `${Math.min(rect.width - 170, Math.max(0, (best.x / w) * rect.width - 60))}px`;
      const cursor = stage.querySelector(".ch-cursor");
      if (cursor) { cursor.setAttribute("x1", best.x); cursor.setAttribute("x2", best.x); cursor.setAttribute("visibility", "visible"); }
    };
    stage.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch") showTip(e.clientX); });
    stage.addEventListener("pointerleave", () => { tip.hidden = true; stage.querySelector(".ch-cursor")?.setAttribute("visibility", "hidden"); });
    if (compact && options.onEnlarge) {
      stage.addEventListener("click", () => options.onEnlarge(meter.id));
      stage.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); options.onEnlarge(meter.id); } });
    } else {
      stage.addEventListener("click", (e) => showTip(e.clientX));
    }
    draw();
    if (typeof ResizeObserver === "function") {
      state.observer?.disconnect();
      state.observer = new ResizeObserver(() => {
        if (!stage.isConnected) { state.observer.disconnect(); return; }
        const box = stage.getBoundingClientRect();
        if (box.width > 20 && `${Math.max(280, Math.round(box.width))}x${Math.max(compact ? 150 : 220, Math.round(box.height))}` !== state.size) draw();
      });
      state.observer.observe(stage);
    }
  }

  /* Small inline sparkline for table rows: last 60 days, gaps not joined. */
  function sparkline(meter, { width = 120, height = 34, days = 60 } = {}) {
    const series = meter.series || [];
    if (!series.length) return "";
    const end = meter.excel?.exportDate && meter.excel.exportDate > series[series.length - 1].date ? meter.excel.exportDate : series[series.length - 1].date;
    const start = new Date(end.getTime() - days * DAY);
    const pts = series.filter((p) => p.date >= start);
    if (!pts.length) return `<svg class="spark" viewBox="0 0 ${width} ${height}" aria-hidden="true"><rect x="0" y="2" width="${width}" height="${height - 4}" class="sp-stale"/></svg>`;
    const max = Math.max(5, ...pts.map((p) => p.value)) * 1.1;
    const x = (d) => 2 + ((d - start) / (end - start || 1)) * (width - 6);
    const y = (v) => height - 3 - (v / max) * (height - 6);
    let d = "", shade = "";
    pts.forEach((p, i) => {
      const joined = i > 0 && History.calendarDays(pts[i - 1].date, p.date) <= 1;
      if (i > 0 && !joined) shade += `<rect x="${x(pts[i - 1].date).toFixed(1)}" y="2" width="${Math.max(1, x(p.date) - x(pts[i - 1].date)).toFixed(1)}" height="${height - 4}" class="sp-gap"/>`;
      d += `${joined ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`;
    });
    const last = pts[pts.length - 1];
    if (History.calendarDays(last.date, end) >= 2) shade += `<rect x="${x(last.date).toFixed(1)}" y="2" width="${Math.max(1, width - 2 - x(last.date)).toFixed(1)}" height="${height - 4}" class="sp-stale"/>`;
    const ref = meter.finding?.ref;
    let refLine = "";
    if (ref && Number.isFinite(ref.level)) {
      let first = null, last = null;
      const add = () => { if (first) refLine += `<line x1="${x(first.date).toFixed(1)}" x2="${Math.min(width - 2, Math.max(x(first.date) + 2, x(last.date))).toFixed(1)}" y1="${y(ref.level).toFixed(1)}" y2="${y(ref.level).toFixed(1)}" class="sp-ref"/>`; };
      for (const p of pts.filter(p => p.date >= ref.from && p.date <= ref.to)) {
        if (last && History.calendarDays(last.date, p.date) > 1) { add(); first = null; }
        first ||= p; last = p;
      }
      add();
    }
    return `<svg class="spark" viewBox="0 0 ${width} ${height}" aria-hidden="true">${shade}${refLine}<path d="${d}" class="sp-line"/><circle cx="${x(last.date).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="2.6" class="sp-last"/></svg>`;
  }

  return { buildSvg, render, sparkline, compareText };
}));
