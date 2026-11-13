const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Plan = require('../src/review-plan');

test('An updated same-timestamp workspace marks a paid plan outdated without another automatic AI call', async () => {
  const nodes = new Map(), timers = [], posts = [];
  function element() {
    return { textContent:'', value:'', hidden:false, disabled:false, open:false, checked:false, dataset:{}, children:[], listeners:{},
      addEventListener(type,fn){this.listeners[type]=fn;},
      append(...nodes){this.children.push(...nodes);},
      replaceChildren(...nodes){this.children=[...nodes];this.textContent='';},
      showModal(){this.open=true;},close(){this.open=false;},
    };
  }
  const document = {hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},
    createElement:element,addEventListener(){}};
  const latestExport = new Date();
  const meter={id:'1',address:'TESTVÄGEN 1',category:'suspect_auto',priority:60,latest:{ageDays:0},codes:{},
    excel:{F:5},series:[{date:latestExport,value:25}],field:{state:'check'},history:{}};
  const state={profileId:'p',latestExport,meters:[meter],labels:{},byId:new Map([['1',meter]])};
  state.reviewKey=Plan.contextKey(state.meters,{latestExport});
  const report={day:Plan.dayKey(),exportKey:state.reviewKey,exportDate:Plan.dayKey(),examined:1,selected:1,
    links:[['m1',{id:'1',address:meter.address}]],createdAt:latestExport.toISOString(),
    result:{model:'test',createdAt:latestExport.toISOString(),usage:{inputTokens:0,outputTokens:0},
      review:{summary:'Sparad plan',observations:[],possibleCauses:[],nextChecks:[],limitations:[]}}};
  const window={LeakReviewPlan:Plan,LeakApp:{state},LeakStorage:{loadDailyReview:async()=>({auto:true,report})},addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/ai-review.js'),'utf8'),{window,document,Date,Intl,Map,Set,Boolean,Number,Array,Error,JSON,AbortController,
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
    fetch:async(url,options)=>{if(options.method==='POST')posts.push(url);return {ok:true,json:async()=>({configured:true,authenticated:true})};},
  });
  await window.LeakAI.openDaily();
  assert.equal(nodes.get('dailyStatusLine').textContent,'Klar för senaste exporten');
  assert.equal(nodes.get('aiRun').hidden,true);
  assert.equal(nodes.get('aiStatus').textContent,'');

  state.meters=[{...meter,excel:{F:2}}];
  state.reviewKey=Plan.contextKey(state.meters,{latestExport});
  window.LeakAI.refreshContext();
  assert.match(nodes.get('dailyStatusLine').textContent,/Underlaget har ändrats/);
  assert.match(nodes.get('aiStatus').textContent,/inte i den sparade planen/);
  assert.equal(nodes.get('aiRun').hidden,true,'A second paid daily review remains blocked');
  assert.equal(nodes.get('aiExport').hidden,false,'The original report can still be saved');
  window.LeakAI.onWorkspace();
  while(timers.length)await timers.shift()();
  assert.deepEqual(posts,[],'Context changes must never silently start a second paid review');
  assert.equal(report.exportKey===state.reviewKey,false,'The saved report keeps its original evidence identity');
});
