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
    sparse_history: { label: "Glest underlag", color: "#8a5a00" },
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
  const ascendingSorts = new Set(["address", "area", "kamstrup"]);
  const sortOptions = [
    { key: "suspicion", label: "Mest misstänkt", group: "Analys" },
    { key: "priority", label: "Arbetsordning", group: "Analys" },
    { key: "kamstrup", label: "Kamstrups rang", group: "Analys" },
    { key: "persistence", label: "Flest signaldagar", group: "Analys" },
    { key: "neighbors", label: "Störst områdessignal", group: "Analys" },
    { key: "confidence", label: "Starkast underlag", group: "Analys" },
    { key: "signalDate", label: "Nyaste signal", group: "Analys" },
    { key: "excelP", label: "P · E/F − 1", group: "Förändring" },
    { key: "change", label: "Förändring %", group: "Förändring" },
    { key: "changeAbs", label: "Förändring i nivå", group: "Förändring" },
    { key: "baseline", label: "Mot jämförelsenivå", group: "Förändring" },
    { key: "value", label: "Senaste brusvärde", group: "Värden och adress" },
    { key: "maxValue", label: "Högsta historiska värde", group: "Värden och adress" },
    { key: "lastRead", label: "Senast avläst", group: "Värden och adress" },
    { key: "address", label: "Adress", group: "Värden och adress" },
    { key: "area", label: "Område", group: "Värden och adress" },
  ];
  const sortHelp = {
    suspicion: "Mest misstänkt: analyspoäng 0–100 från förändring, varaktighet, aktualitet och grannsignaler. Poängen är en rangordning, inte sannolikhet för läcka. Visa underlag med i-knappen.",
    priority: "Status och arbetsordning först, därefter analyspoäng. Manuella beslut påverkar statusen.",
    kamstrup: "Kamstrups rang i senaste exporten: 1 först. Appens egen analyspoäng är en separat bedömning.",
    persistence: "Flest faktiskt avlästa dagar i signalen först. Saknade dagar räknas inte som bestående signal.",
    neighbors: "Flest separata adresser i samma områdessignal först. Flera mätare på samma adress räknas som en. Visar gemensam påverkan, inte läckans plats.",
    confidence: "Starkast analysunderlag först: starkt, medel, tunt. Ett starkt underlag betyder inte att en läcka är konstaterad.",
    signalDate: "Senaste början på en uppåtgående signal först. För en trend används trendperiodens början. En gammal avläsning i en ny export räknas inte som en ny signal.",
    maxValue: "Högsta avlästa värde i den importerade historiken först. Gamla toppar är inte automatiskt aktiva varningar.",
    excelP: "P = E/F − 1: senaste värde E delat med genomsnitt F från samma exportrad, minus 1. Högst P först. F = 0 eller saknat värde ger ingen procent. P är en nivåavvikelse, inte sannolikhet för läcka.",
    change: "Största procentuella ökning sedan föregående avläsning först. Referensvärde 0 ger ingen beräknad procent.",
    changeAbs: "Största ökning i exportens nivåvärden sedan föregående avläsning först.",
    baseline: "Största procentuella ökning mot mätarens jämförelsenivå först. Listan visar samma jämförelse.",
    value: "Högsta brusvärdet från den senast importerade avläsningen först. Exportens nivåvärde är inte en uppgift om läckans storlek.",
    lastRead: "Senaste faktiska avläsningsdatum först. En ny export av samma gamla avläsning ändrar inte ordningen.",
    address: "Gatunamn och husnummer i adressordning. Hela husnumret och bokstavstillägget behålls.",
    area: "Område i bokstavsordning, därefter adress och husnummer.",
  };
  function comparator(sort = "priority", reverse = false, districtOf = (m) => m.area || "") {
    const maxValues = new WeakMap();
    const selectors = {
      suspicion: (m) => m.latest ? m.priority : null,
      priority: (m) => m.sortRank,
      excelP: (m) => m.excel?.P,
      change: (m) => m.changePrev?.pct,
      changeAbs: (m) => m.changePrev?.delta,
      baseline: (m) => m.finding?.pct,
      lastRead: (m) => m.latest?.date?.getTime(),
      value: (m) => m.latest?.value,
      kamstrup: (m) => m.excel?.interestRank > 0 ? m.excel.interestRank : null,
      persistence: (m) => m.upFinding?.persistence?.n ?? m.upFinding?.now?.n,
      neighbors: (m) => m.areaSignal?.buildingCount,
      confidence: (m) => ({ starkt: 2, medel: 1, tunt: 0 })[m.confidence],
      signalDate: (m) => (m.upFinding?.onset?.at || (m.upFinding?.type === "trend" ? m.upFinding.ref?.from : m.upFinding?.now?.from))?.getTime(),
      maxValue: (m) => {
        if (!maxValues.has(m)) maxValues.set(m, m.series?.length ? Math.max(...m.series.map(p => p.value)) : null);
        return maxValues.get(m);
      },
    };
    const selector = selectors[sort] || selectors.priority;
    const value = (m) => numeric(selector(m));
    const direction = reverse ? -1 : 1;
    return (a, b) => {
      if (sort === "address") return direction * addressOrder(a, b);
      if (sort === "area") return direction * (String(districtOf(a)).localeCompare(String(districtOf(b)), "sv") || addressOrder(a, b));
      const av = value(a), bv = value(b);
      const missing = Number(av == null) - Number(bv == null);
      if (missing) return missing;
      const difference = av != null && bv != null ? (ascendingSorts.has(sort) ? av - bv : bv - av) : 0;
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
  return { statuses, comparator, mapRevision, ascendingSorts, sortHelp, sortOptions };
}));

