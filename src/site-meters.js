(function siteMeters(root) {
  function siteKey(address) {
    const cleaned = String(address || "").toUpperCase().replace(/\b\d{5}\b/g, "").replace(/\s+/g, " ").trim();
    const match = cleaned.match(/^(.+?\b\d+)\b/);
    return match ? match[1] : cleaned;
  }

  function looksMultiUnit(address) {
    const text = String(address || "").toUpperCase();
    return /\b\d+\s*[-–]\s*\d+\b/.test(text)
      || /\b\d+\s*[A-H]\s*[-–]\s*[A-H]\b/.test(text)
      || /HÖGHUS|LGH|LÄGENHET|UPPG/.test(text);
  }

  function isSilent(meter) {
    const points = Array.isArray(meter.points) ? meter.points : [];
    if (points.length === 0) return true;
    const latest = points[points.length - 1];
    if (!latest || latest.current == null || latest.current === "" || latest.readAtUnknown) return true;
    const value = Number(latest.current);
    return !Number.isFinite(value);
  }

  function isLive(meter) {
    return !isSilent(meter) && !meter.staleContact;
  }

  function attachSites(meters) {
    const groups = new Map();
    for (const meter of meters) {
      const key = siteKey(meter.address);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(meter);
    }
    for (const [place, group] of groups) {
      const live = group.filter(isLive);
      const silent = group.filter((meter) => !live.includes(meter));
      const multi = group.length > 1 || group.some((meter) => looksMultiUnit(meter.address));
      for (const meter of group) {
        meter.site = {
          place,
          multi,
          meterCount: group.length,
          liveCount: live.length,
          silentCount: silent.length,
          serials: group.map((item) => item.serial || item.id),
          liveSerials: live.map((item) => item.serial || item.id),
          silentSerials: silent.map((item) => item.serial || item.id),
          incompleteExcel: multi && group.length === 1,
          siblingSilent: silent.length > 0 && live.length > 0,
        };
      }
    }
  }

  function applySiteRank(meter) {
    const site = meter.site;
    if (!site) return meter;
    const reasons = Array.isArray(meter.reasons) ? [...meter.reasons] : [];
    if (site.meterCount > 1) {
      reasons.unshift(site.meterCount + " mätare på samma adress (" + site.liveCount + " med data" + (site.silentCount ? ", " + site.silentCount + " tysta" : "") + ")");
    } else if (site.incompleteExcel) {
      reasons.unshift("Flerbostad/adressintervall i Excel, men bara en mätare importerades");
    }
    if (site.siblingSilent && isSilent(meter) && !meter.label?.type) {
      return Object.assign({}, meter, {
        category: "stale_contact",
        risk: Math.min(meter.risk || 0, 12),
        confidence: "låg",
        reasons: ["Ingen avläsning på " + (meter.serial || meter.id) + ". Syskon " + site.liveSerials.join(", ") + " har data."].concat(reasons).slice(0, 8),
      });
    }
    if (site.siblingSilent && isLive(meter)) {
      reasons.push("Tyst syskonmätare: " + site.silentSerials.join(", "));
    }
    return Object.assign({}, meter, { reasons: [...new Set(reasons)].slice(0, 8) });
  }

  function decoratePreview() {
    const title = document.getElementById("previewTitle") && document.getElementById("previewTitle").textContent.trim();
    const meta = document.getElementById("previewMeta");
    if (!title || !meta || typeof state === "undefined") return;
    const meter = state.meters.find((item) => (item.address || item.id) === title);
    const site = meter && meter.site;
    if (!site || (!site.multi && site.meterCount < 2)) return;
    if (meta.textContent.includes("mätare på adressen")) return;
    meta.dataset.siteNote = meter.id;
    const extra = site.meterCount > 1
      ? site.meterCount + " mätare på adressen · " + site.liveCount + " med data" + (site.silentCount ? " · " + site.silentCount + " utan avläsning" : "")
      : "Adressintervall: Excel kan sakna syskonmätare";
    meta.textContent = meta.textContent + " · " + extra;
  }

  (window.LeakAnalysisSteps ||= []).push(() => {
    attachSites(state.meters);
    state.meters = state.meters.map(applySiteRank);
  });
  if (typeof state !== "undefined" && Array.isArray(state.meters) && state.meters.length) {
    attachSites(state.meters);
    state.meters = state.meters.map(applySiteRank);
  }
  document.addEventListener("DOMContentLoaded", decoratePreview);
  const originalRender = window.render;
  if (typeof originalRender === "function" && !originalRender.__siteDecorated) {
    window.render = function renderWithSite() {
      originalRender();
      decoratePreview();
    };
    window.render.__siteDecorated = true;
  }
  setTimeout(decoratePreview, 0);
  root.LeakSiteMeters = { siteKey, attachSites, applySiteRank };
}(typeof globalThis !== "undefined" ? globalThis : this));
