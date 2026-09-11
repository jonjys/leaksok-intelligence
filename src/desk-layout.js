(function deskKamstrupLayout() {
  function apply() {
    if (!window.matchMedia("(min-width: 1100px)").matches) return;
    const column = document.querySelector(".content-column");
    const preview = document.getElementById("meterPreview");
    const chart = preview && preview.querySelector(".preview-chart");
    if (!column || !preview || !chart || column.querySelector(".desk-right")) return;

    const right = document.createElement("div");
    right.className = "desk-right";
    const controls = column.querySelector(".controls");
    const bulk = column.querySelector(".bulk-actions");
    const workspace = column.querySelector(".workspace");
    right.appendChild(chart);
    if (controls) right.appendChild(controls);
    if (bulk) right.appendChild(bulk);
    if (workspace) right.appendChild(workspace);
    preview.after(right);
    column.classList.add("desk-split");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
  setTimeout(apply, 0);
})();

(function fieldControls() {
  function currentPageRows() {
    return [...document.querySelectorAll("#rows tr[data-meter-row]")].map((row) => ({
      id: row.dataset.meterRow,
      input: row.querySelector(".row-select"),
    })).filter((row) => row.id && row.input);
  }

  function selectVisiblePage() {
    const rows = currentPageRows();
    if (!rows.length) return;
    const turnOff = rows.every((row) => row.input.checked);
    const previousRender = typeof render === "function" ? render : null;
    if (previousRender) render = function silentRender() {};
    rows.forEach((row) => {
      if (Boolean(row.input.checked) === !turnOff) return;
      row.input.checked = !turnOff;
      row.input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (previousRender) {
      render = previousRender;
      previousRender();
    }
    labelSelectButton();
  }

  function labelSelectButton() {
    const button = document.getElementById("selectAllMatches");
    if (!button) return;
    const size = document.getElementById("pageSize")?.value || "50";
    const rows = currentPageRows();
    const selected = rows.filter((row) => row.input.checked).length;
    const label = selected && selected === rows.length
      ? "Avmarkera sida (" + selected + ")"
      : "Markera sida (" + size + ")";
    // Setting the same text still mutates the DOM and retriggers our observer.
    if (button.textContent !== label) button.textContent = label;
  }

  function ensureHideOptions() {
    const select = document.getElementById("excludeFilter");
    if (!select) return;
    const add = (value, label) => {
      if ([...select.options].some((option) => option.value === value)) return;
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    };
    add("customer_side", "Göm Efter mätare");
    add("stale_contact", "Göm DRY / utan avläsning");
  }

  function interceptSelectAll(event) {
    const pageButton = event.target.closest && event.target.closest("#selectAllMatches");
    const headerSelect = event.target.closest && event.target.closest('button[data-sort-table="select"]');
    if (!pageButton && !headerSelect) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectVisiblePage();
  }

  document.addEventListener("click", interceptSelectAll, true);
  const observer = new MutationObserver(() => {
    ensureHideOptions();
    labelSelectButton();
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  ensureHideOptions();
  labelSelectButton();
})();
