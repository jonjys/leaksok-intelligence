/* Identity-free, user-triggered second opinion. Access code stays in memory. */
(function (root) {
  const date = value => value instanceof Date && !Number.isNaN(+value) ? `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}` : null;
  function payload(meter) {
    const readings = meter.series.slice(-180).map(p => ({ date: date(p.date), value: p.value }));
    return { version: 1, readings, totalReadingDays: meter.series.length,
      exportDate: date(meter.excel.exportDate), infoCodes: Object.fromEntries(['leak','burst','dry','acousticLeak','follow'].map(k => [k, !!meter.codes[k]])),
      neighborAddresses: meter.areaSignal?.buildingCount || 0,
      minimumFlow: meter.excel.minimumFlow == null ? null : { valueLph: meter.excel.minimumFlow, date: date(meter.excel.minimumFlowAt) },
      localAssessment: { score: meter.priority, confidence: meter.confidence } };
  }
  let credential = '', active = null, controller = null;
  const results = new Map();
  const $ = id => document.getElementById(id);
  function renderResult(data) {
    const result = $('aiResult'); result.replaceChildren();
    const summary = document.createElement('p'); summary.className = 'ai-summary'; summary.textContent = data.review.summary; result.append(summary);
    for (const [key, title] of [['observations','Observationer'],['possibleCauses','Möjliga förklaringar'],['nextChecks','Nästa kontroller'],['limitations','Osäkerheter']]) {
      if (!data.review[key].length) continue;
      const h = document.createElement('h3'); h.textContent = title;
      const ul = document.createElement('ul');
      for (const text of data.review[key]) { const li = document.createElement('li'); li.textContent = text; ul.append(li); }
      result.append(h, ul);
    }
    const meta = document.createElement('p'); meta.className = 'small';
    meta.textContent = `${data.model} · ${new Date(data.createdAt).toLocaleString('sv-SE')} · ${data.usage.inputTokens + data.usage.outputTokens} token${data.cached ? ' · återanvänt svar' : ''}`;
    result.append(meta);
  }
  async function open(meter) {
    if (!meter?.series?.length) return;
    controller?.abort(); active = { data: payload(meter), key: JSON.stringify(payload(meter)) };
    $('aiMeter').textContent = meter.address;
    $('aiPayload').textContent = JSON.stringify(active.data, null, 2);
    $('aiScope').textContent = `${active.data.readings.length} senaste avläsningsdagar av ${meter.series.length}. Adress, serienummer, GPS och kommentarer stannar här.`;
    $('aiStatus').textContent = ''; $('aiResult').replaceChildren();
    $('aiAccessCode').value = credential;
    const cached = results.get(active.key); if (cached) renderResult({ ...cached, cached: true });
    $('aiRun').disabled = true;
    $('aiDialog').showModal();
    const snapshot = active;
    try {
      const response = await fetch('/api/ai-review'); const config = await response.json();
      if (active !== snapshot) return;
      $('aiRun').disabled = !config.configured;
      $('aiStatus').textContent = config.configured ? '' : config.needsAccessCode
        ? 'Aktivering: lägg LEAKSOK_AI_ACCESS_CODE (minst 24 tecken) som hemlig variabel i Vercel och gör en ny deployment. Ange samma kod här.'
        : 'Serverns Anthropic-nyckel saknas. Kontrollera Vercel-inställningarna.';
    } catch { if (active === snapshot) $('aiStatus').textContent = 'Claude-tjänsten kunde inte nås.'; }
  }
  $('aiForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!active || $('aiRun').disabled) return;
    credential = $('aiAccessCode').value; const snapshot = active;
    if (results.has(snapshot.key)) { renderResult({ ...results.get(snapshot.key), cached: true }); return; }
    controller?.abort(); controller = new AbortController();
    $('aiRun').disabled = true; $('aiStatus').textContent = 'Claude går igenom underlaget…';
    try {
      const response = await fetch('/api/ai-review', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` }, body: JSON.stringify(snapshot.data) });
      const data = await response.json(); if (!response.ok) throw Error(data.error || 'Bedömningen kunde inte hämtas.');
      results.set(snapshot.key, data); if (results.size > 32) results.delete(results.keys().next().value);
      if (active === snapshot) { renderResult(data); $('aiStatus').textContent = ''; }
    } catch (error) { if (active === snapshot) $('aiStatus').textContent = error.name === 'AbortError' ? 'Anropet avbröts. Det kan redan ha behandlats av Anthropic.' : error.message; }
    finally { if (active === snapshot) $('aiRun').disabled = false; }
  });
  $('aiDialog').addEventListener('close', () => { controller?.abort(); active = null; $('aiAccessCode').value = ''; });
  function lock() { credential = ''; results.clear(); controller?.abort(); $('aiDialog').close(); $('aiPayload').textContent = ''; $('aiResult').replaceChildren(); }
  root.LeakAI = { open, payload, lock };
}(window));
