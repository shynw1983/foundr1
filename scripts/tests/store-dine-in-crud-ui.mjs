// Actual React editor -> actual OS route -> isolated PostgreSQL, with local-only HTTP.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDineInMenuFixture,fixtureUuid} from './store-dine-in-menu-fixture.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-crud-ui');await mkdir(output,{recursive:true});
const verifiedFiles=['app/os/menus/DineInMenuEditor.tsx','app/os/menus/DineInMenuComposer.tsx','app/os/menus/DineInMenuEditor.module.css','app/os/components/OsTranslationProvider.tsx','public/locales/os/zh.json','public/locales/os/zh-Hans.json','public/locales/os/zh-Hant.json','lib/store-dine-in-menu-policy.ts','lib/store-dine-in-menu.ts','app/api/os/menus/dine-in/route.ts','scripts/tests/store-dine-in-crud-ui.mjs'];
const hashSources=async()=>Object.fromEntries(await Promise.all(verifiedFiles.map(async file=>[file,createHash('sha256').update(await readFile(join(source,file))).digest('hex')])));
const compiledInputHashes=await hashSources();await writeFile(join(output,'compiled-input-hashes.json'),JSON.stringify({recordedAt:new Date().toISOString(),source,sourceHashes:compiledInputHashes},null,2)+'\n');
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
const bundleHashes=Object.fromEntries(bundled.outputFiles.map(file=>[file.path,createHash('sha256').update(file.contents).digest('hex')]));
const css=await readFile(join(source,'app/globals.css'),'utf8')+'\n'+(bundled.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'')+'\nbody{margin:0;background:#f6f8f7}#root{max-width:1440px;margin:auto;padding:16px}nav[data-fixture-brand]{display:flex;gap:8px;padding:0 0 16px}';
const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const dictionaries=Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async key=>[key,JSON.parse(await readFile(join(source,`public/locales/os/${key}.json`),'utf8'))])));
let loseNextMutation=false,forceSchemaMissing=false,delayNextGet=0,failNextMutation=false;
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
      posts.push(JSON.parse(raw));if(failNextMutation){failNextMutation=false;return send(res,{error:'削除の保存に失敗しました。再確認してください。'},400);}const response=await f.admin().POST(request),body=await response.json();
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
async function settle(page){await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="setEnabled"]')?.disabled);}
async function openDelete(page){await click(page,'[data-dine-in-action="openDelete"]');await page.waitForSelector('dialog[open]');assert.match(await page.$eval('dialog[open]',el=>el.innerText),/Web予約・Webサイト・外部デリバリーと過去の注文は変更しません/);await assertGeometry(page,'dialog[open] [data-dine-in-action="delete"]');}
async function cancelDelete(page){const button=await page.evaluateHandle(()=>[...document.querySelectorAll('dialog[open] button')].find(x=>x.textContent==='キャンセル'));await button.asElement().click();await button.dispose();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));}
try{
  for(const width of [390,800,1366]){
    await db.exec('delete from store_dine_in_menu_operations;delete from store_dine_in_menus;');posts.length=0;
    const {page,context}=await pageAt(width);currentPage=page;page.setDefaultTimeout(15000);
    await click(page,'[data-dine-in-action="initialize"]');await page.waitForSelector('[data-dine-in-action="setEnabled"]');
    const createCategory=async name=>{await click(page,'[data-dine-in-open="category"]');await fill(page,'#dine-in-new-category-name',name);await click(page,'[data-dine-in-action="createCategory"]');await waitForName(page,name);return(await readMenu()).catalog.categories.find(x=>x.name===name);};
    const first=await createCategory(`基本 ${width}`),second=await createCategory(`移動先 ${width}`);
    await click(page,'[data-dine-in-open="item"]');await fill(page,'#dine-in-new-item-name',`新しい碗 ${width}`);await page.select('#dine-in-new-item-category',first.id);await click(page,'[data-dine-in-action="createItem"]');await waitForName(page,`新しい碗 ${width}`);
    let menu=await readMenu(),baseItem=menu.catalog.items.find(x=>x.name===`新しい碗 ${width}`);assert.deepEqual(baseItem.optionGroupIds,[]);assert.equal(baseItem.posWeightUnitPrice,4);record('create-base-and-product-categories-from-empty-menu-with-native-keyboard',width);
    await click(page,'[data-dine-in-open="group"]');assert.equal(await page.$eval('#dine-in-group-item',el=>el.value),baseItem.id);await fill(page,'#dine-in-group-name',`まとめ加料 ${width}`);await page.select('#dine-in-group-selection','quantity');
    await assertGeometry(page,'#dine-in-group-name');await assertGeometry(page,'[data-dine-in-action="createOptionGroup"]');await page.screenshot({path:join(output,`crud-${width}-new-group.png`),fullPage:true});await click(page,'[data-dine-in-action="createOptionGroup"]');await waitForName(page,`まとめ加料 ${width}`);
    menu=await readMenu();let group=menu.catalog.optionGroups.find(x=>x.name===`まとめ加料 ${width}`);assert.equal(group.options.length,0);assert.equal(group.selectionType,'quantity');record('create-empty-independent-option-group-for-new-base',width);
    await click(page,`details[data-addon-importer="${group.id}"] > summary`);
    const candidateText=await page.$eval(`details[data-addon-importer="${group.id}"]`,el=>el.innerText);assert.match(candidateText,/ブランドメニュー/);assert.match(candidateText,/牛筋 50g/);assert.match(candidateText,/650/);assert.match(candidateText,/店頭指定食材 50g/);assert.match(candidateText,/100/);assert.match(candidateText,/価格と50g/);
    for(const id of [ids.heatOption,ids.numbOption,ids.option])assert.equal(await page.$(`input[data-addon-option-id="${id}"]`),null,'Protected choices absent from cross-group importer');
    for(const id of [ids.beef,ids.legacyOption]){await assertGeometry(page,`input[data-addon-option-id="${id}"]`);await click(page,`input[data-addon-option-id="${id}"]`);}
    assert.match(await page.$eval(`details[data-addon-importer="${group.id}"]`,el=>el.innerText),/選択中 2 件/);await page.screenshot({path:join(output,`crud-${width}-multiple-source-options.png`),fullPage:true});await click(page,'[data-dine-in-action="importAddonOptions"]');await settle(page);menu=await readMenu();group=menu.catalog.optionGroups.find(x=>x.id===group.id);
    assert.deepEqual(group.options.map(x=>x.sourceOptionId).sort(),[ids.beef,ids.legacyOption].sort());assert.deepEqual(group.options.map(x=>x.priceDelta).sort((a,b)=>a-b),[100,650]);record('multi-select-cross-group-source-options-with-visible-original-price-and-fifty-gram-specification',width);
    await chooseKind(page,'選択肢');const localBeef=group.options.find(x=>x.sourceOptionId===ids.beef);await click(page,`[data-target-id="${localBeef.id}"]`);assert.equal(await page.$eval('[data-dine-in-option-price]',el=>el.value),'650');assert.equal(await page.$eval('[data-dine-in-action="setOptionPrice"]',el=>el.disabled),true);
    for(const value of ['', '-1', '1.2']){await fill(page,'[data-dine-in-option-price]',value);assert.equal(await page.$eval('[data-dine-in-action="setOptionPrice"]',el=>el.disabled),true);assert.equal(await page.$eval('[data-dine-in-option-price]',el=>el.getAttribute('aria-invalid')),'true');}
    await fill(page,'[data-dine-in-option-price]','500');await assertGeometry(page,'[data-dine-in-action="setOptionPrice"]');await page.screenshot({path:join(output,`crud-${width}-local-option-price.png`),fullPage:true});await click(page,'[data-dine-in-action="setOptionPrice"]');await settle(page);menu=await readMenu();assert.equal(menu.catalog.optionGroups.find(x=>x.id===group.id).options.find(x=>x.id===localBeef.id).priceDelta,500);assert.equal(menu.catalog.optionGroups.find(x=>x.id===group.id).options.find(x=>x.id===localBeef.id).name,'牛筋 50g');
    await fill(page,'[data-dine-in-option-price]','0');await click(page,'[data-dine-in-action="setOptionPrice"]');await settle(page);assert.equal((await readMenu()).catalog.optionGroups.find(x=>x.id===group.id).options.find(x=>x.id===localBeef.id).priceDelta,0);await fill(page,'[data-dine-in-option-price]','500');await click(page,'[data-dine-in-action="setOptionPrice"]');await settle(page);record('local-option-price-editor-validates-integers-allows-zero-and-preserves-fifty-gram-label',width);
    await click(page,'[data-dine-in-open="group"]');await page.select('#dine-in-group-item',baseItem.id);await fill(page,'#dine-in-group-name',`一つ選ぶ ${width}`);await page.select('#dine-in-group-selection','single');await click(page,'[data-dine-in-action="createOptionGroup"]');await waitForName(page,`一つ選ぶ ${width}`);menu=await readMenu();let singleGroup=menu.catalog.optionGroups.find(x=>x.name===`一つ選ぶ ${width}`);await click(page,`details[data-addon-importer="${singleGroup.id}"] > summary`);await click(page,`input[data-addon-option-id="${ids.pork}"]`);await click(page,'[data-dine-in-action="importAddonOptions"]');await settle(page);singleGroup=(await readMenu()).catalog.optionGroups.find(x=>x.id===singleGroup.id);assert.equal(singleGroup.selectionType,'single');assert.equal(singleGroup.ruleJson.maxSelections,1);assert.equal(singleGroup.options[0].priceDelta,550);record('single-choice-group-import-keeps-one-selection-rule',width);
    await chooseKind(page,'追加・選択グループ');await click(page,`[data-target-id="${group.id}"]`);
    await openDelete(page);const postsBeforeCancel=posts.length;await cancelDelete(page);assert.equal(posts.length,postsBeforeCancel);assert.ok((await readMenu()).catalog.optionGroups.some(x=>x.id===group.id));record('delete-dialog-cancel-performs-no-write-and-keeps-group',width);
    await chooseKind(page,'商品分類');await click(page,`[data-target-id="${first.id}"]`);await openDelete(page);assert.equal(await page.$eval('[data-dine-in-action="delete"]',el=>el.disabled),true);assert.match(await page.$eval('dialog[open]',el=>el.innerText),/商品 1 件/);assert.equal(await page.$eval('#dine-in-delete-replacement',(el,id)=>[...el.options].some(x=>x.value===id),first.id),false);
    await page.select('#dine-in-delete-replacement',second.id);await assertGeometry(page,'#dine-in-delete-replacement');await page.screenshot({path:join(output,`crud-${width}-delete-category-move.png`),fullPage:true});await click(page,'[data-dine-in-action="delete"]');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));await settle(page);menu=await readMenu();assert.ok(!menu.catalog.categories.some(x=>x.id===first.id));assert.equal(menu.catalog.items.find(x=>x.id===baseItem.id).category,second.name);assert.equal(menu.catalog.items.find(x=>x.id===baseItem.id).posWeightUnitPrice,4);record('nonempty-category-delete-requires-explicit-existing-destination-and-moves-product',width);
    await chooseKind(page,'追加・選択グループ');await click(page,`[data-target-id="${group.id}"]`);await openDelete(page);failNextMutation=true;await click(page,'[data-dine-in-action="delete"]');await page.waitForFunction(()=>document.querySelector('dialog[open] [role="alert"]')?.textContent.includes('削除の保存に失敗'));assert.ok((await readMenu()).catalog.optionGroups.some(x=>x.id===group.id));await assertGeometry(page,'dialog[open] [role="alert"]');await page.screenshot({path:join(output,`crud-${width}-delete-failure.png`),fullPage:true});await cancelDelete(page);record('failed-delete-retains-object-and-shows-actionable-error-inside-open-dialog',width);
    await openDelete(page);loseNextMutation=true;await click(page,'[data-dine-in-action="delete"]');await page.waitForSelector('dialog[open] [data-dine-in-action="retryDelete"]');assert.ok(!(await readMenu()).catalog.optionGroups.some(x=>x.id===group.id));const unknownCommand=posts.at(-1);await assertGeometry(page,'dialog[open] [data-dine-in-action="retryDelete"]');await page.screenshot({path:join(output,`crud-${width}-delete-unknown.png`),fullPage:true});await click(page,'[data-dine-in-action="retryDelete"]');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));await settle(page);assert.deepEqual(posts.at(-1),unknownCommand);menu=await readMenu();assert.ok(!menu.catalog.optionGroups.some(x=>x.id===group.id));assert.ok(menu.catalog.items.every(x=>!x.optionGroupIds.includes(group.id)));record('unknown-delete-result-retries-identical-operation-and-cleans-group-references-once',width);
    await chooseKind(page,'商品');await click(page,`[data-target-id="${baseItem.id}"]`);await openDelete(page);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.ok((await readMenu()).catalog.items.some(x=>x.id===baseItem.id));record('escape-dismisses-delete-confirmation-without-deleting-product',width);
    await openDelete(page);await click(page,'[data-dine-in-action="delete"]');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));await settle(page);menu=await readMenu();assert.equal(menu.catalog.items.length,0);assert.equal(Number((await db.query('select count(*)::int n from menu_catalog_items where id=$1',[baseItem.sourceItemId])).rows[0].n),1);await page.screenshot({path:join(output,`crud-${width}-product-deleted.png`),fullPage:true});record('confirmed-product-delete-leaves-canonical-id-for-old-orders-and-empty-editable-menu',width);
    assert.deepEqual(await canonicalMasterSnapshot(),canonicalBefore);assert.equal(Number((await db.query('select count(*)::int n from store_dine_in_menus where store_id<>$1',[ids.store])).rows[0].n),0);record('brand-menu-prices-portions-and-other-store-data-are-unchanged',width);await context.close();currentPage=null;
  }
  // A separate authenticated, local-only menu supplies the Chinese copy checks.
  let translatedMenu=await readMenu();
  const edit=async body=>{const response=await f.mutateMenu({revision:translatedMenu.revision,operationId:fixtureUuid(49000+posts.length+Number(translatedMenu.revision)),...body});assert.equal(response.status,200,await response.clone().text());translatedMenu=await response.json();};
  await edit({action:'importItem',sourceItemId:ids.menu,name:'中文验证店内碗'});
  const translatedItem=translatedMenu.catalog.items.find(x=>x.name==='中文验证店内碗'),translatedOption=translatedMenu.catalog.optionGroups.filter(x=>translatedItem.optionGroupIds.includes(x.id)).flatMap(x=>x.options).find(x=>x.sourceOptionId===ids.beef);
  for(const language of ['zh-Hans','zh-Hant']){
    const {page,context}=await pageAt(390,language);currentPage=page;const dictionary=dictionaries[language];
    await page.waitForFunction(label=>document.querySelector('[data-dine-in-open="group"]')?.textContent.includes(label),{},dictionary['選択グループを作成']);
    await click(page,'[data-dine-in-open="group"]');assert.ok((await page.$eval('[data-dine-in-composer="group"]',el=>el.innerText)).includes(dictionary['選び方']));await assertGeometry(page,'#dine-in-group-name');
    const kind=await page.evaluateHandle(label=>[...document.querySelectorAll('[data-dine-in-menu-editor] button')].find(x=>x.textContent===label),dictionary['選択肢']);await kind.asElement().click();await kind.dispose();await click(page,`[data-target-id="${translatedOption.id}"]`);
    assert.ok((await page.$eval('[data-dine-in-option-price-form]',el=>el.innerText)).includes(dictionary['店内の追加料金（円／1点）']));await fill(page,'[data-dine-in-option-price]','-1');assert.ok((await page.$eval('[data-dine-in-option-price-form]',el=>el.innerText)).includes(dictionary['価格は0〜9,999,999円の整数で入力してください。']));await fill(page,'[data-dine-in-option-price]','500');await assertGeometry(page,'[data-dine-in-action="setOptionPrice"]');await page.screenshot({path:join(output,`crud-390-${language}-price.png`),fullPage:true});
    await click(page,'[data-dine-in-action="openDelete"]');await page.waitForSelector('dialog[open]');assert.ok((await page.$eval('dialog[open]',el=>el.innerText)).includes(dictionary['削除する']));await assertGeometry(page,'dialog[open] [data-dine-in-action="delete"]');await page.screenshot({path:join(output,`crud-390-${language}-delete.png`),fullPage:true});await page.keyboard.press('Escape');await context.close();currentPage=null;record(`translated-group-price-validation-and-delete-dialog-${language}`,390);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const sourceHashes=await hashSources();assert.deepEqual(sourceHashes,compiledInputHashes,'Exact UI/API sources match before bundle and after all interactions');
  const report={passed:results.length,results,errors,externalRequests:external,source,sourceHashes,compiledInputHashes,bundleHashes,noSourceDrift:true,actualReact:true,actualOsRoute:true,isolatedPostgreSQL:true,nativePointerAndKeyboard:true,viewports:[390,800,1366],languages:['ja','zh-Hans','zh-Hant'],liveWrites:0};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(output,'executed-test.mjs'),await readFile(new URL(import.meta.url)));console.log(JSON.stringify({passed:report.passed,viewports:report.viewports,output}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,posts,errors,external,state:currentPage&&!currentPage.isClosed()?await currentPage.$eval('body',el=>el.innerText):null},null,2));if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:join(output,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await f.db.close();stop();}
