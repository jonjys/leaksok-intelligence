(function applyLayoutPolish() {
  const compactBulkOptions = [
    ["manual_dispatch", "Akut / åk ut"],
    ["suspect", "Misstänk / bevaka"],
    ["leak", "Aktiv läcka"],
    ["customer_contact", "Efter mätare / kontakta FÄ"],
    ["repaired", "Lagad / klar"],
    ["known_noise", "Störning / säsong / topp"],
    ["reset_baseline", "Nollställ och följ nya värden"],
    ["ignored", "Ignorera"],
  ];

  const listNames = {
    all: "Alla mätare",
    dispatch: "Åk ut",
    suspect_auto: "Misstänk / bevaka",
    customer_side: "Efter mätare",
    confirmed: "Aktiva läckor",
    repaired: "Lagad",
  };

  function optionHtml() {
    return compactBulkOptions
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");
  }

  function simplifyBulkSelect() {
    const select = document.getElementById("bulkType");
    if (!select) return;
    const wanted = optionHtml();
    if (select.dataset.polished !== "true" || select.innerHTML !== wanted) {
      select.innerHTML = wanted;
      select.dataset.polished = "true";
    }
  }

  function polishListTabs() {
    document.querySelectorAll("#listTabs button[data-filter]").forEach((button) => {
      const filter = button.dataset.filter;
      const count = button.querySelector("b")?.textContent || "0";
      if (listNames[filter]) button.innerHTML = `${listNames[filter]} <b>${count}</b>`;
    });
    document.querySelectorAll('#listTabs button[data-filter="watch"], #listTabs button[data-filter="seasonal"], #listTabs button[data-filter="noise"], #listTabs button[data-filter="ignored"], #listTabs button[data-filter="stale_contact"], #listTabs button[data-filter="learning"]').forEach((button) => {
      button.hidden = true;
    });
    const more = document.getElementById("moreLists");
    if (more) {
      more.open = false;
      const summary = more.querySelector("summary");
      if (summary) summary.innerHTML = "Info / fler listor";
    }
  }

  function moveInfoPanel() {
    const rail = document.querySelector(".left-rail");
    const panel = document.querySelector(".panel");
    if (!rail || !panel || document.querySelector(".info-drawer")) return;
    const drawer = document.createElement("details");
    drawer.className = "info-drawer";
    drawer.innerHTML = `
      <summary>Info</summary>
      <div class="info-drawer-content">${panel.innerHTML}</div>
    `;
    rail.appendChild(drawer);
  }

  function removeRowMoveTo() {
    document.querySelectorAll(".feedback-cell").forEach((cell) => {
      cell.hidden = true;
    });
  }

  function makeChartsClickable() {
    const preview = document.getElementById("selectedChart");
    if (preview && preview.dataset.zoomReady !== "true") {
      preview.dataset.zoomReady = "true";
      preview.title = "Klicka för större graf";
      preview.addEventListener("click", () => {
        const firstChecked = document.querySelector(".row-select:checked");
        const firstRowButton = firstChecked?.closest("tr")?.querySelector(".spark");
        if (firstRowButton) firstRowButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
  }

  function patchChartDefaults() {
    if (!window.Chart || window.Chart.defaults.datasetPolished) return;
    Chart.defaults.datasetPolished = true;
    Chart.defaults.color = "#334155";
    Chart.defaults.borderColor = "rgba(100, 116, 139, .16)";
    Chart.defaults.animation.duration = 180;
    Chart.defaults.elements.line.borderWidth = 2.4;
    Chart.defaults.elements.point.radius = 0;
    Chart.defaults.elements.point.hoverRadius = 5;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    registerSmartChartPlugin();
  }

  function ensureMapModeButton() {
    const actions = document.querySelector(".preview-actions");
    const preview = document.getElementById("meterPreview");
    if (!actions || !preview || document.getElementById("focusMapMode")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "focusMapMode";
    button.className = "secondary";
    button.textContent = "Karta-läge";
    button.addEventListener("click", () => {
      preview.classList.toggle("map-focus");
      button.classList.toggle("active", preview.classList.contains("map-focus"));
      button.textContent = preview.classList.contains("map-focus") ? "Lista-läge" : "Karta-läge";
      setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    });
    actions.prepend(button);
  }

  function ensureContextMenu() {
    if (document.getElementById("moveContextMenu")) return;
    const menu = document.createElement("div");
    menu.id = "moveContextMenu";
    menu.className = "move-context-menu";
    menu.hidden = true;
    menu.innerHTML = `
      <b>Flytta markerade</b>
      ${compactBulkOptions.map(([value, label]) => `<button type="button" data-move="${value}">${label}</button>`).join("")}
    `;
    document.body.appendChild(menu);
    menu.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-move]");
      if (!button) return;
      const bulk = document.getElementById("bulkType");
      const save = document.getElementById("bulkSave");
      if (bulk && save) {
        bulk.value = button.dataset.move;
        save.click();
      }
      hideContextMenu();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#moveContextMenu")) hideContextMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideContextMenu();
    });
    document.addEventListener("contextmenu", (event) => {
      const row = event.target.closest("#rows tr");
      const checkbox = row?.querySelector(".row-select");
      if (!checkbox) return;
      event.preventDefault();
      if (!checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
      showContextMenu(event.clientX, event.clientY);
    });
  }

  function showContextMenu(x, y) {
    const menu = document.getElementById("moveContextMenu");
    if (!menu) return;
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 10);
    const top = Math.min(y, window.innerHeight - rect.height - 10);
    menu.style.left = `${Math.max(10, left)}px`;
    menu.style.top = `${Math.max(10, top)}px`;
  }

  function hideContextMenu() {
    const menu = document.getElementById("moveContextMenu");
    if (menu) menu.hidden = true;
  }

  function makeRowsSelectOnClick() {
    document.querySelectorAll("#rows tr").forEach((row) => {
      if (row.dataset.rowClickReady === "true") return;
      const checkbox = row.querySelector(".row-select");
      if (!checkbox) return;
      row.dataset.rowClickReady = "true";
      row.addEventListener("dblclick", (event) => {
        if (event.target.closest("button, select, input, a")) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }

  function simplifySortSelect() {
    const select = document.getElementById("sort");
    if (!select || select.dataset.smartSort === "true") return;
    const current = select.value;
    select.innerHTML = [
      ["risk", "Motorprioritet"],
      ["persistence", "Beständig längst"],
      ["robustRise", "Robust ökning"],
      ["current", "Senaste värde"],
      ["confidence", "Säkerhet"],
    ].map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    select.value = [...select.options].some((option) => option.value === current) ? current : "risk";
    select.dataset.smartSort = "true";
  }

  function registerSmartChartPlugin() {
    if (!window.Chart || Chart.registry.plugins.get("leakEvidenceBands")) return;
    Chart.register({
      id: "leakEvidenceBands",
      beforeDraw(chart) {
        if (!["selectedChart", "detailChart"].includes(chart.canvas?.id)) return;
        const area = chart.chartArea;
        const y = chart.scales?.y;
        if (!area || !y) return;
        const { ctx } = chart;
        const zones = [
          [0, 50, "rgba(14, 165, 164, .075)"],
          [50, 100, "rgba(245, 158, 11, .075)"],
          [100, Math.max(100, y.max), "rgba(225, 29, 72, .075)"],
        ];
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
        ctx.clip();
        zones.forEach(([from, to, color]) => {
          if (from >= y.max || to <= y.min) return;
          const top = y.getPixelForValue(Math.min(to, y.max));
          const bottom = y.getPixelForValue(Math.max(from, y.min));
          ctx.fillStyle = color;
          ctx.fillRect(area.left, top, area.right - area.left, bottom - top);
        });
        ctx.restore();
      },
      afterDraw(chart) {
        if (!["selectedChart", "detailChart"].includes(chart.canvas?.id)) return;
        const active = chart.tooltip?.getActiveElements?.()?.[0];
        if (!active || !chart.chartArea) return;
        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.strokeStyle = "rgba(15, 23, 42, .32)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(active.element.x, chartArea.top);
        ctx.lineTo(active.element.x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
      },
    });
  }

  function styleChart(chart) {
    if (!chart || chart.$smartStyled) return;
    chart.$smartStyled = true;
    const colors = [
      { border: "#147dcc", background: "rgba(20, 125, 204, .10)", width: 2.2 },
      { border: "#078b77", background: "transparent", width: 3 },
      { border: "#64748b", background: "transparent", width: 1.6 },
      { border: "#dc5264", background: "transparent", width: 1.5 },
      { border: "#94a3b8", background: "transparent", width: 1.6 },
    ];
    chart.data.datasets.forEach((dataset, index) => {
      const palette = colors[index] || colors[0];
      dataset.borderColor = palette.border;
      dataset.backgroundColor = palette.background;
      dataset.borderWidth = palette.width;
      dataset.pointBackgroundColor = palette.border;
      dataset.pointBorderColor = "#ffffff";
      dataset.pointBorderWidth = 1.5;
      dataset.fill = index === 0;
    });
    chart.options.animation = { duration: 180 };
    chart.options.interaction = { intersect: false, mode: "index" };
    chart.options.plugins.legend.labels = {
      ...(chart.options.plugins.legend.labels || {}),
      color: "#334155",
      usePointStyle: true,
      padding: 14,
    };
    chart.options.scales.x.ticks.color = "#64748b";
    chart.options.scales.y.ticks.color = "#64748b";
    chart.options.scales.x.grid.color = "rgba(100, 116, 139, .10)";
    chart.options.scales.y.grid.color = "rgba(100, 116, 139, .14)";
    chart.update("none");
  }

  function decorateCharts() {
    if (!window.Chart) return;
    styleChart(typeof state !== "undefined" ? state.previewChart : null);
    styleChart(typeof state !== "undefined" ? state.chart : null);
  }

  function previewMeter() {
    if (typeof state === "undefined") return null;
    const title = document.getElementById("previewTitle")?.textContent?.trim();
    const byTitle = state.meters.find((meter) => (meter.address || meter.id) === title);
    if (byTitle) return byTitle;
    const checked = document.querySelector(".row-select:checked")?.dataset.id;
    return state.meters.find((meter) => meter.id === checked) || null;
  }

  function renderEngineKpis() {
    const preview = document.getElementById("meterPreview");
    const head = preview?.querySelector(".preview-head");
    if (!preview || !head) return;
    let strip = preview.querySelector(".preview-kpis");
    if (!strip) {
      strip = document.createElement("div");
      strip.className = "preview-kpis";
      head.insertAdjacentElement("afterend", strip);
    }
    const meter = previewMeter();
    if (!meter?.engine) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    const engine = meter.engine;
    const rise = Math.round((engine.relativeRise || 0) * 100);
    const values = [
      ["Motor", meter.risk],
      ["Bas", Math.round(engine.baseline || 0)],
      ["Nu", Math.round(engine.recentLevel || 0)],
      ["Ökning", `${rise > 0 ? "+" : ""}${rise}%`],
      ["Beständig", engine.sustained ? `${engine.persistenceDays} d` : `${engine.trailingElevated || 0} st`],
    ];
    strip.innerHTML = values.map(([label, value]) => `<span><small>${label}</small><b>${value}</b></span>`).join("");
    strip.classList.toggle("is-alert", meter.category === "dispatch");
  }

  function compactRowReasons() {
    document.querySelectorAll("#rows tr").forEach((row) => {
      const reasons = row.querySelectorAll(".reason-cell li");
      reasons.forEach((reason, index) => { reason.hidden = index > 2; });
      row.tabIndex = 0;
    });
  }

  function polish() {
    simplifyBulkSelect();
    simplifySortSelect();
    polishListTabs();
    moveInfoPanel();
    removeRowMoveTo();
    makeChartsClickable();
    patchChartDefaults();
    ensureMapModeButton();
    ensureContextMenu();
    makeRowsSelectOnClick();
    renderEngineKpis();
    compactRowReasons();
    setTimeout(decorateCharts, 0);
  }

  const originalRender = window.render;
  if (typeof originalRender === "function" && originalRender.datasetPolished !== "true") {
    window.render = function renderPolished() {
      originalRender();
      polish();
    };
    window.render.datasetPolished = "true";
  }

  document.addEventListener("change", (event) => {
    if (event.target?.classList?.contains("row-select")) setTimeout(polish, 0);
  });
  document.addEventListener("DOMContentLoaded", polish);
  setTimeout(polish, 0);
})();
