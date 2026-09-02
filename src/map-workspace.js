(function applyMapWorkspace() {
  const VIEW_KEY = "leaksok_workspace_view_v1";
  const MAP_FILTER_KEY = "leaksok_map_filter_v1";
  const DEFAULT_FILTER = "field";
  let userPickedFilter = false;
  let ranInitialFilter = false;
  let renderTimer = 0;

  function savedView() {
    try { return localStorage.getItem(VIEW_KEY) || "map"; }
    catch { return "map"; }
  }

  function saveView(view) {
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
  }

  function savedFilter() {
    try { return localStorage.getItem(MAP_FILTER_KEY) || DEFAULT_FILTER; }
    catch { return DEFAULT_FILTER; }
  }

  function saveFilter(filter) {
    try { localStorage.setItem(MAP_FILTER_KEY, filter); } catch {}
  }

  function ensureWorkspaceToggle() {
    if (document.getElementById("workspaceToggle")) return;
    const actions = document.querySelector(".topbar .actions");
    if (!actions) return;
    const toggle = document.createElement("div");
    toggle.id = "workspaceToggle";
    toggle.className = "workspace-toggle";
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", "Vy");
    toggle.innerHTML = `
      <button type="button" data-work-view="map">Karta</button>
      <button type="button" data-work-view="list">Lista</button>
    `;
    actions.prepend(toggle);
    toggle.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-work-view]");
      if (!button) return;
      setWorkView(button.dataset.workView, true);
    });
  }

  function setWorkView(view, persist) {
    const next = view === "list" ? "list" : "map";
    document.body.dataset.workView = next;
    document.querySelectorAll("#workspaceToggle [data-work-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.workView === next);
      button.setAttribute("aria-pressed", String(button.dataset.workView === next));
    });
    if (persist) saveView(next);
    if (next === "map") {
      setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
      scheduleMapFilter(false);
    }
  }

  function forceLightMap() {
    const street = document.getElementById("streetMap");
    const satellite = document.getElementById("satelliteMap");
    if (street && !street.classList.contains("active")) street.click();
    if (satellite) {
      satellite.hidden = true;
      satellite.setAttribute("aria-hidden", "true");
      satellite.tabIndex = -1;
    }
  }

  function rememberMapFilterClicks() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-map-filter]");
      if (!button) return;
      userPickedFilter = true;
      saveFilter(button.dataset.mapFilter || DEFAULT_FILTER);
    }, true);
  }

  function scheduleMapFilter(force) {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => applyMapFilter(force), 80);
  }

  function applyMapFilter(force) {
    renderTimer = 0;
    if (document.body.dataset.workView === "list") return;
    const wanted = savedFilter();
    const active = document.querySelector(".map-category-controls button.active[data-map-filter]");
    const target = document.querySelector(`.map-category-controls button[data-map-filter="${CSS.escape(wanted)}"]`)
      || document.querySelector(`.map-category-controls button[data-map-filter="${DEFAULT_FILTER}"]`);
    if (!target) return;
    if (!force && ranInitialFilter && (userPickedFilter || active?.dataset.mapFilter === target.dataset.mapFilter)) return;
    if (!force && active?.dataset.mapFilter === "all" && userPickedFilter) return;
    ranInitialFilter = true;
    if (active !== target) target.click();
  }

  function keepSuspectVisible() {
    const tab = document.querySelector('#listTabs button[data-filter="suspect_auto"]');
    if (!tab) return;
    tab.hidden = false;
    tab.style.display = "flex";
    const count = tab.querySelector("b")?.textContent || "0";
    if (!/Misstänk/.test(tab.textContent)) tab.innerHTML = `Misstänk / bevaka <b>${count}</b>`;
  }

  function renameMapFilters() {
    const labels = {
      field: "Fält",
      dispatch: "Åk ut",
      suspect: "Misstänk/bevaka",
      confirmed: "Aktiva läckor",
      customer_side: "Efter mätare",
      all: "Alla",
    };
    document.querySelectorAll(".map-category-controls button[data-map-filter]").forEach((button) => {
      const label = labels[button.dataset.mapFilter];
      if (label && button.textContent.trim() !== label) button.textContent = label;
    });
  }

  function polish() {
    ensureWorkspaceToggle();
    setWorkView(document.body.dataset.workView || savedView(), false);
    forceLightMap();
    keepSuspectVisible();
    renameMapFilters();
    scheduleMapFilter(false);
  }

  rememberMapFilterClicks();
  document.addEventListener("DOMContentLoaded", polish);
  const observer = new MutationObserver(polish);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(polish, 0);
}());
