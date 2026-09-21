const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/../src/field-workflow.js','utf8');
const section=src.slice(src.indexOf('  const districts ='),src.indexOf('  function refreshAreaFilter'));
const ctx={normalize:s=>s.toLowerCase()};vm.createContext(ctx);vm.runInContext(section+';this.town=meterTown;',ctx);
for(const [area,want] of [['FITTJA','Fittja'],['NORSBORG','Hallunda-Norsborg'],['HALLUNDA','Hallunda-Norsborg'],['TUMBA','Tumba-Storvreten'],['STORVRETEN','Tumba-Storvreten'],['GRÖDINGE','Vårsta-Grödinge'],['VÅRSTA','Vårsta-Grödinge'],['ALBY','Alby'],['TULLINGE','Tullinge']])assert.equal(ctx.town({area}),want);
assert.equal(ctx.town({address:'ALBYVÄGEN 1 TULLINGE'}),'Tullinge');
const k={state:{labels:{a:{type:'repaired'}}}};vm.createContext(k);vm.runInContext(fs.readFileSync(__dirname+'/../src/kamstrup-codes.js','utf8'),k);
assert.equal(k.KamstrupCodes.applyCodes({id:'a',info:'LEAK',category:'repaired'}).category,'repaired');
assert.equal(k.KamstrupCodes.applyCodes({id:'b',info:'LEAK',category:'normal'}).category,'customer_side');
assert.equal(k.KamstrupCodes.applyCodes({id:'b',closedEvents:'LEAK',category:'normal'}).category,'normal');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');const nav=html.slice(html.indexOf('<nav'),html.indexOf('</nav>'));
assert.deepEqual([...nav.matchAll(/data-filter="([^"]+)"/g)].map(m=>m[1]),['all','dispatch','suspect','watch','confirmed','repaired','ignored','seasonal','customer_side','learning','stale_contact','hidden']);
assert.ok(!fs.readFileSync(__dirname+'/../src/desk-layout.js','utf8').includes('interceptSelectAll'));
console.log('menu: district mapping, assignments, order and complete selection passed');

