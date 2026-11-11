/* Reuse the same deterministic engine as the app; send compact, referenced
   evidence to Claude rather than asking an LLM to recalculate time series. */
const { createHash } = require('node:crypto');
const History = require('../src/history');
const Engine = require('../src/engine');
const { MAX_CASES, MAX_RELATIONS } = require('../src/review-plan');
const VERSION = 'leaksok-evidence-2.0';
const PLAN_VERSION = 'leaksok-plan-3.0';
const DAY = 86400000;
const decisions = ['none','manual_dispatch','interesting','customer_contact','leak','repaired','seasonal','known_noise','new_install','reset_baseline','ignored','district_heating','large_building','pump','false_alarm'];
const validDate = v => typeof v === 'string' && /^20\d\d-\d\d-\d\d$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const day = v => new Date(`${v}T12:00:00Z`);
const key = v => v instanceof Date ? v.toISOString().slice(0,10) : null;
const count = v => Number.isInteger(v) && v >= 0 && v <= 10000000;
const value = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000000;
const only = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
const fail = () => { throw Error('Ogiltigt kontrollunderlag. Endast strukturerade mätuppgifter utan identiteter accepteras.'); };
function validateCase(c, i, exportDate, limit) {
  if (!only(c, ['caseId','readings','totalReadingDays','codes','minimumFlow','vendor','decision','incidents','areaGroup','importQuality','interference']) || c.caseId !== `m${i+1}`) fail();
  if (!Array.isArray(c.readings) || c.readings.length < 1 || c.readings.length > 1460 || !count(c.totalReadingDays) || c.totalReadingDays < c.readings.length) fail();
  let prev = '';
  const readings = c.readings.map(p => {
    if (!only(p,['date','value']) || !validDate(p.date) || p.date <= prev || p.date > exportDate || !value(p.value)) fail();
    prev=p.date; return { date:p.date,value:p.value };
  });
  const codes = {};
  const codeKeys=['leak','burst','dry','reverse','tamper','noConsumption','afterMeterText','acousticLeak','acousticOther','acousticUndetermined','follow'];
  if (!only(c.codes,codeKeys)) fail();
  for (const k of codeKeys) { if (typeof c.codes[k] !== 'boolean') fail(); codes[k]=c.codes[k]; }
  let minimumFlow=null;
  if (c.minimumFlow !== null) {
    const f=c.minimumFlow; if (!only(f,['valueLph','date']) || !value(f.valueLph) || (f.date !== null && !validDate(f.date))) fail();
    minimumFlow={valueLph:f.valueLph,date:f.date};
  }
  if (!only(c.vendor,['average','maximum','interestRank','exportDate']) || !validDate(c.vendor.exportDate) || c.vendor.exportDate > exportDate || c.vendor.exportDate < readings.at(-1).date) fail();
  for (const k of ['average','maximum']) if (c.vendor[k] !== null && !value(c.vendor[k])) fail();
  if (c.vendor.interestRank !== null && (!count(c.vendor.interestRank) || c.vendor.interestRank < 1)) fail();
  const d=c.decision;
  if (!only(d,['type','origin','confirmedDate','repairedDate','resetAfter','uncertain','lineType']) || !decisions.includes(d.type) || !['manual','builtin','none'].includes(d.origin) || typeof d.uncertain !== 'boolean' || !['AV','SV','unknown'].includes(d.lineType)) fail();
  for (const k of ['confirmedDate','repairedDate','resetAfter']) if (d[k] !== null && (!validDate(d[k]) || d[k] > exportDate)) fail();
  if (d.repairedDate && d.confirmedDate && d.repairedDate < d.confirmedDate) fail();
  if (!Array.isArray(c.incidents) || c.incidents.length > 5) fail();
  const incidents=c.incidents.map(r => {
    if (!only(r,['confirmedDate','repairedDate','uncertain','lineType','origin']) || !validDate(r.confirmedDate) || r.confirmedDate > exportDate || (r.repairedDate !== null && (!validDate(r.repairedDate) || r.repairedDate < r.confirmedDate || r.repairedDate > exportDate)) || typeof r.uncertain !== 'boolean' || !['AV','SV','unknown'].includes(r.lineType) || !['manual','builtin'].includes(r.origin)) fail();
    return {confirmedDate:r.confirmedDate,repairedDate:r.repairedDate,uncertain:r.uncertain,lineType:r.lineType,origin:r.origin};
  });
  let areaGroup=null;
  if (c.areaGroup !== null) {
    const g=c.areaGroup; if (!only(g,['key','meters','addresses','basis','trend']) || !/^g[1-9][0-9]?$/.test(g.key) || +g.key.slice(1) > limit || !count(g.meters) || !count(g.addresses) || g.addresses > g.meters || !['position','address'].includes(g.basis)) fail();
    areaGroup={key:g.key,meters:g.meters,addresses:g.addresses,basis:g.basis};
    if (g.trend !== undefined) {
      const t=g.trend;
      if (!only(t,['medianDelta','medianPct','simultaneousDays','support','risingAddresses','nearbyAddresses','broad'])
        || !value(t.medianDelta) || (t.medianPct !== null && !value(t.medianPct))
        || !count(t.simultaneousDays) || t.simultaneousDays > 1460
        || !value(t.support) || t.support > 1 || !count(t.risingAddresses) || !count(t.nearbyAddresses)
        || t.risingAddresses > t.nearbyAddresses || t.risingAddresses > g.addresses || typeof t.broad !== 'boolean') fail();
      areaGroup.trend={...t};
    }
  }
  if (!only(c.importQuality,['exportRows','reexports','missingValues','undated','conflicts'])) fail();
  for (const k of ['exportRows','reexports','missingValues','undated','conflicts']) if (!count(c.importQuality[k])) fail();
  if(!only(c.interference,['districtHeating','largeSubstation'])||typeof c.interference.districtHeating!=='boolean'||typeof c.interference.largeSubstation!=='boolean')fail();
  return {caseId:c.caseId,readings,totalReadingDays:c.totalReadingDays,codes,minimumFlow,vendor:{...c.vendor},decision:{...d},incidents,areaGroup,importQuality:{...c.importQuality},interference:{...c.interference}};
}
function period(points, from, to) {
  if(to<from)return {from:null,to:null,n:0,median:null,missingDays:0,coverage:0,maxGap:0,pending:true};
  const selected=points.filter(p=>p.date>=from&&p.date<=to), coverage=History.coverage(selected,from,to);
  return {from:key(from),to:key(to),n:selected.length,median:selected.length?Engine.median(selected.map(p=>p.value)):null,
    missingDays:coverage.missingDays,coverage:Math.round(coverage.coverage*1000)/1000,maxGap:coverage.maxGap};
}
function buildCase(c, exportDate, compact = false) {
  const raw=c.readings.map(p=>({id:c.caseId,address:'',serial:'',readAt:day(p.date),current:p.value}));
  const last=raw.at(-1), latest={...last,average:c.vendor.average,max:c.vendor.maximum,interestRank:c.vendor.interestRank,
    infoCode:[...['leak','burst','dry','reverse','tamper','noConsumption'].filter(k=>c.codes[k]).map(k=>k.toUpperCase()),...(c.codes.afterMeterText?['läcka efter mätaren']:[])].join(' '),
    activeEvents:[c.codes.acousticLeak?'Läckage':'',c.codes.acousticOther?'Annat brus':'',c.codes.acousticUndetermined?'Ej fastställt':''].filter(Boolean).join(' · '),follow:c.codes.follow,
    minimumFlow:c.minimumFlow?.valueLph,minimumFlowAt:c.minimumFlow?.date?day(c.minimumFlow.date):null};
  const hist=History.summarize(c.caseId,[...raw.slice(0,-1),latest],[...c.readings.slice(0,-1).map(p=>day(p.date)),day(c.vendor.exportDate)],raw.map(()=>''));
  Object.assign(hist,{rowCount:c.importQuality.exportRows,reexports:c.importQuality.reexports,missingValues:c.importQuality.missingValues,undated:c.importQuality.undated,conflicts:c.importQuality.conflicts});
  const label=c.decision.type==='none'?null:{type:c.decision.type,confirmedDate:c.decision.confirmedDate,repairedDate:c.decision.repairedDate,resetAfter:c.decision.resetAfter?`${c.decision.resetAfter}T23:59:59Z`:null,confirmedDateUncertain:c.decision.uncertain};
  const r=Engine.analyzeMeter(hist,{latestExport:day(exportDate),label,interference:c.interference});
  const facts=[];
  function add(title, detail, source='beräknat från importerade avläsningar',data=null) { const id=`${c.caseId}:e${facts.length+1}`;facts.push({id,title,detail,source,...(data===null?{}:{data})});return id; }
  const coverage=History.coverage(hist.series,hist.series[0].date,day(exportDate));
  add('Datatäckning',`${hist.series.length} avläsningsdagar av ${coverage.expectedDays} kalenderdagar, ${key(hist.series[0].date)}–${exportDate}. ${coverage.missingDays} dagar saknas. Senast ${key(hist.series.at(-1).date)}, ${Math.round((day(exportDate)-hist.series.at(-1).date)/DAY)} dagar före exporten. ${c.totalReadingDays>c.readings.length?'Äldre historik är avkortad; slutsatser gäller urvalet.':'All tillgänglig avläsningshistorik ingår.'}`);
  add('Signal och underlag',`${r.status}; ${r.summary} Underlag ${r.confidence}. Serverns basrangordning ${r.priority}/100 utan områdes- och fältfallsbonus, inte sannolikhet.`);
  if(compact && r.field) add('Fältberedskap',r.field.reason);
  if (r.changePrev) add('Senaste förändring',`${key(r.changePrev.fromDate)}: ${r.changePrev.from} → ${key(r.changePrev.toDate)}: ${r.changePrev.to}; skillnad ${Engine.fmtSigned(r.changePrev.delta)}, ${r.changePrev.pct===null?'ingen procent från noll':Engine.fmtPct(r.changePrev.pct)}.`);
  if (r.finding.ref) add('Egen jämförelsenivå',`Median ${r.finding.ref.level}; ${r.finding.ref.n} avläsningsdagar, ${key(r.finding.ref.from)}–${key(r.finding.ref.to)}. Referens tillräckligt täckt: ${r.sampling?.referenceReliable===true?'ja':'nej'}. Median är beräkning, inte värden i luckorna.`);
  if(r.finding.ref&&r.finding.now&&r.finding.delta!=null)add('Relativ förändring mot egen nivå',`${r.finding.ref.level} → ${r.finding.now.level}; skillnad ${Engine.fmtSigned(r.finding.delta)}, ${r.finding.pct==null?'procent kan inte beräknas':Engine.fmtPct(r.finding.pct)}. Nuvarande period ${key(r.finding.now.from)}–${key(r.finding.now.to)}, ${r.finding.now.n} avläsningsdagar. Detta är en annan jämförelse än sedan föregående avläsning.`);
  add('Infokoder och flöde',`${Object.entries(c.codes).filter(([,v])=>v).map(([k])=>k).join(', ')||'Inga av de exporterade kodflaggorna är satta'}. Minimiflöde: ${c.minimumFlow?`${c.minimumFlow.valueLph} l/h, datum ${c.minimumFlow.date||'saknas'}`:'saknas'}. Färskt kontinuerligt minimiflöde enligt regelmotorn: ${r.codes.minimumFlowContinuous?'ja':'nej'}. Modell, storlek, rörmaterial och tryck är okända.`,'kodflaggor/flödesfält från exporten; aktualitet beräknad');
  add('Manuellt beslut',`${c.decision.type}; källa ${c.decision.origin}; konstaterad ${c.decision.confirmedDate||'okänt'}, lagad ${c.decision.repairedDate||'okänt'}, datum osäkert ${c.decision.uncertain?'ja':'nej'}, ledningstyp ${c.decision.lineType}. Manuella beslut får inte ändras av AI.`,'lokalt registrerat beslut, inte oberoende verifierat');
  add('Importkvalitet',`${c.importQuality.exportRows} exportrader; ${c.importQuality.reexports} återexporteringar, ${c.importQuality.missingValues} saknade värden, ${c.importQuality.undated} utan giltigt datum och ${c.importQuality.conflicts} värdekonflikter.`,'importörens kvalitetsräknare; råa exportrader skickas inte');
  if(c.interference.districtHeating||c.interference.largeSubstation)add('Störmiljö',`${c.interference.districtHeating?'Fjärrvärmestörning markerad i lokal analys. ':''}${c.interference.largeSubstation?'Större undercentral/störmiljö markerad.':''}`,'störflagga från den lokala analysen; adressen skickas inte');
  if(c.areaGroup) add('Gemensam områdessignal',`${c.areaGroup.key}: ${c.areaGroup.addresses} separata adresser och ${c.areaGroup.meters} mätare, gruppering via ${c.areaGroup.basis}. Adresspunkter är inte ledningstopologi. Kontrollera spolning/driftändringar innan fältutryckning.`,'rapporterat av appens områdesanalys, inte omräknad geometri på servern');
  if(c.areaGroup?.trend){const t=c.areaGroup.trend;add('Samstämmig nivåökning',`Median av mätarnas förändringar mot egna referenser: ${Engine.fmtSigned(t.medianDelta)} i nivå, ${t.medianPct==null?'ingen procent från noll':Engine.fmtPct(t.medianPct)}. ${t.simultaneousDays} gemensamma förhöjda avläsningsdagar; medianandel förhöjda observationer ${Math.round(t.support*100)} %. ${t.risingAddresses} av ${t.nearbyAddresses} närliggande adresser ingår. ${t.broad?'Bred ökning i urvalet: kontrollera drift och säsong först.':'Lokal gemensam påverkan behöver kontrolleras.'} Procent avser avläsningsvärden, inte ljudenergi eller läcksannolikhet.`,'rapporterat av appens områdesanalys; områden, adresser och koordinater skickas inte');}
  if(r.season)add('Säsongsunderlag',`${{verified:'Återkommande årstidsmönster',possible:'Möjligt årstidsmönster',none:'Inget belagt årstidsmönster'}[r.season.status]}. ${r.season.months} observerade månader; vintermedian ${r.season.cold??'saknas'}, sommarmedian ${r.season.warm??'saknas'}, förväntad nivå ${r.season.expected??'saknas'}. Detta bevisar inte värmepanna eller pump.`);
  if(r.season?.sameTimeLastYear&&r.latest){const y=r.season.sameTimeLastYear;add('Samma period föregående år',`${key(y.from)}–${key(y.to)}: median ${y.level}, ${y.n} avläsningsdagar. Senaste värde ${r.latest.value}; ${y.level>0?Engine.fmtPct(r.latest.value/y.level-1):'ingen procent från noll'}. Historiska observationer är inte fullständig kontinuitet.`);}
  if(c.vendor.interestRank) add('Kamstrups rang',`${c.vendor.interestRank} i exporten. Motorns aktuella stöd: ${r.kamstrupInterest?'ja':'nej'}. Rang är inte läcksannolikhet.`,'leverantörsfält med serverns aktualitetskontroll');
  const incidents=c.incidents.map(incident=>{
    const start=day(incident.confirmedDate),repair=incident.repairedDate?day(incident.repairedDate):null;
    const before=period(hist.series,new Date(+start-14*DAY),new Date(+start-DAY));
    const during=period(hist.series,start,repair?new Date(+repair-DAY):day(exportDate));
    const after=repair?period(hist.series,new Date(+repair+DAY),new Date(Math.min(+repair+14*DAY,+day(exportDate)))):null;
    const item={...incident,before,during,after};
    add('Registrerat fältfall',`Konstaterad ${incident.confirmedDate}, lagad ${incident.repairedDate||'saknas'}, ledning ${incident.lineType}, osäkert datum ${incident.uncertain?'ja':'nej'}.`,'lokalt fältbeslut; periodvärden beräknade, ingen träning eller bevisad träffsäkerhet',item);
    return item;
  });
  if(r.dataQuality.length||r.missing.length) add('Reservationer',[...r.dataQuality,...r.missing].slice(0,compact?3:undefined).join(' '));
  if(compact){
    if(r.excel.P!=null) add('Mot snitt i exporten',`E ${r.excel.E}, F ${r.excel.F}; P ${Engine.fmtPct(r.excel.P)}. Avvikelse i samma exportrad, inte sannolikhet.`,'exportvärden');
    add('Senaste avläsningar','Högst fem faktiska avläsningsdagar. Luckor fylls inte.','importerade avläsningar',c.readings.slice(-5));
    return {caseId:c.caseId,evidence:facts,serverCategory:r.category,confidence:r.confidence,
      historyDigest:createHash('sha256').update(JSON.stringify(c)).digest('hex')};
  }
  const monthly=new Map();
  for(const p of hist.series){const k=key(p.date).slice(0,7);if(!monthly.has(k))monthly.set(k,[]);monthly.get(k).push(p.value);}
  const windows=[7,30,90,365].map(days=>period(hist.series,new Date(+day(exportDate)-(days-1)*DAY),day(exportDate)));
  add('Periodjämförelser','Separata fönster om 7, 30, 90 och 365 kalenderdagar. Median räknas endast från faktiska avläsningsdagar.','beräknat från importerade avläsningar',windows);
  add('Månadsmönster',`${Math.min(48,monthly.size)} av ${monthly.size} observerade månader visas; antal avläsningsdagar är n. Ingen värmekälla eller väderdata är känd.`,'beräknat från importerade avläsningar',[...monthly].slice(-48).map(([month,values])=>({month,n:values.length,median:Engine.median(values),min:Math.min(...values),max:Math.max(...values)})));
  add('Aktuell kurva','Högst 30 senaste faktiska avläsningsdagar, inte interpolerade kalenderdagar.','importerade avläsningar',c.readings.slice(-30));
  return {caseId:c.caseId,evidence:facts,serverCategory:r.category,confidence:r.confidence,
    historyDigest:createHash('sha256').update(JSON.stringify(c)).digest('hex')};
}
function build(body) {
  const compact=body?.version===3, limit=compact?MAX_CASES:8;
  const fields=['version','mode','exportDate','cases','relations',...(compact?['examined','candidates']:[])];
  if(!only(body,fields)||![2,3].includes(body.version)||!(compact?['daily','selection']:['meter','triage']).includes(body.mode)
      ||!validDate(body.exportDate)||!Array.isArray(body.cases)||body.cases.length<1||body.cases.length>limit||(body.mode==='meter'&&body.cases.length!==1))fail();
  if(compact&&(!count(body.examined)||!count(body.candidates)||body.cases.length>body.candidates||body.candidates>body.examined))fail();
  const cases=body.cases.map((c,i)=>validateCase(c,i,body.exportDate,limit)).map(c=>buildCase(c,body.exportDate,compact));
  if(body.relations!==undefined&&!Array.isArray(body.relations))fail();
  const relations=body.relations||[],pairs=new Set();if(relations.length>(compact?MAX_RELATIONS:28))fail();
  for(const r of relations){
    if(!only(r,['a','b','distanceMeters','independentAddress']))fail();
    const ai=cases.findIndex(c=>c.caseId===r.a),bi=cases.findIndex(c=>c.caseId===r.b),pair=`${r.a}|${r.b}`;
    if(ai<0||bi<=ai||pairs.has(pair)||!Number.isInteger(r.distanceMeters)||r.distanceMeters<0||r.distanceMeters>250||typeof r.independentAddress!=='boolean')fail();pairs.add(pair);
    for(const [self,other] of [[cases[ai],r.b],[cases[bi],r.a]])self.evidence.push({id:`${self.caseId}:e${self.evidence.length+1}`,title:'Närhet inom urvalet',detail:`${other}: cirka ${r.distanceMeters} m mellan adresspunkter; separat oberoende adress ${r.independentAddress?'ja':'nej/okänt'}. Detta visar inte gemensam huvudledning eller servis.`,source:'lokalt beräknat adressavstånd, inte verifierad ledningstopologi'});
  }
  return {version:body.version,algorithmVersion:compact?PLAN_VERSION:VERSION,mode:body.mode,exportDate:body.exportDate,cases,relations,
    ...(compact?{examined:body.examined,candidates:body.candidates}:{}),
    scope:compact?'Regelmotorn har gått igenom arbetsytan eller markeringen lokalt. Claude bedömer endast kortlistan. Ingen nätövergripande slutsats eller läcklokalisering.'
      :'Endast uttryckligen valda mätare. Ingen nätövergripande slutsats eller läcklokalisering. Inga identiteter eller ledningsdata.'};
}
const strings={type:'array',items:{type:'string'}};
const references={type:'array',items:{type:'string',pattern:'^m[1-9][0-9]?:e[1-9][0-9]?$'}};
const schema={type:'object',additionalProperties:false,properties:{summary:{type:'string'},order:strings,sharedChecks:strings,
  cases:{type:'array',items:{type:'object',additionalProperties:false,properties:{caseId:{type:'string'},summary:{type:'string'},evidenceIds:references,
    hypotheses:{type:'array',items:{type:'object',additionalProperties:false,properties:{explanation:{type:'string'},support:references,against:references,check:{type:'string'}},required:['explanation','support','against','check']}},
    nextChecks:{...strings,minItems:1,description:'En till tre konkreta kontroller; även säsongsfall ska ha en uppföljning. Varje punkt ska vara en kort, icke-tom text.'},limitations:strings},required:['caseId','summary','evidenceIds','hypotheses','nextChecks','limitations']}}},required:['summary','order','sharedChecks','cases']};
function schemaFor(input){
  // JSON cloning intentionally separates reused schema fragments: adding the
  // order enum must never constrain narrative lists such as limitations.
  const output=JSON.parse(JSON.stringify(schema)), ids=input.cases.map(c=>c.caseId);
  output.properties.order.items={type:'string',enum:ids};
  output.properties.cases.items.properties.caseId={type:'string',enum:ids};
  // Keep the provider grammar small. Exact selected-case evidence membership is
  // enforced by clean() against the selected server-computed evidence, never trusted.
  return output;
}
function clean(result,input){
  const fail=code=>{const error=Error('Ogiltig kontrollplan.');error.code=code;throw error;};
  const text=s=>typeof s==='string'&&s.trim().length>0&&s.length<=1500;
  const list=(a,max=6)=>Array.isArray(a)&&a.length<=max&&a.every(text);
  const caseId=id=>typeof id==='string'?(input.cases.find(c=>c.caseId.toLowerCase()===id.toLowerCase())?.caseId||id):id;
  if(!result||typeof result!=='object')fail('AI_PLAN_OBJECT');
  result=structuredClone(result);
  if(Array.isArray(result.order))result.order=result.order.map(caseId);
  if(!text(result.summary)||!list(result.order,input.cases.length)||result.order.length!==input.cases.length||new Set(result.order).size!==input.cases.length||!result.order.every(id=>input.cases.some(c=>c.caseId===id))||!list(result.sharedChecks)||!Array.isArray(result.cases)||result.cases.length!==input.cases.length)fail('AI_PLAN_STRUCTURE');
  const seen=new Set(),allEvidence=input.cases.flatMap(c=>c.evidence);
  for(const c of result.cases){
    c.caseId=caseId(c.caseId);const source=input.cases.find(s=>s.caseId===c.caseId);
    if(!source||seen.has(c.caseId))fail('AI_CASE_ID');seen.add(c.caseId);
    if(!text(c.summary))fail('AI_CASE_SUMMARY');
    if(!list(c.evidenceIds,allEvidence.length)||!c.evidenceIds.length)fail('AI_CASE_EVIDENCE_LIST');
    if(!Array.isArray(c.nextChecks))fail('AI_CASE_CHECKS_TYPE');
    if(!c.nextChecks.length)fail('AI_CASE_CHECKS_EMPTY');
    if(!list(c.nextChecks))fail('AI_CASE_CHECKS_CONTENT');
    if(!list(c.limitations))fail('AI_CASE_LIMITATIONS');
    if(!Array.isArray(c.hypotheses)||c.hypotheses.length>4)fail('AI_CASE_HYPOTHESES');
    const canonical=ids=>Array.isArray(ids)?ids.map(id=>typeof id==='string'?(allEvidence.find(e=>e.id.toLowerCase()===id.toLowerCase())?.id||id):id):ids;
    const refs=ids=>list(ids,allEvidence.length)&&ids.every(id=>allEvidence.some(e=>e.id===id));
    c.evidenceIds=canonical(c.evidenceIds);if(!refs(c.evidenceIds))fail('AI_EVIDENCE_MEMBERSHIP');
    for(const h of c.hypotheses){h.support=canonical(h.support);h.against=canonical(h.against);if(!text(h.explanation)||!refs(h.support)||!refs(h.against)||!text(h.check))fail('AI_HYPOTHESIS');}
  }
  return result;
}
const prompt=`Du är VA-driftens analysassistent. Underlaget är serverberäknat med samma regelmotor som LeakSök och beläggen har stabila ID:n. Räkna inte om värden och hitta inte på fakta. Använd både stöd och motbevis, periodtäckning, senaste datum, infokoder, manuella beslut, återgång efter lagning, säsong och samtidiga områdessignaler. Alla slutsatser gäller endast urvalet. Bevara beslut om konstaterad/lagad läcka; builtin-uppgifter är inte oberoende pilotfacit. Brist på historik eller flöde är okänt, inte normalt. Skilj sedan föregående avläsning från förändring mot egen referens. Gamla toppar är inte nya varningar. Ange inga läcksannolikheter, läckflöden, geografiska lägen eller nätkopplingar. Prioritera nästa undersökning, aldrig automatiska statusändringar. DRY och för gammal avläsning kräver datakontroll. Dämpa säkra tolkningar vid gles referens eller osäkert fältdatum.
Bakgrund: Kamstrup FILE100004503_A_EN_08.2024 beskriver kurvbeteende framför absolut brusnivå, ny bestående ökning, gradvis ökning, återkommande förändringar, grannsamband, pump-/värmestörning samt kontroll av spolning, värme, rörarbete och ny pump före utryckning. Det är kvalitativa råd, inte numeriska gränser eller bevisad träffsäkerhet för LeakSök. Brusvärdet har ingen angiven fysisk enhet. Flöde ska ha datum, kan vara legitim förbrukning och fastställer inte läckans läge. Adressnärhet bevisar inte samma ledning.
Samstämmiga ökningar hos separata närliggande adresspunkter får motivera hypotes om gemensam läcka, även på huvudledning, men ställ den mot spolning, tryck/drift och värme. Kräv ledningsuppgifter och kontroll i fält innan en sådan koppling fastställs. Anta aldrig närhet bara för att flera mätare valts.
Svara kort på svenska. order ska innehålla varje caseId exakt en gång som föreslagen kontrollordning, inte riskprocent. Ge summary och gemensamma sharedChecks utan påhittade samband. cases ska vara en lista med exakt ett fall per valt caseId. Använd bara belägg-ID:n exakt som de står i underlaget, till exempel m1:e1. Högst sex välvalda belägg i evidenceIds. Varje fall ska ha giltiga evidenceIds; varje hypotes ska ange support och against som ID-listor (tom lista om belägg saknas) samt en konkret check som kan skilja orsakerna åt. Referera giltiga belägg från de valda fallen. Gemensamma hypoteser får hänvisa till båda mätarnas faktiska belägg; ID-prefixet anger vilken mätare källan gäller. Närhet måste ha separat stöd i relationsunderlaget. Högst två hypoteser och en till tre korta nästa kontroller per fall. nextChecks får aldrig vara tom: ange uppföljning även för säsong eller låg prioritet. Högst sex punkter i sharedChecks och limitations. Varje textfält högst 1 500 tecken. Förklara vad som skulle ändra bedömningen. Ingen fri chatt, inga verktyg eller externa datakällor. Nätets topologi, modellvariant, mätarstorlek, tryck och rörmaterial saknas.`;
const planPrompt=prompt+`\nFör kortlistan: ange de mest motiverade nästa kontrollerna först, med kundsidans LEAK/BURST som en separat typ av kontroll. Var kort: högst 45 ord i varje falls sammanfattning, en hypotes, en konkret nästa kontroll och en kort osäkerhet. Ge verklig text i sharedChecks och limitations, inte fall-ID:n. Ge exakt ett fall för varje inskickad mätare. Påstå aldrig att du sett övriga mätare som bara passerat den lokala gallringen. Skillnader i rapporterat antal är inte läckor. En fältkontroll är ett förslag, och en ensam hög avläsning är inte en bekräftad läcka.`;
module.exports={build,clean,schema,schemaFor,prompt,planPrompt,VERSION,PLAN_VERSION,MAX_CASES};
