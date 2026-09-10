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

  function replaceDashedGaps(svg) {
    const connectors = [...svg.querySelectorAll(".signal-gap-connector")];
    if (!connectors.length) return;
    const height = Number(svg.viewBox?.baseVal?.height) || svg.getBoundingClientRect().height || 180;
    const top = 16;
    const plotHeight = Math.max(40, height - 46);
    connectors.forEach((path) => {
      const numbers = String(path.getAttribute("d") || "").match(/-?\d+(?:\.\d+)?/g);
      if (!numbers || numbers.length < 4) {
        path.remove();
        return;
      }
      const x1 = Number(numbers[0]);
      const x2 = Number(numbers[2]);
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(Math.min(x1, x2)));
      rect.setAttribute("y", String(top));
      rect.setAttribute("width", String(Math.max(0, Math.abs(x2 - x1)));
      rect.setAttribute("height", String(plotHeight));
      rect.setAttribute("fill", "#f1f4f7");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = "Ingen avläsning i underlaget";
      rect.appendChild(title);
      path.replaceWith(rect);
    });
  }

  function polish() {
    ensureExcelCompareOption();
    document.querySelectorAll(".signal-chart-stage svg").forEach(replaceDashedGaps);
  }

  const observer = new MutationObserver(() => polish());
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", polish);
  setTimeout(polish, 0);
})();
