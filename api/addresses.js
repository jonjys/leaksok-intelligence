/* Public address data only. This endpoint never accepts meter addresses,
   serial numbers, measurements or caller-selected upstream queries. */
const BASE = "https://karta.botkyrka.se/spatialmap";
const DAY = 86400000;
let snapshot, pending;

async function download(fetcher = fetch) {
  const signal = AbortSignal.timeout(45000);
  const page = await fetcher(`${BASE}?page=content`, { signal });
  if (!page.ok) throw Error("Public map unavailable");
  const html = await page.text();
  const session = html.match(/sessionStorage\.setItem\("spatialmapSessionId",\s*'([^']+)'/)[1];
  const params = new URLSearchParams({
    page: "spatialserver.datasource.executesmql", datasource: "ds_fb_adressnummer_sok",
    expression: "select beladress,adressplats,postnr,postort,xkoord,ykoord from ds_fb_adressnummer_sok command read",
    outputformat: "json", jsonformat: "compact",
  });
  const response = await fetcher(`${BASE}?${params}`, {
    signal, headers: { Accept: "application/json", "Session-Id": session },
  });
  if (!response.ok) throw Error("Public addresses unavailable");
  const data = await response.json();
  if (!Array.isArray(data) || data.length < 1000 || data.length > 100000) throw Error("Unexpected address data");
  const rows = data.filter(r => typeof r.beladress === "string" && typeof r.adressplats === "string" &&
    r.beladress.endsWith(` ${r.adressplats}`) && Number.isFinite(r.xkoord) && Number.isFinite(r.ykoord)).map(r => [
    r.beladress.slice(0, -r.adressplats.length).trim(), r.adressplats, String(r.postnr || "").replace(/\s/g, ""), String(r.postort || ""),
    Math.round(r.xkoord * 100) / 100, Math.round(r.ykoord * 100) / 100,
  ]);
  if (rows.length < 1000) throw Error("Incomplete address data");
  return { version: 1, source: "Botkyrka kommuns publika webbkarta", sourceUrl: "https://karta.botkyrka.se/",
    crs: "EPSG:3011", fetchedAt: new Date().toISOString(), rows };
}

module.exports = async function addresses(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
  // Reject query parameters instead of ever forwarding private input upstream.
  if (new URL(req.url, "https://localhost").search) return res.status(400).json({ error: "Inga sökparametrar accepteras." });
  try {
    if (!snapshot || Date.now() - snapshot.at > DAY) {
      if (!pending) pending = download().then(data => { snapshot = { at: Date.now(), data }; }).finally(() => { pending = null; });
      await pending;
    }
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).json(snapshot.data);
  } catch {
    // Keep the last good table through a temporary municipal outage.
    if (snapshot && Date.now() - snapshot.at < 7 * DAY) {
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
      return res.status(200).json({ ...snapshot.data, stale: true });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "Adressregistret kunde inte hämtas. Försök igen senare." });
  }
};
module.exports.download = download;
