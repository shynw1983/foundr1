// Local Next UI exercise with intercepted APIs. No application database or supplier is contacted.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const base=process.env.FOUNDR1_UI_BASE_URL||'http://127.0.0.1:3148';
const out=process.env.FOUNDR1_UI_OUTPUT||'/private/tmp/replenishment-ui-evidence';mkdirSync(out,{recursive:true});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const storeId=id(1),employeeId=id(2),productId=id(3),demandId=id(4),buyerId=id(5);
const product={id:productId,name:'芋頭（冷凍）／タロイモ 500g',unit:'袋',isOrderable:true};
const initialDemand=()=>({id:demandId,storeId,storeName:'桜並木店',product,status:'open',version:1,quantity:null,unit:'袋',note:'',deferredUntil:null,createdAt:'2026-10-18T03:00:00Z',updatedAt:'2026-10-18T03:00:00Z',sources:[{kind:'inventory',id:id(10),name:product.name,stockStatus:'low_stock',locationName:'冷凍庫 A／作業用',quantity:2,countUnit:'個',lastCountedAt:'2026-10-18T02:00:00Z',stockRevision:2,countConfidence:'confirmed'}],inventory:[{id:id(10),locationName:'冷凍庫 A／作業用',quantity:2,countUnit:'個',safetyStock:5,lastCountedAt:'2026-10-18T02:00:00Z',quickStatus:'low',quickCheckedAt:'2026-10-18T03:00:00Z'},{id:id(11),locationName:'冷凍庫 B／予備',quantity:20,countUnit:'個',safetyStock:5,lastCountedAt:'2026-10-18T02:00:00Z',quickStatus:'enough',quickCheckedAt:'2026-10-18T03:00:00Z'}],events:[{id:id(12),kind:'report',actorName:'店舗スタッフ',note:'週末に備えて確認をお願いします。',quantity:2,unit:'袋',shortageStatus:'low_stock',createdAt:'2026-10-18T03:00:00Z'}],orders:[],openOrders:[],openItemIds:[],progress:'reported'});
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
let demand=initialDemand(),reports=[],issues=[],failReport=false,failOrder=false;
async function pageFor(surface,language='ja'){
 const page=await browser.newPage();page.setDefaultNavigationTimeout(180000);await page.setBypassServiceWorker(true);
 const role=surface==='store'?'staff':'owner';
 const employee={id:employeeId,name:'確認担当',loginId:'local-test',role,sessionId:id(90),sessionVersion:1,permittedNavPaths:['/os/orders','/os/replenishment','/os/procurement','/store/replenishment'],permissions:['store.inventory','module.orders']};
 const payload=Buffer.from(JSON.stringify(employee)).toString('base64url');
 const signature=createHmac('sha256',process.env.FOUNDR1_UI_AUTH_SECRET||'local-replenishment-test').update(payload).digest('base64url');
 await page.setCookie({name:'foundr1_os_session',value:`${payload}.${signature}`,url:base});
 await page.evaluateOnNewDocument(locale=>{localStorage.setItem('foundr1-os-language',locale);localStorage.setItem('foundr1-os-language-preference','manual');},language);
 const errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message));
 await page.setRequestInterception(true);
 page.on('request',async req=>{
  const u=new URL(req.url());
  if(u.origin!==new URL(base).origin){await req.abort();return;}
  if(!u.pathname.startsWith('/api/')){await req.continue();return;}
  let body={},status=200;
  const operator={id:employeeId,name:'確認担当',role,expiresAt:null};
  if(u.pathname==='/api/auth/me')body={employee};
  else if(u.pathname==='/api/store/context')body={selectedStoreId:storeId,access:{role,canUseAllStoreView:false,stores:[{id:storeId,name:'桜並木店'}]}};
  else if(u.pathname==='/api/store/inventory/operator')body={storeId,baseRole:role,operator,canOperate:true,requiresOperatorAuthentication:false};
  else if(u.pathname==='/api/os/replenishment'||u.pathname==='/api/store/replenishment'){
   if(req.method()==='GET')body={storeId:u.searchParams.get('storeId')||'',stores:[{id:storeId,name:'桜並木店'}],demands:[structuredClone(demand)],products:[product],operator,canReport:true,canManage:surface==='os',buyers:[{id:buyerId,name:'購入担当'}]};
   else {
    const input=JSON.parse(req.postData());
    if(input.action==='report'){
     reports.push(input);if(failReport){failReport=false;status=503;body={error:'補充依頼を処理できませんでした。内容を保持して再試行してください。'};}else body={ok:true,demandId};
    }else if(input.action==='review'){
     demand={...demand,status:input.status,quantity:input.quantity,note:input.note,version:demand.version+1};body={ok:true,demandId};
    }else if(input.action==='create_order'){
     issues.push(input);if(failOrder){failOrder=false;status=503;body={error:'補充依頼を処理できませんでした。内容を保持して再試行してください。'};}else{demand={...demand,status:'ordered',progress:'purchasing',version:demand.version+1};body={ok:true,orderId:'PO-20261018-0001'};}
    }else{status=400;body={error:'unexpected test action'};}
   }
  }else if(u.pathname==='/api/os/quick-dashboard')body={stores:[{id:storeId,name:'桜並木店'}],selectedStoreId:storeId,canChangeGlobalStore:false,staff:[],operation:null,metrics:{},preferences:{widgets:[]}};
  else if(u.pathname==='/api/inventory')body={stores:[],locations:[],items:[]};
  else if(u.pathname.includes('navigation'))body={betaNavPaths:[]};
  else if(u.pathname==='/api/os/store-context')body={storeId,selectedStoreId:storeId,stores:[{id:storeId,name:'桜並木店'}]};
  else if(u.pathname.includes('notifications'))body={notifications:[],unreadCount:0,items:[]};
  else if(u.pathname==='/api/app-version')body={version:'local-test'};
  await req.respond({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 return {page,errors};
}
async function clickText(page,label){await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===text&&!e.disabled),{},label);await page.evaluate(text=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text);if(!button||button.disabled)throw new Error(`Missing enabled button: ${text}; buttons=${[...document.querySelectorAll('button')].map(e=>e.textContent.trim()+':'+e.disabled).join('|')}; fields=${[...document.querySelectorAll('input,select')].map(e=>e.name+'='+e.value).join('|')}`);button.click();},label);}
async function noOverflow(page,label){const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(result.scroll<=result.width+1,`${label} overflow ${JSON.stringify(result)}`);}
try{
 for(const surface of (process.env.FOUNDR1_UI_INTERACTIONS_ONLY?[]:process.env.FOUNDR1_UI_ONLY?[process.env.FOUNDR1_UI_ONLY]:['store','os']))for(const language of ['ja','zh-Hans','zh-Hant']){
  const {page,errors}=await pageFor(surface,language);
  for(const width of [390,768,1440]){
   await page.setViewport({width,height:950});await page.goto(`${base}/${surface}/replenishment?storeId=${storeId}`,{waitUntil:'networkidle0'});
   await page.waitForFunction(()=>document.body.innerText.includes('芋頭（冷凍）')).catch(async error=>{console.error(JSON.stringify({surface,language,width,errors,text:await page.evaluate(()=>document.body.innerText)}));await page.screenshot({path:`${out}/failure.png`,fullPage:true});throw error;});
   await noOverflow(page,`${surface}/${language}/${width}`);
   await page.screenshot({path:`${out}/${surface}-${language}-${width}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[],`${surface}/${language} runtime errors`);await page.close();
 }
 // Employee report: invalid decimals are blocked, an uncertain send retries exactly the original body.
 {
  const {page,errors}=await pageFor('store');await page.goto(`${base}/store/replenishment?storeId=${storeId}`,{waitUntil:'networkidle0'});
  await page.select('select[name=productId]',productId);await page.type('input[name=quantity]','1.5');
  assert.equal(await page.$eval('[data-store-replenishment-report] button[type=submit]',e=>e.disabled),true);
  await page.$eval('input[name=quantity]',e=>{e.focus();e.select();});await page.keyboard.press('Backspace');await page.type('input[name=quantity]','2');
  await page.type('textarea[name=note]','冷凍庫Bも確認済み');failReport=true;
  await clickText(page,'担当者に報告');await page.waitForFunction(()=>document.body.innerText.includes('同じ内容で再送'));
  await clickText(page,'同じ内容で再送');await page.waitForFunction(()=>document.body.innerText.includes('補充の必要を報告しました。'));
  assert.equal(reports.length,2);assert.deepEqual(reports[0],reports[1]);assert.equal(reports[0].expectedOperatorId,employeeId);
  assert.deepEqual(errors,[]);await page.close();
 }
 // Manager edits desired quantity, previews the final order and recovers a response failure idempotently.
 {
  demand=initialDemand();const {page,errors}=await pageFor('os');await page.setViewport({width:390,height:950});
  await page.goto(`${base}/os/replenishment?storeId=${storeId}`,{waitUntil:'networkidle0'});
  await page.type(`input[aria-label="${product.name} 発注数量"]`,'3');
  await clickText(page,'変更を保存');await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.getAttribute('aria-label')?.includes('発注数量')&&e.value==='3'));
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='変更を保存'&&!e.disabled));
  await page.click(`input[aria-label="${product.name} 選択した需要"]`);
  const selects=await page.$$('select');await selects[selects.length-1].select(buyerId);
  await page.$eval('input[type=date]',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'2026-10-20');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
  await clickText(page,'発注内容を確認');await page.waitForSelector('[role=dialog]');await noOverflow(page,'mobile preview');
  await page.screenshot({path:`${out}/os-preview-mobile.png`,fullPage:true});failOrder=true;
  await clickText(page,'発注を確定する');await page.waitForFunction(()=>document.body.innerText.includes('同じ内容で結果を確認'));
  await clickText(page,'同じ内容で結果を確認');await page.waitForFunction(()=>document.body.innerText.includes('発注を作成しました。')).catch(async error=>{console.error(JSON.stringify({stage:'order-retry',issues,reports,errors,text:await page.evaluate(()=>document.body.innerText)}));await page.screenshot({path:`${out}/order-retry-failure.png`,fullPage:true});throw error;});
  assert.ok(await page.$('a[href*="PO-20261018-0001"]'));assert.equal(issues.length,2);assert.deepEqual(issues[0],issues[1]);assert.equal(issues[0].items[0].quantity,3);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log(JSON.stringify({ok:true,responsiveScreens:process.env.FOUNDR1_UI_INTERACTIONS_ONLY?0:18,languages:['ja','zh-Hans','zh-Hant'],reportRetries:reports.length,orderRetries:issues.length,evidence:out}));
}finally{await browser.close();}
