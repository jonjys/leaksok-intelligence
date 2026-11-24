/* Fältläge för telefon: startskärmen "Idag" och en bottenmeny.
   Läser bara appens färdiga analys (LeakApp.state). Ingen egen bedömning,
   inga beslut ändras och inga mätardata lämnar enheten. */
(function (root) {
  const phone = root.matchMedia("(max-width: 760px)");
  const MAX_CARDS = 8;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString("sv-SE", { maximumFractionDigits: d }) : "–");
  const short = (m) => String(m.address || m.id).replace(/\s+\d{3}\s?\d{2}$/, "");
  const dayFmt = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" });
  const stampFmt = new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  let tab = "today";
  let built = false;

  const app = () => root.LeakApp;
  const $ = (id) => document.getElementById(id);

  function build() {
    if (built) return;
    built = true;
    const today = document.createElement("section");
    today.id = "today";
    today.className = "today";
    today.setAttribute("aria-label", "Idag");
    $("dropzone").prepend(today);

    const nav = document.createElement("nav");
    nav.id = "fieldNav";
    nav.className = "field-nav";
    nav.setAttribute("aria-label", "Fältläge");
    nav.innerHTML = [["today", "●", "Idag"], ["map", "▦", "Karta"], ["list", "☰", "Lista"], ["more", "⋯", "Mer"]]
      .map(([key, icon, label]) => `<button type="button" data-tab="${key}" aria-pressed="false"><span aria-hidden="true">${icon}</span>${label}</button>`).join("");
    document.body.append(nav);

    const more = document.createElement("div");
    more.id = "fieldMore";
    more.className = "field-more";
    more.hidden = true;
    more.innerHTML = `<div class="field-more-sheet" role="menu" aria-label="Mer">
      <button type="button" data-more="import">＋ Importera exporter</button>
      <button type="button" data-more="worklist">Arbetslista <b id="fieldWorklistCount">0</b></button>
      <button type="button" data-more="worklist-map">Arbetslistan på karta</button>
      <button type="button" data-more="daily">AI · Dagens granskning</button>
      <button type="button" data-more="rules">Om analysen</button>
      <button type="button" data-more="backup">Säkerhetskopiera</button>
      <button type="button" data-more="restore">Återställ säkerhetskopia</button>
      <button type="button" data-more="lock">Lås</button>
      <button type="button" data-more="close" class="field-more-close">Stäng</button>
    </div>`;
    document.body.append(more);

    nav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (button) setTab(button.dataset.tab);
    });
    more.addEventListener("click", onMore);
    today.addEventListener("click", onToday);
  }

  function setTab(next) {
    const a = app();
    if (next === "more") { $("fieldMore").hidden = false; return; }
    $("fieldMore").hidden = true;
    tab = next;
    if (a && (next === "map" || next === "list")) {
      const view = document.querySelector(`.view-toggle button[data-view="${next}"]`);
      if (a.state.view !== next && view) view.click();
    }
    render();
    root.scrollTo({ top: 0 });
  }

  function onMore(event) {
    const act = event.target.closest("[data-more]")?.dataset.more;
    if (!act) { if (event.target === $("fieldMore")) $("fieldMore").hidden = true; return; }
    $("fieldMore").hidden = true;
    const click = (selector) => document.querySelector(selector)?.click();
    if (act === "import") click("#pickFiles");
    if (act === "worklist") click("#openWorklist");
    if (act === "worklist-map") { app()?.setList("worklist"); setTab("map"); }
    if (act === "daily") root.LeakAI?.openDaily();
    if (["rules", "backup", "restore", "lock"].includes(act)) click(`#infoMenu [data-info="${act}"]`);
  }

  function onToday(event) {
    const a = app(); if (!a) return;
    const button = event.target.closest("[data-f]");
    if (!button) return;
    const id = button.closest("[data-meter]")?.dataset.meter;
    const m = id && a.state.byId.get(id);
    const act = button.dataset.f;
    if (act === "nav" && m) root.open(root.LeakMap.navigationUrl(m), "_blank", "noopener,noreferrer");
    if (act === "add" && m) { a.addToWorklist([m.id]); render(); }
    if (act === "chart" && m) a.openChart(m.id);
    if (act === "map" && m) { a.setFocus(m.id, { scroll: false }); setTab("map"); }
    if (act === "list") { a.setList(button.dataset.target); setTab("list"); }
    if (act === "area") setTab("map"); // själva markeringen görs av appens [data-area-signal]
    if (act === "import") document.querySelector("#pickFiles")?.click();
  }

  // Minigraf: senaste 60 dagarna, grå före start, färgad efter.
  function spark(m, onset, color) {
    const latest = app().state.latestExport;
    const points = (m.series || []).filter((p) => latest && (latest - p.date) / 86400000 <= 60);
    if (points.length < 3) return "";
    const values = points.map((p) => p.value), lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
    const t0 = +points[0].date, t1 = +points[points.length - 1].date, w = 320, h = 44;
    const xy = (p) => [((+p.date - t0) / (t1 - t0 || 1)) * (w - 8) + 4, h - 5 - ((p.value - lo) / span) * (h - 12)];
    const before = points.filter((p) => !onset || p.date < onset), after = points.filter((p) => onset && p.date >= onset);
    if (before.length && after.length) after.unshift(before[before.length - 1]);
    const line = (list, stroke, width) => list.length > 1 ? `<polyline fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" points="${list.map((p) => xy(p).map((n) => n.toFixed(1)).join(",")).join(" ")}"/>` : "";
    const [lx, ly] = xy(points[points.length - 1]);
    return `<svg class="today-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${line(before, "#C9C1B4", 3)}${line(after, color, 4)}<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5" fill="${color}"/></svg>`;
  }

  function meterCard(m, kind) {
    const a = app();
    const onset = a.onsetOf(m);
    const from = m.finding?.ref?.level, value = m.latest?.value;
    const pct = Number.isFinite(m.finding?.pct) ? m.finding.pct * 100 : null; // motorn ger andel, inte procent
    const inList = a.state.tripList.some((e) => e.id === m.id);
    const tag = kind === "dispatch" ? `<span class="tag t-red">Åk ut</span>` : `<span class="tag t-amber">Nytt${onset ? ` · ${esc(dayFmt.format(onset))}` : ""}</span>`;
    const extra = m.codes?.leak ? `<span class="tag t-ink">LEAK-kod</span>` : "";
    const why = String(m.summary || "").replace(/\s+/g, " ");
    return `<article class="today-card ${kind}" data-meter="${esc(m.id)}">
      <div class="today-tags">${tag}${extra}</div>
      <h3>${esc(short(m))}</h3>
      <div class="today-value"><div class="big">${num(value, 1)}${Number.isFinite(from) ? ` <span>från ${num(from, 1)}</span>` : ""}</div>${Number.isFinite(pct) ? `<div class="pct">${pct >= 0 ? "+" : "−"}${num(Math.abs(pct))} %</div>` : ""}</div>
      ${spark(m, onset, kind === "dispatch" ? "#E8351F" : "#C47F00")}
      <p class="why">${esc(why.length > 150 ? `${why.slice(0, 147)}…` : why)}</p>
      <div class="today-actions"><button type="button" data-f="nav" class="dark">Kör hit</button><button type="button" data-f="add"${inList ? " disabled" : ""}>${inList ? "I listan" : "+ Lista"}</button><button type="button" data-f="chart">Graf</button><button type="button" data-f="map">Karta</button></div>
    </article>`;
  }

  function areaCard(signal) {
    return `<article class="today-card area">
      <div class="today-tags"><span class="tag t-white">Område · ${signal.buildingCount} adresser</span></div>
      <h3>${esc(signal.anchorAddress)}</h3>
      <p class="why">${esc(signal.summary)}</p>
      ${signal.action ? `<p class="why strong">${esc(signal.action)}</p>` : ""}
      <div class="today-actions"><button type="button" data-f="area" data-area-signal="${esc(signal.id)}" class="light">Visa på karta</button></div>
    </article>`;
  }

  function renderToday() {
    const a = app(), s = a?.state, el = $("today");
    if (!s || !el) return;
    if (!s.files.length) {
      el.innerHTML = `<div class="today-head"><p class="kicker">LäckSök</p><h2>Importera dagens export</h2><p>Välj en eller flera Excel-filer från Leak Detector.</p></div>
        <div class="today-empty"><button type="button" data-f="import" class="dark">＋ Importera</button></div>`;
      return;
    }
    const usable = (m) => !s.labels[m.id]?.hidden;
    const dispatch = s.meters.filter((m) => m.category === "dispatch" && usable(m)).sort((x, y) => y.priority - x.priority);
    const fresh = s.meters.filter((m) => m.category === "suspect_auto" && a.isFresh(m) && usable(m)).sort((x, y) => y.priority - x.priority);
    const freshCount = s.meters.filter((m) => a.inList(m, "fresh")).length; // samma som listan Nytt 14 dagar
    const areas = (s.areaSignals || []).filter((g) => !g.broad);
    const cards = [...dispatch.map((m) => meterCard(m, "dispatch")), ...areas.slice(0, 3).map(areaCard), ...fresh.map((m) => meterCard(m, "fresh"))];
    const shown = cards.slice(0, MAX_CARDS);
    const newToday = s.meters.filter((m) => m.isNewToday).length;
    const stamp = s.latestExport ? stampFmt.format(s.latestExport) : "";
    const ageHours = s.latestExport ? (Date.now() - s.latestExport) / 3600000 : 0;
    const warn = s.storageError ? `<div class="today-warn"><b>Historiken kunde inte sparas på telefonen.</b> Den finns kvar tills du stänger appen. Spara en säkerhetskopia under Mer.</div>`
      : ageHours > 30 ? `<div class="today-warn"><b>Exporten är från ${esc(stamp)}.</b> Importera dagens fil för att se nya signaler.</div>` : "";
    el.innerHTML = `<div class="today-head">
        <p class="kicker">Export ${esc(stamp)}</p>
        <h2>${shown.length ? `${shown.length} att lyssna på idag` : "Inget nytt att lyssna på"}</h2>
        <p>${num(s.meters.length)} mätare kollade · ${num(newToday)} nya signaler i dag</p>
      </div>
      ${warn}
      <div class="today-blocks">
        <button type="button" class="blk red" data-f="list" data-target="dispatch"><b>${num(dispatch.length)}</b>Åk ut</button>
        <button type="button" class="blk amber" data-f="list" data-target="fresh"><b>${num(freshCount)}</b>Nytt 14 d</button>
        <button type="button" class="blk ink" data-f="list" data-target="worklist"><b>${num(s.tripList.filter((e) => s.byId.has(e.id)).length)}</b>I listan</button>
      </div>
      ${shown.length ? `<p class="today-sec">Börja här</p>${shown.join("")}` : `<p class="today-sec">Inga Åk ut eller nya ökningar de senaste 14 dagarna.</p>`}
      ${cards.length > shown.length ? `<button type="button" class="today-more" data-f="list" data-target="fresh">Visa alla ${num(freshCount)} nya</button>` : ""}`;
  }

  function render() {
    if (!built && phone.matches) build();
    if (!built) return;
    const on = phone.matches;
    document.body.classList.toggle("field-mode", on);
    document.body.dataset.tab = on ? tab : "";
    document.querySelectorAll("#fieldNav [data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
    const count = $("fieldWorklistCount"), s = app()?.state;
    if (count && s) count.textContent = String(s.tripList.filter((e) => s.byId.has(e.id)).length);
    if (on && tab === "today") renderToday();
  }

  phone.addEventListener?.("change", render);
  // Listval i appen (t.ex. Åk ut-blocket eller arbetslistan) växlar till rätt flik.
  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("field-mode")) return;
    if (event.target.closest("#rail [data-list]") && tab === "today") { tab = "list"; render(); }
  });
  root.LeakField = { render, setTab, get tab() { return tab; } };
  render();
}(window));
