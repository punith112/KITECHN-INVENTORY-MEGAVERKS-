const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const base = 'http://127.0.0.1:8765';
const shots = '/mnt/agents/temp/canteen-shots';
fs.mkdirSync(shots, {recursive:true});
let passed = 0;
function ok(value, name) { assert(value, name); passed++; console.log('PASS', name); }
async function boot(browser, viewport={width:1440,height:1000}) {
  const context = await browser.newContext({viewport, acceptDownloads:true});
  const page = await context.newPage();
  await page.goto(base);
  await page.locator('[data-action="demo-login"]').click();
  await page.waitForSelector('.app-shell');
  return {context,page};
}
async function nav(page, view) { await page.locator('.desktop-rail [data-view="'+view+'"]:visible, .bottom-nav [data-view="'+view+'"]:visible').first().click(); }
async function state(page) { return page.evaluate(()=>CanteenApp.getState()); }
async function demoRequest(page, action, payload={}) { return page.evaluate(async ({action,payload})=>{const session=JSON.parse(sessionStorage.getItem('canteen_session'));return DemoAPI.request(action,payload,session);},{action,payload}); }
async function noOverflow(page, name) {
  const d=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
  ok(d.scroll<=d.width+1, name+' has no horizontal page overflow ('+d.scroll+'/'+d.width+')');
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==','base64');
(async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const {context,page}=await boot(browser);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));

    await nav(page,'add');
    await page.locator('[data-action="add-mode"][data-mode="count"]').click();
    await page.locator('#inventory-file').setInputFiles({name:'shelf.png',mimeType:'image/png',buffer:png});
    await page.waitForSelector('#photo-count-form');
    ok(await page.locator('[data-photo-count-qty]').count()===2,'inventory photo opens human count review');
    await page.locator('[data-photo-count-qty][data-index="0"]').fill('13');
    await page.locator('[data-photo-count-qty][data-index="1"]').fill('14');
    await page.locator('#photo-count-form button[type="submit"]').click();
    await page.waitForSelector('#photo-count-form',{state:'detached'});
    const counted=await demoRequest(page,'getBootstrap');
    ok(counted.stock.find(i=>i.id==='TOOR_DAL').balance===13&&counted.stock.find(i=>i.id==='RAVA').balance===14,'inventory suggestions post only confirmed physical counts');

    await page.evaluate(()=>{const original=DemoAPI.request;DemoAPI.request=async function(action,payload,session){const r=await original(action,payload,session);if(action==='scanBill')r.bill.items=[{name:'Mystery Grain',itemId:'',qty:2,unit:'kg',rate:50,amount:100,confidence:.4,flags:['No item match']}];return r;};});
    await nav(page,'today');await nav(page,'add');
    await page.locator('[data-action="add-mode"][data-mode="bill"]').click();
    await page.locator('#bill-file').setInputFiles({name:'unknown-bill.png',mimeType:'image/png',buffer:png});
    await page.waitForSelector('[data-action="review-new-item"]');
    await page.locator('[data-action="review-new-item"]').click();
    ok(await page.locator('#edit-item-name').inputValue()==='Mystery Grain','unmatched bill row pre-fills Admin new-item editor');
    await page.locator('#edit-item-category').fill('Test grains');
    await page.locator('#item-form button[type="submit"]').click();
    await page.waitForSelector('#item-form',{state:'detached'});
    const matched=await state(page);
    ok(matched.review.bill.items[0].itemId&&matched.data.items.some(i=>i.id===matched.review.bill.items[0].itemId),'new master item returns to and resolves the bill line');

    await page.locator('[data-action="cancel-review"]').click();
    await page.locator('.topbar [data-action="settings"]').click();
    await page.locator('[data-action="settings-tab"][data-tab="items"]').click();
    await page.locator('[data-action="edit-item"]').first().click();
    await page.locator('#edit-item-name').fill('Photo Grain');
    await page.locator('#edit-item-category').fill('Test grains');
    await page.locator('#edit-item-unit').fill('kg');
    await page.locator('#edit-item-purchase').fill('kg');
    await page.locator('input[name="item-meal"][value="B"]').check();
    await page.locator('#edit-item-photo').setInputFiles({name:'grain.png',mimeType:'image/png',buffer:png});
    await page.locator('#item-form button[type="submit"]').click();
    await page.waitForSelector('#item-form',{state:'detached'});
    const photoBoot=await demoRequest(page,'getBootstrap');
    const photoItem=photoBoot.items.find(i=>i.name==='Photo Grain');
    ok(photoItem&&photoItem.photoUrl.startsWith('data:image/jpeg'),'Admin reference photo is compressed and attached to item master');
    await page.locator('[data-action="close-modal"]').click();
    await nav(page,'today');
    await page.locator('#item-search').fill('Photo Grain');
    await page.waitForSelector('.item-tile.has-photo .item-photo');
    await page.waitForFunction(()=>{const e=document.querySelector('.item-tile.has-photo .item-photo');return e&&e.style.backgroundImage.includes('data:image');});
    ok(true,'item reference photo appears as a picker visual hint');

    await page.locator('.item-tile.has-photo').click();
    await page.locator('[data-bind="receivedBy"]').selectOption({label:'Ramesh'});
    let dialogText='';page.once('dialog',async d=>{dialogText=d.message();await d.dismiss();});
    await page.locator('[data-action="save-issue"]').click();
    await page.waitForTimeout(250);
    ok(dialogText.includes('Admin override')&&dialogText.includes('negative stock'),'Admin negative-stock override displays explicit warning');
    ok((await state(page)).data.issue.filter(r=>r.itemId===photoItem.id).length===0,'cancelling Admin override prevents stock issue');
    page.once('dialog',d=>d.accept());
    await page.locator('[data-action="save-issue"]').click();
    await page.getByText('Stock issued successfully.',{exact:true}).last().waitFor();
    ok((await state(page)).data.stock.find(i=>i.id===photoItem.id).balance===-1,'accepted Admin override posts auditable negative balance');

    await nav(page,'reports');
    const downloadPromise=page.waitForEvent('download');
    await page.locator('[data-action="export-report"]').click();
    const download=await downloadPromise;
    ok((await download.suggestedFilename()).endsWith('.csv'),'report CSV download works');
    await page.evaluate(()=>{window.__printed=false;window.print=()=>{window.__printed=true;};});
    await page.locator('[data-action="print-report"]').click();
    ok(await page.evaluate(()=>window.__printed),'Print / PDF invokes the printable report');

    await page.locator('[data-action="report-tab"][data-tab="history"]').click();
    const beforeHistory=await demoRequest(page,'getBootstrap');
    await page.locator('[data-action="reverse"]').first().click();
    await page.locator('#reverse-reason').fill('Final acceptance correction test');
    await page.locator('#reverse-form button[type="submit"]').click();
    await page.waitForSelector('#reverse-form',{state:'detached'});
    const afterHistory=await demoRequest(page,'getBootstrap');
    ok(afterHistory.data===undefined&&afterHistory.issue.length===beforeHistory.issue.length&&afterHistory.adjust.length===beforeHistory.adjust.length+1,'reversal preserves original ledger and appends adjustment');

    await page.locator('.topbar [data-action="settings"]').click();
    await page.locator('[data-action="settings-tab"][data-tab="staff"]').click();
    await page.locator('[data-action="edit-dish"]').first().click();
    await page.locator('#dish-name').fill('Acceptance Test Dish');
    await page.locator('input[name="dish-meal"][value="L"]').check();
    await page.locator('#dish-form button[type="submit"]').click();
    await page.getByText('Acceptance Test Dish',{exact:true}).waitFor();
    ok(true,'Admin dish editor saves and lists a new dish');
    await page.locator('.modal [data-action="settings"]').click();
    await page.locator('[data-action="backup"]').click();
    await page.getByText('Demo data is already stored in this browser.',{exact:true}).waitFor();
    ok(true,'backup control gives an honest local-demo result');
    await page.locator('[data-action="connection"]').click();
    await page.locator('#connection-url').fill('https://example.com/not-apps-script');
    await page.locator('[data-action="save-connection"]').click();
    await page.getByText('Enter a valid Apps Script URL ending in /exec.',{exact:true}).waitFor();
    ok(await page.locator('#connection-url').isVisible(),'connection validation rejects a non-Apps-Script URL');
    await page.locator('#connection-url').fill('https://script.google.com/macros/s/TEST_ONLY/exec');
    await page.locator('[data-action="save-connection"]').click();
    ok(await page.evaluate(()=>localStorage.getItem('canteen_apps_script_url'))==='https://script.google.com/macros/s/TEST_ONLY/exec','valid Apps Script /exec URL saves per device');
    ok(errors.length===0,'extended feature workflow has zero browser errors: '+errors.join('; '));
    await context.close();

    for(const width of [375,430,768,1024,1440]){
      const run=await boot(browser,{width,height:900});
      for(const view of ['today','stock','add','reports']){await nav(run.page,view);await run.page.waitForTimeout(80);await noOverflow(run.page,width+' px '+view);}
      if(width===375||width===1024)await run.page.screenshot({path:path.join(shots,'final-'+width+'.png'),fullPage:true});
      const tiny=await run.page.evaluate(()=>[...document.querySelectorAll('button:not([disabled]),a[href],input,select')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(r.width<32||r.height<32);}).map(e=>({tag:e.tagName,cls:e.className,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).slice(0,8));
      ok(tiny.length===0,width+' px controls meet the 32 px minimum touch floor: '+JSON.stringify(tiny));
      await run.context.close();
    }

    const netContext=await browser.newContext({viewport:{width:1280,height:900}});
    const worker=await netContext.newPage();await worker.goto(base);
    const app=await netContext.newPage();const requests=[];const netErrors=[];app.on('pageerror',e=>netErrors.push(e.message));
    const cloudUser={username:'network-admin',name:'Network Admin',role:'Admin'};
    await app.route('https://script.google.com/macros/s/TEST_NETWORK/exec',async route=>{
      const req=route.request(),body=JSON.parse(req.postData()||'{}');requests.push({action:body.action,token:body.token,contentType:req.headers()['content-type']});
      let result;
      if(body.action==='login')result=body.password==='network-test-password'?{ok:true,token:'network-token',user:cloudUser}:{ok:false,error:'Invalid username or password.'};
      else result=await worker.evaluate(async ({action,payload,user})=>DemoAPI.request(action,payload,{token:'network-token',user}),{action:body.action,payload:body,user:cloudUser});
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await app.addInitScript(()=>localStorage.setItem('canteen_apps_script_url','https://script.google.com/macros/s/TEST_NETWORK/exec'));
    await app.goto(base);
    await app.locator('#login-username').fill('network-admin');await app.locator('#login-password').fill('wrong-password');await app.locator('#login-form button[type="submit"]').click();
    await app.getByText('Invalid username or password.',{exact:true}).waitFor();
    ok(true,'real fetch path displays server-side login rejection');
    await app.locator('#login-password').fill('network-test-password');await app.locator('#login-form button[type="submit"]').click();await app.waitForSelector('.app-shell');
    ok(requests.some(r=>r.action==='getBootstrap'&&r.token==='network-token'),'real fetch path sends session token after login');
    ok(requests.every(r=>r.contentType==='text/plain;charset=utf-8'),'all cloud requests use preflight-free text/plain POST bodies');
    await app.locator('[data-bind="platesServed"]').fill('77');await app.locator('[data-action="save-plates"]').click();await app.getByText('Plate count saved.',{exact:true}).last().waitFor();
    ok(requests.some(r=>r.action==='savePlates'&&r.token==='network-token'),'authenticated cloud write completes through actual browser fetch');
    await app.locator('.topbar [data-action="settings"]').click();await app.locator('[data-action="settings-tab"][data-tab="users"]').click();await app.locator('[data-action="edit-user"]').first().click();
    await app.locator('#user-username').fill('network-viewer');await app.locator('#user-name').fill('Network Viewer');await app.locator('#user-role').selectOption('Viewer');await app.locator('#user-password').fill('viewer-network-pass');await app.locator('#user-form button[type="submit"]').click();await app.getByText('network-viewer · Viewer · Active',{exact:true}).waitFor();
    ok(requests.some(r=>r.action==='saveUser'),'Admin user dialog works through the cloud request adapter');
    ok(netErrors.length===0,'cloud request workflow has zero browser errors: '+netErrors.join('; '));
    await netContext.close();

    console.log('\n'+passed+' final acceptance assertions passed. Screenshots: '+shots);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
