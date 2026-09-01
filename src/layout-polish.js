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
    suspect_auto: "Misstänk",
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
    Chart.defaults.borderColor = "rgba(100, 116, 139, .20)";
    Chart.defaults.elements.line.borderWidth = 3;
    Chart.defaults.elements.point.radius = 0;
    Chart.defaults.elements.point.hoverRadius = 4;
    Chart.defaults.plugins.legend.labels.boxWidth = 11;
    Chart.defaults.plugins.legend.labels.boxHeight = 11;
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

  function polish() {
    simplifyBulkSelect();
    polishListTabs();
    moveInfoPanel();
    removeRowMoveTo();
    makeChartsClickable();
    patchChartDefaults();
    ensureMapModeButton();
    ensureContextMenu();
    makeRowsSelectOnClick();
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
