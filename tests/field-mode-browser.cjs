const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const kit=require('./browser-kit.cjs');
const {buildDailyExports,toCsv}=require('./fixtures/synthetic-exports');
// Fältläge på telefon: Idag först, första kortet synligt direkt, bottenmeny och Mer.
(async()=>{
  const server=await kit.startServer(4192),browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await kit.routeExternal(page);
    await page.goto('http://127.0.0.1:4192/');await kit.unlock(page,'Falt');
    assert.ok(await page.locator('#today .today-empty [data-f="import"]').isVisible(),'Tom arbetsyta visar Importera');
    await kit.importFiles(page,buildDailyExports({meters:600,days:30}).map(f=>({name:f.name,text:toCsv(f.rows)})));
    await page.waitForFunction(()=>state.meters.length===600&&document.querySelector('.today-card'));
    assert.equal(await page.evaluate(()=>LeakField.tab),'today');
    assert.equal(await page.evaluate(()=>document.body.classList.contains('field-mode')),true);
    // Importen svarar på telefonen: status och sparning syns på Idag.
    assert.ok(await page.locator('#importStatus').isVisible(),'Importstatus syns på Idag');
    assert.match(await page.locator('#importStatus').textContent(),/Sparat på denna enhet/);
    assert.equal(await page.locator('.today-ai').count(),0,'Ingen AI-panel när servern saknar AI');
    // Nytt 14 dagar: bara verkliga ökningar med en start, aldrig stabil nivå.
    const freshKinds=await page.evaluate(()=>state.meters.filter(m=>LeakApp.inList(m,'fresh')).map(m=>`${m.finding.type}/${m.finding.direction}`));
    assert.ok(freshKinds.length>0,'Fixturen ger nya signaler');
    for(const kind of freshKinds)assert.match(kind,/^(level_shift|new_signal|trend)\/up$/);
    // Visa alla-knapparna pekar på listan de räknar.
    for(const more of await page.locator('.today-more').all()){
      const target=await more.getAttribute('data-target'),text=await more.textContent();
      assert.match(text,target==='dispatch'?/Åk ut/:/Nytt 14 dagar/);
      const total=await page.evaluate(t=>state.meters.filter(m=>LeakApp.inList(m,t)).length,target);
      if(target==='fresh')assert.match(text,new RegExp(`Visa alla ${total} `));
    }
    const first=await page.locator('.today-card').first().boundingBox();
    assert.ok(first.y<844-120,'Första mätarkortet syns utan att scrolla');
    for(const hidden of ['#brief','.toolbar','.workspace','.top-actions'])assert.equal(await page.locator(hidden).isVisible(),false,`${hidden} döljs på Idag`);
    const counts=await page.evaluate(()=>({dispatch:state.meters.filter(m=>m.category==='dispatch').length,fresh:state.meters.filter(m=>LeakApp.inList(m,'fresh')).length}));
    assert.equal(await page.locator('.blk.red b').textContent(),String(counts.dispatch));
    assert.equal(await page.locator('.blk.amber b').textContent(),String(counts.fresh));
    // Procent visas som procent, inte som andel.
    const pct=await page.evaluate(()=>{const id=document.querySelector('.today-card[data-meter]').dataset.meter;return Math.round(state.byId.get(id).finding.pct*100);});
    assert.match(await page.locator('.today-card[data-meter] .pct').first().textContent(),new RegExp(`${Math.abs(pct)}\\s*%`));
    // + Lista och Mer → Arbetslistan på karta.
    const id=await page.locator('.today-card[data-meter]').first().getAttribute('data-meter');
    await page.locator('.today-card[data-meter] [data-f="add"]').first().click();
    assert.equal(await page.evaluate(id=>state.tripList.some(e=>e.id===id),id),true);
    await page.locator('#fieldNav [data-tab="more"]').click();
    assert.ok(await page.locator('#fieldMore').isVisible());
    await page.locator('#fieldMore [data-more="worklist-map"]').click();
    await page.waitForFunction(()=>LeakField.tab==='map'&&state.list==='worklist'&&state.view==='map');
    assert.equal(await page.locator('#map').isVisible(),true);
    // Arbetslistans dialog → Visa på karta: kartan visas, inte Idag.
    await page.locator('#fieldNav [data-tab="today"]').click();
    await page.locator('#fieldNav [data-tab="more"]').click();
    await page.locator('#fieldMore [data-more="worklist"]').click();
    await page.locator('#worklistDialog [data-act="map"]').click();
    await page.waitForFunction(()=>LeakField.tab==='map'&&state.view==='map');
    assert.equal(await page.locator('#today').isVisible(),false,'Idag ligger inte kvar över kartan');
    assert.ok((await page.locator('#map').boundingBox()).height>200,'Kartan syns');
    // Lista: ett listval behåller listan, fliken och vyn stämmer.
    await page.locator('#fieldNav [data-tab="list"]').click();
    await page.locator('#listSelect').selectOption('suspect');
    assert.deepEqual(await page.evaluate(()=>[LeakField.tab,state.view,state.list]),['list','list','suspect']);
    assert.ok(await page.locator('#rows tr.row').first().isVisible());
    // En mätare vald ur listan visas på kartan, och grafen hamnar under kartan.
    await page.locator('#rows tr.row').first().locator('.addr').click();
    await page.waitForFunction(()=>LeakField.tab==='map'&&state.view==='map'&&state.focusId);
    await page.waitForFunction(()=>{const c=document.querySelector('#focusChart').getBoundingClientRect(),m=document.querySelector('#map').getBoundingClientRect();return m.height>100&&c.top>=m.bottom-5;});
    // Nytt-blocket öppnar listan Nytt 14 dagar.
    await page.locator('#fieldNav [data-tab="today"]').click();
    await page.locator('.blk.amber').click();
    await page.waitForFunction(()=>LeakField.tab==='list'&&state.list==='fresh'&&state.view==='list');
    assert.equal(await page.locator('#rows tr.row').count(),Math.min(counts.fresh,50));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    // Dator: inget fältläge.
    await page.setViewportSize({width:1280,height:900});
    await page.waitForFunction(()=>!document.body.classList.contains('field-mode'));
    assert.equal(await page.locator('#fieldNav').isVisible(),false);
    assert.equal(await page.locator('.toolbar').isVisible(),true);
    fs.mkdirSync('test-results',{recursive:true});
    assert.deepEqual(errors,[]);
    console.log('Field mode PASS: Idag first, first card above the fold, blocks match engine, percent, + Lista, Mer, worklist map, Nytt list, desktop unchanged.');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
