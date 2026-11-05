// Actual React editor -> actual OS route -> isolated PostgreSQL, with local-only HTTP.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDineInMenuFixture,fixtureUuid} from './store-dine-in-menu-fixture.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-pricing-ui');await mkdir(output,{recursive:true});
const require=createRequire(join(source,'package.json')),{build,stop}=require('esbuild'),puppeteer=require('puppeteer-core');
const f=await createDineInMenuFixture(source);await f.installMigration();const {db,ids}=f;
Object.assign(ids,{juice:fixtureUuid(43001),rice:fixtureUuid(43002)});
await db.exec(`insert into menu_catalog_items(id,brand_id,name,item_kind,category,base_price,sort_order) values
 ('${ids.juice}','${ids.brand}','酸梅湯','fixed_product','ドリンク',300,710),
 ('${ids.rice}','${ids.brand}','白ごはん','fixed_product','麻辣湯',200,720);`);

const stores=[{id:ids.store,name:'桜並木店',brandIds:[ids.brand,ids.secondBrand]},{id:ids.other,name:'別店舗',brandIds:[ids.brand,ids.secondBrand]}];
const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{DineInMenuEditor}from'./app/os/menus/DineInMenuEditor';import PosAdmin from'./app/os/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
function App(){if(location.pathname==='/os/pos')return <PosAdmin/>;return <MenuApp/>;}function MenuApp(){const[brand,setBrand]=useState('${ids.brand}');return <><nav data-fixture-brand><button onClick={()=>setBrand('${ids.brand}')}>まぁ麻</button><button onClick={()=>setBrand('${ids.secondBrand}')}>第二ブランド</button></nav><DineInMenuEditor brandId={brand} brandName={brand==='${ids.brand}'?'まぁ麻':'第二ブランド'} stores={${JSON.stringify(stores)}} initialStoreId="${ids.store}"/></>};createRoot(document.getElementById('root')).render(<OsTranslationProvider><App/></OsTranslationProvider>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:source,loader:'tsx'},bundle:true,write:false,outdir:'/virtual',jsx:'automatic',charset:'utf8',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'local-next-fixture',setup(b){
 b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'local-next'}));
 b.onLoad({filter:/.*/,namespace:'local-next'},a=>({contents:a.path==='next/link'?`import React from'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`:`export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});export const useSearchParams=()=>new URLSearchParams(location.search);`,loader:'js',resolveDir:source}));
}}]});
const css=await readFile(join(source,'app/globals.css'),'utf8')+'\n'+(bundled.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'')+'\nbody{margin:0;background:#f6f8f7}#root{max-width:1440px;margin:auto;padding:16px}nav[data-fixture-brand]{display:flex;gap:8px;padding:0 0 16px}';
const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const dictionaries=Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async key=>[key,JSON.parse(await readFile(join(source,`public/locales/os/${key}.json`),'utf8'))])));
let loseNextMutation=false,forceSchemaMissing=false,delayNextGet=0;
const posts=[],errors=[],external=[];
const send=(res,body,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/fixture.js'){res.writeHead(200,{'content-type':'application/javascript; charset=utf-8'});return res.end(bundled.outputFiles.find(f=>f.path.endsWith('.js')).text);}
  if(url.pathname.startsWith('/locales/os/'))return send(res,dictionaries[url.pathname.includes('Hant')?'zh-Hant':'zh-Hans']);
  if(url.pathname==='/api/auth/me')return send(res,{employee:{id:'fixture-owner',name:'Fixture',role:'owner'}});
  if(url.pathname==='/api/os/quick-dashboard')return send(res,{stores,selectedStoreId:ids.store,staff:[],operation:null,metrics:{},canChangeGlobalStore:false,preferences:{selectedStoreId:ids.store,widgets:[]}});
  if(url.pathname==='/api/inventory')return send(res,{stores,selectedStoreId:ids.store,locations:[],items:[]});
  if(url.pathname==='/api/store/pos')return send(res,{selectedStoreId:ids.store,access:{role:'owner',stores},todaySummary:{orderCount:0,total:0,average:0,latestOrders:[]}});
  if(url.pathname==='/api/store/pos/reconciliation')return send(res,{sessions:[],totals:{openingAmount:0,expectedCashAmount:0,countedCashAmount:0,differenceAmount:0,cashSales:0,cashIn:0,cashOut:0}});
  if(url.pathname==='/api/os/pos/settings')return send(res,{access:{canManagePosSettings:true},settings:{storeId:ids.store,storeName:'桜並木店',posBrandSettings:[{brandId:ids.brand,brandName:'まぁ麻',posPricingMode:'weight',posWeightUnit:'g',posWeightUnitPrice:4}],discountPresets:[]}});
  if(url.pathname==='/api/os/menus/dine-in'){
    let raw='';for await(const part of req)raw+=part;
    const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:{...req.headers},...(req.method==='POST'?{body:raw}:{})});
    if(req.method==='POST'){
      posts.push(JSON.parse(raw));const response=await f.admin().POST(request),body=await response.json();
      if(loseNextMutation){loseNextMutation=false;return send(res,{error:'Fixture: 保存結果が不明です'},503);}
      return send(res,body,response.status);
    }
    const delay=delayNextGet;delayNextGet=0;
    const response=await f.admin().GET(request),body=await response.json();
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    if(forceSchemaMissing)return send(res,{ready:false,exists:false,enabled:false,revision:'',catalog:{version:1,items:[],optionGroups:[],categories:[]}});
    return send(res,body,response.status);
  }
  if(url.pathname.startsWith('/api/'))return send(res,{items:[],notifications:[],unreadCount:0});
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);
}catch(error){errors.push(error.stack);send(res,{error:error.message},500);}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,pipe:true,timeout:30000});
const results=[];
const readMenu=async()=>{const response=await f.getMenu();assert.equal(response.status,200,await response.clone().text());return response.json();};
async function pageAt(width=390,language='ja'){
  const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width,height:1000});
  page.on('pageerror',error=>errors.push(error.stack));await page.setRequestInterception(true);page.on('request',request=>{if(request.url().startsWith(base+'/'))return request.continue();external.push(request.url());return request.abort();});
  await page.goto(`${base}/os/menus?lang=${language}`,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-dine-in-menu-editor]');await page.waitForFunction(()=>document.querySelectorAll('[data-target-id]').length>0||document.querySelector('[data-dine-in-action="initialize"]')||document.querySelector('[role="alert"]'));
  return{page,context};
}
async function click(page,selector){await page.waitForFunction(selector=>{const el=document.querySelector(selector);return el&&!el.matches(':disabled');},{},selector);await page.$eval(selector,async el=>{el.scrollIntoView({block:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.click(selector);}
async function fill(page,selector,value){
  await click(page,selector);
  assert.equal(await page.$eval(selector,el=>document.activeElement===el),true,'Native click focuses editable field');
  const length=await page.$eval(selector,el=>el.value.length);
  // Headless Chrome key bindings vary by platform; use ordinary navigation/deletion keys.
  for(let index=0;index<length;index++)await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval(selector,el=>el.selectionStart),length,'Native arrow keys reach the end of the editable value');
  for(let index=0;index<length;index++)await page.keyboard.press('Backspace');
  assert.equal(await page.$eval(selector,el=>el.value),'','Native Backspace clears the previous value');
  await page.keyboard.type(value);
  assert.deepEqual(await page.$eval(selector,el=>({focused:document.activeElement===el,value:el.value,caret:el.selectionStart})),{focused:true,value,caret:value.length});
  if(value.length){await page.keyboard.press('ArrowLeft');assert.equal(await page.$eval(selector,el=>el.selectionStart),value.length-1,'Keyboard moves caret');await page.keyboard.press('ArrowRight');}
}
async function geometry(page,selector){return page.$eval(selector,async el=>{el.scrollIntoView({block:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{x:r.x,right:r.right,width:r.width,height:r.height,hit:hit===el||el.contains(hit),scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};});}
async function assertGeometry(page,selector){const g=await geometry(page,selector);assert.ok(g.width>0&&g.height>0&&g.hit,JSON.stringify(g));assert.ok(g.x>=-1&&g.right<=g.viewport+1,JSON.stringify(g));assert.ok(g.scrollWidth<=g.viewport+1,JSON.stringify(g));return g;}
async function renamed(page,targetId,name){await click(page,`[data-target-id="${targetId}"]`);await fill(page,'[data-dine-in-name]',name);await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="rename"]').disabled);await click(page,'[data-dine-in-action="rename"]');await page.waitForFunction(name=>[...document.querySelectorAll('[data-target-id]')].some(el=>el.textContent.includes(name)),{},name);}

let currentPage;
const masterSnapshot=async()=>{const value=await f.masterSnapshot();value.menu_catalog_items=value.menu_catalog_items.filter(row=>!row.variable_schema?.storeDineInOnly);return value;};
const canonicalBefore=await masterSnapshot();
function record(name,width,detail={}){results.push({name,width,passed:true,...detail});console.log(`PASS ${name} ${width}`);}
async function idle(page){await page.waitForFunction(()=>document.querySelector('[data-dine-in-action="setEnabled"]')&&!document.querySelector('[data-dine-in-action="setEnabled"]').disabled&&!document.querySelector('[data-dine-in-action="retry"]'));}
async function waitName(page,name){await page.waitForFunction(name=>[...document.querySelectorAll('[data-target-id]')].some(el=>el.textContent.includes(name)),{},name);}
async function choose(page,id){await click(page,`[data-target-id="${id}"][data-target-kind="item"]`);await page.waitForSelector('[data-dine-in-pricing]');}
async function createItem(page,{name,categoryId,kind,price}){
  await click(page,'[data-dine-in-open="item"]');await fill(page,'#dine-in-new-item-name',name);await page.select('#dine-in-new-item-category',categoryId);if(kind)await page.select('#dine-in-new-item-kind',kind);if(price!==undefined)await fill(page,'#dine-in-new-item-price',String(price));
  await assertGeometry(page,'[data-dine-in-action="createItem"]');await click(page,'[data-dine-in-action="createItem"]');await waitName(page,name);await idle(page);return(await readMenu()).catalog.items.find(item=>item.name===name);
}
async function importItem(page,id,name){await click(page,'[data-dine-in-open="import"]');await page.select('#dine-in-import-source',id);await fill(page,'#dine-in-import-name',name);const summary=await page.$eval('[data-dine-in-composer="import"]',el=>el.innerText);assert.equal(await page.$('[data-dine-in-composer="import"] input[inputmode="numeric"]'),null,'Imported price stays readonly');await click(page,'[data-dine-in-action="importItem"]');await waitName(page,name);await idle(page);return{item:(await readMenu()).catalog.items.find(item=>item.name===name),summary};}
async function reloadEditor(page){await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-target-id]');await idle(page);}
async function settingsAt(width){
  const context=await browser.createBrowserContext(),page=await context.newPage();currentPage=page;await page.setViewport({width,height:1000});page.on('pageerror',error=>errors.push(error.stack));await page.setRequestInterception(true);page.on('request',request=>{if(request.url().startsWith(base+'/'))return request.continue();external.push(request.url());return request.abort();});
  await page.goto(base+'/os/pos',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('.pos-admin-brand-pricing-row select')&&!document.querySelector('.pos-admin-brand-pricing-row select').disabled);return{page,context};
}
try{
 for(const width of [390,800,1366]){
  await db.exec('delete from store_dine_in_menu_operations;delete from store_dine_in_menus;');await db.query('update store_brands set pos_weight_unit_price=4 where store_id=$1 and brand_id=$2',[ids.store,ids.brand]);posts.length=0;
  const{page,context}=await pageAt(width);currentPage=page;page.setDefaultTimeout(15000);
  await click(page,'[data-dine-in-action="initialize"]');await idle(page);assert.equal((await readMenu()).enabled,false);
  await click(page,'[data-dine-in-open="category"]');await fill(page,'#dine-in-new-category-name','店内商品');await click(page,'[data-dine-in-action="createCategory"]');await waitName(page,'店内商品');await idle(page);let menu=await readMenu();const category=menu.catalog.categories[0];
  assert.deepEqual(menu.pricingDefaults,{unit:'g',unitPrice:4});
  await click(page,'[data-dine-in-open="item"]');await fill(page,'#dine-in-new-item-name',`新しい基本の一杯 ${width}`);await page.select('#dine-in-new-item-category',category.id);
  assert.equal(await page.$eval('#dine-in-new-item-kind',el=>el.value),'buildable_product');assert.equal(await page.$eval('#dine-in-new-item-pricing',el=>el.value),'weight');
  assert.match(await page.$eval('[data-dine-in-new-weight-rate]',el=>el.innerText),/¥4\s*\/\s*1g/);assert.equal(await page.$('[data-dine-in-new-weight-rate] input'),null);assert.equal(await page.$('#dine-in-new-item-price'),null);
  await assertGeometry(page,'#dine-in-new-item-pricing');await assertGeometry(page,'[data-dine-in-action="createItem"]');await page.screenshot({path:join(output,`pricing-${width}-new-weight-base.png`),fullPage:true});
  await click(page,'[data-dine-in-action="createItem"]');await waitName(page,`新しい基本の一杯 ${width}`);await idle(page);menu=await readMenu();const baseItem=menu.catalog.items.find(item=>item.name===`新しい基本の一杯 ${width}`);
  assert.equal(baseItem.itemKind,'buildable_product');assert.equal(baseItem.productionType,'bowl');assert.equal(baseItem.posPricingMode,'weight');assert.equal(baseItem.posWeightUnitPrice,4);assert.equal(baseItem.price,0);assert.equal(posts.at(-1).pricingMode,'weight');assert.equal(posts.at(-1).price,0);assert.equal(menu.enabled,false);
  record('native-create-base-bowl-defaults-to-weight-and-readonly-trusted-four-yen-rate',width);

  const food=await createItem(page,{name:`単品ごはん ${width}`,categoryId:category.id,kind:'fixed_product',price:250});assert.equal(food.posPricingMode,'fixed');assert.equal(food.productionType,'item');assert.equal(food.price,250);
  await choose(page,food.id);assert.equal(await page.$eval('[data-dine-in-pricing]',el=>el.value),'fixed');assert.match(await page.$eval('[data-dine-in-current-price]',el=>el.innerText),/¥250\s*\/\s*1点/);record('standalone-food-defaults-to-portion-price-and-separate-item-production',width);
  const drink=await createItem(page,{name:`店内のお茶 ${width}`,categoryId:category.id,kind:'drink',price:350});assert.equal(drink.posPricingMode,'fixed');assert.equal(drink.productionType,'drink');assert.equal(drink.price,350);
  assert.equal(await page.$eval('[data-dine-in-pricing]',el=>({value:el.value,disabled:el.disabled})).then(x=>x.value),'fixed');assert.equal(await page.$eval('[data-dine-in-pricing]',el=>el.disabled),true);assert.equal(await page.$('[data-dine-in-action="setItemPricing"]'),null);assert.ok((await page.$eval('[data-dine-in-pricing-form]',el=>el.innerText)).includes('ドリンクは個数販売です。重量では計算しません。'));record('drink-stays-per-portion-with-disabled-method-and-explanation',width);

  const juiceImport=await importItem(page,ids.juice,`店内酸梅湯 ${width}`),riceImport=await importItem(page,ids.rice,`店内白ごはん ${width}`);const juice=juiceImport.item,rice=riceImport.item;
  for(const [item,summary,price]of[[juice,juiceImport.summary,300],[rice,riceImport.summary,200]]){assert.equal(item.posPricingMode,'fixed');assert.equal(item.price,price);assert.equal(item.productionType,(await readMenu()).source.items.find(source=>source.id===item.sourceItemId).productionType,'Imported production identity is preserved independently of sales method');assert.match(summary,new RegExp(`¥${price}\\s*\\/\\s*1点`));}
  record('brand-wide-weight-does-not-turn-imported-juice-or-preset-food-into-weighed-sales',width);

  menu=await readMenu();const legacy=structuredClone(menu.catalog),legacyJuice=legacy.items.find(item=>item.id===juice.id);legacyJuice.posPricingMode='weight';legacyJuice.posWeightUnitPrice=4;delete legacyJuice.posPricingOverride;
  await db.query('update store_dine_in_menus set catalog=$3::jsonb where store_id=$1 and brand_id=$2',[ids.store,ids.brand,JSON.stringify(legacy)]);await reloadEditor(page);await choose(page,juice.id);
  assert.equal(await page.$eval('[data-dine-in-pricing]',el=>el.value),'fixed');assert.match(await page.$eval('[data-dine-in-current-price]',el=>el.innerText),/¥300\s*\/\s*1点/);assert.equal((await readMenu()).catalog.items.find(item=>item.id===juice.id).posPricingMode,'fixed');record('legacy-accidental-weight-snapshot-is-normalized-in-actual-editor-response',width);

  await choose(page,food.id);await page.select('[data-dine-in-pricing]','weight');assert.match(await page.$eval('[data-dine-in-default-rate]',el=>el.innerText),/¥4\s*\/\s*1g/);assert.equal(await page.$('[data-dine-in-pricing-form] input'),null);
  loseNextMutation=true;await assertGeometry(page,'[data-dine-in-action="setItemPricing"]');await click(page,'[data-dine-in-action="setItemPricing"]');await page.waitForFunction(()=>document.querySelector('[data-dine-in-action="retry"]')&&!document.querySelector('[data-dine-in-action="retry"]').disabled);const originalOperation=posts.at(-1);assert.equal(originalOperation.action,'setItemPricing');assert.equal(originalOperation.targetId,food.id);assert.equal(originalOperation.pricingMode,'weight');
  assert.equal((await readMenu()).catalog.items.find(item=>item.id===food.id).posPricingMode,'weight');await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('[data-dine-in-action="retry"]')&&!document.querySelector('[data-dine-in-action="retry"]').disabled);await click(page,'[data-dine-in-action="retry"]');await idle(page);assert.deepEqual(posts.at(-1),originalOperation);
  menu=await readMenu();const weightedFood=menu.catalog.items.find(item=>item.id===food.id);assert.equal(weightedFood.posPricingOverride,'weight');assert.equal(weightedFood.posPricingMode,'weight');assert.equal(weightedFood.posWeightUnitPrice,4);assert.equal(weightedFood.price,250);assert.equal(weightedFood.productionType,'item');assert.equal(menu.catalog.items.find(item=>item.id===baseItem.id).posPricingMode,'weight');assert.equal(menu.catalog.items.find(item=>item.id===drink.id).posPricingMode,'fixed');
  await choose(page,food.id);await page.screenshot({path:join(output,`pricing-${width}-per-item-weight.png`),fullPage:true});record('item-method-save-is-isolated-and-unknown-result-retry-reuses-exact-operation',width);

  await db.query('update store_brands set pos_weight_unit_price=5 where store_id=$1 and brand_id=$2',[ids.store,ids.brand]);await reloadEditor(page);await choose(page,food.id);assert.match(await page.$eval('[data-dine-in-current-price]',el=>el.innerText),/¥4\s*\/\s*1g/);assert.ok((await page.$eval('[data-dine-in-pricing-form]',el=>el.innerText)).includes('この商品の重量単価は保存済みです。店舗の初期値を変更しても自動では変わりません。'));assert.equal(await page.$('[data-dine-in-default-rate]'),null,'Saved rate is not mislabeled as current defaults');
  await choose(page,rice.id);await page.select('[data-dine-in-pricing]','weight');assert.match(await page.$eval('[data-dine-in-default-rate]',el=>el.innerText),/¥5\s*\/\s*1g/);await page.screenshot({path:join(output,`pricing-${width}-independent-rate-preview.png`),fullPage:true});record('saved-weight-rate-stays-independent-while-new-method-preview-uses-current-default',width);
  await choose(page,food.id);await page.select('[data-dine-in-pricing]','fixed');assert.match(await page.$eval('[data-dine-in-fixed-price]',el=>el.innerText),/¥250\s*\/\s*1点/);await click(page,'[data-dine-in-action="setItemPricing"]');await idle(page);menu=await readMenu();assert.equal(menu.catalog.items.find(item=>item.id===food.id).posPricingMode,'fixed');assert.equal(menu.catalog.items.find(item=>item.id===food.id).price,250);record('switch-back-to-portion-previews-and-preserves-original-fixed-price',width);

  const sourceBowl=(await readMenu()).source.items.find(item=>item.id===ids.menu);const importedBowl=await importItem(page,ids.menu,`取込済みの基本 ${width}`);assert.equal(importedBowl.item.posPricingMode,'weight');assert.equal(importedBowl.item.posWeightUnitPrice,sourceBowl.posWeightUnitPrice);assert.equal(importedBowl.item.price,600);menu=await readMenu();const premium=menu.catalog.optionGroups.find(group=>group.sourceGroupId===ids.premiumGroup);assert.equal(premium.ruleJson.portionGrams,50);assert.equal(premium.options.find(option=>option.sourceOptionId===ids.beef).priceDelta,650);record('import-preserves-current-source-rate-price-and-fifty-gram-addon-rules',width);

  await db.query('update store_brands set pos_weight_unit_price=null where store_id=$1 and brand_id=$2',[ids.store,ids.brand]);await reloadEditor(page);await click(page,'[data-dine-in-open="item"]');await fill(page,'#dine-in-new-item-name',`未設定単価 ${width}`);await page.select('#dine-in-new-item-category',category.id);assert.equal(await page.$eval('[data-dine-in-action="createItem"]',el=>el.disabled),true);assert.ok((await page.$eval('#dine-in-create-item-help',el=>el.innerText)).includes('重量単価が未設定です。'));
  await page.select('#dine-in-new-item-kind','fixed_product');await fill(page,'#dine-in-new-item-price','200');assert.equal(await page.$eval('[data-dine-in-action="createItem"]',el=>el.disabled),false);record('missing-weight-rate-explains-disabled-create-with-fixed-food-still-available',width);
  await context.close();currentPage=null;

  const settings=await settingsAt(width);await assertGeometry(settings.page,'.pos-admin-brand-pricing-row select');const settingsText=await settings.page.$eval('.pos-admin-brand-pricing-settings',el=>el.innerText);assert.ok(settingsText.includes('基本商品の販売方法（初期値）'));assert.ok(settingsText.includes('麺・追加食材・ドリンクは個数で計算します。店内メニューの商品別設定が優先されます。'));assert.ok(settingsText.includes('この初期値を変更しても、作成済みの店内メニューは変更されません。'));
  await settings.page.select('.pos-admin-brand-pricing-row select','fixed');assert.equal(await settings.page.$eval('.pos-admin-brand-pricing-row input',el=>el.disabled),true);await settings.page.select('.pos-admin-brand-pricing-row select','weight');assert.equal(await settings.page.$eval('.pos-admin-brand-pricing-row input',el=>el.disabled),false);await assertGeometry(settings.page,'.pos-admin-brand-pricing-settings');await settings.page.$('.pos-admin-brand-pricing-settings').then(el=>el.screenshot({path:join(output,`pricing-${width}-os-default-settings.png`)}));record('actual-os-settings-clarifies-base-default-without-claiming-all-items-are-weighted',width);await settings.context.close();currentPage=null;
  await db.query('update store_brands set pos_weight_unit_price=4 where store_id=$1 and brand_id=$2',[ids.store,ids.brand]);assert.deepEqual(await masterSnapshot(),canonicalBefore);record('canonical-menu-prices-specs-and-other-stores-unchanged',width);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const files=['app/os/menus/DineInMenuEditor.tsx','app/os/menus/DineInMenuComposer.tsx','app/os/menus/DineInMenuEditor.module.css','app/os/pos/page.tsx','lib/store-dine-in-menu-policy.ts','lib/store-dine-in-menu.ts','lib/pos-item-pricing.ts','app/api/os/menus/dine-in/route.ts','scripts/tests/store-dine-in-pricing-ui.mjs'];
 const hashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(join(source,file))).digest('hex')])));
 const report={passed:results.length,results,errors,externalRequests:external,source,hashes,actualReact:true,actualOsSettingsPage:true,actualOsRoute:true,isolatedPostgreSQL:true,nativePointerAndKeyboard:true,viewports:[390,800,1366],liveWrites:0,limitations:['OS settings HTTP responses are synthetic; editor mutations execute the actual API and persistence.']};
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(output,'executed-test.mjs'),await readFile(new URL(import.meta.url)));console.log(JSON.stringify({passed:report.passed,viewports:report.viewports,output}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,posts,errors,external,state:currentPage&&!currentPage.isClosed()?await currentPage.$eval('body',el=>el.innerText):null},null,2));if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:join(output,'failure.png'),fullPage:true});throw error;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await f.db.close();stop();}
