process.env.TZ = 'UTC';
const assert = require('node:assert/strict');
const harness = require('./workflow-harness.js');
const { context, workflow } = harness();
const nodes = new Map();
const makeNode = () => ({dataset:{},style:{setProperty(){}},classList:{add(){},toggle(){}},addEventListener(){},querySelectorAll(){return [];}});
const host = {...makeNode(),innerHTML:'',querySelector(selector) {
  if (!this.innerHTML) return null;
  if (!nodes.has(selector)) nodes.set(selector,makeNode());
  return nodes.get(selector);
}};
context.document.createElement = () => host;
let attached = false;
const container = {...makeNode(),id:'preview-test',querySelector:()=>attached?host:null,appendChild(){attached=true;},getBoundingClientRect:()=>({width:640,height:340})};
const meter = {id:'test',address:'Testmätare',points:[
  {date:new Date('2026-09-01'),readAt:new Date('2026-09-01'),current:0,average:0},
  {date:new Date('2026-09-08'),readAt:new Date('2026-09-07'),current:8,average:4},
  {date:new Date('2026-09-10'),readAt:new Date('2026-09-07'),current:8,average:4},
]};
workflow.renderLeakSignalChart(container,meter,true);
assert.doesNotMatch(host.innerHTML,/NaN|Infinity/);
assert.match(host.innerHTML,/2026-09-07/);
assert.doesNotMatch(host.innerHTML,/fill="#f1f4f7"/);
assert.match(host.innerHTML,/<b>—<\/b>/); // Previous zero must never produce +700%.
assert.match(host.innerHTML,/aria-label="Förstora graf"/);
assert.match(host.innerHTML,/viewBox="0 0 616 218"/);
assert.doesNotMatch(host.innerHTML,/class="signal-pulse /); // Compact chart has no extra bar strip.
assert.equal(host.dataset.pointCount,'2'); // Duplicate exports do not create extra observations.
host.dataset.comparisonPeriod='90';
workflow.renderLeakSignalChart(container,meter,true);
assert.match(nodes.get('.signal-comparison-summary').innerHTML,/Avläsning saknas/);
assert.doesNotMatch(nodes.get('.signal-chart-stage').innerHTML,/NaN|Infinity/);
// The expanded graph must keep circular points and readable text, with no bar panel.
workflow.renderLeakSignalChart(container, {...meter,id:'sparse',points:[
 {date:new Date('2025-12-17'),readAt:new Date('2025-12-17'),current:120},
 {date:new Date('2026-06-01'),readAt:new Date('2026-06-01'),current:45},
 {date:new Date('2026-09-09'),readAt:new Date('2026-09-09'),current:112},
]}, false);
assert.match(host.innerHTML, /preserveAspectRatio="xMidYMid meet"/);
assert.match(host.innerHTML, /Datalucka mellan avläsningar/);
assert.match(host.innerHTML, /signal-gap-connector/);
assert.doesNotMatch(host.innerHTML, /fill="#f1f4f7"/);
assert.doesNotMatch(host.innerHTML, /signal-pulse|Mediantrend|NaN|Infinity/);
assert.equal((host.innerHTML.match(/class="signal-line current"/g)||[]).length,3);
workflow.renderLeakSignalChart(container,{...meter,id:'single',points:[{date:new Date('2026-09-09'),current:42}]},false);
assert.doesNotMatch(host.innerHTML,/NaN|Infinity/);
assert.equal((host.innerHTML.match(/class="signal-date"/g)||[]).length,1, 'One reading has a single date tick');
console.log('chart render tests: ok');
