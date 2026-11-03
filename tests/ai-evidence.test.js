const test=require('node:test');const assert=require('node:assert/strict');
const Evidence=require('../server/ai-evidence');const {createHandler}=require('../api/ai-review');
function fixture(values=Array.from({length:30},(_,i)=>i<25?5:15)){
  return {version:2,mode:'meter',exportDate:'2026-10-31',cases:[{caseId:'m1',readings:values.map((value,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,value})),totalReadingDays:values.length,
    codes:Object.fromEntries(['leak','burst','dry','reverse','tamper','noConsumption','afterMeterText','acousticLeak','acousticOther','acousticUndetermined','follow'].map(k=>[k,false])),minimumFlow:null,
    vendor:{average:5,maximum:15,interestRank:null,exportDate:'2026-10-31'},
    decision:{type:'none',origin:'none',confirmedDate:null,repairedDate:null,resetAfter:null,uncertain:false,lineType:'unknown'},incidents:[],areaGroup:null,
    importQuality:{exportRows:values.length,reexports:0,missingValues:0,undated:0,conflicts:0},interference:{districtHeating:false,largeSubstation:false}}]};
}
function result(input){return {summary:'Kontrollera förändringen.',order:input.cases.map(c=>c.caseId),sharedChecks:[],cases:input.cases.map(c=>({caseId:c.caseId,summary:'Ändrat mönster.',evidenceIds:[c.evidence[0].id],hypotheses:[{explanation:'En hypotes.',support:[c.evidence[0].id],against:[],check:'Jämför efter kontroll.'}],nextChecks:['Kontrollera på plats.'],limitations:['Ingen bekräftelse från brus ensamt.']}))};}
test('Server evidence uses the existing engine, actual coverage and labelled reference windows',()=>{
 const e=Evidence.build(fixture()),c=e.cases[0];assert.ok(c.evidence.some(f=>f.title==='Egen jämförelsenivå'));
 assert.equal(c.evidence.find(e=>e.title==='Periodjämförelser').data[1].n,29);assert.equal(c.evidence.find(e=>e.title==='Aktuell kurva').data.length,30);assert.match(c.evidence[0].detail,/1 dagar saknas/);
 assert.equal(c.evidence.find(e=>e.title==='Månadsmönster').data[0].median,5);assert.equal(c.historyDigest.length,64);
 assert.ok(!c.evidence.some(e=>/exporterats 2 gånger/.test(e.detail)),'Adding latest export metadata must not invent a reexport');
});
test('Sparse annual history cannot become a stable high claim',()=>{
 const f=fixture();f.cases[0].readings=[{date:'2026-01-01',value:384},{date:'2026-07-01',value:385},{date:'2026-10-30',value:394}];f.cases[0].totalReadingDays=3;f.cases[0].vendor.average=null;
 const c=Evidence.build(f).cases[0];assert.equal(c.serverCategory,'sparse_history');assert.equal(c.confidence,'tunt');
 assert.match(c.evidence[0].detail,/301 dagar saknas/);assert.doesNotMatch(c.evidence.find(e=>e.title==='Signal och underlag').detail,/stabilt hög/i);
});
test('Dates, identities, instructions and too many cases are rejected before provider use',()=>{
 for(const mutate of [f=>f.cases[0].address='PRIVATE',f=>f.cases[0].decision.comment='PRIVATE',f=>f.cases[0].codes.prompt='instruction',f=>f.cases[0].readings[1].date=f.cases[0].readings[0].date,f=>f.cases[0].vendor.exportDate='2026-01-01',f=>f.cases[0].areaGroup={key:'PRIVATE',addresses:2,meters:2,basis:'address'},f=>{f.mode='triage';f.cases=Array.from({length:9},(_,i)=>({...f.cases[0],caseId:`m${i+1}`}));}]){const f=fixture();mutate(f);assert.throws(()=>Evidence.build(f));}
});
test('Manual repair, uncertain dates and own before/during/after periods remain explicit',()=>{
 const f=fixture(Array.from({length:30},(_,i)=>i<10?5:i<18?15:5));f.cases[0].decision={type:'repaired',origin:'manual',confirmedDate:'2026-10-11',repairedDate:'2026-10-19',resetAfter:null,uncertain:true,lineType:'SV'};
 f.cases[0].incidents=[{confirmedDate:'2026-10-11',repairedDate:'2026-10-19',uncertain:true,lineType:'SV',origin:'manual'}];
 const c=Evidence.build(f).cases[0],incident=c.evidence.find(e=>e.title==='Registrerat fältfall').data;assert.equal(c.serverCategory,'repaired');assert.equal(incident.before.median,5);assert.equal(incident.during.median,15);assert.equal(incident.after.median,5);assert.equal(incident.uncertain,true);
});
test('Old vendor rank and missing dated flow cannot imply current supplier interest or continuous flow',()=>{
 const f=fixture([5,5,5]);f.cases[0].vendor={average:5,maximum:5,interestRank:1,exportDate:'2026-10-03'};f.cases[0].minimumFlow={valueLph:20,date:null};
 const c=Evidence.build(f).cases[0];assert.match(c.evidence.find(e=>e.title==='Kamstrups rang').detail,/stöd: nej/);assert.match(c.evidence.find(e=>e.title==='Infokoder och flöde').detail,/minimiflöde enligt regelmotorn: nej/);
});
test('Anonymous groups stay hypotheses about shared influence, never pipeline topology',()=>{
 const f=fixture();f.mode='triage';f.cases.push({...structuredClone(f.cases[0]),caseId:'m2'});f.cases.forEach(c=>c.areaGroup={key:'g1',meters:5,addresses:3,basis:'address'});
 const e=Evidence.build(f);assert.equal(e.cases.length,2);assert.match(e.cases[0].evidence.find(e=>e.title==='Gemensam områdessignal').detail,/3 separata adresser.*inte ledningstopologi/);
});
test('Claude cannot fabricate evidence IDs, borrow another case reference or omit/duplicate ranking entries',()=>{
 const f=fixture();f.mode='triage';f.cases.push({...structuredClone(f.cases[0]),caseId:'m2'});const e=Evidence.build(f);
 assert.doesNotThrow(()=>Evidence.clean(result(e),e));
 for(const mutate of [r=>r.cases[0].evidenceIds=['made-up'],r=>r.cases[0].hypotheses[0].support=['m2:e1'],r=>r.order=['m1','m1'],r=>r.cases.pop()]){const r=result(e);mutate(r);assert.throws(()=>Evidence.clean(r,e));}
});
test('Selected neighbours have anonymous proximity evidence, while invalid pair identities cannot pass',()=>{
 const f=fixture();f.mode='triage';f.cases.push({...structuredClone(f.cases[0]),caseId:'m2'});f.relations=[{a:'m1',b:'m2',distanceMeters:35,independentAddress:true}];
 const e=Evidence.build(f);assert.match(e.cases[0].evidence.find(x=>x.title==='Närhet inom urvalet').detail,/m2.*35 m.*oberoende adress ja.*inte gemensam huvudledning/);
 f.relations.push({...f.relations[0]});assert.throws(()=>Evidence.build(f));f.relations=[{a:'m1',b:'not-selected',distanceMeters:35,independentAddress:true}];assert.throws(()=>Evidence.build(f));
});
test('Changing old data invalidates the audit fingerprint even outside the recent curve',()=>{
 const f=fixture(),a=Evidence.build(f).cases[0].historyDigest;f.cases[0].readings[0].value=6;assert.notEqual(Evidence.build(f).cases[0].historyDigest,a);
});
test('The v2 endpoint forwards computed evidence, validates references, caches and keeps v1 compatibility',async()=>{
 const code='synthetic-access-code-at-least-24';let calls=0,modelInput;
 const h=createHandler({env:{ANTHROPIC_API_KEY:'not-real',LEAKSOK_AI_ACCESS_CODE:code},fetcher:async(url,opts)=>{
   calls++;modelInput=JSON.parse(JSON.parse(opts.body).messages[0].content);
   return {ok:true,json:async()=>({model:'test',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result(modelInput))}],usage:{input_tokens:100,output_tokens:100}})};
 }});
 const run=async()=>{let status,data;const res={setHeader(){},status(n){status=n;return this},json(v){data=v},end(){}};await h({method:'POST',headers:{authorization:`Bearer ${code}`,'content-type':'application/json',host:'example.test'},body:fixture()},res);return {status,data}};
 const a=await run(),b=await run();assert.equal(a.status,200);assert.equal(calls,1);assert.equal(b.data.cached,true);assert.equal(a.data.promptVersion,'field-plan-2.0');assert.ok(modelInput.cases[0].evidence);assert.equal(modelInput.cases[0].readings,undefined);
});
test('Two years at 8 followed by 14 yields a +75% own-reference change and a prior-year comparison',()=>{
 const f=fixture(),start=Date.parse('2024-11-01'),end=Date.parse('2026-11-03');f.exportDate='2026-11-03';
 const readings=[];for(let at=start;at<=end;at+=86400000)readings.push({date:new Date(at).toISOString().slice(0,10),value:at>=Date.parse('2026-10-29')?14:8});
 Object.assign(f.cases[0],{readings,totalReadingDays:readings.length});f.cases[0].vendor={average:8,maximum:14,interestRank:null,exportDate:f.exportDate};
 const c=Evidence.build(f).cases[0];assert.equal(c.serverCategory,'suspect_auto');assert.match(c.evidence.find(e=>e.title==='Relativ förändring mot egen nivå').detail,/8 → 14.*75 %/);assert.match(c.evidence.find(e=>e.title==='Samma period föregående år').detail,/median 8.*75 %/);
});
test('Repeated heating cycles are recognised, while a fresh excess above the usual winter level remains suspicious',()=>{
 const f=fixture(),readings=[];for(let at=Date.parse('2024-11-01');at<=Date.parse('2026-11-03');at+=86400000){const d=new Date(at),month=d.getUTCMonth()+1;readings.push({date:d.toISOString().slice(0,10),value:[11,12,1,2].includes(month)?30:8});}
 f.exportDate='2026-11-03';Object.assign(f.cases[0],{readings,totalReadingDays:readings.length});f.cases[0].vendor={average:30,maximum:40,interestRank:null,exportDate:f.exportDate};
 assert.equal(Evidence.build(f).cases[0].serverCategory,'seasonal');
 f.cases[0].readings.slice(-3).forEach(p=>p.value=40);
 const c=Evidence.build(f).cases[0];assert.equal(c.serverCategory,'suspect_auto');assert.match(c.evidence.find(e=>e.title==='Samma period föregående år').detail,/33 %/);
});
test('LEAK and BURST route into customer-side checks without inventing a main-line leak',()=>{
 for(const flag of ['leak','burst','afterMeterText']){const f=fixture();f.cases[0].codes[flag]=true;assert.equal(Evidence.build(f).cases[0].serverCategory,'customer_side');}
});
module.exports={fixture,result};
