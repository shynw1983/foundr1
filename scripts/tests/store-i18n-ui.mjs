// Requires the synthetic fixture server: node scripts/verify-store-responsive.mjs --serve.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const output='outputs/store-i18n-20260916';await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage(),errors=[],report=[];
page.on('pageerror',e=>errors.push(e.message));
const visit=path=>page.goto('http://127.0.0.1:4178/'+path,{waitUntil:'networkidle0'});
const labels={ja:['本日の販売状態','注文管理','レジ状態','注文キュー'], 'zh-Hans':['今日销售状态','订单管理','收银台状态','订单队列'], 'zh-Hant':['今日銷售狀態','訂單管理','收銀台狀態','訂單佇列']};
const routes=['store','store/orders','store/menu','store/menu/inventory-history','store/pos','store/timecard','store/receiving','store/procedures','store/seats','store/display/pickup','store/display/courier','store/display/kitchen'];
try{
 await visit('store');
 for(const width of process.env.INTERACTIONS_ONLY ? [] : [390,768,1440]){
  await page.setViewport({width,height:width===390?844:1024});
  for(const language of ['ja','zh-Hans','zh-Hant']){
   await page.evaluate(language=>{localStorage.setItem('foundr1-os-language',language);localStorage.setItem('foundr1-os-language-preference','manual');},language);
   for(const route of width===390?routes:['store/orders','store/menu','store/display/kitchen','store/procedures']){
    await visit(route);await page.waitForFunction(lang=>document.documentElement.lang===lang,{},language);
    const text=await page.$eval('main',e=>e.textContent);
    const expected=route==='store/menu'?labels[language][0]:route==='store/orders'?labels[language][1]:route==='store/pos'?labels[language][2]:route==='store/display/kitchen'?labels[language][3]:null;
    if(expected)assert.ok(text.includes(expected),`${route} ${language}: missing ${expected}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${route} ${language} ${width}px overflow`);
    if(route==='store/procedures'&&language==='zh-Hant'){
     const reference=await page.$eval('.maamaa-production-reference',e=>e.textContent);
     assert.match(reference,/麻辣燙 \/ 廚房規則/);assert.match(reference,/約7個/);
     assert.doesNotMatch(reference,/7個くらい|1パック|1ショット|订单|说明|汤底|规则|选择/);
    }
    report.push({route,language,width});
    if(['store/menu','store/procedures','store/display/kitchen'].includes(route))await page.screenshot({path:`${output}/${route.replaceAll('/','-')}-${language}-${width}.png`});
   }
   console.log(`PASS ${language} ${width}px: page translations and overflow`);
  }
 }
 // Switch without reloading, including a new failed read and native confirmation dialog.
 await visit('store/orders');
 for(const language of ['zh-Hant','ja','zh-Hans']){
  await page.select('.os-language-picker select',language);
  await page.waitForFunction(label=>document.querySelector('h1').textContent===label,{},labels[language][1]);
  const selector='select[aria-label="表示状態"],select[aria-label="显示状态"],select[aria-label="顯示狀態"]';
  await page.select(selector,'all');await page.waitForSelector('.store-history-pagination');
  const pager=await page.$eval('.store-history-pagination',e=>e.textContent);
  assert.ok(pager.includes(language==='ja'?'次のページ':language==='zh-Hant'?'下一頁':'下一页'));
  await page.select(selector,'active');
  const dialogPromise=new Promise(resolve=>page.once('dialog',async d=>{const text=d.message();await d.dismiss();resolve(text);}));
  await page.$$eval('.store-order-detail button',buttons=>buttons.find(b=>/^(キャンセル|取消)$/.test(b.textContent.trim())).click());
  const message=await dialogPromise;
  assert.ok(message.includes(language==='ja'?'この注文は決済済みです。':language==='zh-Hant'?'此訂單已付款。':'此订单已支付。'));
 }
 // Production-language data must survive UI translation; controls and errors use the staff language.
 await visit('store/display/kitchen');
 await page.evaluate(()=>{
  window.__fixtures['/api/store/display/kitchen'].tasks=[{id:'task-ja',orderId:'order-ja',brandId:'brand-test',productionArea:'kitchen',productionAreaLabel:'調理',status:'new',printStatus:'pending',itemSummary:'日本語の制作指示',itemCount:1,isHistorical:false,itemGroups:[{itemName:'日本語の制作指示',quantity:1,amount:1000,options:[],productionLines:['野菜を先に入れる']}],startedAt:'',estimatedPrepMinutes:10,estimatedReadyAt:'',pickupCode:'K-TEST',scheduledAt:'',amount:1000,currency:'JPY',customerName:'山田',tableLabel:'',orderSource:'maamaa_web',orderType:'pickup',note:'',noteOriginal:'',createdAt:new Date().toISOString(),kitchenLanguage:'ja',showAmounts:false}];
 });
 await page.click('.store-display-menu-button');
 await page.$$eval('.store-display-menu button',es=>es.find(e=>/^(刷新|更新)$/.test(e.textContent)).click());
 await page.waitForSelector('.store-kitchen-task');
 assert.match(await page.$eval('.store-kitchen-task',e=>e.textContent),/日本語の制作指示/);
 assert.match(await page.$eval('.store-kitchen-actions',e=>e.textContent),/开始制作/);
 await page.evaluate(()=>{window.__readTest.failPath='/api/store/display/kitchen';});
 await page.$$eval('.store-display-menu button',es=>es.find(e=>/^(刷新|更新)$/.test(e.textContent)).click());
 await page.waitForSelector('.read-status-notice');assert.match(await page.$eval('.read-status-notice',e=>e.textContent),/信息更新失败/);
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/verification.json`,JSON.stringify({pages:report,errors,languageSwitch:true,confirmationDialogs:true,productionLanguagePreserved:true},null,2));
 console.log('PASS language switching, pagination, confirmation dialogs, production data language and failure notices; no browser errors');
}finally{await browser.close();}
