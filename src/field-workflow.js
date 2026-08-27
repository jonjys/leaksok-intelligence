(function applyFieldWorkflow() {
  const workflowTypes = {
    leak: "Hittad läcka",
    repaired: "Lagad",
    seasonal: "Säsong",
    known_noise: "Falsklarm/Annat",
    district_heating: "Fjärrvärme",
    large_building: "Höghus/stor byggnad",
    pump: "Undercentral/pumpar",
    false_alarm: "Falsklarm/Annat",
    suspect: "Misstänk",
    ignored: "Ignorera denna",
    manual_dispatch: "Ska åka ut på",
    interesting: "Intressant",
    reset_baseline: "Falsklarm - nollställ",
  };
  const bulkDefaults = {
    seasonal: ["värmepanna"],
    known_noise: ["falsklarm/annat"],
    district_heating: ["fjärrvärme"],
    large_building: ["höghus"],
    pump: ["undercentral/pumpar"],
    false_alarm: ["falsklarm/annat"],
    reset_baseline: ["nollställd/följ nya värden"],
  };
  const selectedMeters = new Set();

  Object.assign(categoryText, {
    confirmed: "HITTAD LÄCKA",
    seasonal: "SÄSONG",
    noise: "FALSKLARM / STÖRNING",
    ignored: "IGNORERAD",
    suspect_auto: "MISSTÄNK",
  });
  Object.assign(labelTypes, workflowTypes);
  Object.keys(feedbackButtons).forEach((key) => { delete feedbackButtons[key]; });
  Object.assign(feedbackButtons, {
    leak: "Hittad läcka",
    repaired: "Lagad",
    manual_dispatch: "Ska åka ut på",
    interesting: "Intressant",
    ignored: "Ignorera denna",
    known_noise: "Falskt larm - tillfällig topp",
    reset_baseline: "Falsklarm - nollställ",
    seasonal: "Säsong",
    false_alarm: "Falsklarm/Annat",
    suspect: "Misstänk",
  });
  const listLabels = {
    all: "Alla",
    dispatch: "Åk ut",
    watch: "Bevaka",
    suspect_auto: "Misstänk",
    seasonal: "Säsong",
    confirmed: "Hittad läcka",
    repaired: "Lagad",
    ignored: "Ignorera",
    learning: "Under inlärning",
    noise: "Falsklarm/störning",
  };
  document.querySelectorAll('#filter option[value="normal"]').forEach((option) => option.remove());

  const originalScoreMeter = scoreMeter;
  scoreMeter = function scoreMeterWithFieldLists(meter, networkContext) {
    const result = originalScoreMeter(meter, networkContext);
    const label = state.labels[meter.id];
    const shortHistory = result.profile?.coverage?.days < 365 || meter.points.length < 5;
    const staleReadDays = result.staleReadDays ?? Math.max(0, Math.round(((result.last?.date || new Date()) - (result.last?.readAt || result.last?.date || new Date())) / 86400000));
    const staleContact = result.staleContact || staleReadDays >= 14;
    const customerSide = Boolean(result.infrastructure?.customerSide);
    if (label?.type === "leak") result.category = "confirmed";
    if (label?.type === "repaired") result.category = "repaired";
    if (label?.type === "manual_dispatch") {
      result.category = "dispatch";
      result.risk = Math.max(result.risk, 90);
      result.reasons = ["Manuellt vald: ska åka ut på", ...result.reasons.filter((reason) => !/manuellt vald/i.test(reason))];
    }
    if (label?.type === "interesting") {
      result.category = "watch";
      result.risk = Math.max(result.risk, 45);
      result.reasons = ["Manuellt vald: intressant", ...result.reasons.filter((reason) => !/manuellt vald/i.test(reason))];
    }
    if (label?.type === "reset_baseline") {
      const resetDate = parseLabelDate(label);
      const pointsAfterReset = resetDate
        ? meter.points.filter((point) => point.date > resetDate)
        : [];
      if (!pointsAfterReset.length || !hasNewRiseAfterReset(pointsAfterReset)) {
        result.category = "normal";
        result.risk = Math.min(result.risk, 18);
        result.reasons = ["Falsklarm nollställt: inväntar nya värden efter nästa Excel", ...result.reasons.filter((reason) => !/falsklarm nollställt/i.test(reason))];
      } else if (result.category === "watch") {
        result.category = "suspect_auto";
      }
    }
    if (label?.type === "ignored") {
      result.category = "ignored";
      result.risk = 0;
      result.reasons = ["Ignorerad manuellt i fältfacit", ...result.reasons.filter((reason) => !/ignorerad manuellt/i.test(reason))];
    }
    if (label?.type === "suspect" && result.category !== "dispatch") result.category = "suspect_auto";
    if (label?.type === "seasonal" && !["dispatch", "repaired"].includes(result.category)) result.category = "seasonal";
    if (["known_noise", "district_heating", "large_building", "pump", "false_alarm"].includes(label?.type) && result.category !== "repaired") {
      result.category = "noise";
      result.risk = Math.min(result.risk, 24);
    }
    if (!label && customerSide) {
      result.category = "normal";
      result.risk = Math.min(result.risk, 24);
      if (!result.reasons.some((reason) => /kundsida/i.test(reason))) result.reasons.unshift("LEAK i Excel: kundsida efter mätaren");
    }
    if (!label && staleContact) {
      result.category = "normal";
      result.risk = Math.min(result.risk, 24);
      if (!result.reasons.some((reason) => /gammal avläsning|dålig kontakt/i.test(reason))) {
        result.reasons.unshift(`Dålig kontakt/gammal avläsning: ${staleReadDays} dagar sedan senaste mätarläsning`);
      }
    }
    if (!label && result.category === "repaired") {
      if (result.risk >= 58 && !result.infrastructure?.customerSide) result.category = "dispatch";
      else if (result.risk >= 38 || result.lowRelativeRise) result.category = "watch";
      else if (result.infrastructure?.customerSide) result.category = "normal";
      else if (shortHistory) result.category = "learning";
      else result.category = "normal";
    }
    if (!label && shortHistory && result.category === "normal" && !customerSide && !staleContact) {
      result.category = "learning";
    }
    if (!label && result.category === "watch") result.category = "suspect_auto";
    return result;
  };

  function parseLabelDate(label) {
    const raw = label.notedDate || label.at || label.confirmedDate || "";
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function hasNewRiseAfterReset(points) {
    if (points.length < 2) return false;
    const values = points.map((point) => point.current).filter(Number.isFinite);
    if (values.length < 2) return false;
    const previous = values.slice(0, -1);
    const base = median(previous) || avg(previous) || 1;
    const last = values[values.length - 1];
    return last >= 25 && last >= base * 1.7;
  }

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

  function renderBulk(rows, searchTerms) {
    const box = document.getElementById("bulkActions");
    const count = document.getElementById("bulkCount");
    if (!box || !count) return;
    const selectedCount = selectedMeters.size;
    const show = selectedCount > 0 || (searchTerms.length > 0 && rows.length > 0);
    box.hidden = !show;
    if (show) count.textContent = selectedCount > 0 ? `${selectedCount} markerade` : `${rows.length} träffar`;
  }

  render = function renderFieldWorkflow() {
    const searchTerms = terms(els.search.value);
    const filter = els.filter.value;
    const sort = els.sort.value;
    let rows = [...state.meters];
    if (filter !== "all") {
      rows = rows.filter((row) => {
        if (filter === "learning") return ["learning", "new_high", "new_unknown"].includes(row.category);
        if (filter === "confirmed") return row.category === "confirmed";
        if (filter === "suspect_auto") return row.category === "suspect_auto";
        return row.category === filter;
      });
    }
    if (searchTerms.length) rows = rows.filter((row) => matches(row, searchTerms));
    rows.sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
    renderSummary();
    renderLabels();
    renderBulk(rows, searchTerms);
    renderRows(rows);
  };

  renderSummary = function renderFieldSummary() {
    const counts = {
      files: state.files.length,
      meters: state.meters.length,
      dispatch: state.meters.filter((meter) => meter.category === "dispatch").length,
      watch: state.meters.filter((meter) => meter.category === "watch").length,
      suspect: state.meters.filter((meter) => meter.category === "suspect_auto").length,
      confirmed: state.meters.filter((meter) => meter.category === "confirmed").length,
      known: state.meters.filter((meter) => ["seasonal", "noise", "repaired", "ignored"].includes(meter.category)).length,
      short: state.meters.filter((meter) => ["learning", "new_high", "new_unknown"].includes(meter.category)).length,
    };
    els.summary.innerHTML = `
      <div><b>${counts.files}</b><span>filer</span></div>
      <div><b>${counts.meters}</b><span>mätare</span></div>
      <div><b>${counts.dispatch}</b><span>åk ut</span></div>
      <div><b>${counts.watch}</b><span>bevaka</span></div>
      <div><b>${counts.suspect}</b><span>misstänk</span></div>
      <div><b>${counts.confirmed}</b><span>hittade</span></div>
      <div><b>${counts.known}</b><span>lagad/störning</span></div>
    `;
    renderListTabs(counts);
  };

  function renderListTabs(counts) {
    const tabs = document.getElementById("listTabs");
    if (!tabs) return;
    const active = els.filter.value;
    const values = {
      all: state.meters.length,
      dispatch: counts.dispatch,
      watch: counts.watch,
      suspect_auto: counts.suspect,
      seasonal: state.meters.filter((meter) => meter.category === "seasonal").length,
      confirmed: counts.confirmed,
      repaired: state.meters.filter((meter) => meter.category === "repaired").length,
      ignored: state.meters.filter((meter) => meter.category === "ignored").length,
      learning: counts.short,
      noise: state.meters.filter((meter) => meter.category === "noise").length,
    };
    tabs.querySelectorAll("button[data-filter]").forEach((button) => {
      const filter = button.dataset.filter;
      button.classList.toggle("active", filter === active);
      button.innerHTML = `${listLabels[filter] || filter} <b>${values[filter] || 0}</b>`;
    });
  }

  labelSummary = function labelSummaryField(label) {
    const parts = [];
    if (label.type === "ignored") parts.push("ignorerad");
    if (label.type === "manual_dispatch") parts.push("ska åka ut på");
    if (label.type === "interesting") parts.push("intressant");
    if (label.type === "reset_baseline") parts.push("nollställd");
    if (label.confirmedDate) parts.push(`hittad ${label.confirmedDate}`);
    if (label.confirmedDateUncertain) parts.push("datum osäkert");
    if (label.repairedDate) parts.push(`lagad ${label.repairedDate}`);
    if (Number.isFinite(label.distanceMeters)) parts.push(`ca ${label.distanceMeters} m från mätaren`);
    if (label.distanceUncertain) parts.push("avstånd osäkert");
    if (label.lineType) parts.push(label.lineType);
    if (label.noiseTags?.length) parts.push(label.noiseTags.join(", "));
    if (label.notedDate) parts.push(label.notedDate);
    if (label.note) parts.push(label.note);
    return parts.join(" · ");
  };

  renderRows = function renderRowsFieldWorkflow(rows) {
    if (!rows.length) {
      els.rows.innerHTML = `<tr><td colspan="8" class="empty">Ingen mätare matchar filtret.</td></tr>`;
      return;
    }
    els.rows.innerHTML = rows.map((r) => `
      <tr>
        <td data-label="Välj" class="select-cell">
          <label class="row-check">
            <input type="checkbox" class="row-select" data-id="${escapeAttr(r.id)}" ${selectedMeters.has(r.id) ? "checked" : ""}>
            <span>Markera</span>
          </label>
        </td>
        <td data-label="Beslut" class="decision-cell">
          <span class="pill ${r.category}">${categoryText[r.category]}</span>
          <div class="score">${r.risk}</div>
          <div class="small">säkerhet: ${r.confidence}</div>
        </td>
        <td data-label="Adress" class="address-cell">
          <div class="address-line"><b>${escapeHtml(r.address || "-")}</b>${customerSideMark(r)}<button class="copy-address secondary" title="Kopiera adress" onclick="copyAddress('${escapeAttr(r.id)}', event)">Kopiera</button></div>
          <div class="small">${escapeHtml(r.serial || r.id)} · ${escapeHtml(r.area || "ÖVRIGT")}</div>
          ${tagLine(r)}
        </td>
        <td data-label="E/F/P" class="metrics-cell">
          <b>E ${round(r.last.current)}</b> · F ${round(r.last.average)} · G ${round(r.maxSeen)}
          <div class="small">P ${(r.pDeviation * 100).toFixed(0)}% · ${signedPct(r.lastJump)} senast</div>
        </td>
        <td data-label="Trend" class="trend-cell">
          <b>${signedPct(r.lastJump)}</b> senast
          <div class="small">${signedPct(r.firstChange)} från första filen</div>
        </td>
        <td data-label="Historik" class="history-cell">
          <svg class="spark" viewBox="0 0 160 42" onclick="openDetail('${escapeAttr(r.id)}')">${sparkPath(r.points)}</svg>
          <div class="small">${r.points.length} punkter · ${r.profile.coverage.days} dagar · ${r.profile.coverage.months} månader · ${r.profile.coverage.seasons} säsonger</div>
        </td>
        <td data-label="Varför" class="reason-cell">
          <ul class="reasons">${r.reasons.slice(0, 5).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
        </td>
        <td data-label="Facit" class="feedback-cell"><div class="feedback">${feedbackActions(r.id)}</div></td>
      </tr>
    `).join("");
  };

  window.labelMeter = function labelMeterField(id, type) {
    const meter = state.meters.find((item) => item.id === id);
    if (!meter) return;
    const existing = state.labels[id] || {};
    const today = localDate(new Date());
    document.getElementById("feedbackMeterId").value = id;
    document.getElementById("feedbackType").value = type;
    document.getElementById("feedbackTitle").textContent = workflowTypes[type] || feedbackButtons[type] || "Facit";
    document.getElementById("feedbackAddress").textContent = meter.address || id;
    document.getElementById("confirmedDateField").hidden = type === "repaired";
    document.getElementById("confirmedFields").hidden = type !== "leak";
    document.getElementById("repairFields").hidden = type !== "repaired";
    document.getElementById("noiseFields").hidden = !["seasonal", "known_noise", "district_heating", "large_building", "pump", "false_alarm", "reset_baseline"].includes(type);
    document.getElementById("feedbackDateLabel").textContent = type === "leak" ? "Datum hittad" : "Datum noterat";
    document.getElementById("confirmedDate").value = existing.confirmedDate || existing.notedDate || today;
    document.getElementById("confirmedDateUncertain").checked = Boolean(existing.confirmedDateUncertain);
    document.getElementById("repairedDate").value = existing.repairedDate || today;
    document.getElementById("distanceMeters").value = existing.distanceMeters ?? "";
    document.getElementById("distanceUncertain").checked = Boolean(existing.distanceUncertain);
    document.getElementById("feedbackNote").value = existing.note || "";
    document.querySelectorAll('input[name="lineType"]').forEach((input) => { input.checked = input.value === existing.lineType; });
    document.querySelectorAll('input[name="repairLineType"]').forEach((input) => { input.checked = input.value === existing.lineType; });
    document.querySelectorAll('input[name="noiseTag"]').forEach((input) => {
      input.checked = (existing.noiseTags || []).includes(input.value)
        || (bulkDefaults[type] || []).includes(input.value);
    });
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
      note: document.getElementById("feedbackNote").value.trim(),
      at: new Date().toISOString(),
      source: "fältfacit",
    };
    if (type === "leak") {
      next.confirmedDate = document.getElementById("confirmedDate").value || localDate(new Date());
      next.confirmedDateUncertain = document.getElementById("confirmedDateUncertain").checked;
      delete next.lineType;
    } else if (type === "repaired") {
      next.repairedDate = document.getElementById("repairedDate").value || localDate(new Date());
      next.lineType = document.querySelector('input[name="repairLineType"]:checked')?.value || "";
      next.distanceMeters = parseNumber(document.getElementById("distanceMeters").value);
      next.distanceUncertain = document.getElementById("distanceUncertain").checked;
    } else {
      next.notedDate = document.getElementById("confirmedDate").value || localDate(new Date());
      if (["seasonal", "known_noise", "district_heating", "large_building", "pump", "false_alarm", "reset_baseline"].includes(type)) {
        next.noiseTags = [...document.querySelectorAll('input[name="noiseTag"]:checked')].map((input) => input.value);
      }
    }
    state.labels[id] = next;
    saveLabels();
    document.getElementById("feedbackDialog").close();
    analyze();
  }

  document.getElementById("feedbackForm")?.addEventListener("submit", saveFieldFeedback, true);
  document.getElementById("rows")?.addEventListener("change", (event) => {
    const input = event.target.closest?.(".row-select");
    if (!input) return;
    if (input.checked) selectedMeters.add(input.dataset.id);
    else selectedMeters.delete(input.dataset.id);
    render();
  });
  document.getElementById("listTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-filter]");
    if (!button) return;
    els.filter.value = button.dataset.filter;
    selectedMeters.clear();
    render();
  });
  document.getElementById("bulkSave")?.addEventListener("click", () => {
    const searchTerms = terms(els.search.value);
    const type = document.getElementById("bulkType").value;
    const rows = selectedMeters.size > 0
      ? state.meters.filter((meter) => selectedMeters.has(meter.id))
      : state.meters.filter((meter) => matches(meter, searchTerms));
    if (!rows.length) return;
    const now = new Date().toISOString();
    for (const meter of rows) {
      const existing = state.labels[meter.id] || {};
      state.labels[meter.id] = {
        ...existing,
        type,
        address: meter.address || existing.address,
        serial: meter.serial || existing.serial,
        noiseTags: [...new Set([...(existing.noiseTags || []), ...(bulkDefaults[type] || [])])],
        notedDate: existing.notedDate || localDate(new Date()),
        at: now,
        source: "fältfacit bulk",
      };
    }
    selectedMeters.clear();
    saveLabels();
    analyze();
    els.importStatus.textContent = `${rows.length} träffar sparade som ${workflowTypes[type] || type}.`;
  });

  analyze();
}());