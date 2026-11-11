const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const kit=require('./browser-kit.cjs');
const {buildDailyExports,toCsv}=require('./fixtures/synthetic-exports');
(async()=>{
  const server=await kit.startServer(4188),browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await kit.routeExternal(page);
    await page.goto('http://127.0.0.1:4188/');await kit.unlock(page,'Studio');
    await kit.importFiles(page,buildDailyExports({meters:300,days:20}).map(f=>({name:f.name,text:toCsv(f.rows)})));
    await page.waitForFunction(()=>state.meters.length===300);
    assert.equal(await page.locator('.brand-mark').count(),1);
    assert.equal(await page.locator('.brief-row > .brief-stats button').count(),3);
    fs.mkdirSync('test-results',{recursive:true});
    await page.screenshot({path:'test-results/studio-list-desktop.png',fullPage:true});
    await page.locator('button[data-view="map"]').click();
    await page.locator('#rows tr.row').first().locator('[data-mark]').check();
    const before=await page.evaluate(()=>({focus:state.focusId,marked:[...state.marked]}));
    const map=await page.locator('#map').boundingBox();
    await page.locator('.table-wrap').evaluate(el=>{el.scrollTop=120;});
    await page.waitForFunction(()=>document.querySelector('.table-wrap').dataset.scrollEdge==='middle');
    assert.deepEqual(await page.locator('#map').boundingBox(),map);
    assert.equal(await page.evaluate(()=>scrollY),0);
    await page.screenshot({path:'test-results/studio-map-desktop.png'});
    for(const viewport of [{width:1100,height:900},{width:980,height:780},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
      assert.deepEqual(await page.evaluate(()=>({focus:state.focusId,marked:[...state.marked]})),before);
      if(viewport.width===390)await page.screenshot({path:'test-results/studio-mobile.png',fullPage:true});
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#selectionBar [data-sort="value"]').click();
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#rows tr.row')].some(el=>el.getAnimations().length>0)),false);
    assert.deepEqual(errors,[]);
    console.log('Studio PASS: responsive overview, independent scroll, preserved selection, direct sort and reduced motion.');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
