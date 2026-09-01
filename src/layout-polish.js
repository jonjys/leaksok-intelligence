(function applyLayoutPolish() {
  const compactBulkOptions = [
    ["manual_dispatch", "Akut / åk ut"],
    ["suspect", "Misstänk / bevaka"],
    ["leak", "Aktiv läcka"],
    ["customer_contact", "Efter mätare / kontakta FÄ"],
    ["repaired", "Lagad"],
    ["seasonal", "Störning / säsong / topp"],
    ["reset_baseline", "Nollställ och följ nya värden"],
    ["ignored", "Ignorera"],
  ];

  const listNames = {
    all: "Alla mätare",
    dispatch: "Åk ut",
    suspect_auto: "Misstänk",
    watch: "Bevaka",
    customer_side: "Efter mätare",
    confirmed: "Aktiva läckor",
    repaired: "Lagad",
  };

  function simplifyBulkSelect() {
    const select = document.getElementById("bulkType");
    if (!select || select.dataset.polished === "true") return;
    select.innerHTML = compactBulkOptions
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");
    select.dataset.polished = "true";
  }

  function polishListTabs() {
    document.querySelectorAll("#listTabs button[data-filter]").forEach((button) => {
      const filter = button.dataset.filter;
      const count = button.querySelector("b")?.textContent || "0";
      if (listNames[filter]) button.innerHTML = `${listNames[filter]} <b>${count}</b>`;
    });
    document.querySelectorAll('#listTabs button[data-filter="seasonal"], #listTabs button[data-filter="noise"], #listTabs button[data-filter="ignored"], #listTabs button[data-filter="stale_contact"], #listTabs button[data-filter="learning"]').forEach((button) => {
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
    Chart.defaults.borderColor = "rgba(100, 116, 139, .22)";
    Chart.defaults.elements.line.borderWidth = 3;
    Chart.defaults.elements.point.radius = 0;
    Chart.defaults.elements.point.hoverRadius = 4;
  }

  function polish() {
    simplifyBulkSelect();
    polishListTabs();
    moveInfoPanel();
    removeRowMoveTo();
    makeChartsClickable();
    patchChartDefaults();
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
