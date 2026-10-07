const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const kit = require('./browser-kit.cjs');
const {buildDailyExports,toCsv} = require('./fixtures/synthetic-exports.js');
(async()=>{
  const server=await kit.startServer(4179), browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Europe/Stockholm'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await kit.routeExternal(page);
  // Nearby exact house-number hits; no existing cached positions are seeded.
  await page.route('https://nominatim.openstreetmap.org/**',route=>{
    const street=new URL(route.request().url()).searchParams.get('street');
    const number=street?.match(/(\d+)$/)?.[1];
    return route.fulfill({json:[{lat:String(59.2+(Number(number)-18)*0.0002),lon:'17.8',address:{road:'TESTVÄGEN',house_number:number,postcode:'14730'}}]});
  });
  try{
    await page.goto('http://127.0.0.1:4179/',{waitUntil:'load'});await kit.unlock(page,'Läckfall','1234');
    const files=buildDailyExports({meters:2,days:28,end:'2026-09-28'}).map((f,i)=>{
      f.rows=[f.rows[0], ...f.rows.slice(1,3).map((r,j)=>[r[0],`TESTVÄGEN ${18+j*2} TUMBA 14730`,'TUMBA',r[3],i>=7&&i<13?30:10,10,35,'','',''])];
      return {name:f.name,text:toCsv(f.rows)};
    });
    await kit.importFiles(page,files);
    await page.waitForFunction(()=>state.byId.has("90000001"));
    await page.locator('button[data-view="map"]').click();
    await page.evaluate(()=>LeakApp.setFocus('90000001',{scroll:false}));
    await page.locator('#focusMenu').click();await page.locator('#contextMenu [data-decision="leak"]').click();
    await page.locator('[name="confirmedDate"]').fill('2026-09-08');
    await page.locator('[name="repairedDate"]').fill('2026-09-14');
    await page.locator('[name="lineType"][value="AV"]').check();await page.locator('#decisionSave').click();
    await page.waitForFunction(()=>state.leakCases[0]?.profiles.filter(p=>p.validated).length===2);
    assert.equal(await page.evaluate(()=>state.labels['90000001'].type),'repaired');
    assert.equal(await page.evaluate(()=>state.labels['90000002']?.type),undefined,'Learning does not invent a neighbour decision');
    await page.locator('#rows tr[data-id="90000001"] [data-act="expand"]').click();
    await page.locator('.case-evidence summary').click();
    assert.match(await page.locator('.case-evidence').innerText(),/10 \(7 d\) → 30 \(6 d\) → 10 \(14 d\)/);
    fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/learned-neighbours.png'});
    await page.reload({waitUntil:'load'});await kit.unlock(page,null,'1234');
    await page.waitForFunction(()=>state.leakCases[0]?.profiles.filter(p=>p.validated).length===2);
    assert.deepEqual(errors,[]);
    console.log('Case learning PASS: both dates + AV, automatic neighbour geocoding, per-meter before/during/after evidence, retained decisions and reload.');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
