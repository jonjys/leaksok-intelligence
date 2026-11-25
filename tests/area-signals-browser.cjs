const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const kit = require('./browser-kit.cjs');
const {toCsv} = require('./fixtures/synthetic-exports');
const Evidence = require('../server/ai-evidence');

(async()=>{
  const server=await kit.startServer(4187), browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await kit.routeExternal(page);
    await page.route('**/api/addresses',route=>route.fulfill({json:{version:1,crs:'EPSG:3011',rows:[]}}));
    await page.goto('http://127.0.0.1:4187/');await kit.unlock(page);
    const header=['Serienummer','Adress','Område','Senaste avläsning','Senaste värde','Genomsnittsvärde'];
    const areaIds=['98100001','98100002','98100003'];
    const files=[];
    const add=(date,rows)=>files.push({name:`Områdestest ${date} 08-00.csv`,text:toCsv([header,...rows.map(r=>[...r.slice(0,3),`${date} 04:00`,...r.slice(3)])])});
    for(let i=0;i<16;i++) {
      const date=`2026-08-${String(1+i*2).padStart(2,'0')}`;
      add(date,[["98200001","VÄRMEREFERENSVÄGEN 1 TUMBA 14730","TUMBA",6,6]]);
    }
    for(let i=0;i<15;i++) {
      const date=new Date(Date.UTC(2026,9,28+i)).toISOString().slice(0,10);
      const rows=Array.from({length:5},(_,j)=>[String(98100001+j),`SAMKLANGSVÄGEN ${1+j*2} TUMBA 14730`,'TUMBA',j<3&&i>=12?40:j===3&&i===14?37:35,35]);
      if(i>=4) rows.push(['98200001','VÄRMEREFERENSVÄGEN 1 TUMBA 14730','TUMBA',18,6]);
      add(date,rows);
    }
    await kit.importFiles(page,files);await page.waitForFunction(()=>state.meters.length===6);
    await page.locator('#rail [data-list="all"]').click();
    await page.waitForFunction(()=>state.areaSignals.length===1);
    assert.equal(await page.evaluate(ids=>ids.every(id=>state.byId.get(id).category==='normal'),areaIds),true);
    await page.locator('#brief .area-signals > summary').click();
    const card=page.locator('#brief .area-signal').first();
    assert.match(await card.textContent(),/Liten gemensam ökning/);
    assert.deepEqual(await card.locator('.area-metrics strong').allTextContents(),['+5','+14 %','3','3 / 5']);
    const packet=await page.evaluate(()=>{
      const plan=LeakReviewPlan.shortlist(state.meters);
      return LeakAI.packet(plan.meters,{histories:state.prepared.histories,latestExport:state.latestExport},plan);
    });
    assert.equal(packet.cases.filter(c=>c.areaGroup?.trend?.medianDelta===5).length,3);
    assert.ok(Evidence.build(packet).cases.some(c=>c.evidence.some(e=>e.title==='Samstämmig nivåökning')));
    assert.doesNotMatch(JSON.stringify(packet),/SAMKLANGSVÄGEN|VÄRMEREFERENSVÄGEN|98100001/);
    await page.locator('#rail [data-list="dispatch"]').click();
    await page.locator('.field-lanes [data-field-lane="check"]').click();
    assert.equal(await page.evaluate(ids=>ids.every(id=>state.visible.some(m=>m.id===id)),areaIds),true);
    assert.equal(await page.locator('#rows tr.row').count(),4);
    assert.match(await page.locator('#rows').textContent(),/KONTROLLERA FÖRST/);
    await page.locator('#rail [data-list="all"]').click();
    await page.locator('#brief [data-area-signal]').first().click();
    assert.deepEqual((await page.evaluate(()=>[...state.marked])).sort(),areaIds);
    await page.locator('button[data-view="list"]').click();
    await page.locator('thead [data-sort="value"]').click();
    let values=await page.evaluate(()=>state.visible.map(m=>m.latest.value));
    assert.deepEqual(values,[...values].sort((a,b)=>b-a));
    await page.locator('thead [data-sort="value"]').click();
    values=await page.evaluate(()=>state.visible.map(m=>m.latest.value));
    assert.deepEqual(values,[...values].sort((a,b)=>a-b));
    await page.locator('thead [data-sort="change"]').click();
    const changes=await page.evaluate(()=>state.visible.map(m=>m.changePrev?.pct).filter(v=>v!=null));
    assert.deepEqual(changes,[...changes].sort((a,b)=>b-a));
    assert.equal(await page.evaluate(()=>state.visible[0].id),'98100004');
    await page.locator('thead [data-sort="excelP"]').click();
    assert.equal(await page.locator('thead [data-sort="excelP"]').evaluate(el=>el.closest('th').getAttribute('aria-sort')),'descending');
    assert.equal(await page.locator('#sortLabel').textContent(),'Mot snitt (P)');
    fs.mkdirSync('test-results',{recursive:true});
    await page.screenshot({path:'test-results/area-intelligence-desktop.png',fullPage:true});
    await page.locator('#rail .rail-more > summary').click();
    await page.locator('#rail [data-list="seasonal"]').click();
    await page.waitForFunction(()=>state.visible.length===1);
    assert.equal(await page.evaluate(()=>state.visible[0].season.status),'possible');
    assert.notEqual(await page.evaluate(()=>state.visible[0].category),'seasonal');
    assert.match(await page.locator('#rows').textContent(),/Möjlig säsong/);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>window.LeakField?.setTab(state.view));
    await page.locator('#selectionBar [data-sort="change"]').click();
    assert.equal(await page.locator('#sortLabel').textContent(),'Förändring %');
    await page.locator('#selectionBar [data-sort="value"]').click();
    assert.equal(await page.locator('#sortLabel').textContent(),'Brusvärde');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'test-results/area-intelligence-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('Area intelligence PASS: modest shared rise, 3/5 addresses, 3 simultaneous days, AI evidence, field checks, clickable sort and possible seasonality.');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
