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
