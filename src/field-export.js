/* Field work list workbook built from the same analysis objects the app shows.
   Sheet "Arbetslista" is for printing and ticking off; "Analysunderlag" holds
   every comparison with its period and reference value. */
(function (root, factory) {
  const api = factory(root.LeakEngine || (typeof require === "function" ? require("./engine.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakFieldExport = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (Engine) {
  const FINDING = {
    new_signal: "Ny signal (en avläsning)", level_shift: "Ny nivå", trend: "Gradvis ökning",
    transient: "Tillfällig topp med återgång", stable: "Oförändrad nivå", single: "En avläsning", none: "Inga avläsningar",
  };
  const STATUS_COLOR = {
    dispatch: "red", confirmed: "red", suspect_auto: "amber", watch: "blue", customer_side: "cyan",
    stable_high: "purple", repaired: "green", stale_contact: "gray", learning: "gray", noise: "gray", seasonal: "gray", normal: "gray", ignored: "gray",
  };

  function statusText(m) {
    const manual = m.label?.type && !["reset_baseline"].includes(m.label.type);
    const base = Engine.CATEGORY[m.category]?.label || m.category;
    if (m.category === "dispatch" && m.label?.type === "manual_dispatch") return "Åk ut (manuell)";
    if (m.category === "watch") return "Bevaka (manuell)";
    if (manual && ["confirmed", "repaired", "customer_side"].includes(m.category) && m.label.type !== "customer_contact") return `${base} (manuell)`;
    return base;
  }

  function periodText(ref) {
    if (!ref?.from) return "";
    return `${Engine.fmtPeriod(ref.from, ref.to, null)} ${ref.from.getFullYear()}, ${ref.n} avläsning${ref.n === 1 ? "" : "ar"}`;
  }

  function findingText(m) {
    const f = m.finding;
    let text = FINDING[f.type] || f.type;
    if (f.direction === "down" && f.type !== "trend") text = f.type === "new_signal" ? "Lägre värde (en avläsning)" : "Lägre nivå";
    if (f.withinPattern) text += " – i nivå med mätarens återkommande toppar";
    return text;
  }

  function comparison(m) {
    const f = m.finding;
    if (!f?.ref) return {};
    return {
      refLevel: f.ref.level,
      refPeriod: periodText(f.ref),
      definition: m.baseline?.definition || "",
      nowLevel: f.now?.level ?? null,
      delta: f.delta ?? null,
      pct: f.pct ?? null,
    };
  }

  function rowFor(m, labels) {
    const label = labels[m.id] || {};
    const cmp = comparison(m);
    const per = m.finding.persistence;
    return {
      id: m.id,
      address: m.address,
      serial: String(m.serial || m.id),
      area: m.area,
      status: statusText(m),
      category: m.category,
      priority: m.priority,
      confidence: m.confidence,
      latestDate: m.latest?.date || null,
      latestValue: m.latest?.value ?? null,
      prevDate: m.previous?.date || null,
      prevValue: m.previous?.value ?? null,
      prevDelta: m.changePrev?.delta ?? null,
      prevPct: m.changePrev?.pct ?? null,
      summary: m.areaSignal ? `${m.summary} Områdessignal: ${m.areaSignal.count} mätare på ${m.areaSignal.buildingCount} adresser ökar tillsammans.` : m.summary,
      action: m.areaSignal ? `${m.action} ${m.areaSignal.action}` : m.action,
      comment: label.comment || "",
      done: label.fieldDone ? "Klar" : "Ej utförd",
      finding: findingText(m),
      onset: m.finding.onset?.at || null,
      levelReadings: per?.n ?? null,
      levelDays: per ? per.days + 1 : null,
      ...cmp,
      readings: m.history.readings,
      historyFrom: m.history.firstDate,
      historyTo: m.history.lastDate,
      lastExport: m.excel.exportDate,
      ageDays: m.latest?.ageDays ?? null,
      E: m.excel.E, F: m.excel.F, G: m.excel.G, P: m.excel.P,
      interestRank: m.excel.interestRank,
      infoCode: m.codes.infoCode,
      events: [m.codes.activeEvents, m.codes.closedEvents && `stängd: ${m.codes.closedEvents}`, m.codes.follow && "Följs i Kamstrup"].filter(Boolean).join(" · "),
      quality: m.dataQuality.join("\n"),
      observations: m.observations.join("\n"),
      explanations: m.explanations.join("\n"),
      missing: m.missing.join("\n"),
      priorityParts: m.priorityParts.map((p) => `${p.name} ${p.points > 0 ? "+" : ""}${p.points}`).join("\n"),
      decision: m.label ? `${Engine.LABELS[m.label.type] || m.label.type}${m.label.at ? ` (${String(m.label.at).slice(0, 10)})` : ""}` : "",
    };
  }

  const statusStyle = (row) => `status_${STATUS_COLOR[row.category] || "gray"}`;

  function buildWorkbook(meters, { labels = {}, exportedAt = new Date(), sort = "priority" } = {}) {
    if (!meters.length) throw new Error("Inga mätare valda för export");
    let rows = meters.map((m) => rowFor(m, labels));
    if (sort === "address") rows = rows.sort((a, b) => String(a.address).localeCompare(String(b.address), "sv", { numeric: true }));
    const day = exportedAt.toISOString().slice(0, 10);
    const subtitle = `${rows.length} mätare · exporterad ${Engine.fmtDate(exportedAt, true)}`;
    return {
      title: `LeakSök arbetslista ${day}`,
      sheets: [
        {
          name: "Arbetslista", table: "Arbetslista", freeze: { rows: 1, cols: 0 }, headerHeight: 56,
          print: { title: "LeakSök – arbetslista", subtitle },
          rowRule: { key: "done", equals: "Klar" },
          columns: [
            { header: "Adress", key: "address", width: 27, style: "bold" },
            { header: "Serienummer", key: "serial", width: 12.5, wrap: false },
            { header: "Status", key: "status", width: 13, cellStyle: statusStyle },
            { header: "Senast avläst", key: "latestDate", type: "date", width: 11 },
            { header: "Senaste värde", key: "latestValue", type: "number", width: 8.5 },
            { header: "Förändring sedan föreg. avläsning", key: "prevDelta", type: "signed", width: 12 },
            { header: "Förändring sedan föreg. avläsning %", key: "prevPct", type: "percent", width: 12 },
            { header: "Huvudorsak", key: "summary", width: 40 },
            { header: "Rekommenderad kontroll", key: "action", width: 30 },
            { header: "Kommentar", key: "comment", width: 26, style: "editable" },
            { header: "Utförd", key: "done", width: 10.5, style: "choice", choices: ["Ej utförd", "Klar"] },
          ],
          rows,
        },
        {
          name: "Analysunderlag", table: "Analysunderlag", freeze: { rows: 1, cols: 1 }, zoom: 90, headerHeight: 56,
          print: { title: "LeakSök – analysunderlag", subtitle, fitWidth: false, repeatFirstColumn: true },
          columns: [
            { header: "Adress", key: "address", width: 27, style: "bold" },
            { header: "Serienummer", key: "serial", width: 12.5, wrap: false },
            { header: "Område", key: "area", width: 11, wrap: false },
            { header: "Status", key: "status", width: 13, cellStyle: statusStyle },
            { header: "Prioritet (rangordning 0–100)", key: "priority", type: "int", width: 11 },
            { header: "Underlag", key: "confidence", width: 9 },
            { header: "Fynd", key: "finding", width: 18 },
            { header: "Senaste avläsning", key: "latestDate", type: "datetime", width: 15 },
            { header: "Senaste värde", key: "latestValue", type: "number", width: 8.5 },
            { header: "Föregående avläsning", key: "prevDate", type: "datetime", width: 15 },
            { header: "Föregående värde", key: "prevValue", type: "number", width: 9.5 },
            { header: "Förändring sedan föregående", key: "prevDelta", type: "signed", width: 11 },
            { header: "Förändring sedan föregående %", key: "prevPct", type: "percent", width: 11 },
            { header: "Jämförelsenivå", key: "refLevel", type: "number", width: 10 },
            { header: "Jämförelseperiod", key: "refPeriod", width: 24 },
            { header: "Definition av jämförelse", key: "definition", width: 30 },
            { header: "Nuvarande nivå", key: "nowLevel", type: "number", width: 10 },
            { header: "Förändring mot jämförelsenivå", key: "delta", type: "signed", width: 11 },
            { header: "Förändring mot jämförelsenivå %", key: "pct", type: "percent", width: 11 },
            { header: "Ny nivå sedan", key: "onset", type: "date", width: 11 },
            { header: "Avläsningar på nuvarande nivå", key: "levelReadings", type: "int", width: 11 },
            { header: "Observerad varaktighet (dagar)", key: "levelDays", type: "int", width: 11 },
            { header: "Unika avläsningsdagar", key: "readings", type: "int", width: 10 },
            { header: "Historik från", key: "historyFrom", type: "date", width: 11 },
            { header: "Historik till", key: "historyTo", type: "date", width: 11 },
            { header: "Dagar sedan avläsning", key: "ageDays", type: "int", width: 10 },
            { header: "Senaste export", key: "lastExport", type: "datetime", width: 15 },
            { header: "E Senaste värde (export)", key: "E", type: "number", width: 10 },
            { header: "F Genomsnittsvärde (export)", key: "F", type: "number", width: 11 },
            { header: "G Maxvärde (export)", key: "G", type: "number", width: 10 },
            { header: "P = E/F − 1", key: "P", type: "percent", width: 9 },
            { header: "Infokod", key: "infoCode", width: 10 },
            { header: "Kamstrup intresserang", key: "interestRank", type: "number", width: 14 },
            { header: "Aktiva händelser", key: "events", width: 14 },
            { header: "Datakvalitet", key: "quality", width: 42 },
            { header: "Observationer", key: "observations", width: 60 },
            { header: "Möjliga förklaringar", key: "explanations", width: 46 },
            { header: "Vad saknas", key: "missing", width: 30 },
            { header: "Prioritet består av", key: "priorityParts", width: 30 },
            { header: "Manuellt beslut", key: "decision", width: 20 },
            { header: "Kommentar", key: "comment", width: 26, style: "editable" },
          ],
          rows,
        },
        {
          name: "Definitioner", freeze: { rows: 1, cols: 0 }, print: { title: "LeakSök – definitioner", landscape: false },
          columns: [
            { header: "Begrepp", key: "term", width: 30, style: "bold" },
            { header: "Definition", key: "text", width: 100 },
          ],
          rows: DEFINITIONS,
        },
      ],
    };
  }

  const DEFINITIONS = [
    { term: "Kamstrup intresserang", text: "Mätare av intresse är Kamstrups rangordnade läckförslag. En färsk rekommendation visas i Misstänk även om egen historik saknar en tidigare lägre nivå. Rangen är inte en procentsats eller LeakSöks prioritet och bekräftar inte läcka eller placering. Manuella beslut och infokoder hanteras separat." },
    { term: "Värden", text: "Kamstrup Leak Detectors exporterade brusvärde (dagens lägsta, filtrerade värde). Kamstrup anger ingen enhet. Procent är procent av exportvärdet, inte procentuell förändring av ljudintensitet." },
    { term: "Förändring sedan föregående", text: "Senaste avläsningsdagens värde minus föregående avläsningsdags värde; procent = (nytt / tidigare) − 1. Tidigare värde 0 ger ingen procent." },
    { term: "Jämförelsenivå", text: "Mätarens egen nivå före det aktuella fyndet: median av avläsningar i angiven period. Se kolumnen Definition av jämförelse. Skild från förändring sedan föregående avläsning." },
    { term: "P = E/F − 1", text: "E = Senaste värde och F = Genomsnittsvärde från samma rad i senaste exporten. Beräknas inte om F saknas eller är 0." },
    { term: "G", text: "Maxvärde från senaste exporten. Saknat G lämnas tomt." },
    { term: "Ny signal", text: "En enda avläsning större än max(3, 3 × variationen, 50 % av nivån). Ännu oklart om den består – kontrollera nästa avläsning." },
    { term: "Ny nivå", text: "Minst två avläsningar på samma sida om den tidigare nivån; bestående först efter minst fem avläsningar under minst fem dagar. Luckor räknas inte som observerad tid." },
    { term: "Normal variation", text: "Robust mått på mätarens dag-till-dag-variation (median av successiva skillnader). En nivåförändring måste vara större än max(2, 3 × variationen, 25 % av nivån). Med färre än 8 jämförbara avläsningspar används 8 % av nivån som variation." },
    { term: "Tillfällig topp", text: "Topp där återgång till tidigare nivå faktiskt har observerats." },
    { term: "Prioritet 0–100", text: "Regelbaserad rangordning av vad som bör kontrolleras först. Inte en kalibrerad sannolikhet för läcka. Delarna redovisas i kolumnen Prioritet består av." },
    { term: "Underlag", text: "Starkt/medel/tunt efter antal avläsningar före och efter förändringen, täckning och aktualitet." },
    { term: "Infokoder (flowIQ)", text: "LEAK: vattnet har inte stått still en sammanhängande timme senaste dygnet (läcka efter mätaren möjlig). BURST: högt flöde i 30 minuter. DRY: mätaren är inte vattenfylld – inte kommunikationsfel." },
    { term: "Leak Detector-händelser", text: "Akustiska händelser (t.ex. Läckage) anger inte om läckan ligger före eller efter mätaren." },
    { term: "Utförd", text: "Välj Ej utförd eller Klar. Raden blir grön när den är Klar." },
  ];

  function fileName(date = new Date(), count) {
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return `Leaksok-Arbetslista-${day}${count ? `-${count}-matare` : ""}.xlsx`;
  }

  return { buildWorkbook, rowFor, statusText, fileName, DEFINITIONS };
}));
