(function applyFieldWorkflow() {
  const workflowTypes = {
    leak: "Konstaterad läcka",
    repaired: "Lagad",
    ignored: "Ignorerad",
    manual_dispatch: "Ska åka ut",
    interesting: "Bevaka",
  };

  Object.assign(categoryText, {
    confirmed: "KONSTATERAD",
    repaired: "LAGAD",
    ignored: "IGNORERAD",
  });
  Object.assign(labelTypes, workflowTypes);
  Object.keys(feedbackButtons).forEach((key) => { delete feedbackButtons[key]; });
  Object.assign(feedbackButtons, {
    leak: "Konstaterad läcka",
    repaired: "Lagad",
  });

  const tabDefinitions = [
    { value: "dispatch", label: "Åk ut", tone: "danger" },
    { value: "watch", label: "Bevaka", tone: "warning" },
    { value: "seasonal", label: "Säsong", tone: "seasonal" },
    { value: "confirmed", label: "Konstaterad", tone: "confirmed" },
    { value: "repaired", label: "Lagad", tone: "success" },
    { value: "ignored", label: "Ignorera", tone: "muted" },
    { value: "all", label: "Alla", tone: "all" },
  ];
  const selectedMeters = new Set();

  const originalScoreMeter = scoreMeter;
  scoreMeter = function scoreMeterWithFieldLists(meter, networkContext) {
    const result = originalScoreMeter(meter, networkContext);
    const label = state.labels[meter.id];
    const timeline = readingTimeline(meter.points);
    const shortHistory = result.profile?.coverage?.days < 365 || meter.points.length < 5;
    const customerSide = Boolean(result.infrastructure?.customerSide);

    result.staleReadDays = timeline.gapDays;
    result.staleContact = timeline.hasGap;
    result.lastReadingDate = timeline.lastReadingDate;

    if (label?.type === "leak") result.category = "confirmed";
    if (label?.type === "repaired") result.category = "repaired";
    if (label?.type === "manual_dispatch") {
      result.category = "dispatch";
      result.risk = Math.max(result.risk, 90);
      result.reasons = ["Manuellt vald: ska åka ut", ...result.reasons.filter((reason) => !/manuellt vald/i.test(reason))];
    }
    if (label?.type === "interesting") {
      result.category = "watch";
      result.risk = Math.max(result.risk, 45);
      result.reasons = ["Manuellt vald: bevaka", ...result.reasons.filter((reason) => !/manuellt vald/i.test(reason))];
    }
    if (label?.type === "ignored") {
      result.category = "ignored";
      result.risk = 0;
      result.reasons = ["Ignorerad manuellt", ...result.reasons.filter((reason) => !/ignorerad manuellt/i.test(reason))];
    }
    if (["known_noise", "district_heating", "large_building", "pump", "false_alarm"].includes(label?.type)
      && !["dispatch", "repaired"].includes(result.category)) {
      result.category = "noise";
    }
    if (!label && customerSide) {
      result.category = "normal";
      result.risk = Math.min(result.risk, 24);
      if (!result.reasons.some((reason) => /kundsida/i.test(reason))) {
        result.reasons.unshift("LEAK i Excel: kundsida efter mätaren");
      }
    }
    if (!label && timeline.hasGap) {
      result.category = "normal";
      result.risk = Math.min(result.risk, 24);
      result.reasons = [
        `Inga avläsningar sedan ${timeline.lastReadingDate} (${timeline.gapDays} dagar)`,
        ...result.reasons.filter((reason) => !/inga avläsningar|gammal avläsning|dålig kontakt/i.test(reason)),
      ];
    }
    if (!label && result.category === "repaired") {
      if (result.risk >= 58 && !customerSide) result.category = "dispatch";
      else if (result.risk >= 38 || result.lowRelativeRise) result.category = "watch";
      else if (customerSide) result.category = "normal";
      else if (shortHistory) result.category = "learning";
      else result.category = "normal";
    }
    if (!label && shortHistory && result.category === "normal" && !customerSide && !timeline.hasGap) {
      result.category = "learning";
    }
    return result;
  };

  function terms(value) {
    return String(value || "")
      .split(/[\n,;]+/)
      .map((term) => normalize(term))
      .filter(Boolean);
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matches(row, searchTerms) {
    const haystack = normalize(`${row.address} ${row.serial} ${row.area}`);
    return searchTerms.some((term) => haystack.includes(term));
  }

  function categoryCount(filter) {
    if (filter === "all") return state.meters.length;
    if (filter === "learning") {
      return state.meters.filter((row) => ["learning", "new_high", "new_unknown"].includes(row.category)).length;
    }
    return state.meters.filter((row) => row.category === filter).length;
  }

  function renderListTabs() {
    const tabs = document.getElementById("listTabs");
    if (!tabs) return;
    tabs.innerHTML = tabDefinitions.map((tab) => `
      <button
        type="button"
        class="list-tab ${tab.tone} ${els.filter.value === tab.value ? "active" : ""}"
        data-filter="${tab.value}"
        aria-pressed="${els.filter.value === tab.value}"
      >
        <span>${tab.label}</span>
        <b>${categoryCount(tab.value)}</b>
      </button>
    `).join("");
  }

  function renderMultiActions() {
    const box = document.getElementById("multiActions");
    const count = document.getElementById("multiCount");
    if (!box || !count) return;
    box.hidden = selectedMeters.size === 0;
    count.textContent = `${selectedMeters.size} markerade`;
  }

  render = function renderFieldWorkflow() {
    const searchTerms = terms(els.search.value);
    const filter = els.filter.value;
    const sort = els.sort.value;
    let rows = [...state.meters];
    if (filter !== "all") {
      rows = rows.filter((row) => {
        if (filter === "learning") return ["learning", "new_high", "new_unknown"].includes(row.category);
        return row.category === filter;
      });
    }
    if (searchTerms.length) rows = rows.filter((row) => matches(row, searchTerms));
    rows.sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
    renderSummary();
    renderLabels();
    renderListTabs();
    renderMultiActions();
    renderRows(rows);
  };

  renderSummary = function renderFieldSummary() {
    const stale = state.meters.filter((meter) => meter.staleContact).length;
    els.summary.innerHTML = `
      <div><b>${state.files.length}</b><span>filer</span></div>
      <div><b>${state.meters.length}</b><span>mätare</span></div>
      <div class="summary-alert"><b>${categoryCount("dispatch")}</b><span>åk ut</span></div>
      <div class="summary-gap"><b>${stale}</b><span>utan avläsning</span></div>
    `;
  };

  labelSummary = function labelSummaryField(label) {
    const parts = [];
    if (label.type === "ignored") parts.push("ignorerad");
    if (label.type === "manual_dispatch") parts.push("ska åka ut");
    if (label.type === "interesting") parts.push("bevaka");
    if (label.confirmedDate) parts.push(`konstaterad ${label.confirmedDate}${label.confirmedDateUncertain ? " (osäkert datum)" : ""}`);
    if (label.repairedDate) parts.push(`lagad ${label.repairedDate}`);
    if (label.lineType) parts.push(label.lineType);
    if (label.material) parts.push(label.material);
    if (label.dimension) parts.push(`dimension ${label.dimension}`);
    if (label.note) parts.push(label.note);
    return parts.join(" · ");
  };

  function selectedMoveType(row) {
    if (["manual_dispatch", "interesting", "ignored"].includes(row.label?.type)) return row.label.type;
    return "";
  }

  function markSelect(row) {
    const current = selectedMoveType(row);
    return `
      <select class="move-select" aria-label="Flytta ${escapeAttr(row.address || row.id)}" onchange="moveMeter('${escapeAttr(row.id)}', this.value)">
        <option value="" ${current ? "" : "selected"}>Flytta till…</option>
        <option value="manual_dispatch" ${current === "manual_dispatch" ? "selected" : ""}>Åk ut</option>
        <option value="interesting" ${current === "interesting" ? "selected" : ""}>Bevaka</option>
        <option value="ignored" ${current === "ignored" ? "selected" : ""}>Ignorera</option>
        ${current ? '<option value="auto">Återställ automatisk</option>' : ""}
      </select>
    `;
  }

  function markTools(row) {
    return `
      <div class="mark-tools">
        <label class="row-check">
          <input type="checkbox" class="row-select" data-id="${escapeAttr(row.id)}" ${selectedMeters.has(row.id) ? "checked" : ""}>
          <span>Markera</span>
        </label>
        ${markSelect(row)}
      </div>
    `;
  }

  function gapStatus(row) {
    if (!row.staleContact) return "";
    return `<div class="gap-status"><span></span>Inga avläsningar sedan ${escapeHtml(row.lastReadingDate)}</div>`;
  }

  renderRows = function renderRowsFieldWorkflow(rows) {
    if (!rows.length) {
      els.rows.innerHTML = '<tr><td colspan="8" class="empty">Inga mätare i denna lista.</td></tr>';
      return;
    }
    els.rows.innerHTML = rows.map((r) => `
      <tr class="${r.staleContact ? "stale-row" : ""}">
        <td data-label="Markera" class="select-cell">${markTools(r)}</td>
        <td data-label="Beslut" class="decision-cell">
          <span class="pill ${r.category}">${categoryText[r.category]}</span>
          <div class="score">${r.risk}</div>
          <div class="small">säkerhet ${r.confidence}</div>
        </td>
        <td data-label="Adress" class="address-cell">
          <div class="address-line"><b>${escapeHtml(r.address || "-")}</b>${customerSideMark(r)}<button class="copy-address secondary" title="Kopiera adress" onclick="copyAddress('${escapeAttr(r.id)}', event)">Kopiera</button></div>
          <div class="small">${escapeHtml(r.serial || r.id)} · ${escapeHtml(r.area || "ÖVRIGT")}</div>
          ${tagLine(r)}
        </td>
        <td data-label="Värden" class="metrics-cell">
          <b>E ${round(r.last.current)}</b> · F ${round(r.last.average)} · G ${round(r.maxSeen)}
          <div class="small">P ${(r.pDeviation * 100).toFixed(0)}%</div>
        </td>
        <td data-label="Trend" class="trend-cell">
          <b>${signedPct(r.lastJump)}</b>
          <div class="small">från första ${signedPct(r.firstChange)}</div>
        </td>
        <td data-label="Graf" class="history-cell">
          <svg class="spark" viewBox="0 0 160 42" role="img" aria-label="Mätarhistorik" onclick="openDetail('${escapeAttr(r.id)}')">${sparkPath(r.points)}</svg>
          ${gapStatus(r)}
        </td>
        <td data-label="Varför" class="reason-cell">
          <ul class="reasons">${r.reasons.slice(0, 3).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
        </td>
        <td data-label="Facit" class="feedback-cell"><div class="feedback">${feedbackActions(r.id)}</div></td>
      </tr>
    `).join("");
  };

  function applyMove(id, type) {
    const meter = state.meters.find((item) => item.id === id);
    if (!meter) return null;
    if (type === "auto") {
      delete state.labels[id];
    } else {
      const existing = state.labels[id] || {};
      state.labels[id] = {
        ...existing,
        type,
        address: meter.address || existing.address,
        serial: meter.serial || existing.serial,
        at: new Date().toISOString(),
        source: "markera",
      };
    }
    return meter;
  }

  window.moveMeter = function moveMeter(id, type) {
    if (!type) return;
    const meter = applyMove(id, type);
    if (!meter) return;
    saveLabels();
    analyze();
    els.importStatus.textContent = type === "auto"
      ? `${meter.address || id} återställd till automatisk bedömning.`
      : `${meter.address || id} flyttad till ${workflowTypes[type]}.`;
  };

  window.moveSelectedMeters = function moveSelectedMeters(type) {
    if (!type || !selectedMeters.size) return;
    const ids = [...selectedMeters];
    ids.forEach((id) => applyMove(id, type));
    selectedMeters.clear();
    document.getElementById("multiMove").value = "";
    saveLabels();
    analyze();
    els.importStatus.textContent = `${ids.length} mätare flyttade till ${workflowTypes[type]}.`;
  };

  window.labelMeter = function labelMeterField(id, type) {
    const meter = state.meters.find((item) => item.id === id);
    if (!meter || !["leak", "repaired"].includes(type)) return;
    const existing = state.labels[id] || {};
    const today = localDate(new Date());
    document.getElementById("feedbackMeterId").value = id;
    document.getElementById("feedbackType").value = type;
    document.getElementById("feedbackTitle").textContent = workflowTypes[type];
    document.getElementById("feedbackAddress").textContent = meter.address || id;
    document.getElementById("confirmedDateField").hidden = type !== "leak";
    document.getElementById("confirmedDateUncertainField").hidden = type !== "leak";
    document.getElementById("confirmedFields").hidden = type !== "leak";
    document.getElementById("repairFields").hidden = type !== "repaired";
    document.getElementById("feedbackDateLabel").textContent = "När konstaterad";
    document.getElementById("confirmedDate").value = existing.confirmedDate || today;
    document.getElementById("confirmedDateUncertain").checked = Boolean(existing.confirmedDateUncertain);
    document.getElementById("confirmedLineType").value = ["AV", "SV"].includes(existing.lineType) ? existing.lineType : "Osäkert";
    document.getElementById("repairedDate").value = existing.repairedDate || today;
    document.getElementById("repairLineType").value = existing.lineType === "AV" ? "AV" : "SV";
    document.getElementById("repairMaterial").value = ["Gjutjärn", "Segjärn", "Stål", "PEM"].includes(existing.material) ? existing.material : "Osäkert";
    document.getElementById("repairDimension").value = ["50", "100", "150", "200", "250", "300"].includes(String(existing.dimension)) ? String(existing.dimension) : "Osäkert";
    document.getElementById("feedbackNote").value = existing.note || "";
    document.getElementById("feedbackDialog").showModal();
  };

  function saveFieldFeedback(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const id = document.getElementById("feedbackMeterId").value;
    const type = document.getElementById("feedbackType").value;
    const meter = state.meters.find((item) => item.id === id);
    const existing = state.labels[id] || {};
    const next = {
      ...existing,
      type,
      address: meter?.address || existing.address,
      serial: meter?.serial || existing.serial,
      at: new Date().toISOString(),
      source: "fältfacit",
    };
    if (type === "leak") {
      next.confirmedDate = document.getElementById("confirmedDate").value || localDate(new Date());
      next.confirmedDateUncertain = document.getElementById("confirmedDateUncertain").checked;
      next.lineType = document.getElementById("confirmedLineType").value;
    }
    if (type === "repaired") {
      next.repairedDate = document.getElementById("repairedDate").value || localDate(new Date());
      next.lineType = document.getElementById("repairLineType").value;
      next.material = document.getElementById("repairMaterial").value;
      next.dimension = document.getElementById("repairDimension").value;
    }
    state.labels[id] = next;
    saveLabels();
    document.getElementById("feedbackDialog").close();
    analyze();
  }

  document.getElementById("listTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-filter]");
    if (!button) return;
    els.filter.value = button.dataset.filter;
    render();
  });
  document.getElementById("rows")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest?.(".row-select");
    if (!checkbox) return;
    if (checkbox.checked) selectedMeters.add(checkbox.dataset.id);
    else selectedMeters.delete(checkbox.dataset.id);
    renderMultiActions();
  });
  document.getElementById("multiMove")?.addEventListener("change", (event) => {
    window.moveSelectedMeters(event.target.value);
  });
  document.getElementById("clearSelection")?.addEventListener("click", () => {
    selectedMeters.clear();
    render();
  });
  document.getElementById("feedbackForm")?.addEventListener("submit", saveFieldFeedback, true);

  analyze();
}());
