(function networkWatch() {
  let events = [];
  let panel;
  function compute() {
    const raw = new Map(state.meters.filter(m => !MeterVisibility.hidden(state.labels[m.id]) && !["customer_side","repaired","ignored","seasonal","noise"].includes(m.category)).map(m => [m.id, {id:m.id,address:m.address,area:m.area,points:[]} ]));
    // Use original exports, before the daily minimum used by the older scorer.
    for (const file of state.files) for (const row of file.rows) {
      raw.get(row.id)?.points.push({date:row.exportDate || file.exportDate,readAt:row.readAt,current:row.current});
    }
    events = LeakNetworkEvents.detect([...raw.values()]);
    const byId = new Map(state.meters.map(m=>[m.id,m]));
    for (const event of events) for (const member of event.members) {
      const meter = byId.get(member.id);
      if (!meter || state.labels[member.id]?.type) continue;
      meter.networkEvent = event.key;
      if (['normal','learning','watch','suspect_auto'].includes(meter.category)) {
        meter.category = 'suspect_auto';
        meter.risk = Math.max(meter.risk || 0, 44);
        meter.enginePriority = Math.max(meter.enginePriority || 0, 6440);
        meter.reasons.unshift(`Gemensam ökning: ${event.members.length} mätare på samma gata, överlappande avläsningsintervall. Möjlig läcka, kontrollera.`);
      }
    }
  }
  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function draw() {
    const host = document.getElementById("networkBriefHost");
    if (!host) return;
    if (!panel) { panel = element('details', '', 'network-watch'); panel.setAttribute('aria-label','Gemensamma förändringar'); }
    if (panel.parentElement !== host) host.prepend(panel);
    const signature = JSON.stringify(events);
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    panel.replaceChildren();
    panel.hidden = !events.length;
    const header = element('summary','','network-watch-heading');
    header.append(element('span','OMRÅDESPULS','network-watch-kicker'), element('strong',events.length ? `${events.length} gemensamma förändringar` : 'Inga nya gemensamma ökningar'));
    panel.append(header);
    const help = element('p', 'Minst två adresser på samma gata, minst +50 % och +3 mot tidigare nivå. Saknad avläsning räknas inte som oförändrat brus.','network-watch-help');
    panel.append(help);
    for (const event of events) {
      const card = element('details','','network-watch-card');
      const summary = element('summary',`${event.street} · ${event.members.length} mätare · ${event.day}`);
      card.append(summary, element('p',event.persistent ? 'Möjlig gemensam läcka · ökningen finns kvar vid nya avläsningsdagar.' : 'Möjlig gemensam läcka · invänta nästa avläsning för beständighet.'));
      const list = element('div','','network-watch-members');
      const maximum = Math.max(...event.members.map(m=>m.latest));
      for (const m of event.members) {
        const button = element('button','','network-watch-meter');
        button.type = 'button';
        button.append(element('span',m.address),element('strong',`${m.baseline} → ${m.latest}  (+${Math.round(m.rise)} %)`));
        const track = element('span','','network-watch-track');
        const base = element('i','','network-watch-base'); base.style.width = `${m.baseline/maximum*100}%`;
        const now = element('i','','network-watch-now'); now.style.width = `${m.latest/maximum*100}%`;
        track.append(now,base); button.append(track);
        button.setAttribute('aria-label',`${m.address}, tidigare nivå ${m.baseline}, senaste ${m.latest}. Öppna graf`);
        button.addEventListener('click',()=>openDetail(m.id));
        list.append(button);
      }
      card.append(element('p','Grå stapel: median av tidigare avläsningsdagar. Blå: senaste värdet. Tryck på en adress för grafen.'),list);
      panel.append(card);
    }
  }
  (window.LeakAnalysisSteps ||= []).push(compute);
  const previousRender = render;
  render = function renderNetworkEvents() { previousRender(); draw(); };
  document.addEventListener('DOMContentLoaded', draw);
})();

