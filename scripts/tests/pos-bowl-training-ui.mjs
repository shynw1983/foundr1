// Actual React pages with synthetic HTTP/native printing. No live API or database access.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const output=resolve('outputs/dine-in-workflow-20261015'); await mkdir(output,{recursive:true});
const dictionaries=Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async l=>[l,JSON.parse(await readFile(`public/locales/os/${l}.json`,'utf8'))])));
const store={id:'fixture-store',name:'桜並木店',brandIds:['fixture-brand']},brand={id:'fixture-brand',name:'まぁ麻'};
const printer={deviceType:'star_printer',connectionType:'bluetooth',identifier:'fixture-printer',paperWidth:'58mm',cutPaper:true,openCashDrawer:true};
const posData={selectedStoreId:store.id,access:{stores:[store]},brands:[brand],categories:[],optionGroups:[],todaySummary:{orderCount:0,total:0,average:0,latestOrders:[]},
  items:[{id:'fixture-menu',brandId:brand.id,brandName:brand.name,name:'自選マーラータン',itemKind:'buildable_product',category:'マーラータン',priceOverride:null,basePrice:0,posPricingMode:'weight',posWeightUnit:'g',posWeightUnitPrice:4,isAvailable:true,variableSchema:{},imageUrl:''}],
  posSettings:{dineInEnabled:true,takeoutEnabled:true,priceTaxMode:'tax_included',printerSettings:{enabled:true,receiptEnabled:true,kitchenEnabled:false,receiptPrinter:printer,kitchenPrinter:{...printer,identifier:'remote-kitchen'},customerDisplay:{enabled:false}}}};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import Admin from './app/os/procedures/page';import Reader from './app/store/procedures/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
const language=new URLSearchParams(location.search).get('lang')||'ja';localStorage.setItem('foundr1-os-language',language);localStorage.setItem('foundr1-os-language-preference','manual');
window.__prints=[];window.__failPrintAt=0;window.Foundr1Printer={isAvailable:()=>true,print:payload=>{window.__prints.push(JSON.parse(payload));return JSON.stringify(window.__failPrintAt===window.__prints.length?{ok:false,error:'fixture paper out'}:{ok:true});}};
const View=location.pathname==='/admin'?Admin:location.pathname==='/reader'?Reader:Pos;
createRoot(document.getElementById('root')).render(<OsTranslationProvider><View/></OsTranslationProvider>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture-navigation',setup(b){
  b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/link'?`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`:`export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`,loader:'js',resolveDir:process.cwd()}));
}}]});
const css=(await readFile('app/globals.css','utf8'))+'\n'+(await readFile('app/store/store-responsive.css','utf8'));
const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const sales=new Map();let draft=null;let next=37;let posts=0;let failResponse=false;let reprintRefunded=false;
const send=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/fixture.js'){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end(bundle.outputFiles[0].text);}
  if(url.pathname.startsWith('/locales/os/'))return send(res,dictionaries[url.pathname.includes('Hant')?'zh-Hant':'zh-Hans']);
  if(url.pathname==='/api/auth/me')return send(res,{employee:{id:'fixture-employee',name:'Fixture',role:'owner'}});
  if(url.pathname==='/api/store/context')return send(res,{selectedStoreId:store.id,access:{role:'owner',stores:[store]}});
  if(url.pathname==='/api/store/pos/reconciliation')return send(res,{businessDate:'2026-10-15',activeSession:{id:'fixture-register',expectedCashAmount:10000},sessions:[],movements:[],activeCashResponsibleEmployees:[]});
  if(url.pathname==='/api/store/pos'&&req.method==='POST'){
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);posts++;
    if(!sales.has(body.offlineClientOrderId)){
      const tickets=body.items.map((item,itemIndex)=>({itemIndex,pickupCode:String(next++).padStart(3,'0'),itemId:'item-'+itemIndex,taskId:'task-'+itemIndex}));
      const amount=body.items.reduce((n,item)=>n+item.measuredQuantity*4*item.quantity,0);
      sales.set(body.offlineClientOrderId,{ok:true,orderId:'order-'+body.offlineClientOrderId,pickupCode:'D-RECEIPT',servingTickets:tickets,amount,subtotalAmount:amount,taxAmount:Math.floor(amount/11),taxRate:10,discountAmount:0,couponDiscountAmount:0,cashTenderedAmount:body.cashTenderedAmount,cashChangeAmount:body.cashTenderedAmount-amount,todaySummary:posData.todaySummary});
    }
    if(failResponse){res.destroy();return;}
    return send(res,sales.get(body.offlineClientOrderId));
  }
  if(url.pathname==='/api/store/pos')return send(res,posData);
  if(url.pathname==='/api/store/pos/transactions')return send(res,{selectedTransaction:{status:'new',items:[0,1,2].map(i=>({id:'item-'+i,refundStatus:reprintRefunded?'refunded':''}))},transactions:[]});
  if(url.pathname==='/api/procedures/maamaa-reference')return send(res,{});
  if(url.pathname==='/api/procedures'&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;draft=JSON.parse(raw);return send(res,{ok:true,id:'fixture-procedure'});}
  if(url.pathname==='/api/procedures')return send(res,{canEdit:true,procedures:url.searchParams.get('mode')==='admin'?[]:draft?.status==='published'?[{...draft,id:'fixture-procedure',brand:'まぁ麻',stores:[store],versionNumber:1}]:[],stores:[store],brands:[brand],products:[],materials:[],menuCatalogItems:[],menuOptionGroups:[],menuOptions:[],actionTypes:[],locations:[],equipment:[],containers:[]});
  if(url.pathname.startsWith('/api/'))return send(res,{items:[],notifications:[],unreadCount:0});
  res.writeHead(200,{'Content-Type':'text/html'});res.end(html);
}catch(error){send(res,{error:error.message},500);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',error=>{errors.push(error.message);console.log('PAGE_ERROR',error.message)});page.on('dialog',dialog=>dialog.accept());
 await page.setRequestInterception(true);page.on('request',request=>request.url().startsWith(base)||request.url().startsWith('data:')?request.continue():request.abort());
 async function open(path,width=1366){await page.setViewport({width,height:900});await page.goto(base+path,{waitUntil:'networkidle0'});}
 async function addBowl(weight){await page.click('.store-pos-item-button');await page.waitForSelector('.store-pos-weight-entry input');await page.type('.store-pos-weight-entry input',String(weight));await page.click('.store-pos-option-add');await page.waitForFunction(()=>!document.querySelector('.store-pos-option-add'));}
 await open('/pos');await page.waitForSelector('.store-pos-item-button:not(:disabled)').catch(async error=>{console.log((await page.$eval('body',e=>e.innerText)).slice(0,2000));throw error;});
 for(const weight of [300,300,350])await addBowl(weight);
 assert.equal(await page.$$eval('.store-pos-cart-list>.store-pos-cart-row',nodes=>nodes.length),3);
 assert.equal(await page.$('input[placeholder="01〜30"]'),null);
 await page.type('.store-pos-cart-row input','この杯だけ');
 for(const width of [1366,800,390]){
   await page.setViewport({width,height:900});
   if(width===390)await page.evaluate(()=>{const b=document.querySelector('.store-pos-floating-checkout button');b?.click();});
   await page.screenshot({path:resolve(output,`pos-${width}.png`),fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`POS overflow ${width}`);
 }
 await page.setViewport({width:1366,height:900});
 const cash=await page.$('.store-pos-cash-payment input')||await page.$('.store-pos-cash-tendered input');
 assert.ok(cash,'cash input');await cash.type('5000');
 await page.click('.store-pos-checkout');await page.waitForFunction(()=>window.__prints.length===10);
 await page.waitForFunction(()=>document.querySelectorAll('.store-pos-cart-list>.store-pos-cart-row').length===0);
 const printed=await page.evaluate(()=>window.__prints);
 assert.deepEqual(printed.map(p=>p.order.pickupCode),['037','037','037','038','038','038','039','039','039','D-RECEIPT']);
 assert.equal(printed[0].printer.identifier,'fixture-printer');
 assert.equal(printed[1].kitchenTicketTemplate.title,'出品伝票');
 assert.equal(printed[2].kitchenTicketTemplate.title,'お客様番号札');
 assert.deepEqual(printed.slice(0,3).map(p=>p.kitchenTicketTemplate.title),['厨房伝票','出品伝票','お客様番号札']);
 assert.ok(printed[1].order.note.includes('この杯だけ'));
 assert.deepEqual(printed[1].order.items,printed[0].order.items);
 assert.ok(printed[0].order.note.includes('この杯だけ'));
 assert.ok(!printed[3].order.note.includes('この杯だけ'));
 assert.equal(printed[0].printer.openCashDrawer,false);
 assert.equal(printed[9].order.totalAmount,3800);
 assert.equal(posts,1);assert.equal(sales.size,1);
 await page.reload({waitUntil:'networkidle0'});assert.equal(await page.evaluate(()=>window.__prints.length),0,'reload does not reprint');
 // Unknown network result survives reload; same original request recovers one payment.
 await page.waitForSelector('.store-pos-item-button:not(:disabled)');await addBowl(300);
 await (await page.$('.store-pos-cash-payment input')||await page.$('.store-pos-cash-tendered input')).type('2000');
 failResponse=true;await page.click('.store-pos-checkout');
 await page.waitForFunction(()=>document.body.textContent.includes('新しい会計やオフライン会計は作成しないでください'));
 const savedSales=sales.size;failResponse=false;
 // A saved pre-upgrade two-ticket batch must not receive inserted finishing copies.
 const [legacyClient,legacySale]=[...sales.entries()].at(-1);
 await page.evaluate(async ({client,sale,storeId,payloads})=>{
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('foundr1-store-offline');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=database.transaction('pos-print-jobs','readwrite');
   ['kitchen','pickup','receipt'].forEach((kind,i)=>{const payload=payloads[i];payload.order.pickupCode=kind==='receipt'?sale.pickupCode:sale.servingTickets[0].pickupCode;
    tx.objectStore('pos-print-jobs').put({id:`${client}:${i}`,storeId,orderId:sale.orderId,clientOrderId:client,kind,sequence:i,itemId:kind==='receipt'?undefined:sale.servingTickets[0].itemId,label:kind,payload,state:'sent',error:''});});
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});database.close();
 },{client:legacyClient,sale:legacySale,storeId:store.id,payloads:[printed[0],printed[2],printed[9]]});
 await page.reload({waitUntil:'networkidle0'});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='元の会計結果を確認'));
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='元の会計結果を確認').click());
 await page.waitForFunction(()=>document.querySelectorAll('.store-pos-cart-list>.store-pos-cart-row').length===0);
 assert.equal(sales.size,savedSales);assert.equal(await page.evaluate(()=>window.__prints.length),0,'legacy batch is not reprinted or shifted');
 // Paper failure on the finishing ticket preserves kitchen; supplement finishing, guest, then receipt.
 await page.waitForFunction(()=>document.querySelectorAll('.store-pos-cart-list>.store-pos-cart-row').length===0);
 await page.evaluate(()=>{window.__prints=[];window.__failPrintAt=2;});
 await page.waitForSelector('.store-pos-item-button:not(:disabled)');await addBowl(200);
 const cashAgain=await page.$('.store-pos-cash-payment input');await cashAgain.click({clickCount:3});await cashAgain.type('1000');
 await page.click('.store-pos-checkout');await page.waitForFunction(()=>window.__prints.length===2&&document.querySelectorAll('.store-pos-cart-list>.store-pos-cart-row').length===0);
 await page.reload({waitUntil:'networkidle0'});assert.equal(await page.evaluate(()=>window.__prints.length),0);
 await page.waitForFunction(()=>[...document.querySelectorAll('#pos-print-documents .store-pos-cart-row')].some(row=>row.textContent.includes('要確認')));
 await page.waitForFunction(()=>[...document.querySelectorAll('#pos-print-documents .store-pos-cart-row')].some(row=>row.textContent.includes('未送信')&&row.textContent.includes('レシート')));
 await page.evaluate(()=>[...document.querySelectorAll('#pos-print-documents .store-pos-cart-row')].find(row=>row.textContent.includes('未送信')&&row.textContent.includes('レシート')).querySelector('button').click());
 await page.waitForFunction(()=>document.body.textContent.includes('先の伝票の現物'));
 assert.equal(await page.evaluate(()=>window.__prints.length),0);
 reprintRefunded=true;
 await page.evaluate(()=>[...document.querySelectorAll('#pos-print-documents .store-pos-cart-row')].find(row=>row.textContent.includes('要確認')).querySelector('button').click());
 await page.waitForFunction(()=>document.body.textContent.includes('受渡・返金済み'));
 assert.equal(await page.evaluate(()=>window.__prints.length),0,'refunded finishing ticket is denied');
 reprintRefunded=false;
 await page.evaluate(()=>[...document.querySelectorAll('#pos-print-documents .store-pos-cart-row')].find(row=>row.textContent.includes('要確認')).querySelector('button').click());
 await page.waitForFunction(()=>window.__prints.length===1);
 await page.waitForFunction(()=>[...document.querySelectorAll('#pos-print-documents .store-pos-cart-row')].some(row=>row.textContent.includes('未送信')&&row.textContent.includes('お客様番号札')&&!row.querySelector('button').disabled));
 await page.evaluate(()=>[...document.querySelectorAll('#pos-print-documents .store-pos-cart-row')].find(row=>row.textContent.includes('未送信')&&row.textContent.includes('お客様番号札')).querySelector('button').click());
 await page.waitForFunction(()=>window.__prints.length===2);
 assert.equal(await page.evaluate(()=>window.__prints[0].kitchenTicketTemplate.title),'出品伝票');
 assert.equal(await page.evaluate(()=>window.__prints[1].kitchenTicketTemplate.title),'お客様番号札');
 await page.waitForFunction(()=>[...document.querySelectorAll('#pos-print-documents .store-pos-cart-row')].some(row=>row.textContent.includes('未送信')&&row.textContent.includes('レシート')&&!row.querySelector('button').disabled));
 await page.evaluate(()=>[...document.querySelectorAll('#pos-print-documents .store-pos-cart-row')].find(row=>row.textContent.includes('未送信')&&row.textContent.includes('レシート')).querySelector('button').click());
 await page.waitForFunction(()=>window.__prints.length===3);
 assert.equal(await page.evaluate(()=>window.__prints[2].jobType),'receipt');
 await page.waitForFunction(()=>![...document.querySelectorAll('#pos-print-documents button')].some(b=>b.disabled));
 await page.screenshot({path:resolve(output,'print-recovery-1366.png'),fullPage:true});
 await open('/admin');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='まぁ麻 店内接客・会計・厨房引継ぎ'&&!b.disabled));
 await page.evaluate(()=>{document.querySelector('.procedure-helper-actions details').open=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='まぁ麻 店内接客・会計・厨房引継ぎ').click();});
 await page.waitForFunction(()=>document.querySelectorAll('.procedure-step-editor').length===11);
 for(const width of [1366,800,390]){await page.setViewport({width,height:900});await page.screenshot({path:resolve(output,`training-admin-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`training overflow ${width}`);}
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存').click());
 await page.waitForFunction(()=>document.body.textContent.includes('手順書を保存しました'));
 assert.ok(draft.summary.includes('出品伝票'));
 assert.ok(draft.steps[6].instruction.includes('味付け'));
 assert.equal(draft.status,'draft');assert.deepEqual(draft.storeIds,[store.id]);assert.equal(draft.steps.length,11);
 await writeFile(resolve(output,'fixture-procedure-draft.json'),JSON.stringify(draft,null,2));
 draft={...draft,status:'published'};await open('/reader',800);
 await page.waitForFunction(()=>[...document.querySelectorAll('.procedure-reader-book')].some(b=>b.textContent.includes('店内接客')));
 await page.evaluate(()=>[...document.querySelectorAll('.procedure-reader-book')].find(b=>b.textContent.includes('店内接客')).click());
 await page.waitForFunction(()=>document.body.textContent.includes('開店前：3つの対応位置を確認'));
 for(const width of [1366,800,390]){await page.setViewport({width,height:900});await page.screenshot({path:resolve(output,`training-reader-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`reader overflow ${width}`);}
 assert.deepEqual(errors,[]);
 const result={synthetic:true,liveWrites:0,uiScreens:['POS','training editor','training reader'],viewports:[1366,800,390],printOrder:printed.map(p=>p.order.pickupCode),paymentRetryStable:true,trainingDraftSteps:11,errors};
 await writeFile(resolve(output,'ui-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){const pages=await browser.pages();const p=pages.at(-1);console.log('FAILURE_STATE',JSON.stringify({posts,sales:sales.size,errors,ui:await p.evaluate(()=>({text:document.body.innerText.slice(-3500),prints:window.__prints?.length}))}));await p.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
