const test = require('node:test');
const assert = require('node:assert/strict');
const Learn = require('../src/case-learning');
const Engine = require('../src/engine');
const incident = {type:'repaired', confirmedDate:'2026-09-08', repairedDate:'2026-09-14', lineType:'AV'};
const coords = new Map([['a',{lat:59.2,lng:17.8}],['b',{lat:59.201,lng:17.8}]]);
function meter(id='a', repeat=false) {
  return {id, address:`TESTVÄGEN ${id==='a'?18:20} TUMBA 14730`, area:'TUMBA', codes:{}, latest:{ageDays:0},
    series:Array.from({length:repeat?34:28},(_,i)=>({date:new Date(2026,8,i+1,6),value:i>=7&&i<13 || repeat&&i>=31?30:10}))};
}
const build=(meters=[meter(),meter('b')], patch={}, coordinates=coords)=>Learn.build(meters,{labels:{a:{...incident,...patch}},coordinates,placeOf:Engine.placeOf});
test('registered AV case learns own and nearby rise/return, and rejects distant meters',()=>{
  const remote=meter('c');remote.address='TESTVÄGEN 21 TUMBA 14730';
  const positions=new Map([...coords,['c',{lat:59.24,lng:17.8}]]);
  const r=build([meter(),meter('b'),remote],{},positions);
  assert.equal(r.cases.length,1);assert.equal(r.cases[0].profiles.length,2);
  assert.ok(r.cases[0].profiles.every(p=>p.validated&&p.before.level===10&&p.during.level===30&&p.after.level===10));
  assert.equal(r.cases[0].profiles[1].basis,'position');assert.equal(r.matches.length,0);
});
test('address-only neighbours stay preliminary and no pipe type is guessed',()=>{
  const r=build(undefined,{},new Map());
  assert.equal(r.cases[0].profiles[0].validated,true);
  assert.equal(r.cases[0].profiles[1].validated,false);
  assert.match(r.cases[0].profiles[1].reason,/kartpositioner/);
  assert.ok(build(undefined,{lineType:'Vet ej'}).cases[0].profiles.every(p=>!p.validated));
});
test('active leaks, short events, uncertain dates and sampling gaps never train',()=>{
  for(const patch of [{repairedDate:undefined},{repairedDate:'2026-09-08'},{confirmedDateUncertain:true}])
    assert.ok(build(undefined,patch).cases[0].profiles.every(p=>!p.validated));
  const m=meter();m.series=m.series.filter((p,i)=>i!==9&&i!==10&&i!==11);
  assert.equal(build([m]).cases[0].profiles[0].validated,false);
  assert.equal(build(undefined,{repairedDate:'2026-09-07'}).cases.length,0);
});
test('same-day duplicate exports are one day, persistent heating and customer-side codes do not train',()=>{
  const thin=meter();thin.series=thin.series.filter((p,i)=>i!==9&&i!==10&&i!==11&&i!==12);thin.series.push(...thin.series.filter((p)=>p.value===30));
  assert.equal(build([thin]).cases[0].profiles[0].validated,false);
  const heat=meter();heat.series.forEach((p,i)=>{if(i>=7)p.value=30;});
  assert.equal(build([heat]).cases[0].profiles[0].validated,false);
  const customer=meter();customer.codes.leak=true;
  assert.equal(build([customer]).cases[0].profiles[0].validated,false);
});
test('later sustained repeat uses that meter own learned baseline; spikes and stale readings do not match',()=>{
  const m=meter('b',true), r=build([meter(),m]);
  assert.equal(r.matches.length,1);assert.equal(r.matches[0].id,'b');assert.equal(r.matches[0].baseline,10);
  m.series.at(-2).value=10;assert.equal(build([meter(),m]).matches.length,0);
  m.series.at(-2).value=30;m.latest.ageDays=5;assert.equal(build([meter(),m]).matches.length,0);
});
test('prior cases are retained when a new case is registered',()=>{
  const r=build(undefined,{type:'leak',confirmedDate:'2026-10-03',repairedDate:undefined,leakCases:[incident]});
  assert.equal(r.cases.length,2);assert.equal(r.cases[0].profiles[0].validated,true);
});
test('engine adds evidence without overwriting manual decisions or accumulating cached priority',()=>{
  const files=Array.from({length:34},(_,i)=>({name:`day-${i}`,exportDate:new Date(2026,8,i+1,8),rows:['a','b'].map(id=>({id,serial:id,address:meter(id).address,area:'TUMBA',readAt:new Date(2026,8,i+1,6),current:i>=7&&i<13 || i>=31?30:10,average:10}))}));
  const prepared=Engine.prepare(files), cache=new Map();
  const labels={a:incident,b:{type:'seasonal',notedDate:'2026-09-01'}};
  const r=Engine.analyzePrepared(prepared,labels,{coordinates:coords,cache});
  assert.equal(r.leakCases[0].profiles.length,2);
  assert.equal(r.meters.find(m=>m.id==='b').label.type,'seasonal');
  const again=Engine.analyzePrepared(prepared,labels,{coordinates:coords,cache});
  assert.deepEqual(r.meters.map(m=>[m.id,m.priority,m.observations]),again.meters.map(m=>[m.id,m.priority,m.observations]));
  delete labels.b;
  const automatic=Engine.analyzePrepared(prepared,labels,{coordinates:coords,cache}).meters.find(m=>m.id==='b');
  assert.ok(automatic.learnedLeakMatch);assert.notEqual(automatic.category,'confirmed');
  assert.ok(automatic.priorityParts.some(p=>p.name==='Likt registrerat läckfall'));
});
