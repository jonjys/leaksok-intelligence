/* Local shortlist and daily journal. The server remembers an authorised
   browser in an HttpOnly cookie; only anonymous measurement evidence is sent. */
(function (root) {
  const ReviewPlan = root.LeakReviewPlan;
  const date = value => value instanceof Date && !Number.isNaN(+value) ? `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}` : null;
  function payload(meter) {
    const readings = meter.series.slice(-180).map(p => ({ date: date(p.date), value: p.value }));
    return { version: 1, readings, totalReadingDays: meter.series.length,
      exportDate: date(meter.excel.exportDate), infoCodes: Object.fromEntries(['leak','burst','dry','acousticLeak','follow'].map(k => [k, !!meter.codes[k]])),
      neighborAddresses: meter.areaSignal?.buildingCount || 0,
      minimumFlow: meter.excel.minimumFlow == null ? null : { valueLph: meter.excel.minimumFlow, date: date(meter.excel.minimumFlowAt) },
      localAssessment: { score: meter.priority, confidence: meter.confidence } };
  }
  const dayString = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value ? date(value instanceof Date ? value : new Date(value)) : null;
  function packet(meters, context = {}, plan = null) {
    const exportDate = dayString(context.latestExport || new Date(Math.max(...meters.map(m => +m.excel.exportDate))));
    const knownDate = value => { const d = dayString(value); return d && d <= exportDate ? d : null; };
    const groups=new Map();
    const record=(r, fallback='manual')=>({confirmedDate:knownDate(r.confirmedDate),repairedDate:knownDate(r.repairedDate),
      uncertain:!!r.confirmedDateUncertain,lineType:['AV','SV'].includes(r.lineType)?r.lineType:'unknown',origin:r.source==='inbyggt facit'?'builtin':fallback});
    const cases=meters.map((m,i)=>{
      const series=context.histories?.get(m.id)?.series || m.series;
      const l=m.label || {},r=record(l),g=m.areaSignal;
      if(g&&!groups.has(g.id))groups.set(g.id,`g${groups.size+1}`);
      const incidents=[...(Array.isArray(l.leakCases)?l.leakCases:[]),...(['leak','repaired'].includes(l.type)?[l]:[])].map(r=>record(r)).filter(r=>r.confirmedDate&&(!r.repairedDate||r.repairedDate>=r.confirmedDate)).slice(-5);
      const quality=m.history;
      return {caseId:`m${i+1}`,readings:series.slice(-1460).map(p=>({date:date(p.date),value:p.value})),totalReadingDays:series.length,
        codes:Object.fromEntries(['leak','burst','dry','reverse','tamper','noConsumption','afterMeterText','acousticLeak','acousticOther','acousticUndetermined','follow'].map(k=>[k,!!m.codes[k]])),
        minimumFlow:m.excel.minimumFlow==null?null:{valueLph:m.excel.minimumFlow,date:dayString(m.excel.minimumFlowAt)},
        vendor:{average:m.excel.F??null,maximum:m.excel.G??null,interestRank:m.excel.interestRank||null,exportDate:dayString(m.excel.exportDate)},
        decision:{...r,type:['watch','suspect'].includes(l.type)?'interesting':l.type||'none',origin:l.type?r.origin:'none',resetAfter:knownDate(l.resetAfter)},incidents,
        areaGroup:g?{key:groups.get(g.id),meters:g.count,addresses:g.buildingCount,basis:g.basis==='position'?'position':'address',
          ...(g.stats?{trend:{medianDelta:g.stats.medianDelta,medianPct:g.stats.medianPct,
            simultaneousDays:g.stats.simultaneousDays,support:g.stats.support,
            risingAddresses:g.neighborhood.rising,nearbyAddresses:g.neighborhood.total,broad:!!g.broad}}:{})}:null,
        importQuality:Object.fromEntries(['exportRows','reexports','missingValues','undated','conflicts'].map(k=>[k,quality[k]||0])),
        interference:{districtHeating:!!m.interference?.districtHeating,largeSubstation:!!m.interference?.largeSubstation}};
    });
    const relations=[];
    for(let i=0;i<meters.length;i++)for(let j=i+1;j<meters.length;j++){
      const a=root.LeakMap?.cachedPosition(meters[i]),b=root.LeakMap?.cachedPosition(meters[j]);
      if(!a||!b||a.approximate||b.approximate)continue;
      const rad=x=>x*Math.PI/180,h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
      const distance=12742000*Math.asin(Math.sqrt(Math.min(1,h)));if(distance>250)continue;
      const ap=root.LeakAddressIndex?.parseAddress(meters[i]),bp=root.LeakAddressIndex?.parseAddress(meters[j]);
      const distinct=!!ap&&!!bp&&(ap.street!==bp.street||ap.house!==bp.house||ap.city!==bp.city);
      relations.push({a:`m${i+1}`,b:`m${j+1}`,distanceMeters:Math.round(distance),independentAddress:distinct&&distance>=5});
    }
    if (!plan) return {version:2,mode:meters.length>1?'triage':'meter',exportDate,cases,relations};
    // Prefer independent close pairs. A single dense block must not drown
    // the report in duplicated comparisons.
    relations.sort((a,b)=>Number(b.independentAddress)-Number(a.independentAddress)||a.distanceMeters-b.distanceMeters);
    const degree=new Map(), selected=[];
    for(const r of relations){
      if((degree.get(r.a)||0)>=3||(degree.get(r.b)||0)>=3)continue;
      selected.push(r);degree.set(r.a,(degree.get(r.a)||0)+1);degree.set(r.b,(degree.get(r.b)||0)+1);
      if(selected.length===ReviewPlan.MAX_RELATIONS)break;
    }
    const packet={version:3,mode:plan.mode,examined:plan.examined,candidates:plan.candidates,exportDate,cases,relations:selected};
    if(plan.mode==='daily'){
      const memory=ReviewPlan.memory(context.previousReport,meters,context.labels);
      packet.previousPlan=memory?.previousPlan||null;
      if(memory)cases.forEach((c,i)=>{c.previous=memory.cases[i];});
    }
    return packet;
  }
  let active = null, operation = null, owner = null, journal = {}, epoch = 0;
  let config = null, configAt = 0, configRequest = null, autoTimer = 0, sessionBusy = false;
  const results = new Map();
  const $ = id => document.getElementById(id);
  const dialog = $('aiDialog');
  const number = n => n.toLocaleString('sv-SE');
  const workspace = () => {
    const s = root.LeakApp?.state;
    return s?.profileId && !$('profileDialog').open ? s : null;
  };
  const contextOf = s => ({ histories: s.prepared?.histories, latestExport: s.latestExport, reviewKey: s.reviewKey, labels: s.labels });
  const exportKey = s => s?.reviewKey || `${s?.latestExport?.toISOString() || ''}|${ReviewPlan.ALGORITHM}`;
  const scopeText = (plan, daily = false) => `${number(plan.examined)} ${daily ? 'mätare granskade lokalt' : 'markerade'} · ${number(plan.candidates)} relevanta · ${number(plan.meters.length)} i AI-underlaget${plan.vendorSelected ? `, varav ${plan.vendorSelected} rekommenderade av Kamstrup` : ''}. Adresser, serienummer och kommentarer stannar här.`;
  function renderLegacy(data) {
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
  function renderResult(data) {
    if(active)active.result=data;
    $('aiExport').hidden=false;
    if(!data.evidence){renderLegacy(data);return;}
    const container=$('aiResult');container.replaceChildren();
    const node=(tag,text,parent,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;parent.append(n);return n;};
    const dataTable=(data,parent)=>{
      const rows=Array.isArray(data)?data:['before','during','after'].filter(k=>data[k]).map(k=>({period:{before:'Före',during:'Under',after:'Efter'}[k],...data[k]}));
      if(!rows.length)return;
      const headers=Object.keys(rows[0]),labels={date:'Datum',value:'Brusvärde',month:'Månad',n:'Avl.dagar',median:'Median',min:'Min',max:'Max',from:'Från',to:'Till',missingDays:'Saknade dagar',coverage:'Täckning',maxGap:'Största avläsningsavstånd (dagar)',period:'Period'};
      const wrap=node('div',null,parent,'ai-data-table'),table=node('table',null,wrap),head=node('tr',null,node('thead',null,table));headers.forEach(k=>node('th',labels[k]||k,head));
      const body=node('tbody',null,table);for(const row of rows){const tr=node('tr',null,body);headers.forEach(k=>node('td',row[k]==null?'–':k==='coverage'?`${Math.round(row[k]*100)} %`:String(row[k]),tr));}
    };
    const compact=data.evidence.version===3;
    node('p',data.review.summary,container,'ai-summary');
    if(data.review.order.length>1)node('p','Föreslagen kontrollordning för kortlistan. Dina beslut och arbetslistan ändras inte.',container,'small');
    const checks=node('section',null,container);
    if(data.review.sharedChecks.length){node('h3','Gemensamma kontroller',checks);const ul=node('ul',null,checks);data.review.sharedChecks.forEach(s=>node('li',s,ul));}
    let more;
    for(const [rank,id] of data.review.order.entries()){
      const item=data.review.cases.find(c=>c.caseId===id),facts=data.evidence.cases.find(c=>c.caseId===id),local=active.links.get(id);
      if(compact&&rank===ReviewPlan.FIELD_PREVIEW){more=node('details',null,container,'ai-more');node('summary',`Visa ${data.review.order.length-ReviewPlan.FIELD_PREVIEW} till granskade mätare`,more);}
      const article=node('article',null,more||container,compact?'ai-case ai-case-compact':'ai-case');
      const head=node('div',null,article,'ai-case-head');
      node('span',String(rank+1),head,'ai-rank');
      node('h3',local?.address||id,head);
      const status=root.LeakMeterView?.statuses[local?.category||facts.serverCategory]?.label;
      if(status)node('span',status,head,`pill cat-${local?.category||facts.serverCategory}`);
      if(item.untraceable)node('span','Utan spårbara belägg',head,'pill');
      node('p',item.summary,article,'ai-case-summary');
      if(item.untraceable)node('p','Claude angav inga giltiga belägg för det här fallet. Texten kan inte spåras till underlaget; kontrollera mot kurvan innan du agerar.',article,'small');
      if(compact&&item.nextChecks.length){
        const next=node('div',null,article,'ai-next');
        node('b','Börja här',next);node('p',item.nextChecks[0],next);
      }else if(item.nextChecks.length){
        node('h4','Nästa kontroll',article);const ol=node('ol',null,article);item.nextChecks.forEach(s=>node('li',s,ol));
      }
      const full=compact?node('details',null,article,'ai-reasoning'):article;
      if(compact){
        node('summary',item.nextChecks.length>1?'Fler kontroller och belägg':'Motivering och belägg',full);
        if(item.nextChecks.length>1){
          const ol=node('ol',null,full);ol.start=2;item.nextChecks.slice(1).forEach(s=>node('li',s,ol));
        }
      }
      const refs=(ids,parent,prefix)=>{const row=node('p',prefix,parent,'ai-reference-row');if(!ids.length){node('span',' Inga specifika belägg i underlaget.',row);return;}
        for(const ref of ids){const source=data.evidence.cases.find(c=>c.evidence.some(e=>e.id===ref));if(!source)continue;
          const fact=source.evidence.find(e=>e.id===ref),b=node('button',(source.caseId===id?ref.replace(`${id}:`,''):ref).toUpperCase(),row,'ai-ref');
          b.type='button';b.title=`${active.links.get(source.caseId)?.address||source.caseId} · ${fact.title}`;
          b.addEventListener('click',()=>{const target=document.getElementById(`ai-${ref}`);if(!target)return;
            for(let detail=target.closest('details');detail;detail=detail.parentElement.closest('details'))detail.open=true;
            target.scrollIntoView({block:'nearest',behavior:'smooth'});});}};
      refs(item.evidenceIds,full,'Bygger på: ');
      for(const h of item.hypotheses){const box=node('section',null,full,'ai-hypothesis');node('h4',h.explanation,box);refs(h.support,box,'Stöd: ');refs(h.against,box,'Motbelägg: ');node('p',`Skilj orsakerna åt: ${h.check}`,box);}
      if(item.limitations.length){node('h4','Osäkerheter',full);const ul=node('ul',null,full);item.limitations.forEach(s=>node('li',s,ul));}
      const details=node('details',null,full,'ai-evidence');node('summary',`Belägg och beräkningar (${facts.evidence.length})`,details);
      const dl=node('dl',null,details);
      for(const e of facts.evidence){const dt=node('dt',`${e.id.split(':')[1].toUpperCase()} · ${e.title}`,dl);dt.id=`ai-${e.id}`;const dd=node('dd',e.detail,dl);node('small',e.source,dd);if(e.data)dataTable(e.data,dd);}
      node('p',`Underlag: ${facts.confidence} · historikfingeravtryck ${facts.historyDigest.slice(0,16)}`,full,'small');
      if(local&&root.LeakApp?.state.byId.has(local.id)){
        const actions=node('div',null,article,'ai-case-actions');
        const show=node('button','Visa mätare',actions,'secondary');show.type='button';show.addEventListener('click',()=>{dialog.close();$('chartDialog').close();root.LeakApp.setFocus(local.id,{scroll:false});});
        const add=node('button','Lägg i arbetslista',actions,'secondary');add.type='button';add.addEventListener('click',()=>{root.LeakApp.addToWorklist([local.id]);add.textContent='Tillagd';add.disabled=true;});
      }
    }
    if(data.review.removedReferences)node('p',`${number(data.review.removedReferences)} ${data.review.removedReferences===1?'ogiltig belägghänvisning ströks':'ogiltiga belägghänvisningar ströks'} ur Claudes svar. Resten av planen är oförändrad.`,container,'small');
    node('p',`${data.model} · ${new Date(data.createdAt).toLocaleString('sv-SE')} · ${data.usage.inputTokens+data.usage.outputTokens} token${data.cached?' · återanvänt svar':''} · ${data.evidence.algorithmVersion} · ${data.promptVersion}`,container,'small');
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      const error = Error(body?.error || 'AI-tjänsten kunde inte nås.');
      error.status = response.status;
      throw error;
    }
    return body;
  }
  const post = (url, body, signal) => request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  function getConfig(force = false) {
    if (!force && config && Date.now() - configAt < 30000) return Promise.resolve(config);
    if (!configRequest) configRequest = request('/api/ai-review').then(value => {
      config = value; configAt = Date.now(); return config;
    }).finally(() => { configRequest = null; });
    return configRequest;
  }

  async function loadJournal(s) {
    const generation = epoch, profile = s.profileId;
    const value = await root.LeakStorage.loadDailyReview(profile);
    if (generation !== epoch || workspace()?.profileId !== profile) return false;
    owner = profile;
    journal = value;
    return true;
  }
  function adopt(profile, generation, value) {
    if (workspace()?.profileId !== profile || generation !== epoch) return;
    owner = profile; journal = value;
  }
  function dailyDisposition(s) {
    const day = ReviewPlan.dayKey(), key = exportKey(s);
    if (journal.report?.exportKey === key) return 'cached';
    if (journal.attempt?.status === 'running' && Date.now() - journal.attempt.startedAt < 150000) return 'running';
    if (journal.report?.day === day && journal.report.result) return 'done';
    if (journal.attempt?.day === day && journal.attempt.status !== 'done') return 'retry';
    return 'start';
  }
  function refreshBadge() {
    const s = workspace(), button = $('dailyButton'), note = $('dailyStatusLine');
    if (!s || !button || !note) return;
    const state = owner === s.profileId ? dailyDisposition(s) : 'start';
    const running = operation?.kind === 'daily' || state === 'running';
    const report = owner === s.profileId && journal.report;
    button.textContent = running ? 'Visa pågående' : state === 'cached' || state === 'done' ? 'Visa plan' : 'Granska idag';
    note.textContent = running ? 'Granskar prioriterade signaler…'
      : state === 'cached' ? (report?.result ? 'Klar för senaste exporten' : 'Inga nya fall att granska')
      : state === 'done' ? 'Underlaget har ändrats · visa sparad plan'
      : state === 'retry' ? 'Senaste granskningen avbröts'
      : journal.auto ? (config && !config.authenticated ? 'Aktivera AI för automatisk granskning' : 'Automatisk efter dagens import')
      : `${number(s.meters.length)} mätare · en plan per dag`;
    note.dataset.state = running ? 'running' : state;
  }
  function draft(kind, meters, context) {
    const plan = ReviewPlan.shortlist(meters, kind, context.labels);
    const links = new Map(plan.meters.map((m, i) => [`m${i+1}`, { id: m.id, address: m.address, category: m.category }]));
    return { kind, plan, context, links, exportKey: exportKey(context), data: null, result: null, message: '' };
  }
  function evidencePacket(snapshot) {
    const { plan, context } = snapshot;
    if (!snapshot.data && plan.meters.length) {
      // Yesterday's plan comes from this profile's own journal, read when the packet is built.
      const previousReport = snapshot.kind === 'daily' && owner === workspace()?.profileId ? journal.report : null;
      snapshot.data = packet(plan.meters, { ...context, previousReport }, snapshot.kind === 'daily' || plan.examined > 1 ? plan : null);
    }
    return snapshot.data;
  }
  function showReport(snapshot, report) {
    if (!report || snapshot.rendered === report.createdAt) return;
    snapshot.rendered = report.createdAt;
    $('aiMeter').textContent = `Granskad export ${report.exportDate} · ${number(report.examined)} lokalt · ${report.selected} hos Claude`;
    $('aiResult').replaceChildren();
    if (report.result) {
      snapshot.links = new Map(report.links);
      renderResult(report.result);
    } else {
      const p = document.createElement('p'); p.className = 'ai-summary';
      p.textContent = 'Inga aktuella kontrollförslag i exporten. Den lokala genomgången är klar; inget AI-anrop behövdes.';
      $('aiResult').append(p);
    }
  }
  function updateControls() {
    refreshBadge();
    if (!active || !dialog.open) return;
    const daily = active.kind === 'daily', s = workspace();
    const disposition = daily && s ? dailyDisposition(s) : 'start';
    const busy = Boolean(operation) || disposition === 'running';
    const currentPlan = daily && journal.report?.exportKey === active.exportKey;
    if (daily) showReport(active, journal.report);
    $('aiScope').textContent = scopeText(active.plan, daily);
    $('aiDailySettings').hidden = !daily;
    if (daily) $('aiAuto').checked = journal.auto ?? !config?.authenticated;
    $('aiAuto').disabled = !s || sessionBusy;
    $('aiLoginForm').hidden = !config?.configured || Boolean(config.authenticated);
    $('aiLogin').disabled = sessionBusy;
    $('aiDisconnect').hidden = !config?.authenticated;
    $('aiDisconnect').disabled = busy || sessionBusy;
    $('aiData').hidden = !active.plan.meters.length || Boolean(daily && journal.report && !currentPlan);
    $('aiRun').hidden = !(config?.authenticated || (daily && !active.plan.meters.length)) || ['done','cached'].includes(disposition) || Boolean(active.result && !daily);
    $('aiRun').disabled = busy || sessionBusy || !s || s.importing;
    $('aiRun').textContent = disposition === 'retry' ? 'Försök igen' : daily ? 'Kör dagens granskning' : 'Granska urvalet';
    const status = busy ? (operation?.kind === 'selection' ? 'AI granskar urvalet…' : 'AI går igenom dagens prioriterade signaler…')
      : active.message ? active.message
      : daily && journal.report && !currentPlan ? 'Underlaget har ändrats sedan planen skapades. Nya avläsningar, historik, beslut eller kartpositioner ingår inte i den sparade planen. Nästa dags granskning använder det aktuella underlaget. Du kan AI-granska en markerad mätare separat.'
      : disposition === 'retry' ? journal.attempt?.message || 'Körningen slutfördes inte. Försök igen manuellt.'
      : config && !config.configured ? 'AI är inte aktiverad på servern. Kontrollera serverns inställningar.'
      : !config ? 'Kontrollerar AI-anslutningen…'
      : '';
    $('aiStatus').textContent = status;
  }
  function startDialog(snapshot, title, subheading) {
    active = snapshot;
    $('aiTitle').textContent = title;
    $('aiMeter').textContent = subheading;
    $('aiResult').replaceChildren();
    $('aiStatus').textContent = '';
    $('aiPayload').textContent = '';
    $('aiData').open = false;
    $('aiAccessCode').value = '';
    $('aiExport').hidden = true;
    if (!dialog.open) dialog.showModal();
    updateControls();
  }
  async function open(selection, context = {}) {
    if (!workspace()) return;
    const meters = (Array.isArray(selection) ? selection : [selection]).filter(Boolean);
    const snapshot = draft('selection', meters, context);
    if (!snapshot.plan.meters.length) return;
    startDialog(snapshot, meters.length === 1 ? 'Granska mätare' : 'Kontrollplan för markeringen',
      meters.length === 1 ? meters[0].address : `${number(meters.length)} markerade mätare`);
    try { await getConfig(); } catch (error) { if (active === snapshot) snapshot.message = error.message; }
    updateControls();
  }
  async function openDaily() {
    const s = workspace(); if (!s?.latestExport) return;
    const snapshot = draft('daily', s.meters, contextOf(s));
    startDialog(snapshot, 'Dagens granskning', `Senaste export ${dayString(s.latestExport)}`);
    try { await Promise.all([loadJournal(s), getConfig()]); }
    catch (error) { if (active === snapshot) snapshot.message = error.message; }
    updateControls();
  }

  function reportFor(snapshot, result, run) {
    return { day: run.day, exportKey: run.exportKey, exportDate: dayString(snapshot.context.latestExport),
      createdAt: new Date().toISOString(), examined: snapshot.plan.examined, candidates: snapshot.plan.candidates,
      selected: snapshot.plan.meters.length, links: [...snapshot.links], result };
  }
  async function runDaily(manual) {
    const s = workspace(); if (!s?.latestExport || s.importing || operation || sessionBusy) return;
    const today = ReviewPlan.dayKey(), profile = s.profileId, generation = epoch;
    if (!manual && (document.hidden || !journal.auto || dayString(s.latestExport) !== today || dailyDisposition(s) !== 'start')) return;
    const snapshot = draft('daily', s.meters, contextOf(s));
    const run = { id: crypto.randomUUID(), day: today, exportKey: snapshot.exportKey, startedAt: Date.now() };
    const job = { kind: 'daily', controller: new AbortController() };
    operation = job;
    let reserved = false;
    try {
      if (snapshot.plan.meters.length && !(await getConfig()).authenticated) return;
      if (generation !== epoch || workspace()?.profileId !== profile || (!manual && document.hidden)) return;
      const claim = await root.LeakStorage.reserveDailyReview(profile, run, manual);
      adopt(profile, generation, claim.record);
      if (claim.kind !== 'start') return;
      reserved = true;
      if (generation !== epoch || job.controller.signal.aborted) throw Error('Granskningen avbröts.');
      updateControls();
      const data = evidencePacket(snapshot);
      const result = data ? await post('/api/ai-review', data, job.controller.signal) : null;
      const value = await root.LeakStorage.finishDailyReview(profile, run.id, reportFor(snapshot, result, run));
      adopt(profile, generation, value);
    } catch (error) {
      if (error.status === 401 && config) config.authenticated = false;
      const message = error.name === 'AbortError' ? 'Granskningen avbröts. Du kan försöka igen manuellt.' : error.message;
      if (reserved) {
        try { adopt(profile, generation, await root.LeakStorage.finishDailyReview(profile, run.id, null, message)); }
        catch { /* retain the reservation; do not silently retry */ }
      }
      if (active?.kind === 'daily' && generation === epoch) active.message = message;
    } finally {
      if (operation === job) operation = null;
      updateControls();
    }
  }
  async function runSelection() {
    if (!active || active.kind !== 'selection' || operation || !workspace() || !config?.authenticated) return;
    const snapshot = active, data = evidencePacket(snapshot), key = JSON.stringify(data);
    if (results.has(key)) { renderResult({ ...results.get(key), cached: true }); updateControls(); return; }
    const job = { kind: 'selection', controller: new AbortController() };
    operation = job; snapshot.message = ''; updateControls();
    try {
      const result = await post('/api/ai-review', data, job.controller.signal);
      if (job.controller.signal.aborted) return;
      results.set(key, result); if (results.size > 8) results.delete(results.keys().next().value);
      if (active === snapshot) renderResult(result);
    } catch (error) {
      if (error.status === 401 && config) config.authenticated = false;
      if (active === snapshot) snapshot.message = error.message;
    } finally {
      if (operation === job) operation = null;
      updateControls();
    }
  }
  function refreshContext() {
    const s = workspace(); if (!s) return;
    if (active?.kind === 'daily' && active.exportKey !== exportKey(s)) {
      active = draft('daily', s.meters, contextOf(s));
      $('aiMeter').textContent = `Senaste export ${dayString(s.latestExport)}`;
      $('aiResult').replaceChildren(); $('aiData').open = false; $('aiExport').hidden = true;
    }
    updateControls();
  }
  function onWorkspace() {
    clearTimeout(autoTimer);
    if (!workspace()) return;
    autoTimer = setTimeout(async () => {
      const s = workspace(); if (!s || s.importing || document.hidden) return;
      try {
        if (!await loadJournal(s)) return;
        refreshContext();
        if (journal.auto) await runDaily(false);
      } catch (error) {
        if (active?.kind === 'daily') { active.message = error.message; updateControls(); }
      }
    }, 500);
  }

  $('aiRun').addEventListener('click', () => {
    if (active) active.message = '';
    if (active?.kind === 'daily') runDaily(true);
    else runSelection();
  });
  $('aiLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const s = workspace(), snapshot = active;
    if (!s || !snapshot || sessionBusy) return;
    const code = $('aiAccessCode').value.trim(), auto = snapshot.kind === 'daily' && $('aiAuto').checked;
    $('aiAccessCode').value = '';
    sessionBusy = true; snapshot.message = ''; updateControls();
    try {
      await post('/api/ai-session', { code });
      await getConfig(true);
      if (!config.authenticated) throw Error('Webbläsaren kunde inte spara AI-sessionen.');
      if (snapshot.kind === 'daily') adopt(s.profileId, epoch, await root.LeakStorage.setDailyAuto(s.profileId, auto));
      onWorkspace();
    } catch (error) { if (active === snapshot) snapshot.message = error.message; }
    finally { sessionBusy = false; updateControls(); }
  });
  $('aiDisconnect').addEventListener('click', async () => {
    if (operation || sessionBusy) return;
    sessionBusy = true; updateControls();
    try { await request('/api/ai-session', { method: 'DELETE' }); if (config) config.authenticated = false; results.clear(); }
    catch (error) { if (active) active.message = error.message; }
    finally { sessionBusy = false; updateControls(); }
  });
  $('aiAuto').addEventListener('change', async () => {
    const s = workspace(); if (!s || active?.kind !== 'daily') return;
    const generation = epoch;
    try {
      adopt(s.profileId, generation, await root.LeakStorage.setDailyAuto(s.profileId, $('aiAuto').checked));
      updateControls(); onWorkspace();
    } catch (error) { if (active) { active.message = error.message; updateControls(); } }
  });
  $('aiData').addEventListener('toggle', () => {
    if ($('aiData').open && active) $('aiPayload').textContent = JSON.stringify(evidencePacket(active), null, 2);
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    active = null; $('aiAccessCode').value = ''; $('aiPayload').textContent = ''; $('aiResult').replaceChildren();
  });
  window.addEventListener('focus', onWorkspace);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onWorkspace(); });
  $('aiExport').addEventListener('click',()=>{
    if(!active?.result)return;
    const copy=$('aiResult').cloneNode(true);copy.querySelectorAll('button').forEach(b=>b.replaceWith(document.createTextNode(b.classList.contains('ai-ref')?`[${b.textContent}] `:'')));copy.querySelectorAll('details').forEach(d=>d.open=true);
    const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const html=`<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LeakSök · Kontrollplan</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;font:14px/1.6 system-ui;color:#183242}h1,h2,h3{line-height:1.3}article{border-top:2px solid #dae4e8;padding-top:16px;margin-top:24px}h4{margin-bottom:4px}small{display:block;color:#586b78}dd{margin:3px 0 12px}dt{font-weight:bold}table{border-collapse:collapse;width:100%;font-size:11px}td,th{padding:4px;border-bottom:1px solid #dae4e8;text-align:left}pre{white-space:pre-wrap;word-break:break-word;font:11px/1.4 monospace;padding:8px;background:#f4f7f9}button{padding:8px 14px}@media print{button{display:none}body{margin:0}article{break-before:auto}h3,h4,dt{break-after:avoid}}</style><button onclick="print()">Skriv ut / spara PDF</button><h1>LeakSök · Kontrollplan</h1><p>${escape($('aiMeter').textContent)}</p><p>AI-förslag att verifiera i fält. Endast det valda urvalet. Inga beslut är ändrade. Underlag från egna Kamstrup-exporter; fristående komplement, ingen uppgift om partnerskap.</p>${copy.innerHTML}</html>`;
    const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`leaksok-kontrollplan-${new Date().toISOString().slice(0,10)}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  });
  function lock() {
    epoch++; owner = null; journal = {}; results.clear(); clearTimeout(autoTimer);
    operation?.controller.abort(); operation = null;
    dialog.close(); active = null; $('aiAccessCode').value = ''; $('aiPayload').textContent = ''; $('aiResult').replaceChildren();
  }
  async function clearDaily(profile) {
    lock();
    try { adopt(profile, epoch, await root.LeakStorage.resetDailyReview(profile)); }
    catch { /* import history has already been cleared */ }
    refreshBadge();
  }
  root.LeakAI = { open, openDaily, payload, packet, lock, onWorkspace, clearDaily, refreshBadge, refreshContext };
}(window));

