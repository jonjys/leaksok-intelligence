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
  const dayString = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value ? date(value instanceof Date ? value : new Date(value)) : null;
  function packet(meters, context = {}) {
    const groups=new Map();
    const record=(r, fallback='manual')=>({confirmedDate:dayString(r.confirmedDate),repairedDate:dayString(r.repairedDate),
      uncertain:!!r.confirmedDateUncertain,lineType:['AV','SV'].includes(r.lineType)?r.lineType:'unknown',origin:r.source==='inbyggt facit'?'builtin':fallback});
    const cases=meters.map((m,i)=>{
      const series=context.histories?.get(m.id)?.series || m.series;
      const l=m.label || {},r=record(l),g=m.areaSignal;
      if(g&&!groups.has(g.id))groups.set(g.id,`g${groups.size+1}`);
      const incidents=[...(Array.isArray(l.leakCases)?l.leakCases:[]),...(['leak','repaired'].includes(l.type)?[l]:[])].filter(r=>dayString(r.confirmedDate)).slice(-5).map(r=>record(r));
      const quality=m.history;
      return {caseId:`m${i+1}`,readings:series.slice(-1460).map(p=>({date:date(p.date),value:p.value})),totalReadingDays:series.length,
        codes:Object.fromEntries(['leak','burst','dry','reverse','tamper','noConsumption','afterMeterText','acousticLeak','acousticOther','acousticUndetermined','follow'].map(k=>[k,!!m.codes[k]])),
        minimumFlow:m.excel.minimumFlow==null?null:{valueLph:m.excel.minimumFlow,date:dayString(m.excel.minimumFlowAt)},
        vendor:{average:m.excel.F??null,maximum:m.excel.G??null,interestRank:m.excel.interestRank||null,exportDate:dayString(m.excel.exportDate)},
        decision:{...r,type:l.type||'none',origin:l.type?r.origin:'none',resetAfter:dayString(l.resetAfter)},incidents,
        areaGroup:g?{key:groups.get(g.id),meters:g.count,addresses:g.buildingCount,basis:g.basis==='position'?'position':'address'}:null,
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
    return {version:2,mode:meters.length>1?'triage':'meter',exportDate:dayString(context.latestExport||new Date(Math.max(...meters.map(m=>+m.excel.exportDate)))),cases,relations};
  }
  let credential = '', active = null, controller = null;
  const results = new Map();
  const $ = id => document.getElementById(id);
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
    const root=$('aiResult');root.replaceChildren();
    const node=(tag,text,parent,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;parent.append(n);return n;};
    const dataTable=(data,parent)=>{
      const rows=Array.isArray(data)?data:['before','during','after'].filter(k=>data[k]).map(k=>({period:{before:'Före',during:'Under',after:'Efter'}[k],...data[k]}));
      if(!rows.length)return;
      const headers=Object.keys(rows[0]),labels={date:'Datum',value:'Brusvärde',month:'Månad',n:'Avl.dagar',median:'Median',min:'Min',max:'Max',from:'Från',to:'Till',missingDays:'Saknade dagar',coverage:'Täckning',maxGap:'Största avläsningsavstånd (dagar)',period:'Period'};
      const wrap=node('div',null,parent,'ai-data-table'),table=node('table',null,wrap),head=node('tr',null,node('thead',null,table));headers.forEach(k=>node('th',labels[k]||k,head));
      const body=node('tbody',null,table);for(const row of rows){const tr=node('tr',null,body);headers.forEach(k=>node('td',row[k]==null?'–':k==='coverage'?`${Math.round(row[k]*100)} %`:String(row[k]),tr));}
    };
    node('p',data.review.summary,root,'ai-summary');
    if(data.review.order.length>1)node('p','Föreslagen kontrollordning inom ditt urval. Ingen automatisk ändring av status eller arbetslista.',root,'small');
    const checks=node('section',null,root);
    if(data.review.sharedChecks.length){node('h3','Gemensamma kontroller',checks);const ul=node('ul',null,checks);data.review.sharedChecks.forEach(s=>node('li',s,ul));}
    for(const [rank,id] of data.review.order.entries()){
      const item=data.review.cases.find(c=>c.caseId===id),facts=data.evidence.cases.find(c=>c.caseId===id),local=active.links.get(id);
      const article=node('article',null,root,'ai-case');node('h3',`${rank+1}. ${local?.address||id}`,article);node('p',item.summary,article);
      const refs=(ids,parent,prefix)=>{const row=node('p',prefix,parent,'ai-reference-row');if(!ids.length){node('span',' Inga specifika belägg i underlaget.',row);return;}
        for(const ref of ids){const owner=data.evidence.cases.find(c=>c.evidence.some(e=>e.id===ref)),fact=owner.evidence.find(e=>e.id===ref);const b=node('button',(owner.caseId===id?ref.replace(`${id}:`,''):ref).toUpperCase(),row,'ai-ref');b.type='button';b.title=`${active.links.get(owner.caseId).address} · ${fact.title}`;b.addEventListener('click',()=>{const target=document.getElementById(`ai-${ref}`);target.closest('.ai-evidence').open=true;target.scrollIntoView({block:'nearest',behavior:'smooth'});});}};
      refs(item.evidenceIds,article,'Bygger på: ');
      for(const h of item.hypotheses){const box=node('section',null,article,'ai-hypothesis');node('h4',h.explanation,box);refs(h.support,box,'Stöd: ');refs(h.against,box,'Motbelägg: ');node('p',`Skilj orsakerna åt: ${h.check}`,box);}
      node('h4','Nästa kontroller',article);const ol=node('ol',null,article);item.nextChecks.forEach(s=>node('li',s,ol));
      node('h4','Osäkerheter',article);const ul=node('ul',null,article);item.limitations.forEach(s=>node('li',s,ul));
      const details=node('details',null,article,'ai-evidence');node('summary',`Belägg och beräkningar (${facts.evidence.length})`,details);
      const dl=node('dl',null,details);
      for(const e of facts.evidence){const dt=node('dt',`${e.id.split(':')[1].toUpperCase()} · ${e.title}`,dl);dt.id=`ai-${e.id}`;const dd=node('dd',e.detail,dl);node('small',e.source,dd);if(e.data)dataTable(e.data,dd);}
      node('p',`Underlag: ${facts.confidence} · historikfingeravtryck ${facts.historyDigest.slice(0,16)}`,article,'small');
      const show=node('button','Visa mätare',article,'secondary');show.type='button';show.addEventListener('click',()=>{$('aiDialog').close();document.getElementById('chartDialog').close();window.LeakApp?.setFocus(local.id,{scroll:false});});
    }
    node('p',`${data.model} · ${new Date(data.createdAt).toLocaleString('sv-SE')} · ${data.usage.inputTokens+data.usage.outputTokens} token${data.cached?' · återanvänt svar':''} · ${data.evidence.algorithmVersion} · ${data.promptVersion}`,root,'small');
  }
  async function open(selection, context = {}) {
    const meters=Array.isArray(selection)?selection:[selection];
    if(!meters.length||meters.length>8||meters.some(m=>!m?.series?.length))return;
    controller?.abort();const data=packet(meters,context);
    active={data,key:JSON.stringify(data),links:new Map(meters.map((m,i)=>[`m${i+1}`,{id:m.id,address:m.address}]))};
    $('aiMeter').textContent=meters.length===1?meters[0].address:`Kontrollplan för ${meters.length} markerade mätare`;
    $('aiPayload').textContent = JSON.stringify(active.data, null, 2);
    $('aiScope').textContent = `${data.cases.reduce((n,c)=>n+c.readings.length,0)} avläsningsdagar i ${meters.length} fall. Upp till 1 460 dagar per mätare bearbetas på servern. Claude får komprimerade belägg och aktuell kurva. Adress, serienummer, GPS och kommentarer stannar här.`;
    $('aiStatus').textContent = ''; $('aiResult').replaceChildren();
    $('aiExport').hidden=true;
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
  $('aiExport').addEventListener('click',()=>{
    if(!active?.result)return;
    const copy=$('aiResult').cloneNode(true);copy.querySelectorAll('button').forEach(b=>b.replaceWith(document.createTextNode(b.classList.contains('ai-ref')?`[${b.textContent}] `:'')));copy.querySelectorAll('details').forEach(d=>d.open=true);
    const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const html=`<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LeakSök · Kontrollplan</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;font:14px/1.6 system-ui;color:#183242}h1,h2,h3{line-height:1.3}article{border-top:2px solid #dae4e8;padding-top:16px;margin-top:24px}h4{margin-bottom:4px}small{display:block;color:#586b78}dd{margin:3px 0 12px}dt{font-weight:bold}table{border-collapse:collapse;width:100%;font-size:11px}td,th{padding:4px;border-bottom:1px solid #dae4e8;text-align:left}pre{white-space:pre-wrap;word-break:break-word;font:11px/1.4 monospace;padding:8px;background:#f4f7f9}button{padding:8px 14px}@media print{button{display:none}body{margin:0}article{break-before:auto}h3,h4,dt{break-after:avoid}}</style><button onclick="print()">Skriv ut / spara PDF</button><h1>LeakSök · Kontrollplan</h1><p>${escape($('aiMeter').textContent)}</p><p>AI-förslag att verifiera i fält. Endast det valda urvalet. Inga beslut är ändrade. Underlag från egna Kamstrup-exporter; fristående komplement, ingen uppgift om partnerskap.</p>${copy.innerHTML}</html>`;
    const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`leaksok-kontrollplan-${new Date().toISOString().slice(0,10)}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  });
  function lock() { credential = ''; results.clear(); controller?.abort(); $('aiDialog').close(); $('aiPayload').textContent = ''; $('aiResult').replaceChildren(); }
  root.LeakAI = { open, payload, packet, lock };
}(window));
