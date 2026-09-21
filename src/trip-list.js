/* Independent field itinerary. Adding entries never changes meter status. */
(function () {
  const selected = new Set();
  const dialog = document.createElement("dialog");
  dialog.id = "tripListDialog";
  dialog.setAttribute("aria-labelledby", "tripListTitle");
  dialog.innerHTML = `
    <header class="trip-head"><div><p class="eyebrow">TA MED UT I FÄLT</p><h2 id="tripListTitle">Ladda ner</h2>
    <p>Din exportlista · välj exakt vilka mätare som ska följa med.</p></div>
    <button type="button" class="secondary" data-trip="close">Tillbaka</button></header>
    <div class="trip-tools"><strong id="tripCount"></strong>
    <button type="button" class="secondary" data-trip="all">Markera alla i listan</button>
    <button type="button" class="secondary" data-trip="none">Avmarkera</button>
    <button type="button" data-trip="export">Ladda ner Excel (0)</button>
    <button type="button" class="secondary" data-trip="copy">Kopiera till Excel</button></div>
    <p class="trip-help">1. Flytta hit från valfri lista. 2. Markera här. 3. Ladda ner valda till Excel. Dina fältbedömningar behålls.</p>
    <p id="tripStatus" role="status" aria-live="polite"></p>
    <div class="trip-table"><table><thead><tr><th>Välj</th><th>Namn</th><th>Adress</th><th>Anledning</th><th></th></tr></thead><tbody id="tripRows"></tbody></table></div>
    <p id="tripEmpty">Listan är tom. Gå tillbaka, markera mätare och välj ”Flytta till Ladda ner”.</p>
    <div class="trip-footer"><button type="button" class="secondary" data-trip="remove">Ta bort markerade från listan</button><button type="button" class="secondary" data-trip="clear">Töm listan</button></div>
    <div id="tripCopyFallback" hidden><label>Kopiera texten och klistra in i Excel<textarea readonly rows="6"></textarea></label></div>`;
  document.body.appendChild(dialog);
  const rows = dialog.querySelector("#tripRows");
  const status = dialog.querySelector("#tripStatus");
  function list() { return state.tripList || (state.tripList = []); }
  async function save(message) {
    const ok = await persistState();
    status.textContent = ok ? message : "Listan finns kvar här men kunde inte sparas på enheten. Ladda ner Excel som säkerhetskopia.";
  }
  function cellInput(entry, field, label) {
    const td = document.createElement("td");
    const input = document.createElement(field === "reason" ? "textarea" : "input");
    input.value = entry[field] || "";
    input.setAttribute("aria-label", label + " för " + entry.address);
    if (field === "reason") input.rows = 2;
    input.addEventListener("input", () => { entry[field] = input.value; });
    input.addEventListener("change", () => save("Ändringen sparad."));
    td.appendChild(input); return td;
  }
  function updateSelection() {
    const count = list().filter(entry => selected.has(entry.id)).length;
    dialog.querySelector("#tripCount").textContent = `${count} av ${list().length} markerade`;
    dialog.querySelector('[data-trip="export"]').textContent = `Ladda ner Excel (${count})`;
    dialog.querySelectorAll('[data-trip="export"],[data-trip="copy"],[data-trip="remove"],[data-trip="none"]').forEach(b => { b.disabled = count === 0; });
    dialog.querySelectorAll('[data-trip="all"],[data-trip="clear"]').forEach(b => { b.disabled = list().length === 0; });
    rows.querySelectorAll("input[type=checkbox]").forEach(input => { input.checked = selected.has(input.dataset.id); input.closest("tr").classList.toggle("trip-selected", input.checked); });
  }
  function render() {
    rows.replaceChildren();
    for (const entry of list()) {
      const tr = document.createElement("tr");
      const choice = document.createElement("td"), check = document.createElement("input");
      check.type = "checkbox"; check.dataset.id = entry.id; check.checked = selected.has(entry.id);
      check.setAttribute("aria-label", "Markera " + entry.address);
      check.addEventListener("change", () => {
        if (check.checked) selected.add(entry.id); else selected.delete(entry.id);
        dialog.querySelector("#tripCopyFallback").hidden = true;
        updateSelection();
      });
      choice.appendChild(check); tr.appendChild(choice);
      tr.append(cellInput(entry, "name", "Namn"), cellInput(entry, "address", "Adress"), cellInput(entry, "reason", "Anledning"));
      const td = document.createElement("td"), remove = document.createElement("button");
      remove.type = "button"; remove.className = "secondary"; remove.textContent = "Ta bort";
      remove.setAttribute("aria-label", "Ta bort " + entry.address + " från Ladda ner");
      remove.addEventListener("click", () => { selected.delete(entry.id); state.tripList = list().filter(x => x.id !== entry.id); render(); save("Borttagen från Ladda ner."); });
      td.appendChild(remove); tr.appendChild(td); rows.appendChild(tr);
    }
    dialog.querySelector("#tripCopyFallback").hidden = true;
    dialog.querySelector("#tripEmpty").hidden = list().length > 0;
    updateSelection();
  }
  function open() {
    selected.clear();
    render(); status.textContent = "";
    dialog.querySelector("#tripCopyFallback").hidden = true;
    if (!dialog.open) dialog.showModal();
  }
  function exportRows() {
    return [["Namn", "Adress", "Anledning"], ...list().filter(x => selected.has(x.id)).map(x => [String(x.name || ""), String(x.address || ""), String(x.reason || "")])];
  }
  async function copy() {
    if (exportRows().length === 1) { status.textContent = "Markera minst en mätare i Ladda ner."; return; }
    // Spreadsheet-safe plain text; tabs and line breaks must not create extra columns.
    const text = exportRows().map(row => row.map(value => {
      const clean = value.replace(/[\t\r\n]+/g, " ");
      return /^[\s]*[=+@-]/.test(clean) ? "'" + clean : clean;
    }).join("\t")).join("\n");
    try { await navigator.clipboard.writeText(text); status.textContent = "Kopierat! Klistra in i Excel så hamnar uppgifterna i tre kolumner."; }
    catch {
      const box = dialog.querySelector("#tripCopyFallback"); box.hidden = false;
      const input = box.querySelector("textarea"); input.value = text; input.focus(); input.select();
      status.textContent = "Automatisk kopiering gick inte. Kopiera den markerade texten nedan.";
    }
  }
  function download() {
    const data = exportRows();
    if (data.length === 1) { status.textContent = "Markera minst en mätare i Ladda ner."; return; }
    if (!window.XLSX) { status.textContent = "Excelverktyget kunde inte laddas. Använd Kopiera till Excel eller försök ladda om sidan."; return; }
    try {
      const sheet = XLSX.utils.aoa_to_sheet(data);
      sheet["!cols"] = [{wch:24}, {wch:48}, {wch:100}];
      sheet["!autofilter"] = {ref:sheet["!ref"]};
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Valda mätare");
      XLSX.writeFile(workbook, "Leaksok-Valda-" + new Date().toISOString().slice(0,10) + ".xlsx");
      status.textContent = `${data.length - 1} markerade mätare exporterade till Excel.`;
    } catch (error) { status.textContent = "Excel kunde inte skapas: " + error.message; }
  }
  window.LeakTripList = {
    async add(meters) {
      const ids = new Set(list().map(x => x.id));
      let added = 0;
      for (const meter of meters) {
        if (ids.has(meter.id)) continue;
        ids.add(meter.id);
        list().push({
          id:meter.id, name:String(meter.name || meter.serial || meter.id),
          address:String(meter.address || ""),
          reason:(meter.reasons || []).slice(0,3).join(" · ") || "Kontroll i fält"
        });
        added++;
      }
      open();
      await save(added ? added + " mätare tillagda. Befintliga rader behålls utan dubbletter." : "Mätarna finns redan i Ladda ner. Markera dem här för export.");
    }
  };
  document.getElementById("openTripList").addEventListener("click", open);
  document.getElementById("openDownloadList")?.addEventListener("click", open);
  dialog.addEventListener("click", event => {
    const action = event.target.closest("[data-trip]")?.dataset.trip;
    if (action === "all") { list().forEach(entry => selected.add(entry.id)); updateSelection(); }
    if (action === "none") { selected.clear(); updateSelection(); }
    if (action === "remove") { state.tripList = list().filter(entry => !selected.has(entry.id)); selected.clear(); render(); save("Markerade borttagna från listan."); }
    if (action === "clear" && list().length && confirm(`Töm Ladda ner på ${list().length} mätare? Historik och facit behålls.`)) { state.tripList = []; selected.clear(); render(); save("Listan är tömd."); }
    if (action && action !== "copy") dialog.querySelector("#tripCopyFallback").hidden = true;
    if (action === "close") dialog.close();
    if (action === "copy") copy();
    if (action === "export") download();
  });
}());

