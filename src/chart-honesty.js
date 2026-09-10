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

  function connectVacationGaps(svg) {
    svg.querySelectorAll(".signal-gap-connector, .signal-gap-label").forEach((node) => node.remove());
    [...svg.querySelectorAll("rect")].forEach((rect) => {
      const fill = String(rect.getAttribute("fill") || "").toLowerCase();
      if (fill === "#f1f4f7" || fill === "#eef3f7" || fill === "#f8fafc") rect.remove();
    });

    const lines = [...svg.querySelectorAll("path.signal-line.current")];
    if (lines.length > 1) {
      const d = lines.map((path, index) => {
        const raw = String(path.getAttribute("d") || "").trim();
        return index && raw.charAt(0) === "M" ? ("L" + raw.slice(1)) : raw;
      }).filter(Boolean).join(" ");
      lines[0].setAttribute("d", d);
      lines.slice(1).forEach((path) => path.remove());
    }

    const fills = [...svg.querySelectorAll('path[fill^="url(#signal-fill"]')];
    if (fills.length > 1) fills.slice(1).forEach((path) => path.remove());
    if (fills[0] && lines[0]) {
      const line = String(lines[0].getAttribute("d") || "");
      const nums = line.match(/-?\d+(?:\.\d+)?/g) || [];
      if (nums.length >= 4) {
        const firstX = nums[0];
        const lastX = nums[nums.length - 2];
        const lastY = nums[nums.length - 1];
        const bottomMatch = String(fills[0].getAttribute("d") || "").match(/L[-?\d.]+,(\d+(?:\.\d+)?)/);
        const bottom = bottomMatch ? bottomMatch[1] : lastY;
        fills[0].setAttribute("d", line + " L" + lastX + "," + bottom + " L" + firstX + "," + bottom + " Z");
      }
    }
  }

  function polish() {
    ensureExcelCompareOption();
    document.querySelectorAll(".signal-chart-stage svg").forEach(connectVacationGaps);
  }

  const observer = new MutationObserver(() => polish());
  function start() {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    polish();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
