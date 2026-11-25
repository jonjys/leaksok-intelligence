/* Fältläge för telefon: startskärmen "Idag" och en bottenmeny.
   Läser appens färdiga analys (LeakApp.state) och, när AI är aktiverat,
   dagens AI-plan (LeakAI.status). Ingen egen bedömning, inga beslut ändras och
   inga mätardata lämnar enheten härifrån. */
(function (root) {
  const phone = root.matchMedia("(max-width: 760px)");
  const MAX_CARDS = 8;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString("sv-SE", { maximumFractionDigits: d }) : "–");
  const short = (m) => String(m.address || m.id).replace(/\s+\d{3}\s?\d{2}$/, "");
  const clip = (text, max) => { const t = String(text || "").replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
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
    // Under import- och lagringsstatus, så att en import på telefonen alltid
    // svarar med vad som lästes, vad som sparades och vad som gick fel.
    const anchor = $("importLine");
    if (anchor) anchor.after(today); else $("dropzone").prepend(today);

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
    if (a && (next === "map" || next === "list") && a.state.view !== next) {
      const view = document.querySelector(`.view-toggle button[data-view="${next}"]`);
      if (view) view.click();
    }
    render();
    root.scrollTo({ top: 0 });
  }

  // Appen har själv bytt vy (Visa på karta, Visa mätare, ett listval med vy):
  // fliken följer med, annars ligger Idag kvar ovanpå en dold karta.
  function show(view) {
    if (!built || !phone.matches || !["map", "list"].includes(view)) return;
    if ($("fieldMore")) $("fieldMore").hidden = true;
    if (tab === view) return;
    tab = view;
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
    if (act === "worklist-map") { app()?.setList("worklist", null, "map"); setTab("map"); }
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
    if (act === "list") { a.setList(button.dataset.target, null, "list"); setTab("list"); }
    if (act === "area") setTab("map"); // själva markeringen görs av appens [data-area-signal]
    if (act === "import") document.querySelector("#pickFiles")?.click();
    if (act === "ai-open") root.LeakAI?.openDaily();
    if (act === "ai-run") root.LeakAI?.runNow?.();
    if (act === "ai-auto") root.LeakAI?.enableAuto?.();
    if (act === "ai-add") {
      const ids = root.LeakAI?.status?.()?.actionable || [];
      if (ids.length) a.addToWorklist(ids);
      render();
    }
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

  function meterCard(m, kind, ai = null) {
    const a = app();
    const onset = a.onsetOf(m);
    const from = m.finding?.ref?.level, value = m.latest?.value;
    const pct = Number.isFinite(m.finding?.pct) ? m.finding.pct * 100 : null; // motorn ger andel, inte procent
    const inList = a.state.tripList.some((e) => e.id === m.id);
    const tags = [];
    if (ai) tags.push(`<span class="tag t-ai">AI #${ai.rank}</span>`);
    tags.push(kind === "dispatch" ? `<span class="tag t-red">Åk ut</span>`
      : kind === "fresh" ? `<span class="tag t-amber">Nytt${onset ? ` · ${esc(dayFmt.format(onset))}` : ""}</span>`
      : `<span class="tag t-ink">${esc(root.LeakMeterView?.statuses?.[m.category]?.label || "Granskas")}</span>`);
    if (m.codes?.leak) tags.push(`<span class="tag t-ink">LEAK-kod</span>`);
    const why = ai?.nextCheck
      ? `<p class="why ai-why"><b>${ai.traceable ? "Börja här" : "Verifiera först"}:</b> ${esc(clip(ai.nextCheck, 160))}</p>${ai.traceable ? "" : `<p class="why ai-note">AI angav inga spårbara belägg. Jämför med kurvan innan du agerar.</p>`}`
      : `<p class="why">${esc(clip(m.summary, 150))}</p>`;
    const color = kind === "dispatch" ? "#E8351F" : kind === "fresh" ? "#C47F00" : "#2F6BFF";
    return `<article class="today-card ${kind}${ai ? " has-ai" : ""}" data-meter="${esc(m.id)}">
      <div class="today-tags">${tags.join("")}</div>
      <h3>${esc(short(m))}</h3>
      <div class="today-value"><div class="big">${num(value, 1)}${Number.isFinite(from) ? ` <span>från ${num(from, 1)}</span>` : ""}</div>${Number.isFinite(pct) ? `<div class="pct">${pct >= 0 ? "+" : "−"}${num(Math.abs(pct))} %</div>` : ""}</div>
      ${spark(m, onset, color)}
      ${why}
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

  // AI-panelen: vad Claude har räknat fram för den här exporten, eller vad som
  // behövs för att det ska ske automatiskt. Döljs helt när servern saknar AI.
  function aiPanel(s) {
    const ai = root.LeakAI?.status?.();
    const ranks = new Map((ai?.ranking || []).map((r) => [r.id, r]));
    if (!ai || ai.configured !== true) return { html: "", ranks: new Map(), ai };
    const button = (act, label, cls = "") => `<button type="button" data-f="${act}"${cls ? ` class="${cls}"` : ""}>${esc(label)}</button>`;
    const head = (kicker, title, body, actions = "", extra = "") => `<section class="today-ai" aria-label="AI-granskning" data-ai="${esc(ai.phase)}">
        <p class="kicker">${esc(kicker)}</p><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}${extra}
        ${actions ? `<div class="today-ai-actions">${actions}</div>` : ""}
      </section>`;
    let html = "";
    if (!ai.authenticated) {
      html = head("AI · Claude", "Låt AI räkna fram dagens ordning", "Efter varje ny export går regelmotorn igenom alla mätare här på telefonen och Claude rangordnar de mest relevanta med spårbara belägg. Adresser och serienummer skickas inte.",
        button("ai-open", "Aktivera AI", "dark"));
    } else if (ai.phase === "running") {
      html = head("AI · räknar", "Claude granskar dagens signaler…", `${num(ai.examined)} mätare genomgångna lokalt. Ordningen dyker upp här när den är klar.`);
    } else if (ai.phase === "ranked") {
      const r = ai.report;
      const strip = `<div class="today-ai-strip"><span><b>${num(r.examined)}</b> genomgångna</span><span><b>${num(r.selected)}</b> hos Claude</span><span><b>${num(ai.traceable)}</b> med belägg</span></div>`;
      html = head(`AI-ordning · export ${r.exportDate}`, ranks.size ? `${num(Math.min(ranks.size, MAX_CARDS))} i AI-ordning nedan` : "Ingen av AI-fallen är kvar i listorna",
        clip(ai.summary, 220),
        `${ai.actionable.length ? button("ai-add", `Lägg ${ai.actionable.length} första i listan`, "dark") : ""}${button("ai-open", "Hela planen")}`, strip);
    } else if (ai.phase === "clear") {
      html = head(`AI · export ${ai.report.exportDate}`, "Inget behövde AI i dag", "Regelmotorn hittade inga aktuella kontrollförslag, så inget AI-anrop gjordes.");
    } else if (ai.phase === "stale") {
      html = head("AI · äldre underlag", "Dagens AI-plan gäller ett tidigare underlag", "Exporten har kompletterats efter att planen skapades. Ordningen nedan är regelmotorns; planen finns kvar att läsa. En plan per dag, nästa skapas efter morgondagens import.",
        button("ai-open", "Visa sparad plan"));
    } else if (ai.phase === "failed") {
      html = head("AI · avbröts", "Granskningen slutfördes inte", clip(ai.message || "Försök igen när du har täckning.", 160),
        button("ai-run", "Försök igen", "dark"));
    } else if (ai.auto && ai.exportIsToday) {
      html = head("AI · automatisk", "Claude startar strax", "Den automatiska granskningen körs när appen är öppen efter dagens import.", button("ai-run", "Kör nu", "dark"));
    } else if (ai.auto) {
      html = head("AI · automatisk", "Väntar på dagens export", "Granskningen startar automatiskt när dagens export är importerad.", button("ai-run", "Granska den här exporten"));
    } else {
      html = head("AI · Claude", "Låt AI räkna fram dagens ordning", "AI är aktiverat men startar bara när du ber om det. Slå på automatiskt så granskas varje ny dags export direkt efter import.",
        `${button("ai-auto", "Automatiskt varje dag", "dark")}${button("ai-run", "Granska nu")}`);
    }
    return { html, ranks, ai };
  }

  function renderToday() {
    const a = app(), s = a?.state, el = $("today");
    if (!s || !el) return;
    if (!s.files.length) {
      el.innerHTML = `<div class="today-head"><p class="kicker">LäckSök</p><h2>Importera dagens export</h2><p>Välj en eller flera Excel-filer från Leak Detector.</p></div>
        <div class="today-empty"><button type="button" data-f="import" class="dark">＋ Importera</button></div>`;
      return;
    }
    const usable = (m) => !s.labels[m.id]?.hidden && !["ignored", "repaired"].includes(m.category);
    const dispatch = s.meters.filter((m) => m.category === "dispatch" && usable(m)).sort((x, y) => y.priority - x.priority);
    const fresh = s.meters.filter((m) => m.category === "suspect_auto" && a.isFresh(m) && usable(m)).sort((x, y) => y.priority - x.priority);
    const freshCount = s.meters.filter((m) => a.inList(m, "fresh")).length; // samma som listan Nytt 14 dagar
    const areas = (s.areaSignals || []).filter((g) => !g.broad);
    const { html: aiHtml, ranks } = aiPanel(s);

    // AI-ordningen först när en aktuell plan finns, sedan regelmotorns kort.
    const kindOf = (m) => m.category === "dispatch" ? "dispatch" : a.isFresh(m) ? "fresh" : "ai";
    const ranked = [...ranks.values()].map((r) => ({ m: s.byId.get(r.id), r })).filter(({ m }) => m && usable(m));
    const seen = new Set(ranked.map(({ m }) => m.id));
    const cards = [
      ...ranked.map(({ m, r }) => ({ id: m.id, html: meterCard(m, kindOf(m), r), from: m.category === "dispatch" ? "dispatch" : "fresh" })),
      ...dispatch.filter((m) => !seen.has(m.id)).map((m) => ({ id: m.id, html: meterCard(m, "dispatch"), from: "dispatch" })),
      ...areas.slice(0, 3).map((g) => ({ id: `area:${g.id}`, html: areaCard(g), from: "area" })),
      ...fresh.filter((m) => !seen.has(m.id)).map((m) => ({ id: m.id, html: meterCard(m, "fresh"), from: "fresh" })),
    ];
    const shown = cards.slice(0, MAX_CARDS);
    const shownIds = new Set(shown.map((c) => c.id));
    const dispatchLeft = dispatch.filter((m) => !shownIds.has(m.id)).length;
    const freshLeft = s.meters.filter((m) => a.inList(m, "fresh") && !shownIds.has(m.id)).length;
    const newToday = s.meters.filter((m) => m.isNewToday).length;
    const stamp = s.latestExport ? stampFmt.format(s.latestExport) : "";
    const ageHours = s.latestExport ? (Date.now() - s.latestExport) / 3600000 : 0;
    const warn = s.storageError ? `<div class="today-warn"><b>Historiken kunde inte sparas på telefonen.</b> Den finns kvar tills du stänger appen. Spara en säkerhetskopia under Mer.</div>`
      : ageHours > 30 ? `<div class="today-warn"><b>Exporten är från ${esc(stamp)}.</b> Importera dagens fil för att se nya signaler.</div>` : "";
    const meterCards = shown.filter((c) => c.from !== "area").length;
    el.innerHTML = `<div class="today-head">
        <p class="kicker">Export ${esc(stamp)}</p>
        <h2>${meterCards ? `${meterCards} att lyssna på idag` : "Inget nytt att lyssna på"}</h2>
        <p>${num(s.meters.length)} mätare kollade · ${num(newToday)} nya signaler i dag</p>
      </div>
      ${warn}
      <div class="today-blocks">
        <button type="button" class="blk red" data-f="list" data-target="dispatch"><b>${num(dispatch.length)}</b>Åk ut</button>
        <button type="button" class="blk amber" data-f="list" data-target="fresh"><b>${num(freshCount)}</b>Nytt 14 d</button>
        <button type="button" class="blk ink" data-f="list" data-target="worklist"><b>${num(s.tripList.filter((e) => s.byId.has(e.id)).length)}</b>I listan</button>
      </div>
      ${aiHtml}
      ${shown.length ? `<p class="today-sec">Börja här</p>${shown.map((c) => c.html).join("")}` : `<p class="today-sec">Inga Åk ut eller nya ökningar de senaste 14 dagarna.</p>`}
      ${dispatchLeft ? `<button type="button" class="today-more" data-f="list" data-target="dispatch">Visa alla ${num(dispatch.length)} i Åk ut</button>` : ""}
      ${freshLeft ? `<button type="button" class="today-more" data-f="list" data-target="fresh">Visa alla ${num(freshCount)} i Nytt 14 dagar</button>` : ""}`;
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
  // Listval i appens meny när Idag visas växlar till Lista.
  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("field-mode")) return;
    if (event.target.closest("#rail [data-list]") && tab === "today") { tab = "list"; render(); }
  });
  root.LeakField = { render, setTab, show, get tab() { return tab; } };
  render();
}(window));
