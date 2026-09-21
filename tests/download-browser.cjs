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
    await page.locator('#profileName').fill('Export regression');
    await page.locator('#profileCode').fill('1234');
    await page.locator('#profileForm button').click();
    await page.waitForFunction(()=>!document.getElementById('profileDialog').open);
    const csv = 'Serienummer;Adress;Senaste avläsning;Senaste värde;Genomsnittsvärde\n' + Array.from({length:2900},(_,i)=>`${10000+i};TESTVÄGEN ${i+1} TUMBA;2026-09-21 04:00;10;5`).join('\n');
    await page.locator('#fileInput').setInputFiles({name:'2026-09-21 06-30.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.waitForFunction(()=>!state.importing && state.meters.length===2900);
    await page.locator('#rows .row-select').nth(0).check();
    await page.locator('#rows .row-select').nth(1).check();
    const expected = await page.locator('#rows .row-select:checked').evaluateAll(nodes=>nodes.map(n=>n.dataset.id));
    await page.locator('#bulkType').selectOption('download');
    await page.locator('#bulkSave').click();
    await page.waitForFunction(()=>state.tripList.length===2);
    assert.equal(await page.locator('#tripRows tr').count(),2);
    assert.equal(await page.locator('[data-trip="export"]').isDisabled(),true);
    await page.locator('#tripRows input[type=checkbox]').first().check();
    async function exportedIDs() {
      const event = page.waitForEvent('download');
      await page.locator('[data-trip="export"]').click();
      const download = await event;
      const file = await download.path();
      const bytes = Array.from(fs.readFileSync(file));
      const values = await page.evaluate(bytes=>{
        const book = XLSX.read(new Uint8Array(bytes),{type:'array'});
        return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
      },bytes);
      assert.deepEqual(values[0],['Namn','Adress','Anledning']);
      return values.slice(1).map(row=>String(row[0]));
    }
    assert.deepEqual(await exportedIDs(),expected.slice(0,1),'Only checked queue entry exported from 2900 meters');
    await page.locator('[data-trip="all"]').click();
    assert.deepEqual(await exportedIDs(),expected,'Select all is scoped to download list');
    await page.screenshot({path:'test-results/download-desktop.png'});
    await page.locator('[data-trip="none"]').click();
    assert.equal(await page.locator('[data-trip="export"]').isDisabled(),true);
    await page.locator('[data-trip="close"]').click();
    await page.locator('#addToTripList').click();
    assert.equal(await page.locator('#tripRows tr').count(),2,'Repeated additions deduplicate');
    await page.locator('[data-trip="close"]').click();
    await page.reload({waitUntil:'networkidle'});
    await page.locator('#profileCode').fill('1234');
    await page.locator('#profileForm button').click();
    await page.waitForFunction(()=>!document.getElementById('profileDialog').open);
    await page.locator('#openDownloadList').click();
    assert.equal(await page.locator('#tripRows tr').count(),2,'Queue persisted');
    assert.equal(await page.locator('[data-trip="export"]').isDisabled(),true,'Old selection is not restored');
    await page.locator('#tripRows input[type=checkbox]').first().check();
    await page.locator('[data-trip="remove"]').click();
    assert.equal(await page.locator('#tripRows tr').count(),1);
    assert.equal(await page.evaluate(()=>state.meters.length),2900,'Removing queue entry preserves meters');
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-trip="all"]').click();
    assert.deepEqual(await exportedIDs(),expected.slice(1));
    await page.screenshot({path:'test-results/download-mobile.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
    await page.locator('[data-trip="close"]').click();
    // Existing users may already have 2900 entries; none are selected on open.
    await page.evaluate(async()=>{state.tripList=state.meters.map(m=>({id:m.id,name:m.id,address:m.address,reason:'Kontroll'}));await persistState();});
    await page.locator('#openTripList').click();
    assert.equal(await page.locator('#tripRows tr').count(),2900);
    assert.equal(await page.locator('[data-trip="export"]').isDisabled(),true);
    await page.locator('#tripRows input[type=checkbox]').first().check();
    assert.equal((await exportedIDs()).length,1,'Legacy queue never exports all automatically');
    page.once('dialog',d=>d.accept());
    await page.locator('[data-trip="clear"]').click();
    assert.equal(await page.locator('#tripRows tr').count(),0);
    assert.deepEqual(errors,[]);
    console.log('Download regression PASS: 2900 meters, scoped selections, real XLSX readback, deduplication, persistence, legacy list, desktop/mobile.');
  } catch(e) {
    await page.screenshot({path:'test-results/failure.png',fullPage:true}).catch(()=>{});
    throw e;
  } finally { await browser.close();server.close(); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

