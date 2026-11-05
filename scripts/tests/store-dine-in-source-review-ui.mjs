// Real React editor, actual API and isolated PostgreSQL. No live account, business writes or device calls.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-source-review-ui');await mkdir(output,{recursive:true});
const tracked=['app/os/menus/DineInMenuEditor.tsx','app/os/menus/DineInMenuComposer.tsx','app/os/menus/DineInSourceReview.tsx','app/os/menus/DineInSourceReview.module.css','lib/store-dine-in-menu.ts','lib/store-dine-in-menu-policy.ts','lib/store-dine-in-source-review.ts','scripts/tests/store-dine-in-source-review-ui.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(tracked.map(async file=>[file,createHash('sha256').update(await readFile(join(source,file))).digest('hex')])));
const inputHashes=await hashes();
let scaffold=await readFile(join(source,'scripts/tests/store-dine-in-menu-ui.mjs'),'utf8');
const marker='\ntry{\n  for(const width of [390,800,1366]){';assert.equal(scaffold.split(marker).length,2);scaffold=scaffold.split(marker)[0];
scaffold=scaffold.replace("from './store-dine-in-menu-fixture.mjs'",`from ${JSON.stringify(join(source,'scripts/tests/store-dine-in-menu-fixture.mjs'))}`);
// The exact locked application code is bundled; the isolated esbuild tool is test infrastructure.
if(process.env.FOUNDR1_ESBUILD_MODULE)scaffold=scaffold.replace("{build,stop}=require('esbuild')",`{build,stop}=require(${JSON.stringify(process.env.FOUNDR1_ESBUILD_MODULE)})`);
const tests=String.raw`
const op=()=>crypto.randomUUID();
const mutate=async(change)=>{const menu=await readMenu();const response=await f.mutateMenu({operationId:op(),revision:menu.revision,...change});assert.equal(response.status,200,await response.clone().text());return response.json();};
const itemBySource=(m,id)=>m.catalog.items.find(x=>x.sourceItemId===id);
const optionBySource=(m,id)=>m.catalog.optionGroups.flatMap(x=>x.options).find(x=>x.sourceOptionId===id);
async function selectEntry(page,key){await click(page,'[data-dine-in-view="source"]');await click(page,'[data-source-entry-key="'+key+'"]');await page.waitForSelector('[data-source-review-detail="'+key+'"]');}
async function ready(page){await page.waitForFunction(()=>!document.querySelector('[data-dine-in-view="source"]').disabled);}
async function setup(){
 await db.exec('delete from store_dine_in_menu_operations;delete from store_dine_in_menus;');
 await db.exec("delete from menu_catalog_items where variable_schema->>'storeDineInOnly'='true';");
 await db.query("update menu_options set name='牛筋 50g',price_delta=500 where id=$1",[ids.beef]);
 let m=await mutate({action:'initialize',mode:'source',enabled:true});
 const item=itemBySource(m,ids.menu),b=optionBySource(m,ids.beef);
 m=await mutate({action:'rename',kind:'item',targetId:item.id,name:'店内 基本スープ'});
 m=await mutate({action:'rename',kind:'option',targetId:b.id,name:'厨房追加 牛筋 50g'});
 m=await mutate({action:'createAddonGroup',name:'統一加料',itemId:item.id,optionIds:[b.id,optionBySource(m,ids.legacyOption).id]});
 const group=m.catalog.optionGroups.find(g=>g.name==='統一加料');
 m=await mutate({action:'createItem',name:'店内限定 ドリンク',categoryId:m.catalog.categories.find(c=>c.name==='ドリンク').id,itemKind:'drink',price:350,pricingMode:'fixed'});
 await db.query("update menu_options set name='国産牛筋 50g',price_delta=700 where id=$1",[ids.beef]);
 return {m:await readMenu(),groupId:group.id,itemId:item.id};
}
try{
 for(const width of[390,800,1366]){
  const{m,groupId,itemId}=await setup();posts.length=0;
  const beef=m.catalog.optionGroups.find(g=>g.id===groupId).options.find(o=>o.sourceOptionId===ids.beef);
  const key='option:'+beef.id;
  const{page,context}=await pageAt(width);
  await selectEntry(page,key);
  const detail=await page.$eval('[data-source-review-detail]',el=>el.innerText);
  assert.match(detail,/統一加料/);assert.match(detail,/厨房追加食材/);assert.match(detail,/厨房追加 牛筋 50g/);assert.match(detail,/国産牛筋 50g/);assert.match(detail,/650/);assert.match(detail,/700/);assert.match(detail,/50g/);
  const geometry=await assertGeometry(page,'[data-source-review-save]');
  await page.screenshot({path:join(output,'correspondence-'+width+'.png'),fullPage:true});
  await page.select('[data-source-field="name"] select','keep');
  await page.select('[data-source-field="price"] select','adopt');
  await click(page,'[data-source-review-save]');await ready(page);
  const saved=await readMenu(),savedBeef=saved.catalog.optionGroups.flatMap(g=>g.options).find(o=>o.id===beef.id);
  assert.equal(savedBeef.name,'厨房追加 牛筋 50g');assert.equal(savedBeef.priceDelta,700);
  assert.equal(saved.catalog.optionGroups.find(g=>g.id===groupId).ruleJson.portionGrams,undefined,'Merged group does not invent one common portion for multiple source groups');
  assert.equal(savedBeef.sourceGroupRuleJson.portionGrams,50);
  assert.ok(!saved.sourceReview.entries.find(e=>e.key===key).pending);
  assert.equal(posts.length,1);assert.equal(posts[0].action,'reviewSource');assert.deepEqual(posts[0].decisions,[{field:'name',decision:'keep'},{field:'price',decision:'adopt'}]);
  assert.ok(!Object.hasOwn(posts[0],'price'));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-dine-in-view="source"]');await selectEntry(page,key);
  assert.ok(!(await readMenu()).sourceReview.entries.find(e=>e.key===key).pending);
  record({name:'actual-react-per-field-adoption-persists-source-baseline-and-merged-lineage-'+width,passed:true,width,geometry});
  await selectEntry(page,'item:'+itemId);
  const priceOptions=await page.$$eval('[data-source-field="price"] select option',els=>els.map(el=>el.value));
  assert.ok(!priceOptions.includes('adopt'));assert.match(await page.$eval('[data-source-field="price"]',el=>el.innerText),/4/);assert.match(await page.$eval('[data-source-field="price"]',el=>el.innerText),/815/);
  const localOnly=(await readMenu()).sourceReview.entries.find(e=>e.status==='localOnly'&&e.kind==='item');assert.ok(localOnly);
  await selectEntry(page,localOnly.key);assert.match(await page.$eval('[data-source-review-detail]',el=>el.innerText),/350/);assert.equal(await page.$('[data-source-review-save]'),null);
  record({name:'weight-vs-portion-price-copy-unavailable-and-local-only-price-visible-'+width,passed:true});
  await context.close();
 }
 // Existing catalogs never invent a previous imported source baseline; a keep-only review is durable.
 for(const width of[390,800,1366]){
  let{m}=await setup();await db.query("update store_dine_in_menus set catalog=catalog-'sourceReview' where store_id=$1",[ids.store]);m=await readMenu();
  const beef=optionBySource(m,ids.beef),key='option:'+beef.id,{page,context}=await pageAt(width);
  await selectEntry(page,key);
  const field=await page.$eval('[data-source-field="price"]',el=>el.innerText);assert.match(field,/初回確認/);assert.ok(!field.includes('元メニューが変更されました'));
  const before=await readMenu();await click(page,'[data-source-review-keep]');await ready(page);const after=await readMenu();
  assert.equal(after.aggregateRevision,before.aggregateRevision);assert.equal(optionBySource(after,ids.beef).priceDelta,650);assert.ok(!after.sourceReview.entries.find(e=>e.key===key).pending);
  assert.equal(after.sourceReview.initial,true,'A partial initial confirmation retains the bulk setup entry');
  await db.query('update menu_options set price_delta=701 where id=$1',[ids.beef]);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-dine-in-view="source"]');await selectEntry(page,key);
  const current=await readMenu(),business=structuredClone(current.catalog);delete business.sourceReview;
  await assertGeometry(page,'[data-source-review-baseline]');await page.screenshot({path:join(output,'initial-baseline-'+width+'.png'),fullPage:true});
  await click(page,'[data-source-review-baseline]');await ready(page);const confirmed=await readMenu(),confirmedBusiness=structuredClone(confirmed.catalog);delete confirmedBusiness.sourceReview;
  assert.deepEqual(confirmedBusiness,business);assert.equal(confirmed.aggregateRevision,current.aggregateRevision);assert.equal(confirmed.sourceReview.initial,false);assert.equal(await page.$('[data-source-review-baseline]'),null);
  assert.equal(confirmed.sourceReview.entries.find(e=>e.key===key).fields.find(f=>f.field==='price').changed,true,'Previously reviewed source change remains pending');
  assert.ok(confirmed.sourceReview.entries.filter(e=>e.status==='new').every(e=>!e.pending));assert.equal(confirmed.catalog.items.length,current.catalog.items.length);
  const request=posts.at(-1);assert.equal(request.action,'acknowledgeSourceBaseline');assert.deepEqual(Object.keys(request).sort(),['action','brandId','operationId','revision','sourceRevision','storeId'].sort());
  record({name:'legacy-initial-bulk-confirmation-preserves-menu-and-keeps-known-changes-pending-'+width,passed:true,width});await context.close();
 }
 // Brand source changes after rendering are rejected; no unseen price can be adopted.
 {
  const{m}=await setup(),beef=optionBySource(m,ids.beef),key='option:'+beef.id,{page,context}=await pageAt();await selectEntry(page,key);await page.select('[data-source-field="price"] select','adopt');
  await db.query('update menu_options set price_delta=701 where id=$1',[ids.beef]);await click(page,'[data-source-review-save]');await page.waitForSelector('[role="alert"]');assert.equal(await page.$eval('[data-source-review-save]',e=>e.disabled),true);assert.equal(optionBySource(await readMenu(),ids.beef).priceDelta,650);assert.match(await page.$eval('[role="alert"]',e=>e.innerText),/参照元|再読込/);
  record({name:'unseen-source-price-conflicts-visibly-with-local-price-retained',passed:true});await context.close();
 }
 // Unknown save result retries the exact immutable request, once.
 {
  const{m}=await setup(),beef=optionBySource(m,ids.beef),key='option:'+beef.id,{page,context}=await pageAt();await selectEntry(page,key);await page.select('[data-source-field="price"] select','adopt');loseNextMutation=true;await click(page,'[data-source-review-save]');await page.waitForSelector('[data-dine-in-action="retry"]');const first=posts.at(-1),revision=(await readMenu()).revision;
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-dine-in-action="retry"]');await click(page,'[data-dine-in-action="retry"]');await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="retry"]'));
  assert.deepEqual(posts.at(-1),first);assert.equal((await readMenu()).revision,revision);assert.equal(optionBySource(await readMenu(),ids.beef).priceDelta,700);
  record({name:'unknown-committed-source-review-reloads-and-retries-without-second-write',passed:true});await context.close();
 }
 // A newly added brand product is offered explicitly and routed into the existing importer.
 {
  await setup();const newId='00000000-0000-4000-8000-000000009901';await db.query("insert into menu_catalog_items(id,brand_id,name,item_kind,category,base_price) values($1,$2,'新しいブランド茶','drink','ドリンク',450) on conflict(id) do update set is_active=true",[newId,ids.brand]);
  const{page,context}=await pageAt(800);await selectEntry(page,'new:item:'+newId);await click(page,'[data-source-review-import]');await page.waitForSelector('[data-dine-in-action="importItem"]');assert.equal(await page.$eval('#dine-in-import-source',e=>e.value),newId);assert.equal((await readMenu()).catalog.items.some(i=>i.sourceItemId===newId),false);
  await click(page,'[data-dine-in-action="importItem"]');await ready(page);assert.equal((await readMenu()).catalog.items.filter(i=>i.sourceItemId===newId).length,1);
  record({name:'new-upstream-product-routes-to-explicit-import-without-automatic-add',passed:true});await context.close();
 }
 {
  const{groupId}=await setup(),newId='00000000-0000-4000-8000-000000009902';
  await db.query("insert into menu_options(id,option_group_id,option_key,name,price_delta) values($1,$2,'new-seafood','新しい海鮮 50g',800) on conflict(id) do update set is_active=true",[newId,ids.premiumGroup]);
  const{page,context}=await pageAt(800);await selectEntry(page,'new:option:'+newId);await click(page,'[data-source-review-import]');await page.waitForSelector('[data-dine-in-addon-target]');assert.equal(await page.$eval('[data-dine-in-addon-target]',e=>e.value),groupId);
  assert.equal((await readMenu()).catalog.optionGroups.find(g=>g.id===groupId).options.some(o=>o.sourceOptionId===newId),false);
  await click(page,'[data-dine-in-action="importAddonOptions"]');await ready(page);
  const saved=await readMenu(),added=saved.catalog.optionGroups.find(g=>g.id===groupId).options.find(o=>o.sourceOptionId===newId);assert.ok(added);assert.equal(added.priceDelta,800);assert.equal(added.sourceGroupId,ids.premiumGroup);assert.equal(added.sourceGroupRuleJson.portionGrams,50);
  assert.equal(saved.catalog.optionGroups.find(g=>g.id===groupId).name,'統一加料');record({name:'new-upstream-ingredient-imports-explicitly-into-existing-unified-group',passed:true});await context.close();
 }
 {
  const{m}=await setup(),beef=optionBySource(m,ids.beef),{page,context}=await pageAt(390,'zh-Hans');await selectEntry(page,'option:'+beef.id);const detail=await page.$eval('[data-source-review]',e=>e.innerText);assert.match(detail,/对应|對應/);assert.ok(!detail.includes('選んだ項目の扱いを保存'));await assertGeometry(page,'[data-source-review-save]');await page.screenshot({path:join(output,'correspondence-zh-Hans-390.png'),fullPage:true});record({name:'simplified-chinese-source-review-local-ui-translated',passed:true});await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(join(output,'report.json'),JSON.stringify({passed:true,checks:results.length,results,errors,externalRequests:external,realReact:true,realApi:true,isolatedPostgres:true,viewports:[390,800,1366],liveWrites:0},null,2)+'\n');console.log(JSON.stringify({passed:true,checks:results.length}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,posts,errors},null,2)+'\n');throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await f.db.close();stop();}
`;
const executed=join(output,'executed.mjs');await writeFile(executed,scaffold+tests);
const code=await new Promise((ok,fail)=>{const child=spawn(process.execPath,[executed,'--source',source,'--output',output],{cwd:source,stdio:'inherit',env:process.env});const timer=setTimeout(()=>{child.kill('SIGTERM');fail(Error('Source review UI exceeded 5 minutes'));},300000);child.on('error',fail);child.on('exit',code=>{clearTimeout(timer);ok(code);});});assert.equal(code,0);
const outputHashes=await hashes();assert.deepEqual(outputHashes,inputHashes);await writeFile(join(output,'source-verification.json'),JSON.stringify({inputHashes,outputHashes,noSourceDrift:true},null,2)+'\n');await rm(join(output,'failure.json'),{force:true});
