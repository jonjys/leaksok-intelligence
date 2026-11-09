/* Arbetslista (previously "Ladda ner"): a saved list of meters to take into the
   field, and the Excel export. Exports only the rows the user has ticked; the
   count is shown before download and there is never a fallback to all meters. */
(function (root) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function create(api) {
    const dialog = api.dialog;
    const exportDialog = api.exportDialog;
    const picked = new Set();
    let pending = null;

    const entries = () => api.getEntries();
    const known = () => entries().filter((e) => api.getMeter(e.id));

    function open() {
      picked.clear();
      render();
      if (!dialog.open) dialog.showModal();
    }

    function add(ids) {
      const list = entries();
      const have = new Set(list.map((e) => e.id));
      let added = 0;
      for (const id of ids) {
        if (have.has(id) || !api.getMeter(id)) continue;
        list.push({ id, addedAt: new Date().toISOString() });
        have.add(id);
        added++;
      }
      api.setEntries(list);
      api.persist();
      api.onChange?.();
      return { added, already: ids.length - added };
    }

    function rowHtml(entry) {
      const m = api.getMeter(entry.id);
      if (!m) return "";
      return `<tr data-id="${esc(entry.id)}" class="${picked.has(entry.id) ? "is-picked" : ""}">
          <td class="c-check"><input type="checkbox" data-pick ${picked.has(entry.id) ? "checked" : ""} aria-label="Välj ${esc(m.address)}"></td>
          <td><span class="addr-line"><button type="button" class="link addr" data-act="focus">${esc(m.address)}</button>${api.copyButton ? api.copyButton(m) : ""}</span><span class="sub">${esc(m.serial || m.id)}</span></td>
          <td><span class="pill cat-${esc(m.category)}">${esc(m.status)}</span></td>
          <td class="wl-reason">${esc(m.summary)}<span class="sub">${esc(m.action)}</span>${entry.reason ? `<span class="sub legacy">Sparad text från tidigare lista: ${esc(entry.reason)}</span>` : ""}</td>
          <td><textarea data-comment rows="2" aria-label="Kommentar för ${esc(m.address)}">${esc(api.getComment(entry.id))}</textarea></td>
          <td><button type="button" class="link" data-remove>Ta bort</button></td>
        </tr>`;
    }

    function render() {
      const list = entries();
      const missing = list.filter((e) => !api.getMeter(e.id)).length;
      dialog.innerHTML = `
        <div class="dialog-head">
          <div><p class="eyebrow">Ta med ut i fält</p><h2 id="worklistTitle">Arbetslista</h2>
          <p class="small">${list.length ? `${list.length} mätare i listan. Kryssa i de som ska exporteras.` : "Listan är tom. Markera mätare i tabellen och välj Lägg i arbetslista."}${missing ? ` ${missing} saknas i nuvarande importer och visas inte.` : ""}</p></div>
          <button type="button" class="secondary" data-act="close">Stäng</button>
        </div>
        <div class="wl-tools"></div>
        <p class="wl-status" role="status" aria-live="polite"></p>
        <div class="wl-table"><table><thead><tr><th class="c-check"></th><th>Adress</th><th>Status</th><th>Huvudorsak och kontroll</th><th>Kommentar</th><th></th></tr></thead><tbody>${list.map(rowHtml).join("")}</tbody></table></div>
        <div class="wl-foot"></div>
        <label class="wl-copy" hidden>Kopiera texten och klistra in i Excel<textarea readonly rows="6"></textarea></label>`;
      renderTools();
    }

    // Counts and buttons only; rows keep their scroll position and edits.
    function renderTools() {
      const count = known().filter((e) => picked.has(e.id)).length;
      const total = known().length;
      dialog.querySelector(".wl-tools").innerHTML = `
          <strong>${count} av ${total} valda</strong>
          <button type="button" class="secondary" data-act="all" ${total ? "" : "disabled"}>Välj alla i arbetslistan (${total})</button>
          <button type="button" class="secondary" data-act="none" ${count ? "" : "disabled"}>Avmarkera</button>
          <button type="button" class="primary" data-act="export" ${count ? "" : "disabled"}>Excel (${count} mätare)</button>
          <button type="button" class="secondary" data-act="copy" ${count ? "" : "disabled"}>Kopiera (${count})</button>`;
      dialog.querySelector(".wl-foot").innerHTML = `
          <button type="button" class="secondary" data-act="remove" ${count ? "" : "disabled"}>Ta bort valda ur listan</button>
          <button type="button" class="secondary danger-text" data-act="clear" ${entries().length ? "" : "disabled"}>Töm listan</button>`;
      dialog.querySelectorAll("tr[data-id]").forEach((tr) => {
        const on = picked.has(tr.dataset.id);
        tr.classList.toggle("is-picked", on);
        const box = tr.querySelector("[data-pick]");
        if (box) box.checked = on;
      });
    }

    function status(text) { const el = dialog.querySelector(".wl-status"); if (el) el.textContent = text; }

    dialog.addEventListener("click", async (event) => {
      const act = event.target.closest("[data-act]")?.dataset.act;
      const row = event.target.closest("tr[data-id]");
      if (event.target.closest("[data-remove]") && row) {
        picked.delete(row.dataset.id);
        api.setEntries(entries().filter((e) => e.id !== row.dataset.id));
        api.persist(); api.onChange?.(); render(); status("Borttagen ur arbetslistan. Mätardata och beslut finns kvar.");
        return;
      }
      if (!act) return;
      if (act === "focus" && row) {
        dialog.close();
        api.onFocus?.(row.dataset.id, [...new Set([...picked, row.dataset.id])]);
        return;
      }
      if (act === "close") dialog.close();
      if (act === "all") { known().forEach((e) => picked.add(e.id)); renderTools(); }
      if (act === "none") { picked.clear(); renderTools(); }
      if (act === "remove") {
        api.setEntries(entries().filter((e) => !picked.has(e.id)));
        picked.clear(); api.persist(); api.onChange?.(); render(); status("Valda togs bort ur arbetslistan.");
      }
      if (act === "clear" && confirm(`Töm arbetslistan (${entries().length} mätare)? Historik, beslut och kommentarer behålls.`)) {
        api.setEntries([]); picked.clear(); api.persist(); api.onChange?.(); render();
      }
      if (act === "export") {
        const ids = known().filter((e) => picked.has(e.id)).map((e) => e.id);
        exportMeters(ids, "valda i arbetslistan");
      }
      if (act === "copy") copy(known().filter((e) => picked.has(e.id)).map((e) => api.getMeter(e.id)));
    });
    dialog.addEventListener("change", (event) => {
      const row = event.target.closest("tr[data-id]");
      if (!row) return;
      if (event.target.matches("[data-pick]")) {
        if (event.target.checked) picked.add(row.dataset.id); else picked.delete(row.dataset.id);
        renderTools();
      }
      if (event.target.matches("[data-comment]")) { api.setComment(row.dataset.id, event.target.value); status("Kommentaren sparad."); }
    });

    async function copy(meters) {
      if (!meters.length) return;
      const clean = (v) => { const t = String(v ?? "").replace(/[\t\r\n]+/g, " "); return /^[=+\-@]/.test(t) ? `'${t}` : t; };
      const lines = [["Adress", "Serienummer", "Status", "Senast avläst", "Senaste värde", "Huvudorsak", "Rekommenderad kontroll", "Kommentar"],
        ...meters.map((m) => [m.address, m.serial || m.id, m.status, m.latest ? root.LeakEngine.fmtDate(m.latest.date, true) : "", m.latest ? root.LeakEngine.fmtNum(m.latest.value) : "", m.summary, m.action, api.getComment(m.id)])];
      const text = lines.map((r) => r.map(clean).join("\t")).join("\n");
      try { await navigator.clipboard.writeText(text); status(`${meters.length} mätare kopierade. Klistra in i Excel.`); }
      catch {
        const box = dialog.querySelector(".wl-copy");
        box.hidden = false;
        box.querySelector("textarea").value = text;
        box.querySelector("textarea").select();
        status("Automatisk kopiering gick inte. Markera texten nedan och kopiera.");
      }
    }

    // Confirmation with the exact count before any file is created.
    function exportMeters(ids, source) {
      const meters = ids.map((id) => api.getMeter(id)).filter(Boolean);
      if (!meters.length) { api.notify?.("Inga mätare valda. Markera mätare först – exporten tar aldrig med alla automatiskt."); return; }
      pending = meters;
      const preview = meters.slice(0, 8).map((m) => `<li>${esc(m.address)} <span class="sub">${esc(m.serial || m.id)}</span></li>`).join("");
      exportDialog.innerHTML = `
        <form method="dialog">
          <div class="dialog-head"><div><h2 id="exportTitle">Exportera ${meters.length} mätare</h2><p class="small">Urval: ${esc(source)}.</p></div>
          <button type="button" class="secondary" data-act="cancel">Avbryt</button></div>
          <ul class="export-preview">${preview}${meters.length > 8 ? `<li class="sub">… och ${meters.length - 8} till</li>` : ""}</ul>
          <fieldset class="inline"><legend>Ordning i arbetslistan</legend>
            <label><input type="radio" name="exportSort" value="priority" checked> Prioritet</label>
            <label><input type="radio" name="exportSort" value="address"> Adress A–Ö</label>
          </fieldset>
          <p class="small">Blad: <b>Arbetslista</b> (utskrift, en sida bred) och <b>Analysunderlag</b> (jämförelser, perioder, datakvalitet) samt <b>Definitioner</b>.</p>
          <p class="form-error" role="alert"></p>
          <button type="submit" class="primary" data-act="download">Ladda ner Excel (${meters.length} mätare)</button>
        </form>`;
      if (!exportDialog.open) exportDialog.showModal();
    }

    exportDialog.addEventListener("click", async (event) => {
      const act = event.target.closest("[data-act]")?.dataset.act;
      if (act === "cancel") { pending = null; exportDialog.close(); return; }
      if (act !== "download" || !pending) return;
      event.preventDefault();
      const error = exportDialog.querySelector(".form-error");
      const button = event.target.closest("button");
      try {
        button.disabled = true;
        button.textContent = "Skapar Excel…";
        const sort = exportDialog.querySelector('input[name="exportSort"]:checked')?.value || "priority";
        const exportedAt = new Date();
        const workbook = root.LeakFieldExport.buildWorkbook(pending, { labels: api.getLabels(), exportedAt, sort });
        const bytes = await root.LeakXlsx.write(workbook);
        const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = root.LeakFieldExport.fileName(exportedAt, pending.length);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        api.notify?.(`Excel med ${pending.length} mätare skapad: ${a.download}`);
        pending = null;
        exportDialog.close();
      } catch (e) {
        error.textContent = `Excel kunde inte skapas: ${e.message}`;
        button.disabled = false;
        button.textContent = "Försök igen";
      }
    });

    return { open, add, exportMeters, render: () => dialog.open && render() };
  }

  root.LeakWorklist = { create };
}(typeof globalThis !== "undefined" ? globalThis : this));

