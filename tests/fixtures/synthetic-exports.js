// Synthetic Kamstrup-like daily exports. No municipal data: every serial,
// address and value is generated. Column order follows the export layout the
// app documents: E = Senaste värde, F = Genomsnittsvärde, G = Maxvärde.
const HEADER = ["Serienummer", "Adress", "Område", "Senaste avläsning", "Senaste värde", "Genomsnittsvärde", "Maxvärde", "Infokod", "Aktiva händelser", "Stängda händelser"];
const DAY = 86400000;

function pad(n) { return String(n).padStart(2, "0"); }
function localStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function fileStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
}
// mulberry32 with a hashed seed: neighbouring seeds give unrelated sequences.
function rng(seed) {
  let s = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each scenario returns, per export day index (0..days-1), either null (meter
// absent from that export) or { value, readDay, info?, events? }. readDay is the
// index of the day the reading was taken; a stale meter keeps an old readDay.
const SCENARIOS = {
  "90000001": { address: "LÅGNIVÅVÄGEN 1 TUMBA 14730", area: "TUMBA", title: "Liten första ökning 5 → 10",
    series: (d, n) => ({ value: d === n - 1 ? 10 : 5, readDay: d }) },
  "90000002": { address: "LÅGNIVÅVÄGEN 3 TUMBA 14730", area: "TUMBA", title: "Liten bestående ökning 5 → 10 → 11 → 12",
    series: (d, n) => ({ value: d < n - 4 ? 5 : [10, 11, 12, 12][d - (n - 4)], readDay: d }) },
  "90000003": { address: "TOPPGATAN 5 TULLINGE 14640", area: "TULLINGE", title: "Stor ensam topp 5 → 100 (en avläsning)",
    series: (d, n) => ({ value: d === n - 1 ? 100 : 5, readDay: d }) },
  "90000004": { address: "TOPPGATAN 7 TULLINGE 14640", area: "TULLINGE", title: "Observerad återgång 5 → 100 → 5",
    series: (d, n) => ({ value: d === n - 2 ? 100 : 5, readDay: d }) },
  "90000005": { address: "HÖGNIVÅVÄGEN 9 NORSBORG 14559", area: "NORSBORG", title: "Stabilt hög nivå",
    series: (d) => ({ value: 62 + ((d * 7) % 5) - 2, readDay: d }) },
  "90000006": { address: "TRENDVÄGEN 11 ALBY 14559", area: "ALBY", title: "Långsam ökning 10 → 30",
    series: (d, n) => ({ value: Math.round(10 + 20 * d / (n - 1)), readDay: d }) },
  "90000007": { address: "KOPIEVÄGEN 13 FITTJA 14551", area: "FITTJA", title: "Upprepad export av samma avläsning",
    series: (d, n) => (d < n - 6 ? { value: 5, readDay: d } : { value: 12, readDay: n - 6 }) },
  "90000008": { address: "LUCKVÄGEN 15 UTTRAN 14763", area: "UTTRAN", title: "Lång datalucka",
    series: (d, n) => (d < 8 ? { value: 5, readDay: d } : d < n - 4 ? null : { value: 10, readDay: d }) },
  "90000009": { address: "GAMMALVÄGEN 17 GRÖDINGE 14750", area: "GRÖDINGE", title: "Gammal avläsning i ny export",
    series: (d, n) => (d < n - 20 ? { value: d === n - 21 ? 40 : 6, readDay: d } : { value: 40, readDay: n - 21 }) },
  "90000010": { address: "NOLLVÄGEN 19 TUMBA 14730", area: "TUMBA", title: "Nollvärde och decimaler",
    series: (d, n) => ({ value: d < n - 2 ? 0 : d === n - 2 ? "5,5" : 8, readDay: d }) },
  "90000011": { address: "SAKNASVÄGEN 21 TUMBA 14730", area: "TUMBA", title: "Saknat värde",
    series: (d, n) => ({ value: d === n - 1 ? "" : 7, readDay: d }) },
  "90000012": { address: "BLOCKVÄGEN 23 TULLINGE 14640", area: "TULLINGE", title: "Känd störning (fjärrvärme) men ny tydlig avvikelse",
    series: (d, n) => ({ value: d < n - 5 ? 14 + (d % 3) : 58 + (d % 2), readDay: d }) },
  "90000013": { address: "BASLINJEVÄGEN 25 NORSBORG 14559", area: "NORSBORG", title: "Äldre baslinje 34, föregående 11, senaste 20",
    series: (d, n) => ({ value: d < n - 6 ? 34 : d < n - 1 ? 11 : 20, readDay: d }) },
  "90000014": { address: "KUNDVÄGEN 27 ALBY 14559", area: "ALBY", title: "Infokod LEAK (förbrukning efter mätaren)",
    series: (d) => ({ value: 9, readDay: d, info: "LEAK" }) },
  "90000015": { address: "TORRVÄGEN 29 TUMBA 14730", area: "TUMBA", title: "Infokod DRY",
    series: (d) => ({ value: 3, readDay: d, info: "DRY" }) },
  "90000016": { address: "AKUSTIKVÄGEN 31 FITTJA 14551", area: "FITTJA", title: "Akustisk händelse Läckage, stigande",
    series: (d, n) => ({ value: d < n - 10 ? 12 : 45 + (d % 3), readDay: d, events: d >= n - 7 ? "Läckage" : "" }) },
  "90000017": { address: "FORMELVÄGEN 33 TUMBA 14730", area: "TUMBA", title: "Adress som ser ut som formel",
    series: (d) => ({ value: 6, readDay: d }), addressOverride: "=HYPERLINK(\"http://x\")" },
};

function buildDailyExports({ meters = 3000, days = 30, end = "2026-09-29", seed = 7, includeScenarios = true } = {}) {
  const random = rng(seed);
  const endDate = new Date(`${end}T06:30:00`);
  const background = [];
  const streets = ["BJÖRKVÄGEN", "EKVÄGEN", "GRANSTIGEN", "LINDGATAN", "ALLÉVÄGEN", "SKOGSVÄGEN", "BERGSVÄGEN", "SJÖVÄGEN", "ÄNGSVÄGEN", "HAGVÄGEN"];
  const areas = [["TUMBA", "14730"], ["TULLINGE", "14640"], ["NORSBORG", "14559"], ["ALBY", "14559"], ["FITTJA", "14551"], ["UTTRAN", "14763"], ["GRÖDINGE", "14750"]];
  const scenarioCount = includeScenarios ? Object.keys(SCENARIOS).length : 0;
  for (let i = 0; i < meters - scenarioCount; i++) {
    const [area, zip] = areas[i % areas.length];
    const street = streets[Math.floor(i / areas.length) % streets.length];
    const house = 1 + Math.floor(i / (areas.length * streets.length));
    const always = random();
    const base = always < .04 ? 150 + Math.round(random() * 60) : always < .2 ? 25 + Math.round(random() * 40) : 2 + Math.round(random() * 14);
    // Realistic behaviour mix: quiet, noisy, pump-like spikes.
    const kind = random();
    const jitter = kind < .1 ? Math.max(2, Math.round(base * .45)) : Math.max(1, Math.round(base * .15));
    const spikeRate = kind > .9 ? .25 : 0;
    const staleFrom = random() < .01 ? Math.floor(days * .5) : null;
    background.push({
      serial: String(20000000 + i), address: `${street} ${house} ${area} ${zip}`, area,
      series: (d) => {
        const readDay = staleFrom != null && d > staleFrom ? staleFrom : d;
        const r = rng(seed * 1000 + i * 37 + readDay);
        const noise = (r() - .5) * 2 * jitter;
        const spike = spikeRate && r() < spikeRate ? base * (1 + r() * 2) : 0;
        return { value: Math.max(0, Math.round(base + noise + spike)), readDay };
      },
    });
  }
  const all = [
    ...(includeScenarios ? Object.entries(SCENARIOS).map(([serial, s]) => ({ serial, ...s })) : []),
    ...background,
  ];
  const files = [];
  for (let d = 0; d < days; d++) {
    const exportAt = new Date(endDate.getTime() - (days - 1 - d) * DAY);
    const rows = [HEADER];
    for (const meter of all) {
      const point = meter.series(d, days);
      if (!point) continue;
      const readAt = new Date(endDate.getTime() - (days - 1 - point.readDay) * DAY);
      readAt.setHours(4, 0, 0, 0);
      // F and G are Kamstrup's own summary columns for the exported period.
      const values = [];
      for (let k = Math.max(0, d - 29); k <= d; k++) {
        const p = meter.series(k, days);
        const v = p && p.value !== "" ? Number(String(p.value).replace(",", ".")) : NaN;
        if (Number.isFinite(v)) values.push(v);
      }
      rows.push([
        meter.serial, meter.addressOverride || meter.address, meter.area, localStamp(readAt),
        point.value,
        values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : "",
        values.length ? Math.max(...values) : "",
        point.info || "", point.events || "", "",
      ]);
    }
    files.push({ name: `Filtrerade mätare ${fileStamp(exportAt)}.csv`, exportAt, rows });
  }
  return files;
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const text = String(cell ?? "");
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(";")).join("\n");
}

module.exports = { HEADER, SCENARIOS, buildDailyExports, toCsv };
