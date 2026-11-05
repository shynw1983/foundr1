// Real editor -> real scoped menu API -> isolated PGlite, with local-only browser traffic.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-fulfillment-ui');await mkdir(output,{recursive:true});
const files=['app/os/menus/DineInFulfillmentSettings.tsx','app/os/menus/DineInMenuEditor.tsx','lib/store-dine-in-menu-policy.ts','lib/store-dine-in-runtime.ts','public/locales/os/zh-Hans.json','public/locales/os/zh-Hant.json','scripts/tests/store-dine-in-fulfillment-ui.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(join(source,p))).digest('hex')])));const inputHashes=await hashes();
let text=await readFile(join(source,'scripts/tests/store-dine-in-crud-ui.mjs'),'utf8');const marker='\ntry{\n  for(const width of [390,800,1366]){';assert.equal(text.split(marker).length,2);text=text.split(marker)[0];text=text.replace("from './store-dine-in-menu-fixture.mjs'",'from '+JSON.stringify(join(source,'scripts/tests/store-dine-in-menu-fixture.mjs')));
text+=String.raw`
let operation=99000;
async function edit(menu,command){const r=await f.mutateMenu({revision:menu.revision,operationId:fixtureUuid(operation++),...command});assert.equal(r.status,200,await r.clone().text());return r.json();}
async function setup(width){
 await db.exec('delete from store_dine_in_menu_operations;delete from store_dine_in_menus;');posts.length=0;
 let menu=await edit({revision:''},{action:'initialize',mode:'empty'});
 for(const name of['飲料','麻辣湯'])menu=await edit(menu,{action:'createCategory',name});
 const category=menu.catalog.categories.find(x=>x.name==='飲料'),bowlCategory=menu.catalog.categories.find(x=>x.name==='麻辣湯');
 menu=await edit(menu,{action:'createItem',name:'缶のお茶 '+width,categoryId:category.id,itemKind:'drink',price:250});const drink=menu.catalog.items.at(-1);
 menu=await edit(menu,{action:'createItem',name:'麻辣湯 '+width,categoryId:bowlCategory.id,itemKind:'buildable_product',price:0,pricingMode:'weight'});const bowl=menu.catalog.items.at(-1);
 return{menu,category,bowlCategory,drink,bowl};
}
const control='[data-dine-in-fulfillment]',save='[data-dine-in-action="setFulfillmentMode"]';
async function waitSaved(page,value){await page.waitForFunction(({control,save,value})=>document.querySelector(control)?.value===value&&document.querySelector(save)?.disabled,{}, {control,save,value});}
try{
 for(const width of[390,800,1366]){
  const data=await setup(width);const{page,context}=await pageAt(width);currentPage=page;page.setDefaultTimeout(15000);
  await chooseKind(page,'商品分類');await click(page,'[data-target-id="'+data.category.id+'"]');assert.equal(await page.$eval(control,x=>x.value),'inherit');assert.equal(await page.$eval(save,x=>x.disabled),true);
  await page.select(control,'immediate');await assertGeometry(page,control);await assertGeometry(page,save);await page.screenshot({path:join(output,'category-mode-'+width+'.png'),fullPage:true});await click(page,save);await waitSaved(page,'immediate');
  assert.equal((await readMenu()).catalog.categories.find(x=>x.id===data.category.id).fulfillmentMode,'immediate');record('category-immediate-setting-native-save-persists-and-disables-unchanged-button',width);
  await chooseKind(page,'商品');await click(page,'[data-target-id="'+data.drink.id+'"]');assert.equal(await page.$eval(control,x=>x.value),'inherit');assert.match(await page.$eval('[data-dine-in-fulfillment-effective]',x=>x.textContent),/会計時にお渡し/);
  await page.select(control,'prepare');await click(page,save);await waitSaved(page,'prepare');assert.equal((await readMenu()).catalog.items.find(x=>x.id===data.drink.id).fulfillmentMode,'prepare');
  await page.select(control,'inherit');await click(page,save);await waitSaved(page,'inherit');assert.equal(Object.hasOwn((await readMenu()).catalog.items.find(x=>x.id===data.drink.id),'fulfillmentMode'),false);assert.match(await page.$eval('[data-dine-in-fulfillment-effective]',x=>x.textContent),/会計時にお渡し/);record('product-override-and-inherit-show-effective-category-method-without-price-change',width);
  await click(page,'[data-target-id="'+data.bowl.id+'"]');assert.equal(await page.$eval(control+' option[value="immediate"]',x=>x.disabled),true);assert.match(await page.$eval('[data-dine-in-fulfillment-form]',x=>x.textContent),/1杯ごとに調理/);
  await chooseKind(page,'商品分類');await click(page,'[data-target-id="'+data.bowlCategory.id+'"]');assert.equal(await page.$eval(control+' option[value="immediate"]',x=>x.disabled),true);record('bowl-and-category-containing-bowl-do-not-offer-immediate-delivery',width);
  await chooseKind(page,'商品');await click(page,'[data-target-id="'+data.drink.id+'"]');await page.select(control,'prepare');loseNextMutation=true;await click(page,save);await page.waitForSelector('[data-dine-in-action="retry"]');const command=posts.at(-1);assert.equal(command.action,'setFulfillmentMode');assert.equal(command.fulfillmentMode,'prepare');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-dine-in-action="retry"]');await click(page,'[data-dine-in-action="retry"]');await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="retry"]'));assert.deepEqual(posts.at(-1),command);await click(page,'[data-target-id="'+data.drink.id+'"]');await waitSaved(page,'prepare');assert.equal((await readMenu()).catalog.items.find(x=>x.id===data.drink.id).price,250);record('uncertain-save-persists-exact-operation-and-retries-without-double-change',width);
  await assertGeometry(page,control);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(output,'product-mode-'+width+'.png'),fullPage:true});record('fulfillment-controls-fit-and-receive-native-pointer-input',width);await context.close();currentPage=null;
 }
 for(const[language,label]of[['zh-Hans','交付方式'],['zh-Hant','交付方式']]){
  const menu=await readMenu(),drink=menu.catalog.items.find(x=>x.name.startsWith('缶のお茶'));const{page,context}=await pageAt(390,language);currentPage=page;await click(page,'[data-target-id="'+drink.id+'"]');await page.waitForFunction(label=>document.querySelector('[data-dine-in-fulfillment-form]')?.textContent.includes(label),{},label);assert.match(await page.$eval('[data-dine-in-fulfillment-form]',x=>x.textContent),language==='zh-Hans'?/结账时交付/:/結帳時交付/);record('fulfillment-labels-localized-'+language,390);await context.close();currentPage=null;
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await writeFile(join(output,'report.json'),JSON.stringify({passed:results.length,results,actualReactEditor:true,actualMenuApi:true,isolatedPostgreSQL:true,viewports:[390,800,1366],errors,externalRequests:external,productionWrites:0},null,2)+'\n');console.log(JSON.stringify({passed:results.length}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,posts,errors,external,state:currentPage&&!currentPage.isClosed()?await currentPage.$eval('body',x=>x.innerText):null},null,2)+'\n');if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:join(output,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));await db.close();stop();}
`;
const executed=join(output,'executed.mjs');await writeFile(executed,text);const log=[];const code=await new Promise((ok,fail)=>{const child=spawn(process.execPath,[executed,'--source',source,'--output',output],{cwd:source,stdio:['ignore','pipe','pipe']});const timeout=setTimeout(()=>{child.kill('SIGTERM');fail(Error('Fulfillment editor UI exceeded four minutes'));},240000);for(const stream of[child.stdout,child.stderr])stream.on('data',c=>{log.push(String(c));process.stdout.write(c);});child.on('error',fail);child.on('exit',code=>{clearTimeout(timeout);ok(code);});});await writeFile(join(output,'test.log'),log.join(''));assert.equal(code,0);const finalHashes=await hashes();assert.deepEqual(finalHashes,inputHashes);await writeFile(join(output,'source-verification.json'),JSON.stringify({source,inputHashes,finalHashes,noSourceDrift:true},null,2)+'\n');
