/* Independent field itinerary. Adding entries never changes meter status. */
(function () {
  const dialog = document.createElement("dialog");
  dialog.id = "tripListDialog";
  dialog.setAttribute("aria-labelledby", "tripListTitle");
  dialog.innerHTML = `
    <header class="trip-head"><div><p class="eyebrow">TA MED UT I FÄLT</p><h2 id="tripListTitle">Åklista</h2>
    <p>Samla mätare från flera listor. Ändra namn och anledning före export.</p></div>
    <button type="button" class="secondary" data-trip="close">Tillbaka</button></header>
    <div class="trip-tools"><strong id="tripCount"></strong>
    <button type="button" data-trip="export">Ladda ner Excel</button>
    <button type="button" class="secondary" data-trip="copy">Kopiera till Excel</button></div>
    <p class="trip-help">Namn visar mätarnumret om namn saknas. Markera mätare i appen och välj ”Lägg i åklista”.</p>
    <p id="tripStatus" role="status" aria-live="polite"></p>
    <div class="trip-table"><table><thead><tr><th>Namn</th><th>Adress</th><th>Anledning</th><th></th></tr></thead><tbody id="tripRows"></tbody></table></div>
    <p id="tripEmpty">Åklistan är tom. Gå tillbaka, markera mätare och välj ”Lägg i åklista”. Du kan använda ”Markera alla” för hela den filtrerade listan.</p>
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
  function render() {
    rows.replaceChildren();
    for (const entry of list()) {
      const tr = document.createElement("tr");
      tr.append(cellInput(entry, "name", "Namn"), cellInput(entry, "address", "Adress"), cellInput(entry, "reason", "Anledning"));
      const td = document.createElement("td"), remove = document.createElement("button");
      remove.type = "button"; remove.className = "secondary"; remove.textContent = "Ta bort";
      remove.setAttribute("aria-label", "Ta bort " + entry.address + " från åklistan");
      remove.addEventListener("click", () => { state.tripList = list().filter(x => x.id !== entry.id); render(); save("Borttagen från åklistan."); });
      td.appendChild(remove); tr.appendChild(td); rows.appendChild(tr);
    }
    dialog.querySelector("#tripCount").textContent = list().length + " mätare";
    dialog.querySelector("#tripEmpty").hidden = list().length > 0;
    dialog.querySelectorAll('[data-trip="export"],[data-trip="copy"]').forEach(b => { b.disabled = !list().length; });
  }
  function open() {
    render(); status.textContent = "";
    dialog.querySelector("#tripCopyFallback").hidden = true;
    if (!dialog.open) dialog.showModal();
  }
  function exportRows() {
    return [["Namn", "Adress", "Anledning"], ...list().map(x => [String(x.name || ""), String(x.address || ""), String(x.reason || "")])];
  }
  async function copy() {
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
    if (!window.XLSX) { status.textContent = "Excelverktyget kunde inte laddas. Använd Kopiera till Excel eller försök ladda om sidan."; return; }
    try {
      const sheet = XLSX.utils.aoa_to_sheet(exportRows());
      sheet["!cols"] = [{wch:24}, {wch:48}, {wch:100}];
      sheet["!autofilter"] = {ref:sheet["!ref"]};
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Åklista");
      XLSX.writeFile(workbook, "Leaksok-Aklista-" + new Date().toISOString().slice(0,10) + ".xlsx");
      status.textContent = "Excel-filen har skapats för nedladdning.";
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
      await save(added ? added + " mätare tillagda. Befintliga rader behålls utan dubbletter." : "Mätarna finns redan i åklistan.");
    }
  };
  document.getElementById("openTripList").addEventListener("click", open);
  dialog.addEventListener("click", event => {
    const action = event.target.closest("[data-trip]")?.dataset.trip;
    if (action === "close") dialog.close();
    if (action === "copy") copy();
    if (action === "export") download();
  });
}());
