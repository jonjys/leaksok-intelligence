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
    await page.waitForTimeout(450); // Leaflet flyTo animation, not an application readiness gate.
    const tableBox=await page.locator('.table-wrap').boundingBox();
    assert.ok(tableBox.y < 900,'Desktop must show first work rows without scrolling');
    await page.screenshot({path:'test-results/desktop-1440.png',fullPage:true});
    console.log('REVIEW_DESKTOP:'+(await page.screenshot({type:'jpeg',quality:35})).toString('base64'));
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
    await page.waitForFunction(()=>!document.getElementById('feedbackDialog').open);
    assert.equal(await page.evaluate(()=>state.labels['1'].distanceMeters),55);
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
    console.log('REVIEW_MOBILE:'+(await page.screenshot({type:'jpeg',quality:35})).toString('base64'));
    assert.equal(await page.locator('#meterPreview .preview-chart').count(),1,'Resize does not orphan chart');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true,'No mobile horizontal overflow');
    // A large import must not turn diagnostics into an expanded text wall.
    await page.setViewportSize({width:1440,height:1000});
    const warningFiles=Array.from({length:121},(_,i)=>({name:`batch-${i}-2026-09-14.csv`,mimeType:'text/csv',buffer:Buffer.from(csv('2026-09-14',10)+'\ninvalid;Bad row;2026-09-14;N/A;5;;')}));
    await page.locator('#fileInput').setInputFiles(warningFiles);
    await page.waitForFunction(()=>!state.importing);
    assert.ok((await page.locator('#importStatus').innerText()).length<220,'Import status stays concise');
    assert.equal(await page.locator('#importDetails').evaluate(e=>e.open),false);
    await page.locator('#importDetailsSummary').click();
    assert.equal(await page.locator('#importDetailsBody li').count(),121,'Every diagnostic remains accessible');
    await page.locator('#importDetailsSummary').click();
    assert.ok((await page.locator('#dropzone').boundingBox()).height<65,'Collapsed import stays compact');
    // Same shape as the reported event, with a synthetic meter identifier/address.
    await page.evaluate(()=>{state.labels['99']={type:'seasonal',note:'Värmepanna'};});
    for (const [stamp,value] of [['2026-09-14 02:46',15],['2026-09-15 06:59',125],['2026-09-15 07:46',127]]) {
      const content='Serienummer;Adress;Senaste avläsning;Senaste värde;Genomsnittsvärde\n99;TESTVÄGEN 23 TUMBA 14730;'+stamp+';'+value+';95';
      await page.locator('#fileInput').setInputFiles({name:stamp.slice(0,10)+' '+stamp.slice(11).replace(':','-')+'.csv',mimeType:'text/csv',buffer:Buffer.from(content)});
      await page.waitForFunction(()=>!state.importing);
    }
    assert.equal(await page.locator('.morning-signal').first().getAttribute('data-morning-meter'),'99');
    await page.locator('[data-morning-meter="99"]').click();
    await page.waitForSelector('.preview-chart [data-meter-id="99"] .signal-chart-stage svg');
    assert.match(await page.locator('.preview-chart .signal-comparison-summary').innerText(),/747%/);
    const titles=await page.locator('.preview-chart .signal-dot title').allTextContents();
    assert.ok(titles.some(t=>t.includes('06:59')&&t.includes('125')));
    assert.ok(titles.some(t=>t.includes('07:46')&&t.includes('127')));
    await page.locator('[data-morning-filter="new_signal"]').click();
    assert.ok((await page.locator('#rows').innerText()).includes('TESTVÄGEN 23'));
    assert.equal(await page.evaluate(()=>state.meters.find(m=>m.id==='99').category),'seasonal');
    await page.evaluate(()=>selectLeakMeter('99'));
    await page.screenshot({path:'test-results/review-desktop.png'});
    console.log('REVIEW_RECHECK:'+(await page.screenshot({type:'jpeg',quality:45})).toString('base64'));
    if(process.env.ORIGINAL_EXPORT_DIR) {
      await page.evaluate(()=>{state.files=[];state.labels={'23571762':{type:'seasonal',note:'Värmepanna'}};analyze();});
      const originals=fs.readdirSync(process.env.ORIGINAL_EXPORT_DIR).filter(n=>n.endsWith('.xlsx')).sort().map(n=>path.join(process.env.ORIGINAL_EXPORT_DIR,n));
      await page.locator('#fileInput').setInputFiles(originals);
      await page.waitForFunction(()=>!state.importing);
      assert.equal(await page.evaluate(()=>state.files.length),13);
      assert.equal(await page.evaluate(()=>state.meters.length),2965);
      assert.equal(await page.locator('.morning-signal').first().getAttribute('data-morning-meter'),'23571762');
      await page.locator('[data-morning-meter="23571762"]').click();
      await page.waitForSelector('.preview-chart [data-meter-id="23571762"] .signal-chart-stage svg');
      assert.match(await page.locator('.preview-chart .signal-comparison-summary').innerText(),/747%/);
      const svgTitles=await page.locator('.preview-chart .signal-dot title').allTextContents();
      assert.ok(svgTitles.some(t=>t.includes('06:59')&&t.includes('125')));
      assert.ok(svgTitles.some(t=>t.includes('07:46')&&t.includes('127')));
      await page.locator('[data-morning-filter="new_signal"]').click();
      assert.ok(await page.locator('#rows').innerText().then(t=>t.includes('ALICE')),'New signals includes earlier seasonal label');
      assert.equal(await page.evaluate(()=>state.meters.find(m=>m.id==='23571762').category),'seasonal');
      await page.evaluate(()=>selectLeakMeter('23571762'));
      await page.screenshot({path:'test-results/original-alice-desktop.png',fullPage:true});
      await page.setViewportSize({width:1366,height:768});
      await page.screenshot({path:'test-results/original-alice-1366.png'});
      await page.setViewportSize({width:390,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
      await page.screenshot({path:'test-results/original-alice-mobile.png',fullPage:true});
      console.log('Original exports: 13 XLSX, 2965 meters, Alice 15→125→127, review filter and full timestamps passed.');
    }
    assert.deepEqual(errors,[],'No browser runtime exceptions');
    console.log('Browser: CSV + XLSX, small rise, hidden menu, repair form, persisted reload, desktop and mobile passed.');
  } catch(e) {
    await page.screenshot({path:'test-results/failure.png',fullPage:true}).catch(()=>{});
    throw e;
  } finally { await browser.close();server.close(); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

