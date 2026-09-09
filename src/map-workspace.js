(function applyMapWorkspace() {
  const VIEW_KEY = "leaksok_workspace_view_v1";
  const MAP_FILTER_KEY = "leaksok_map_filter_v1";
  const MOBILE_FILTER_KEY = "leaksok_mobile_field_filter_v1";
  const DEFAULT_FILTER = "field";
  const MOBILE_BREAKPOINT = 760;
  let userPickedFilter = false;
  let ranInitialFilter = false;
  let renderTimer = 0;
  let geocodeBudget = 32;
  let geocodeBudgetReset = 0;
  let lastMobileState = window.innerWidth <= MOBILE_BREAKPOINT;
  let mobileDefaultsApplied = false;

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function savedView() {
    if (isMobile()) return "list";
    try { return localStorage.getItem(VIEW_KEY) || "map"; }
    catch { return "map"; }
  }

  function saveView(view) {
    if (isMobile()) return;
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
  }

  function savedFilter() {
    try { return localStorage.getItem(MAP_FILTER_KEY) || DEFAULT_FILTER; }
    catch { return DEFAULT_FILTER; }
  }

  function saveFilter(filter) {
    try { localStorage.setItem(MAP_FILTER_KEY, filter); } catch {}
  }

  function installGeocodeThrottle() {
    if (!window.fetch || window.fetch.leaksokMapThrottle) return;
    const nativeFetch = window.fetch.bind(window);
    const wrappedFetch = function throttledFetch(input, init) {
      const raw = typeof input === "string" ? input : input?.url || "";
      const isNominatim = /nominatim\.openstreetmap\.org\/search/i.test(raw);
      const hasSelection = Boolean(document.querySelector(".row-select:checked"));
      if (isNominatim && !hasSelection) {
        const now = Date.now();
        if (now > geocodeBudgetReset) {
          geocodeBudget = 32;
          geocodeBudgetReset = now + 9000;
        }
        geocodeBudget -= 1;
        if (geocodeBudget < 0) {
          return Promise.resolve(new Response("[]", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        }
      }
      return nativeFetch(input, init);
    };
    wrappedFetch.leaksokMapThrottle = true;
    window.fetch = wrappedFetch;
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
    syncWorkspaceLabels();
  }

  function syncWorkspaceLabels() {
    const mapButton = document.querySelector('#workspaceToggle [data-work-view="map"]');
    const listButton = document.querySelector('#workspaceToggle [data-work-view="list"]');
    const listLabel = isMobile() ? "Fält" : "Lista";
    if (mapButton && mapButton.textContent !== "Karta") mapButton.textContent = "Karta";
    if (listButton && listButton.textContent !== listLabel) listButton.textContent = listLabel;
  }

  function ensureMobileMapControls() {
    const controls = document.querySelector(".controls");
    if (controls && !document.getElementById("openMobileMap")) {
      const openButton = document.createElement("button");
      openButton.id = "openMobileMap";
      openButton.type = "button";
      openButton.className = "secondary mobile-map-open";
      openButton.textContent = "Visa karta";
      openButton.addEventListener("click", () => setWorkView("map", true));
      controls.appendChild(openButton);
    }

    const toolbar = document.querySelector(".map-toolbar");
    if (toolbar && !document.getElementById("closeMobileMap")) {
      const closeButton = document.createElement("button");
      closeButton.id = "closeMobileMap";
      closeButton.type = "button";
      closeButton.className = "secondary mobile-map-close";
      closeButton.textContent = "Visa lista";
      closeButton.addEventListener("click", () => setWorkView("list", true));
      toolbar.appendChild(closeButton);
    }
  }

  function setWorkView(view, persist) {
    const next = view === "list" ? "list" : "map";
    const viewChanged = document.body.dataset.workView !== next;
    document.body.dataset.workView = next;
    document.body.dataset.mobileMapOpen = String(isMobile() && next === "map");
    if (isMobile() && next === "map") {
      const preview = document.getElementById("meterPreview");
      if (preview) preview.dataset.mobileView = "map";
    }
    document.querySelectorAll("#workspaceToggle [data-work-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.workView === next);
      button.setAttribute("aria-pressed", String(button.dataset.workView === next));
    });
    if (persist) saveView(next);
    if (next === "map" && viewChanged) {
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

  function rememberMobileFieldFilter() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest?.("#listTabs button[data-filter]");
      if (!button || !isMobile()) return;
      try { localStorage.setItem(MOBILE_FILTER_KEY, button.dataset.filter || "dispatch"); } catch {}
    }, true);
  }

  function applyMobileFieldDefaults() {
    if (!isMobile() || mobileDefaultsApplied) return;
    mobileDefaultsApplied = true;
    const filter = document.getElementById("filter");
    const pageSize = document.getElementById("pageSize");
    let wanted = "dispatch";
    try { wanted = localStorage.getItem(MOBILE_FILTER_KEY) || wanted; } catch {}
    const validFilters = new Set(["all", "dispatch", "suspect", "hidden", "suspect_auto", "watch", "customer_side", "confirmed", "repaired", "seasonal", "noise", "ignored", "stale_contact", "learning"]);
    if (filter && validFilters.has(wanted)) filter.value = wanted;
    if (pageSize) pageSize.value = "25";
    if (typeof render === "function") render();
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
    const escaped = window.CSS?.escape ? CSS.escape(wanted) : wanted.replace(/"/g, "");
    const target = document.querySelector(`.map-category-controls button[data-map-filter="${escaped}"]`)
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
    installGeocodeThrottle();
    ensureWorkspaceToggle();
    ensureMobileMapControls();
    syncWorkspaceLabels();
    applyMobileFieldDefaults();
    setWorkView(document.body.dataset.workView || savedView(), false);
    forceLightMap();
    keepSuspectVisible();
    renameMapFilters();
    scheduleMapFilter(false);
  }

  installGeocodeThrottle();
  rememberMapFilterClicks();
  rememberMobileFieldFilter();
  document.addEventListener("DOMContentLoaded", polish);
  const observer = new MutationObserver(polish);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", () => {
    const mobile = isMobile();
    if (mobile === lastMobileState) return;
    lastMobileState = mobile;
    if (mobile) mobileDefaultsApplied = false;
    syncWorkspaceLabels();
    setWorkView(savedView(), false);
  });
  setTimeout(polish, 0);
}());

