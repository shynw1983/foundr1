// Actual React editor -> actual OS route -> isolated PostgreSQL, with local-only HTTP.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDineInMenuFixture,fixtureUuid} from './store-dine-in-menu-fixture.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-composition-ui');await mkdir(output,{recursive:true});
const require=createRequire(join(source,'package.json')),{build,stop}=require('esbuild'),puppeteer=require('puppeteer-core');
const f=await createDineInMenuFixture(source);await f.installMigration();const {db,ids}=f;
Object.assign(ids,{heatGroup:fixtureUuid(42001),heatOption:fixtureUuid(42002),numbGroup:fixtureUuid(42003),numbOption:fixtureUuid(42004),requiredIngredientGroup:fixtureUuid(42005),requiredIngredientOption:fixtureUuid(42006)});
await db.exec(`insert into menu_option_groups(id,brand_id,group_key,name,selection_type,rule_json,sort_order) values
 ('${ids.heatGroup}','${ids.brand}','heat-level','辛さ','single','{"minSelections":0,"maxSelections":1}',40),
 ('${ids.numbGroup}','${ids.brand}','numb-level','しびれ','single','{"minSelections":0,"maxSelections":1}',50),
 ('${ids.requiredIngredientGroup}','${ids.brand}','required-ingredient','必須食材 50g','single','{"minSelections":1,"maxSelections":1}',60);
 insert into menu_options(id,option_group_id,option_key,name,price_delta,sort_order) values
 ('${ids.heatOption}','${ids.heatGroup}','heat-one','辛さ1',0,1),
 ('${ids.numbOption}','${ids.numbGroup}','numb-one','しびれ1',0,1),
 ('${ids.requiredIngredientOption}','${ids.requiredIngredientGroup}','required-food','必須食材 50g',200,1);`);

const stores=[{id:ids.store,name:'桜並木店',brandIds:[ids.brand,ids.secondBrand]},{id:ids.other,name:'別店舗',brandIds:[ids.brand,ids.secondBrand]}];
const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{DineInMenuEditor}from'./app/os/menus/DineInMenuEditor';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
function App(){const[brand,setBrand]=useState('${ids.brand}');return <><nav data-fixture-brand><button onClick={()=>setBrand('${ids.brand}')}>まぁ麻</button><button onClick={()=>setBrand('${ids.secondBrand}')}>第二ブランド</button></nav><DineInMenuEditor brandId={brand} brandName={brand==='${ids.brand}'?'まぁ麻':'第二ブランド'} stores={${JSON.stringify(stores)}} initialStoreId="${ids.store}"/></>};createRoot(document.getElementById('root')).render(<OsTranslationProvider><App/></OsTranslationProvider>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:source,loader:'tsx'},bundle:true,write:false,outdir:'/virtual',jsx:'automatic',charset:'utf8',define:{'process.env.NODE_ENV':'"development"'}});
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
const canonicalMasterSnapshot=async()=>{
  const value=await f.masterSnapshot();value.menu_catalog_items=value.menu_catalog_items.filter(row=>!row.variable_schema?.storeDineInOnly);return value;
};
const canonicalBefore=await canonicalMasterSnapshot();
async function chooseKind(page,label){
  const handle=await page.evaluateHandle(label=>[...document.querySelectorAll('[aria-label="編集する項目の種類"] button')].find(button=>button.textContent===label),label);
  const element=handle.asElement();assert.ok(element,`Kind button ${label}`);await element.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await element.click();await handle.dispose();
}
async function waitForName(page,name){await page.waitForFunction(name=>[...document.querySelectorAll('[data-target-id]')].some(el=>el.textContent.includes(name)),{},name);}
function findOption(menu,sourceId){const bowl=menu.catalog.items.find(item=>item.sourceItemId===ids.menu);return menu.catalog.optionGroups.filter(group=>!bowl||bowl.optionGroupIds.includes(group.id)).flatMap(group=>group.options).find(option=>option.sourceOptionId===sourceId);}
function record(name,width,detail={}){results.push({name,width,passed:true,...detail});console.log(`PASS ${name} ${width}`);}
try{
  for(const width of [390,800,1366]){
    await db.exec('delete from store_dine_in_menu_operations;delete from store_dine_in_menus;');posts.length=0;
    const {page,context}=await pageAt(width);currentPage=page;page.setDefaultTimeout(15000);
    assert.equal(await page.$eval('input[name="dine-in-initialize-mode"][value="empty"]',el=>el.checked),true);
    assert.equal(await page.$$eval('[data-target-id]',els=>els.length),0,'No apparently editable brand rows before creation');
    await assertGeometry(page,'[data-dine-in-action="initialize"]');await click(page,'[data-dine-in-action="initialize"]');
    await page.waitForSelector('[data-dine-in-action="setEnabled"]');let menu=await readMenu();
    assert.equal(menu.enabled,false);assert.equal(menu.catalog.items.length,0);assert.equal(menu.catalog.categories.length,0);assert.equal(menu.catalog.optionGroups.length,0);
    assert.equal(posts[0].mode,'empty');assert.equal(posts[0].enabled,false);
    await page.screenshot({path:join(output,`composition-${width}-empty-draft.png`),fullPage:true});record('default-empty-initialization-keeps-current-pos-and-has-clear-next-steps',width);

    await click(page,'[data-dine-in-open="category"]');await fill(page,'#dine-in-new-category-name','ドリンク');await assertGeometry(page,'#dine-in-new-category-name');await click(page,'[data-dine-in-action="createCategory"]');await waitForName(page,'ドリンク');
    menu=await readMenu();const category=menu.catalog.categories.find(category=>category.name==='ドリンク');assert.ok(category);assert.ok((await page.$eval('[data-dine-in-menu-editor]',el=>el.innerText)).includes('下書きを保存しました。POS で使用を開始するまでは現在のメニューは変わりません。'));record('native-click-keyboard-create-product-category',width);

    await click(page,'[data-dine-in-open="item"]');await fill(page,'#dine-in-new-item-name',`店内レモン水 ${width}`);
    await page.select('#dine-in-new-item-category',category.id);await page.select('#dine-in-new-item-kind','drink');await fill(page,'#dine-in-new-item-price','350');
    await assertGeometry(page,'#dine-in-new-item-name');await assertGeometry(page,'[data-dine-in-action="createItem"]');
    await page.screenshot({path:join(output,`composition-${width}-new-drink-form.png`),fullPage:true});
    await click(page,'[data-dine-in-action="createItem"]');await waitForName(page,`店内レモン水 ${width}`);menu=await readMenu();let drink=menu.catalog.items.find(item=>item.name===`店内レモン水 ${width}`);
    assert.ok(drink);assert.equal(drink.price,350);assert.equal(drink.posPricingMode,'fixed');assert.equal(drink.productionType,'drink');assert.equal(menu.enabled,false);
    record('create-350-yen-drink-with-explicit-category-and-fixed-pricing',width,{price:drink.price});
    await renamed(page,drink.id,`自家製レモン水 ${width}`);menu=await readMenu();drink=menu.catalog.items.find(item=>item.id===drink.id);assert.equal(drink.name,`自家製レモン水 ${width}`);record('new-drink-name-is-editable-by-native-pointer-and-keyboard-with-caret-movement',width);

    await click(page,'[data-dine-in-open="import"]');await page.select('#dine-in-import-source',ids.menu);await fill(page,'#dine-in-import-name',`店内マーラータン ${width}`);
    assert.match(await page.$eval('[data-dine-in-composer="import"]',el=>el.innerText),/¥4\s*\/\s*1g/);assert.equal(await page.$('[data-dine-in-composer="import"] input[inputmode="numeric"]'),null,'Imported price is not editable');
    await assertGeometry(page,'[data-dine-in-action="importItem"]');await page.screenshot({path:join(output,`composition-${width}-source-import.png`),fullPage:true});
    await click(page,'[data-dine-in-action="importItem"]');await waitForName(page,`店内マーラータン ${width}`);menu=await readMenu();let bowl=menu.catalog.items.find(item=>item.sourceItemId===ids.menu);
    assert.equal(bowl.posWeightUnitPrice,4);assert.equal(bowl.price,600);assert.equal(bowl.productionType,'bowl');
    assert.equal(menu.catalog.optionGroups.find(group=>group.sourceGroupId===ids.premiumGroup).ruleJson.portionGrams,50);record('on-demand-brand-bowl-import-preserves-four-yen-weight-and-fifty-gram-rules',width);

    await click(page,'[data-dine-in-open="addon"]');assert.equal(await page.$eval('#dine-in-addon-item',el=>el.value),bowl.id);
    await fill(page,'#dine-in-addon-name',`厨房追加まとめ ${width}`);
    const beef=findOption(menu,ids.beef),legacy=findOption(menu,ids.legacyOption);
    for(const option of [beef,legacy]){assert.ok(option);await assertGeometry(page,`input[data-addon-option-id="${option.id}"]`);await click(page,`input[data-addon-option-id="${option.id}"]`);}
    for(const sourceId of [ids.option,ids.heatOption,ids.numbOption,ids.requiredIngredientOption]){const option=findOption(menu,sourceId);assert.ok(option);assert.equal(await page.$(`input[data-addon-option-id="${option.id}"]`),null,'Heat/numb/required choices never appear in ingredient merge candidates');}
    await page.screenshot({path:join(output,`composition-${width}-cross-group-selection.png`),fullPage:true});await assertGeometry(page,'[data-dine-in-action="createAddonGroup"]');
    await click(page,'[data-dine-in-action="createAddonGroup"]');await waitForName(page,`厨房追加まとめ ${width}`);menu=await readMenu();let addon=menu.catalog.optionGroups.find(group=>group.localKind==='addon');bowl=menu.catalog.items.find(item=>item.id===bowl.id);
    assert.ok(addon);assert.deepEqual(addon.options.map(option=>option.sourceOptionId).sort(),[ids.beef,ids.legacyOption].sort());
    assert.equal(addon.options.find(option=>option.sourceOptionId===ids.beef).priceDelta,650);assert.equal(addon.options.find(option=>option.sourceOptionId===ids.legacyOption).priceDelta,100);
    for(const sourceId of [ids.beef,ids.legacyOption]){assert.equal(menu.catalog.optionGroups.filter(group=>bowl.optionGroupIds.includes(group.id)).flatMap(group=>group.options).filter(option=>option.sourceOptionId===sourceId).length,1,'Moved options are not duplicated for this product');}
    record('cross-group-checkbox-merge-moves-beef-and-legacy-food-without-changing-price-or-adding-duplicates',width,{prices:addon.options.map(option=>option.priceDelta)});

    await click(page,'details[data-addon-importer] > summary');const pork=findOption(menu,ids.pork);assert.ok(pork);await click(page,`input[data-addon-option-id="${pork.id}"]`);await assertGeometry(page,'[data-dine-in-action="importAddonOptions"]');
    await page.screenshot({path:join(output,`composition-${width}-continue-import.png`),fullPage:true});await click(page,'[data-dine-in-action="importAddonOptions"]');
    await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="retry"]')&&!document.querySelector('[data-dine-in-action="setEnabled"]').disabled);
    menu=await readMenu();addon=menu.catalog.optionGroups.find(group=>group.id===addon.id);assert.equal(addon.options.length,3);assert.equal(addon.options.find(option=>option.sourceOptionId===ids.pork).priceDelta,550);
    await page.screenshot({path:join(output,`composition-${width}-merged-result.png`),fullPage:true});record('existing-unified-group-can-continue-importing-pork-at-original-price',width);
    const beforeOrder=addon.options.map(option=>option.id),lastOption=addon.options.at(-1);
    await click(page,`[data-addon-order-option-id="${lastOption.id}"] [data-addon-order-direction="up"]`);
    const expectedOrder=[beforeOrder[0],beforeOrder[2],beforeOrder[1]];
    assert.deepEqual(await page.$$eval('[data-addon-order-option-id]',rows=>rows.map(row=>row.dataset.addonOrderOptionId)),expectedOrder);
    await assertGeometry(page,'[data-dine-in-action="reorderAddonOptions"]');await click(page,'[data-dine-in-action="reorderAddonOptions"]');
    await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="setEnabled"]').disabled);
    menu=await readMenu();addon=menu.catalog.optionGroups.find(group=>group.id===addon.id);assert.deepEqual(addon.options.map(option=>option.id),expectedOrder);assert.deepEqual(addon.options.map(option=>option.sortOrder),[0,1,2]);
    await page.screenshot({path:join(output,`composition-${width}-saved-order.png`),fullPage:true});record('unified-addon-reorder-saves-full-permutation-without-price-changes',width);


    await chooseKind(page,'商品分類');await renamed(page,category.id,`飲み物 ${width}`);menu=await readMenu();assert.equal(menu.catalog.items.find(item=>item.id===drink.id).category,`飲み物 ${width}`);assert.equal(menu.catalog.items.find(item=>item.id===bowl.id).category,'麻辣湯');record('category-rename-updates-only-local-product-placement',width);
    await chooseKind(page,'追加・選択グループ');await click(page,`[data-target-id="${addon.id}"]`);await page.select('[data-dine-in-visibility]','hide');await click(page,'[data-dine-in-action="setVisibility"]');
    await page.waitForFunction(()=>document.querySelector('[data-target-id][aria-pressed="true"]')?.textContent.includes('POS 非公開'));assert.equal((await readMenu()).catalog.optionGroups.find(group=>group.id===addon.id).visible,false);
    await page.select('[data-dine-in-visibility]','show');await click(page,'[data-dine-in-action="setVisibility"]');await page.waitForFunction(()=>document.querySelector('[data-target-id][aria-pressed="true"]')?.textContent.includes('POS 公開'));
    for(const enabled of [true,false,true]){await click(page,'[data-dine-in-action="setEnabled"]');await page.waitForFunction(enabled=>document.querySelector('[data-dine-in-action="setEnabled"]')?.textContent===(enabled?'独立メニューを停止':'独立メニューを使用'),{},enabled);assert.equal((await readMenu()).enabled,enabled);}record('group-publication-and-menu-enabled-switches-save-without-changing-source',width);

    await click(page,'[data-dine-in-open="category"]');await fill(page,'#dine-in-new-category-name',`通信確認 ${width}`);loseNextMutation=true;await click(page,'[data-dine-in-action="createCategory"]');
    await page.waitForFunction(()=>document.querySelector('[data-dine-in-action="retry"]')&&!document.querySelector('[data-dine-in-action="retry"]').disabled);const first=posts.at(-1);assert.equal(first.action,'createCategory');
    assert.equal((await readMenu()).catalog.categories.filter(category=>category.name===`通信確認 ${width}`).length,1);
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('[data-dine-in-action="retry"]')&&!document.querySelector('[data-dine-in-action="retry"]').disabled);await click(page,'[data-dine-in-action="retry"]');await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="retry"]'));
    assert.deepEqual(posts.at(-1),first);assert.equal((await readMenu()).catalog.categories.filter(category=>category.name===`通信確認 ${width}`).length,1);record('committed-unknown-create-survives-reload-and-retry-without-second-category',width);
    assert.deepEqual(await canonicalMasterSnapshot(),canonicalBefore);assert.equal(Number((await db.query('select count(*)::int n from store_dine_in_menus where store_id<>$1',[ids.store])).rows[0].n),0);record('brand-prices-specifications-and-other-stores-are-unchanged',width);
    await context.close();currentPage=null;
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const files=['app/os/menus/DineInMenuEditor.tsx','app/os/menus/DineInMenuComposer.tsx','app/os/menus/DineInMenuEditor.module.css','lib/store-dine-in-menu-policy.ts','lib/store-dine-in-menu.ts','app/api/os/menus/dine-in/route.ts','scripts/tests/store-dine-in-composition-ui.mjs'];
  const hashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(join(source,file))).digest('hex')])));
  const report={passed:results.length,results,errors,externalRequests:external,source,hashes,actualReact:true,actualOsRoute:true,isolatedPostgreSQL:true,nativePointerAndKeyboard:true,viewports:[390,800,1366],liveWrites:0};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(output,'executed-test.mjs'),await readFile(new URL(import.meta.url)));console.log(JSON.stringify({passed:report.passed,viewports:report.viewports,output}));
}catch(error){
  await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,posts,errors,external,state:currentPage&&!currentPage.isClosed()?await currentPage.$eval('body',el=>el.innerText):null},null,2));
  if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:join(output,'failure.png'),fullPage:true});throw error;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await f.db.close();stop();}
