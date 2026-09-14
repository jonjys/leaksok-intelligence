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

