const assert=require('node:assert/strict');
const {detectHeatPumpSeasonality,rankMeter}=require('../src/smart-engine.js');
function series(months){return months.flatMap(([year,month,value])=>[4,12,22].map(day=>({date:new Date(Date.UTC(year,month-1,day)),readAt:new Date(Date.UTC(year,month-1,day)),current:value})));}
const cycle=series([[2024,11,65],[2024,12,70],[2025,1,68],[2025,4,35],[2025,6,9],[2025,7,10],[2025,10,40],[2025,11,67],[2025,12,72]]);
assert.equal(detectHeatPumpSeasonality(cycle).is,true,'high absolute noise can still be seasonal');
const one=series([[2025,1,70],[2025,2,68],[2025,6,9],[2025,7,10]]);
assert.equal(detectHeatPumpSeasonality(one).is,false,'a repair can mimic one winter to summer drop');
assert.equal(detectHeatPumpSeasonality(one).candidate,true);
assert.equal(detectHeatPumpSeasonality([...cycle,...series([[2026,1,180]])]).is,false,'new winter excess must break seasonal suppression');
assert.equal(detectHeatPumpSeasonality([...cycle,...series([[2026,1,180]])]).anomaly,true);
assert.equal(detectHeatPumpSeasonality(cycle.flatMap(p=>Array(4).fill(p))).winter,detectHeatPumpSeasonality(cycle).winter,'duplicate exports cannot affect monthly weights');
assert.equal(detectHeatPumpSeasonality(series([[2025,1,8],[2025,2,8],[2025,6,8],[2025,7,8],[2025,11,8],[2025,12,8]])).is,false);
const base={last:{average:10},profile:{coverage:{days:400}},reasons:[]};
const m={points:cycle,info:''};
assert.equal(rankMeter(base,m,null).category,'seasonal');
assert.equal(rankMeter(base,m,{type:'leak'}).category,'confirmed','manual fact wins');
console.log('season: 8 checks passed');
