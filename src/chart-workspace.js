(function applyChartWorkspace() {
  function installChartPlugin() {
    if (!window.Chart || Chart.registry.plugins.get("kamstrupWorkspaceBands")) return;
    Chart.register({
      id: "kamstrupWorkspaceBands",
      beforeDraw(chart) {
        if (!chart.chartArea || !chart.scales?.y) return;
        if (!["selectedChart", "detailChart"].includes(chart.canvas?.id)) return;
        const { ctx, chartArea, scales } = chart;
        const y = scales.y;
        const max = Math.max(120, y.max || 120);
        const zones = [
          [100, max, "rgba(244, 63, 94, .115)"],
          [50, 100, "rgba(20, 184, 166, .125)"],
          [0, 50, "rgba(241, 245, 249, .76)"],
        ];
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
        ctx.clip();
        zones.forEach(([from, to, color]) => {
          const top = y.getPixelForValue(Math.min(to, max));
          const bottom = y.getPixelForValue(Math.max(from, 0));
          ctx.fillStyle = color;
          ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
        });
        [50, 100].forEach((value) => {
          if (value < y.min || value > y.max) return;
          const py = y.getPixelForValue(value);
          ctx.strokeStyle = value === 100 ? "rgba(225, 29, 72, .38)" : "rgba(15, 118, 110, .28)";
          ctx.lineWidth = 1.25;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, py);
          ctx.lineTo(chartArea.right, py);
          ctx.stroke();
        });
        ctx.restore();
      },
    });
  }

  function styleChart(chart) {
    if (!chart || chart.$kamstrupWorkspaceStyled) return;
    chart.$kamstrupWorkspaceStyled = true;
    chart.data.datasets.forEach((dataset, index) => {
      if (index === 0 || /brus|ljud|e/i.test(dataset.label || "")) {
        Object.assign(dataset, {
          borderColor: "#199bd3",
          backgroundColor: "rgba(25, 155, 211, .15)",
          borderWidth: 2.6,
          fill: true,
          tension: .18,
          pointRadius: 0,
          pointHoverRadius: 5,
        });
      } else if (/trend/i.test(dataset.label || "") || index === 1) {
        Object.assign(dataset, {
          borderColor: "#078b77",
          backgroundColor: "transparent",
          borderWidth: 3.2,
          fill: false,
          tension: .32,
          pointRadius: 0,
        });
      } else if (/snitt|f/i.test(dataset.label || "")) {
        Object.assign(dataset, {
          borderColor: "#64748b",
          borderWidth: 1.7,
          borderDash: [5, 4],
          fill: false,
          pointRadius: 0,
        });
      } else if (/max|g/i.test(dataset.label || "")) {
        Object.assign(dataset, {
          borderColor: "#e11d48",
          borderWidth: 1.5,
          borderDash: [2, 5],
          fill: false,
          pointRadius: 0,
        });
      }
    });
    chart.options.animation = { duration: 120 };
    chart.options.responsive = true;
    chart.options.maintainAspectRatio = false;
    chart.options.interaction = { intersect: false, mode: "index" };
    chart.options.plugins = chart.options.plugins || {};
    chart.options.plugins.legend = chart.options.plugins.legend || {};
    chart.options.plugins.legend.position = "top";
    chart.options.plugins.legend.labels = {
      ...(chart.options.plugins.legend.labels || {}),
      boxWidth: 10,
      boxHeight: 10,
      usePointStyle: true,
      color: "#334155",
      padding: 10,
      font: { size: 11, weight: "700" },
    };
    chart.options.scales = chart.options.scales || {};
    chart.options.scales.x = chart.options.scales.x || {};
    chart.options.scales.y = chart.options.scales.y || {};
    chart.options.scales.x.grid = { ...(chart.options.scales.x.grid || {}), color: "rgba(100, 116, 139, .16)", drawTicks: false };
    chart.options.scales.y.grid = { ...(chart.options.scales.y.grid || {}), color: "rgba(100, 116, 139, .16)", drawTicks: false };
    chart.options.scales.x.ticks = { ...(chart.options.scales.x.ticks || {}), color: "#475569", maxRotation: 0, minRotation: 0, font: { size: 10 } };
    chart.options.scales.y.ticks = { ...(chart.options.scales.y.ticks || {}), color: "#475569", font: { size: 10 }, padding: 6 };
    chart.update("none");
  }

  function styleExistingCharts() {
    installChartPlugin();
    if (typeof state !== "undefined") {
      styleChart(state.previewChart);
      styleChart(state.chart);
    }
  }

  const originalRender = window.render;
  if (typeof originalRender === "function" && originalRender.chartWorkspace !== "true") {
    window.render = function renderWithChartWorkspace() {
      originalRender();
      setTimeout(styleExistingCharts, 0);
    };
    window.render.chartWorkspace = "true";
  }

  document.addEventListener("click", (event) => {
    if (event.target?.id === "selectedChart") setTimeout(styleExistingCharts, 0);
  });
  document.addEventListener("DOMContentLoaded", styleExistingCharts);
  setTimeout(styleExistingCharts, 0);
  setInterval(styleExistingCharts, 900);
}());
