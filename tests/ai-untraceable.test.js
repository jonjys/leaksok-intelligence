const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Plan = require('../src/review-plan');

// Synthetic plan only. The saved daily report is rendered without any network call.
function harness(review) {
  const nodes = new Map();
  const element = () => ({ textContent:'', value:'', hidden:false, disabled:false, open:false, checked:false, className:'', dataset:{}, children:[],
    addEventListener(){}, append(...n){this.children.push(...n);}, replaceChildren(...n){this.children=[...n];this.textContent='';},
    showModal(){this.open=true;}, close(){this.open=false;} });
  const document = { hidden:false, getElementById(id){ if(!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element, addEventListener(){} };
  const latestExport = new Date();
  const meter = { id:'1', address:'TESTVÄGEN 1', category:'suspect_auto', priority:60, latest:{ageDays:0}, codes:{}, excel:{F:5}, series:[{date:latestExport,value:25}], field:{state:'check'}, history:{} };
  const state = { profileId:'p', latestExport, meters:[meter], labels:{}, byId:new Map([['1',meter]]) };
  state.reviewKey = Plan.contextKey(state.meters, { latestExport });
  const evidence = { version:3, algorithmVersion:'test', cases:[{ caseId:'m1', serverCategory:'suspect_auto', confidence:'medel', historyDigest:'0'.repeat(64),
    evidence:[{ id:'m1:e1', title:'Datatäckning', detail:'Syntetiskt.', source:'test' }] }] };
  const report = { day:Plan.dayKey(), exportKey:state.reviewKey, exportDate:Plan.dayKey(), examined:1, selected:1, links:[['m1',{id:'1',address:meter.address}]], createdAt:latestExport.toISOString(),
    result:{ model:'test', createdAt:latestExport.toISOString(), promptVersion:'test', usage:{inputTokens:0,outputTokens:0}, evidence, review } };
  const window = { LeakReviewPlan:Plan, LeakApp:{state}, LeakStorage:{ loadDailyReview: async () => ({ auto:false, report }) }, addEventListener(){} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/ai-review.js'),'utf8'), { window, document, Date, Intl, Map, Set, Boolean, Number, Array, Error, JSON, AbortController,
    setTimeout:()=>0, clearTimeout(){}, fetch: async () => ({ ok:true, json: async () => ({ configured:true, authenticated:true }) }) });
  const texts = n => [n.textContent, ...n.children.flatMap(texts)];
  return { open: async () => { await window.LeakAI.openDaily(); return texts(nodes.get('aiResult')); } };
}
const review = extra => ({ summary:'Plan.', order:['m1'], sharedChecks:[], removedReferences:0,
  cases:[{ caseId:'m1', summary:'Ändrat mönster.', evidenceIds:['m1:e1'], hypotheses:[], nextChecks:['Kontrollera på plats.'], limitations:[], ...extra }] });

test('A case without valid evidence is shown as "Utan spårbara belägg" with the removed count', async () => {
  const marked = await harness({ ...review({ evidenceIds:[], untraceable:true }), removedReferences:3 }).open();
  assert.ok(marked.includes('Utan spårbara belägg'));
  assert.ok(marked.some(t => /3 ogiltiga belägghänvisningar ströks/.test(t)));
  assert.ok(marked.includes('Kontrollera på plats.'), 'The rest of the case is still shown');
});
test('A fully referenced plan and older saved plans show no marking', async () => {
  for (const r of [review({}), (() => { const old = review({}); delete old.removedReferences; return old; })()]) {
    const plain = await harness(r).open();
    assert.ok(!plain.includes('Utan spårbara belägg'));
    assert.ok(!plain.some(t => /ströks/.test(t)));
  }
});
