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
    button.textContent = selected && selected === rows.length
      ? "Avmarkera sida (" + selected + ")"
      : "Markera sida (" + size + ")";
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
