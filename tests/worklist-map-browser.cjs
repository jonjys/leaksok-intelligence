const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const kit=require('./browser-kit.cjs');
const {buildDailyExports,toCsv}=require('./fixtures/synthetic-exports');
// Arbetslistan som egen lista: bara de mätare du lagt där, i listan och på kartan.
(async()=>{
  const server=await kit.startServer(4191),browser=await chromium.launch();
  try {
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      const page=await browser.newPage({viewport}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));await kit.routeExternal(page);
      await page.goto('http://127.0.0.1:4191/');await kit.unlock(page,'Arbetslista');
      await kit.importFiles(page,buildDailyExports({meters:300,days:20}).map(f=>({name:f.name,text:toCsv(f.rows)})));
      await page.waitForFunction(()=>state.meters.length===300);
      // Tre mätare från Alla mätare, plus en dold kategori som annars filtreras bort.
      const picked=await page.evaluate(()=>{
        const hiddenCat=state.meters.find(m=>state.excluded.has(m.category));
        const ids=state.meters.filter(m=>!state.excluded.has(m.category)).slice(5,8).map(m=>m.id);
        if(hiddenCat)ids.push(hiddenCat.id);
        LeakApp.addToWorklist(ids);return ids;
      });
      await page.locator('#openWorklist').click();
      await page.locator('#worklistDialog [data-act="map"]').click();
      await page.waitForFunction(()=>state.list==='worklist'&&state.view==='map');
      assert.equal(await page.locator('#worklistDialog').evaluate(d=>d.open),false);
      const rows=await page.locator('#rows tr.row').evaluateAll(trs=>trs.map(tr=>tr.dataset.id));
      assert.deepEqual([...rows].sort(),[...picked].sort(),'Listan visar exakt arbetslistan');
      assert.match(await page.locator('#focusTitle').textContent(),/Karta · Arbetslista/);
      if(viewport.width>760){
        assert.match(await page.locator('#rail [data-list="worklist"]').textContent(),new RegExp(`Arbetslista\\s*${picked.length}`));
      } else {
        assert.equal(await page.locator('#listSelect').inputValue(),'worklist');
      }
      // Tas en mätare bort ur arbetslistan försvinner den från listan direkt.
      await page.evaluate(id=>{state.tripList=state.tripList.filter(e=>e.id!==id);LeakApp.render();},picked[0]);
      assert.equal(await page.locator('#rows tr.row').count(),picked.length-1);
      fs.mkdirSync('test-results',{recursive:true});
      await page.screenshot({path:`test-results/worklist-map-${viewport.width}.png`});
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('Worklist map PASS: Visa på karta, own list in rail and mobile select, includes filtered categories, live removal.');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
