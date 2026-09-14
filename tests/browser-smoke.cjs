const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = process.cwd();
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server = http.createServer((req,res)=>{
  const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain'});res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
(async()=>{
  fs.mkdirSync('test-results',{recursive:true});
  await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
  const browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Stockholm'});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://nominatim.openstreetmap.org/**',route=>route.fulfill({json:[{
    lat:'59.20',lon:'17.83',display_name:'TESTVÄGEN 1',address:{house_number:'1',road:'TESTVÄGEN',postcode:'14730'}
  }]}));
  try {
    await page.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'});
    await page.locator('#profileName').fill('Test');
    await page.locator('#profileCode').fill('1234');
    await page.locator('#profileForm button').click();
    await page.waitForFunction(()=>!document.getElementById('profileDialog').open);
    const csv=(date,value)=>'Serienummer;Adress;Senaste avläsning;Senaste värde;Genomsnittsvärde;Infokod;Område\n1;TESTVÄGEN 1 TUMBA 14730;'+date+' 04:00;'+value+';5;;TUMBA';
    async function upload(date,value) {
      await page.locator('#fileInput').setInputFiles({name:'export.csv',mimeType:'text/csv',buffer:Buffer.from('Export '+date+' 06:30\n'+csv(date,value))});
      await page.waitForFunction(()=>!state.importing);
    }
    await upload('2026-09-13',5);
    await upload('2026-09-14',10);
    assert.equal(await page.evaluate(()=>state.files.length),2,'Same-name daily files retain history');
    assert.equal(await page.evaluate(()=>state.meters[0].category),'suspect_auto');
    assert.match(await page.locator('.metrics-cell').innerText(),/100%/);
    assert.match(await page.locator('#morningBrief').innerText(),/100/);
    await page.locator('[data-morning-meter="1"]').click();
    await page.waitForSelector('.preview-chart .signal-chart-stage svg');
    assert.equal(await page.locator('#meterPreview .preview-chart').count(),1,'Chart stays in responsive DOM');
    await page.locator('#rows tr').click({button:'right'});
    await page.locator('[data-context-action="visibility"]').click();
    assert.equal(await page.evaluate(()=>state.labels['1'].hidden),true);
    await page.locator('[data-filter="hidden"]').click();
    await page.locator('#rows tr').click({button:'right'});
    await page.locator('[data-context-action="visibility"]').click();
    await page.locator('[data-filter="all"]').click();
    await page.evaluate(()=>selectLeakMeter('1'));
    await page.waitForSelector('.preview-chart .signal-chart-stage svg');
    await page.screenshot({path:'test-results/desktop-1440.png',fullPage:true});
    await page.setViewportSize({width:1366,height:768});
    await page.screenshot({path:'test-results/desktop-1366.png',fullPage:true});
    assert.ok(await page.locator('.table-wrap').isVisible());
    await page.locator('#rows tr').click({button:'right'});
    await page.locator('#contextGroupSelect').selectOption('repaired');
    await page.locator('[data-context-action="save"]').click();
    await page.locator('#repairedDate').fill('2026-09-14');
    await page.locator('input[name="repairLineType"][value="SV"]').check();
    await page.locator('#distanceMeters').fill('55');
    await page.locator('#saveFeedback').click();
    await page.waitForFunction(()=>state.labels['1']?.distanceMeters===55);
    await page.reload({waitUntil:'networkidle'});
    await page.locator('#profileCode').fill('1234');
    await page.locator('#profileForm button').click();
    await page.waitForFunction(()=>!document.getElementById('profileDialog').open);
    assert.equal(await page.evaluate(()=>state.files.length),2);
    assert.equal(await page.evaluate(()=>state.labels['1'].distanceMeters),55);
    assert.equal(await page.evaluate(()=>state.meters[0].category),'repaired');
    // Real XLSX bytes, including a cover sheet before the meter sheet.
    await page.waitForFunction(()=>typeof XLSX!=='undefined');
    const bytes=await page.evaluate(()=>{
      const workbook=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Omslag']]),'Info');
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
        ['Serienummer','Adress','Senaste avläsning','Senaste värde','Genomsnittsvärde'],
        ['2','TESTVÄGEN 2 TUMBA 14730','2026-09-14 04:00',6,3]
      ]),'Mätare');
      return Array.from(new Uint8Array(XLSX.write(workbook,{type:'array',bookType:'xlsx'})));
    });
    await page.locator('#fileInput').setInputFiles({name:'2026-09-14 06-30.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
    await page.waitForFunction(()=>!state.importing);
    assert.equal(await page.evaluate(()=>state.meters.length),2);
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-filter="all"]').click();
    await page.evaluate(()=>selectLeakMeter('1'));
    await page.screenshot({path:'test-results/mobile-390.png',fullPage:true});
    assert.equal(await page.locator('#meterPreview .preview-chart').count(),1,'Resize does not orphan chart');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true,'No mobile horizontal overflow');
    assert.deepEqual(errors,[],'No browser runtime exceptions');
    console.log('Browser: CSV + XLSX, small rise, hidden menu, repair form, persisted reload, desktop and mobile passed.');
  } catch(e) {
    await page.screenshot({path:'test-results/failure.png',fullPage:true}).catch(()=>{});
    throw e;
  } finally { await browser.close();server.close(); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
