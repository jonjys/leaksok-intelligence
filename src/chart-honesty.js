(function honestLeakCharts() {
  function ensureExcelCompareOption() {
    document.querySelectorAll(".signal-comparison-period").forEach((select) => {
      if ([...select.options].some((option) => option.value === "export")) return;
      const option = document.createElement("option");
      option.value = "export";
      option.textContent = "Föregående Excel";
      const after = select.options[0];
      if (after && after.nextSibling) select.insertBefore(option, after.nextSibling);
      else select.appendChild(option);
    });
  }

  function cleanGaps(svg) {
    svg.querySelectorAll(".signal-gap-connector").forEach((node) => node.remove());
    svg.querySelectorAll(".signal-gap-label").forEach((node) => node.remove());
    [...svg.querySelectorAll("rect")].forEach((rect) => {
      const fill = String(rect.getAttribute("fill") || "").toLowerCase();
      if (fill === "#f1f4f7" || fill === "#eef3f7" || fill === "#f8fafc") rect.remove();
    });
  }

  function polish() {
    ensureExcelCompareOption();
    document.querySelectorAll(".signal-chart-stage svg").forEach(cleanGaps);
  }

  const observer = new MutationObserver(() => polish());
  function start() {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    polish();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
