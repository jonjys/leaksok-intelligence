// Read-only integration check: Python extraction JSON on stdin, production JS parser and scoring.
const assert=require('node:assert/strict');
const {app,context}=require('./workflow-harness')();
let input='';
process.stdin.on('data',chunk=>input+=chunk);
process.stdin.on('end',async()=>{
  try {
    const sources=JSON.parse(input);
    for(const source of sources) {
      const parsed=await app.parseWorkbook({name:source.name,arrayBuffer:async()=>source.table});
      app.state.files.push({...parsed,name:source.name});
      console.log(source.name,parsed.rows.length+' användbara mätarrader');
    }
    app.analyze();
    const counts={}; for(const m of app.state.meters)counts[m.category]=(counts[m.category]||0)+1;
    console.log('Mätare:',app.state.meters.length,'Listor:',counts);
    const result = app.state.meters.map(m=>[m.id,m.category,m.risk,m.engine.points]);
    app.state.files.reverse(); app.analyze();
    assert.deepEqual(app.state.meters.map(m=>[m.id,m.category,m.risk,m.engine.points]),result,'Import order invariant');
    for(const id of ['54366369','54366361','54366370','12856662','12777133']) {
      const m=app.state.meters.find(x=>x.id===id);
      assert.ok(m); console.log(m.address,m.category,'risk',m.risk,'unika dagar',m.engine.points,'glapp',m.engine.staleReadDays);
      assert.ok(m.engine.points < m.points.length,'Repeated exports must not create fresh readings');
    }
    assert.equal(app.state.meters.find(x=>x.id==='12856662').category,'customer_side');
    for(const id of ['54366369','54366361','54366370']) assert.equal(app.state.meters.find(x=>x.id===id).category,'suspect_auto');
    assert.notEqual(app.state.meters.find(x=>x.id==='12777133').category,'dispatch');
    assert.ok(app.state.meters.every(m=>m.category!=='repaired'),'No automatic repairs without labels');
    console.log('Five-export integration: PASS');
  }catch(error){console.error(error);process.exitCode=1;}
});
