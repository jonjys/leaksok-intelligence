(function applyOfficeDemo() {
  function numberFrom(text) {
    const match = String(text || "").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, value));
  }

  function decorateRows() {
    document.querySelectorAll("#rows tr").forEach((row) => {
      const decision = row.querySelector(".decision-cell");
      const score = decision?.querySelector(".score");
      if (score && !decision.querySelector(".ai-meter")) {
        const value = clamp(numberFrom(score.textContent));
        const meter = document.createElement("span");
        meter.className = `ai-meter${value >= 85 ? " hot" : ""}`;
        meter.style.setProperty("--ai", `${value}%`);
        meter.title = `AI-prioritet ${value}/100`;
        meter.innerHTML = "<span></span>";
        score.insertAdjacentElement("afterend", meter);
      }

      const metrics = row.querySelector(".metrics-cell");
      if (metrics && !metrics.querySelector(".office-signal")) {
        const text = metrics.textContent || "";
        const e = numberFrom(text.match(/E\s*-?\d+(?:[.,]\d+)?/i)?.[0]);
        const f = numberFrom(text.match(/F\s*-?\d+(?:[.,]\d+)?/i)?.[0]);
        const g = numberFrom(text.match(/G\s*-?\d+(?:[.,]\d+)?/i)?.[0]);
        const max = Math.max(e, f, g, 1);
        const signal = document.createElement("div");
        signal.className = "office-signal";
        signal.innerHTML = [
          ["E", e, "#199bd3"],
          ["F", f, "#64748b"],
          ["G", g, "#c72543"],
        ].map(([label, value, color]) => `
          <span class="office-bar"><b>${label}</b><i style="--w:${clamp((value / max) * 100)}%;--c:${color}"></i></span>
        `).join("");
        metrics.appendChild(signal);
      }
    });
  }

  function polishChart(chart) {
    if (!chart) return;
    chart.data.datasets.forEach((dataset) => {
      const label = String(dataset.label || "").toLowerCase();
      if (label.includes("brus") || label === "e") {
        dataset.borderColor = "#118ac3";
        dataset.backgroundColor = "rgba(17, 138, 195, .18)";
        dataset.borderWidth = 2.8;
        dataset.fill = true;
        dataset.tension = .16;
        dataset.pointRadius = 0;
        dataset.pointHoverRadius = 5;
      }
      if (label.includes("trend")) {
        dataset.borderColor = "#00796b";
        dataset.borderWidth = 3.4;
        dataset.fill = false;
        dataset.tension = .34;
        dataset.pointRadius = 0;
      }
      if (label.includes("snitt")) {
        dataset.borderColor = "#667085";
        dataset.borderWidth = 1.6;
        dataset.borderDash = [5, 5];
        dataset.fill = false;
        dataset.pointRadius = 0;
      }
      if (label.includes("max")) {
        dataset.borderColor = "#c72543";
        dataset.borderWidth = 1.4;
        dataset.borderDash = [2, 6];
        dataset.fill = false;
        dataset.hidden = chart.canvas?.id === "selectedChart" ? true : dataset.hidden;
      }
    });
    chart.options.plugins = chart.options.plugins || {};
    chart.options.plugins.tooltip = chart.options.plugins.tooltip || {};
    chart.options.plugins.tooltip.backgroundColor = "rgba(17, 24, 39, .92)";
    chart.options.plugins.tooltip.padding = 10;
    chart.options.plugins.tooltip.titleFont = { size: 12, weight: "800" };
    chart.options.plugins.tooltip.bodyFont = { size: 11, weight: "600" };
    chart.options.plugins.legend = chart.options.plugins.legend || {};
    chart.options.plugins.legend.labels = {
      ...(chart.options.plugins.legend.labels || {}),
      color: "#1f2937",
      padding: 8,
      usePointStyle: true,
      boxWidth: 9,
      font: { size: 11, weight: "800" },
    };
    chart.options.scales = chart.options.scales || {};
    chart.options.scales.x = chart.options.scales.x || {};
    chart.options.scales.y = chart.options.scales.y || {};
    chart.options.scales.x.border = { color: "rgba(100,116,139,.35)" };
    chart.options.scales.y.border = { color: "rgba(100,116,139,.35)" };
    chart.options.scales.x.grid = { color: "rgba(100,116,139,.13)", drawTicks: false };
    chart.options.scales.y.grid = { color: "rgba(100,116,139,.15)", drawTicks: false };
    chart.options.scales.x.ticks = { ...(chart.options.scales.x.ticks || {}), color: "#475569", font: { size: 10, weight: "700" }, maxRotation: 0 };
    chart.options.scales.y.ticks = { ...(chart.options.scales.y.ticks || {}), color: "#475569", font: { size: 10, weight: "700" } };
    chart.update("none");
  }

  function decorateCharts() {
    if (typeof state === "undefined") return;
    polishChart(state.previewChart);
    polishChart(state.chart);
  }

  function renamePresentationBits() {
    const importTitle = document.querySelector(".dropzone strong");
    if (importTitle) importTitle.textContent = "Excel in";
    const sort = document.getElementById("sort");
    if (sort && sort.options[0]) sort.options[0].textContent = "AI-prioritet";
    const bulkSave = document.getElementById("bulkSave");
    if (bulkSave && /^Flytta$/.test(bulkSave.textContent.trim())) bulkSave.textContent = "Spara";
  }

  function polish() {
    decorateRows();
    decorateCharts();
    renamePresentationBits();
  }

  const previousRender = window.render;
  if (typeof previousRender === "function" && previousRender.officeDemo !== "true") {
    window.render = function renderOfficeDemo() {
      previousRender();
      setTimeout(polish, 0);
    };
    window.render.officeDemo = "true";
  }

  document.addEventListener("DOMContentLoaded", polish);
  document.addEventListener("change", () => setTimeout(polish, 0), true);
  document.addEventListener("click", () => setTimeout(polish, 0), true);
  setInterval(polish, 1000);
  setTimeout(polish, 0);
}());
