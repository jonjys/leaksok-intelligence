const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/engine');

function files({ warmDays=16, coldDays=11, warm=6, cold=18, spike=false }={}) {
  const rows=[];
  for(let i=0;i<warmDays;i++) rows.push([new Date(2026,7,1+i*2,4),warm]);
  for(let i=0;i<coldDays;i++) rows.push([new Date(2026,10,1+i,4),spike&&i===coldDays-1?100:cold]);
  return rows.map(([readAt,current],i)=>({name:`${i}.csv`,exportDate:new Date(+readAt+4*3600000),
    rows:[{id:'s',serial:'s',address:'VÄRMEVÄGEN 1 TUMBA 14730',area:'TUMBA',readAt,current}]}));
}

test('The first sustained cold-month contrast is visible as possible seasonality, never verified',()=>{
  const m=Engine.analyzeAll(files()).meters[0];
  assert.equal(m.season.status,'possible'); assert.equal(m.season.basis,'warm-cold');
  assert.equal(m.season.cold,18); assert.equal(m.season.warm,6);
  assert.notEqual(m.category,'seasonal');
  assert.ok(!m.priorityParts.some(p=>p.name==='Möjligt säsongsmönster'), 'A first contrast must not lower the suspicion score');
  assert.match(m.explanations.join(' '),/ingen belagd återkomst/);
});

test('Thin references, only a few cold days and a late isolated spike do not create seasonality',()=>{
  for(const opts of [{warmDays:2},{coldDays:3},{warmDays:0},{warm:18,cold:18},{warm:17,cold:18}]){
    assert.equal(Engine.analyzeAll(files(opts)).meters[0].season.status,'none',JSON.stringify(opts));
  }
  const spike=Engine.analyzeAll(files({warm:6,cold:6,spike:true})).meters[0];
  assert.equal(spike.season.status,'none'); assert.equal(spike.category,'suspect_auto');
});

test('A fresh excess over the recent cold-month level is not explained away as seasonal',()=>{
  const input=files();input.at(-1).rows[0].current=60;
  const m=Engine.analyzeAll(input).meters[0];
  assert.equal(m.season.status,'none'); assert.equal(m.category,'suspect_auto');
});

test('A conflicting same-period previous year blocks the new seasonal hypothesis',()=>{
  const input=files();
  for(let i=0;i<10;i++) {
    const readAt=new Date(2025,10,i+1,4);
    input.push({name:`prior-${i}.csv`,exportDate:new Date(+readAt+4*3600000),rows:[{id:'s',address:'VÄRMEVÄGEN 1 TUMBA 14730',area:'TUMBA',readAt,current:6}]});
  }
  assert.equal(Engine.analyzeAll(input).meters[0].season.status,'none');
});
