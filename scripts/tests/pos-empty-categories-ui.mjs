// Exercise the actual POS category controls with synthetic HTTP/native data only.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/pos-empty-categories-ui');
await mkdir(output,{recursive:true});
const files=['app/store/pos/StorePosWorkspace.tsx','scripts/tests/store-dine-in-pricing-pos-ui.mjs','scripts/tests/pos-empty-categories-ui.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(join(source,p))).digest('hex')])));
const inputHashes=await hashes();
let text=await readFile(join(source,'scripts/tests/store-dine-in-pricing-pos-ui.mjs'),'utf8');
const marker='\ntry{\n  for(const width of [800,1366]){';assert.equal(text.split(marker).length,2);text=text.split(marker)[0];
function once(needle,value){assert.equal(text.split(needle).length,2,needle);text=text.replace(needle,value);}
once("connection:{bind(){}},subscribe(){return{name:","connection:{state:'connected',bind(){},unbind(){}},subscribe(){return{subscribed:true,name:");
once("    const url = new URL(req.url, 'http://fixture');", "    const url = new URL(req.url, 'http://fixture');\n    if (url.pathname === '/api/store/pos/summary') return send(res, {selectedStoreId:store.id,todaySummary:summary});");
once("{ businessDate: '2026-10-20', activeSession:","{ selectedStoreId:store.id, businessDate: '2026-10-20', activeSession:");
once("const item=baseItem,localItem=baseItem,group=noodleGroup,localGroup=addonGroup;",String.raw`
const otherBrand={id:'fixture-other',name:'別ブランド'};
Object.assign(baseItem,{category:'麻辣湯'});Object.assign(foodItem,{category:'調味料'});Object.assign(drinkItem,{category:'飲料'});
const soldItem={...drinkItem,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'表示を残す在庫切れ商品',category:'売切表示',isAvailable:false};
const orphanItem={...drinkItem,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'未分類の商品',category:''};
const infoItem={...drinkItem,id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'こちら商品ではありません（案内）',category:'案内'};
const foreignItem={...drinkItem,id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',brandId:otherBrand.id,brandName:otherBrand.name,name:'別ブランド限定の商品',category:'別ブランド限定'};
const takeoutItem={...drinkItem,id:'ffffffff-ffff-4fff-8fff-ffffffffffff',name:'持ち帰り限定商品',category:'持ち帰り商品'};
const localCategories=['麻辣湯','調味料','飲料','売切表示','空分類','案内'].map((name,sortOrder)=>({id:'category-'+sortOrder,brandId:brand.id,name,sortOrder}));
localCategories.push({id:'category-other',brandId:otherBrand.id,name:'別ブランド限定',sortOrder:0});
let localItems=[],version=1;function resetCatalog(){localItems=[baseItem,foodItem,drinkItem,soldItem,orphanItem,infoItem,foreignItem];version=1;}resetCatalog();
`);
const oldLine=text.split('\n').find(line=>line.includes("if (url.pathname === '/api/store/pos') return send"));assert(oldLine);
once(oldLine,String.raw`    if (url.pathname === '/api/store/pos') return send(res,{selectedStoreId:store.id,access:{role:'owner',stores:[store]},brands:[brand,otherBrand],items:[takeoutItem,foreignItem],categories:[{id:'takeout-category',brandId:brand.id,name:'持ち帰り商品',sortOrder:0},{id:'empty-takeout',brandId:brand.id,name:'空分類',sortOrder:1},{id:'other-takeout',brandId:otherBrand.id,name:'別ブランド限定',sortOrder:0}],optionGroups:[],dineInMenu:{items:localItems,categories:localCategories,optionGroups:[noodleGroup,addonGroup]},dineInMenuRevision:'dine-in-fixture:'+version,posMenuRevision:'canonical-fixture:4',todaySummary:summary,posSettings:{dineInEnabled:true,takeoutEnabled:true,dineInTaxRate:10,takeoutTaxRate:8,externalPaymentTerminalBrand:'KOMOJU',priceTaxMode:'tax_included',discountPresets:[],printerSettings:{enabled:false,receiptEnabled:false,kitchenEnabled:false,receiptPrinter:printer,kitchenPrinter:printer,customerDisplay:{enabled:false}},customerDisplayMediaSettings:{weighing:{enabled:false}}}});`);
text+=String.raw`
const results=[];
const record=(name,width)=>results.push({name,width,passed:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const options=()=>page.$$eval('.store-pos-category-select option',xs=>xs.map(x=>({value:x.value,text:x.textContent})));
const tiles=()=>page.$$eval('.store-pos-item-button strong',xs=>xs.map(x=>x.textContent));
async function selectCategory(name){
 const dropdown=await page.$('.store-pos-category-select select');
 if(await dropdown.evaluate(x=>x.getBoundingClientRect().width>0)){await dropdown.select(name);return;}
 const buttons=await page.$$('.store-pos-categories .store-pos-filter-list button');
 for(const button of buttons)if((await button.evaluate(x=>x.textContent.trim())).startsWith(name||'すべて')){await button.click();return;}
 throw Error('Category control not found '+name);
}
async function chooseBrand(name){for(const button of await page.$$('.store-pos-filter-group:first-child button'))if((await button.evaluate(x=>x.textContent.trim()))===name){await button.click();return;}throw Error('Missing brand '+name);}
async function clickOrderType(label){const button=(await page.$$('.store-pos-segmented button'));for(const b of button)if((await b.evaluate(x=>x.textContent.trim()))===label){await b.evaluate(x=>x.click());return;}throw Error('Missing order type '+label);}
async function refreshMenu(){await page.click('.store-pos-head [data-pos-menu-refresh]');await page.waitForFunction(()=>!document.querySelector('.store-pos-head [data-pos-menu-refresh]').disabled);await pause(80);}
try{
 for(const width of[390,800,1366]){
  resetCatalog();const context=await browser.createBrowserContext();page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>pageErrors.push(e.message));
  await page.setViewport({width,height:1100});await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(base+'/')?r.continue():(externalRequests.push(r.url()),r.abort()));
  await page.goto(base+'/store/pos',{waitUntil:'domcontentloaded'});await page.waitForSelector('.store-pos-item-button:not(:disabled)');await pause(120);
  const expected=['','麻辣湯','調味料','飲料','売切表示','未分類'];assert.deepEqual((await options()).map(o=>o.value),expected);
  assert.equal((await tiles()).length,5);assert(!(await tiles()).some(name=>name.includes('こちら商品ではありません')||name.includes('別ブランド')));
  assert((await tiles()).includes(soldItem.name));assert((await options()).some(x=>x.value==='売切表示'));
  assert.equal(await page.$eval('.store-pos-categories .store-pos-filter-list button small',x=>x.textContent),'5');
  record('empty-master-and-information-only-categories-hidden-without-hiding-existing-out-of-stock-tiles',width);
  await selectCategory('調味料');await page.waitForFunction(()=>document.querySelectorAll('.store-pos-item-button').length===1);assert.deepEqual(await tiles(),[foodItem.name]);
  await page.type('.store-pos-search input','zzzz-no-match');await page.waitForFunction(()=>document.querySelectorAll('.store-pos-item-button').length===0);assert.deepEqual((await options()).map(o=>o.value),expected);assert.equal(await page.$eval('.store-pos-category-select select',x=>x.value),'調味料');
  await page.$eval('.store-pos-search input',x=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(x,'');x.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>document.querySelectorAll('.store-pos-item-button').length===1);
  record('keyword-search-keeps-category-navigation-and-selection-stable',width);
  localItems=localItems.filter(x=>x.id!==foodItem.id);version++;const reads=posts.length;await pause(120);assert.deepEqual(await tiles(),[foodItem.name]);
  await refreshMenu();await page.waitForFunction(()=>document.querySelector('.store-pos-category-select select').value==='');assert(!(await options()).some(o=>o.value==='調味料'));assert.equal((await tiles()).length,4);assert.equal(await page.$eval('.store-pos-categories .store-pos-filter-list button',x=>x.classList.contains('is-active')),true);assert.equal(posts.length,reads);
  record('manual-menu-apply-removes-empty-active-category-and-falls-back-to-all-without-sales',width);
  localItems.splice(1,0,foodItem);version++;await refreshMenu();await page.waitForFunction(()=>[...document.querySelectorAll('.store-pos-category-select option')].some(x=>x.value==='調味料'));assert.deepEqual((await options()).map(o=>o.value),expected);assert.equal(await page.$eval('.store-pos-category-select select',x=>x.value),'');
  assert(localCategories.some(x=>x.name==='空分類'));assert(localCategories.some(x=>x.name==='調味料'));
  record('restored-products-reveal-category-in-saved-order-without-deleting-management-categories',width);
  await chooseBrand(otherBrand.name);await page.waitForFunction(()=>document.querySelectorAll('.store-pos-item-button').length===1);assert.deepEqual((await options()).map(x=>x.value),['','別ブランド限定']);assert.deepEqual(await tiles(),[foreignItem.name]);
  await chooseBrand(brand.name);await page.waitForFunction(()=>document.querySelectorAll('.store-pos-item-button').length===5);await selectCategory('調味料');await clickOrderType('持ち帰り');await page.waitForFunction(()=>document.querySelector('.store-pos-category-select select').value==='');assert.deepEqual((await options()).map(x=>x.value),['','持ち帰り商品']);assert.deepEqual(await tiles(),[takeoutItem.name]);
  await clickOrderType('店内');await page.waitForFunction(()=>document.querySelectorAll('.store-pos-item-button').length===5);assert.deepEqual((await options()).map(o=>o.value),expected);
  record('brand-and-dinein-takeout-switches-use-their-own-displayable-products',width);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(output,'categories-'+width+'.png'),fullPage:true});record('category-controls-fit-viewport',width);await context.close();
 }
 assert.deepEqual(posts,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(serverErrors,[]);
 await writeFile(join(output,'report.json'),JSON.stringify({passed:results.length,results,actualReactPos:true,viewports:[390,800,1366],syntheticHttpAndNative:true,pageErrors,externalRequests,serverErrors,liveWrites:0},null,2)+'\n');console.log(JSON.stringify({passed:results.length}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,pageErrors,externalRequests,serverErrors,body:page&&!page.isClosed()?await page.$eval('body',x=>x.innerText):null},null,2)+'\n');if(page&&!page.isClosed())await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));stop();}
`;
const executed=join(output,'executed.mjs');await writeFile(executed,text);
const log=[];const code=await new Promise((ok,fail)=>{const child=spawn(process.execPath,[executed,'--source',source,'--output',output],{cwd:source,stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>{child.kill('SIGTERM');fail(Error('Category UI test exceeded three minutes'));},180000);for(const stream of[child.stdout,child.stderr])stream.on('data',c=>{log.push(String(c));process.stdout.write(c);});child.on('error',fail);child.on('exit',code=>{clearTimeout(timer);ok(code);});});
await writeFile(join(output,'test.log'),log.join(''));assert.equal(code,0);const finalHashes=await hashes();assert.deepEqual(finalHashes,inputHashes);await writeFile(join(output,'source-verification.json'),JSON.stringify({source,inputHashes,finalHashes,noSourceDrift:true,reusedScaffold:'scripts/tests/store-dine-in-pricing-pos-ui.mjs'},null,2)+'\n');
