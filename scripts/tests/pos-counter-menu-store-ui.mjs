// Actual POS workspace, with a loopback-only synthetic menu, cash register and printer.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) => value.startsWith('--') ? [[value.slice(2), all[index + 1]]] : []));
const source = resolve(args.source || process.cwd()), output = resolve(args.output || 'outputs/pos-counter-menu-store-ui');
await mkdir(output, { recursive: true });
const files = ['app/store/pos/StorePosWorkspace.tsx', 'app/store/pos/usePosMenuRefresh.ts', 'app/store/pos/PosDebugMode.tsx', 'lib/pos-counter-tax.ts', 'lib/pos-counter-menu-policy.ts', 'lib/pos-printer.ts', 'scripts/tests/store-dine-in-pricing-pos-ui.mjs', 'scripts/tests/pos-counter-menu-store-ui.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(join(source, path))).digest('hex')])));
const inputHashes = await hashes();
const fixture = await readFile(join(source, 'scripts/tests/store-dine-in-pricing-pos-ui.mjs'), 'utf8');
const marker = '\ntry{\n  for(const width of [800,1366]){';
assert.equal(fixture.split(marker).length, 2);
let executable = fixture.split(marker)[0];
function replaceOnce(before, after) { assert.equal(executable.split(before).length, 2, before); executable = executable.replace(before, after); }
replaceOnce('const item=baseItem,localItem=baseItem,group=noodleGroup,localGroup=addonGroup;', `
const item=baseItem,localItem=baseItem,group=noodleGroup,localGroup=addonGroup;
const canonical = { ...foodItem, id: canonicalId, name: 'ブランド持ち帰り専用', basePrice: 777 };
const paidAlcohol = { ...beef, name: '有料標準税率追加', priceDelta: 550, counterStandardTax: true };
const restrictedOption = { ...beef, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '店内限定追加', priceDelta: 330, counterStandardTax: true, counterTakeoutRestricted: true };
const restrictedItem = { ...drinkItem, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: '店内限定ビール', basePrice: 550, counterStandardTax: true, counterTakeoutRestricted: true };
const exchangeGroupId='efefefef-efef-4fef-8fef-efefefefefef';
const exchangeItem = { ...foodItem,id:'dededede-dede-4ede-8ede-dededededede',name:'交換対象の単品',optionGroupIds:[exchangeGroupId] };
const controllerId='12121212-1212-4212-8212-121212121212', dependentId='13131313-1313-4313-8313-131313131313';
const dependentItem = { ...foodItem,id:'14141414-1414-4414-8414-141414141414',name:'条件付きの単品',optionGroupIds:[controllerId,dependentId] };
const normalOption = { ...noodle,id:'15151515-1515-4515-8515-151515151515',name:'通常の味',optionKey:'normal',priceDelta:0 };
const triggerOption = { ...normalOption,id:'16161616-1616-4616-8616-161616161616',name:'店内追加を表示する味',optionKey:'trigger' };
const onlyRestricted = { ...restrictedOption,id:'17171717-1717-4717-8717-171717171717',name:'必須の店内限定追加' };
const controllerGroup = { ...addonGroup,id:controllerId,menuCatalogItemId:dependentItem.id,name:'味を選ぶ',selectionType:'single',ruleJson:{minSelections:1,defaultOptionKey:'normal'},options:[normalOption,triggerOption] };
const dependentGroup = { ...controllerGroup,id:dependentId,name:'必須追加',ruleJson:{minSelections:1,optionRequirements:{[onlyRestricted.id]:{groupId:controllerId,optionIds:[triggerOption.id],selectOnMatch:true}}},options:[onlyRestricted] };
const localCatalog = { items:[baseItem,foodItem,restrictedItem,exchangeItem,dependentItem], categories:[], optionGroups:[noodleGroup,{ ...addonGroup, options:[paidAlcohol,restrictedOption] },{ ...addonGroup,id:exchangeGroupId,menuCatalogItemId:exchangeItem.id,options:[paidAlcohol] },controllerGroup,dependentGroup] };
const revision = 'fixture-counter-policy:1';
const fixturePolicy = { sharedMenuForTakeout: true, standardTaxCategoryIds:['dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'], takeoutRestrictedCategoryIds:['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'] };
const fixtureTare = { enabled:true, revision:'tare-fixture', presets:[{id:'small',grams:90},{id:'large',grams:140}] };
const fixtureDiscount = { key:'save-100', name:'レジ割引100円', enabled:true, discountType:'amount', discountValue:100, targetScope:'all', targetValue:'', stampEligible:true, allowCouponCombination:true };
let fixtureShared = true, fixtureOfflinePrint = false, fixtureMissingRevision = false, fixtureMissingLocal = false, fixturePolicyRevision = revision;
`);
replaceOnce("if (req.method === 'POST') { let raw = ''; for await (const part of req) raw += part; customerDisplayPosts.push(JSON.parse(raw)); }", "if (req.method === 'POST') { let raw = ''; for await (const part of req) raw += part; const event = JSON.parse(raw); customerDisplayPosts.push(event); if (event.action === 'claim') return send(res,{ok:true,streamId:'fixture-counter',state:{revision:1}}); }");
replaceOnce('connection:{bind(){}},subscribe()', 'connection:{bind(){},unbind(){}},subscribe()');
replaceOnce('await button.click();return;', "await button.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await button.click();return;");
replaceOnce("return send(res, { businessDate: '2026-10-20', activeSession: openSession", "return send(res, { selectedStoreId: store.id, businessDate: '2026-10-20', activeSession: openSession");
const oldGet = executable.split('\n').find(line => line.includes("if (url.pathname === '/api/store/pos') return send"));
assert.ok(oldGet);
replaceOnce(oldGet, `    if (url.pathname === '/api/store/pos/summary') return send(res,{selectedStoreId:store.id,todaySummary:summary});
    if (url.pathname === '/api/store/pos/member') return send(res,{member:{id:'member-fixture',memberNumber:'1000',publicToken:'fixture-member',displayName:'テスト会員',lastName:'テスト',firstName:'会員',fullName:'テスト 会員',preferredLanguage:'ja',pointBalance:0,lifetimeSpendAmount:0,lifetimeVisitCount:0,currentTierKey:'regular'},coupons:[{id:'exchange-fixture',brandId:brand.id,brandName:brand.name,couponCode:'EXCHANGE',name:'交換券',discountType:'amount',discountValue:0,maxDiscountAmount:null,expiresAt:'',issuedSource:'stamp_campaign'}]});
    if (url.pathname === '/api/store/pos') return send(res, {
      selectedStoreId: store.id, access:{ role:'owner', stores:[store] }, brands:[brand], items:[canonical], categories:[], optionGroups:[],
      dineInMenu: fixtureMissingLocal ? null : localCatalog, dineInMenuRevision:'local:1', posMenuRevision:'brand:1',
      ...(fixtureMissingRevision ? {} : { counterMenuPolicyRevision:fixturePolicyRevision }), todaySummary:summary,
      posSettings:{ dineInEnabled:true,takeoutEnabled:true,dineInTaxRate:10,takeoutTaxRate:8,priceTaxMode:'tax_included',
        counterMenuPolicy:fixtureShared ? fixturePolicy : { ...fixturePolicy,sharedMenuForTakeout:false },
        scaleTareSettings:fixtureTare, discountPresets:[fixtureDiscount],
        printerSettings:{ enabled:fixtureOfflinePrint,receiptEnabled:fixtureOfflinePrint,kitchenEnabled:false,
          receiptPrinter:{ ...printer,host:'192.0.2.8' }, kitchenPrinter:printer,customerDisplay:{enabled:false} } }
    });`);
executable += String.raw`
const results=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const deadline=Date.now()+12000;while(!await fn()){if(Date.now()>deadline)throw new Error('Fixture condition timed out');await pause(20);}}
function pass(name, width){results.push({name,width,passed:true});console.log('PASS '+name+' '+width);}
async function withViewport(width, run, path='/store/pos'){
  const context=await browser.createBrowserContext();
  try {
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>pageErrors.push(error.message));
    await page.setViewport({width,height:width<600?852:1000});await page.setRequestInterception(true);
    page.on('request',request=>request.url().startsWith(base+'/')?request.continue():(externalRequests.push(request.url()),request.abort()));
    await page.goto(base+path,{waitUntil:'domcontentloaded'});await run();
  } catch (error) {
    if(page&&!page.isClosed())await page.screenshot({path:join(output,'failure-'+width+'.png'),fullPage:true}).catch(()=>{});
    throw error;
  } finally { await context.close(); }
}
async function click(selector){await page.waitForSelector(selector,{visible:true});await page.$eval(selector,el=>el.scrollIntoView({block:'center',behavior:'instant'}));await page.click(selector);}
async function mode(placement, value){const selector='[data-pos-order-type-selector="'+placement+'"] [data-pos-order-type="'+value+'"]';await click(selector);assert.equal(await page.$eval(selector,el=>el.getAttribute('aria-pressed')),'true');}
async function stepOption(name, direction){
  for(const element of await page.$$('.store-pos-option-choice'))if((await element.evaluate(el=>el.textContent)).includes(name)){
    const button=await element.$('button[aria-label="数量を'+(direction==='add'?'増やす':'減らす')+'"]');
    await button.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await button.click();return;
  }
  throw new Error('Missing option '+name);
}
async function optionState(name){return page.$$eval('.store-pos-option-choice',(elements,needle)=>{const row=elements.find(el=>el.textContent.includes(needle));return {count:row.querySelector('.store-pos-option-stepper span').textContent,plusDisabled:row.querySelector('button[aria-label="数量を増やす"]').disabled};},name);}
async function tax(rate){return page.$eval('[data-pos-tax-rate="'+rate+'"]',el=>el.textContent);}
async function readIndexedStore(name){return page.evaluate(name=>new Promise((resolve,reject)=>{
  const db=indexedDB.open('foundr1-store-offline');db.onerror=()=>reject(db.error);db.onsuccess=()=>{const request=db.result.transaction(name).objectStore(name).getAll();request.onsuccess=()=>{resolve(request.result);db.result.close();};request.onerror=()=>reject(request.error);};
}),name);}
async function setupBowl(){
  await clickItem(baseItem.name);await page.waitForSelector('.store-pos-weight-entry input');
  await click('.store-relay-tare-presets button:nth-of-type(2)');
  await page.type('.store-pos-weight-entry input','200');
  await stepOption(noodle.name,'add');await stepOption(paidAlcohol.name,'add');
}
try {
  for(const width of [393,1366])await withViewport(width,async()=>{
    await page.waitForSelector('.store-pos-item-button:not(:disabled)');
    const menu=()=>page.$$eval('.store-pos-item-button strong',els=>els.map(el=>el.textContent));
    const catalog=await menu();assert.ok(catalog.includes(baseItem.name)&&!catalog.includes(canonical.name));
    await setupBowl();await stepOption(restrictedOption.name,'add');
    await mode('options','takeout');
    assert.equal(await page.$eval('.store-pos-weight-entry input',el=>el.value),'200');
    assert.equal(await page.$eval('.store-relay-tare-presets button:nth-of-type(2)',el=>el.getAttribute('aria-pressed')),'true');
    assert.deepEqual(await optionState(noodle.name),{count:'1',plusDisabled:false});
    assert.deepEqual(await optionState(restrictedOption.name),{count:'1',plusDisabled:true});
    assert.equal(await page.$eval('.store-pos-option-add',el=>el.disabled),true);
    assert.match(await page.$eval('.store-pos-option-footer',el=>el.textContent),/持ち帰りできない/);
    await stepOption(restrictedOption.name,'remove');
    assert.equal(await page.$eval('.store-pos-option-add',el=>el.disabled),false);
    assert.deepEqual(await menu(),catalog);pass('same local catalog and weight, tare and choices survive switching inside options; banned option remains visible and removable',width);
    await click('.store-pos-option-add');await waitCart(1);
    await openPayment();assert.equal(await tax(8),'¥75');assert.equal(await tax(10),'¥50');
    assert.match(await page.$eval('.store-pos-total',el=>el.textContent),/1,550/);
    await mode('cart','eat_in');assert.equal(await tax(10),'¥141');assert.equal(await page.$('[data-pos-tax-rate="8"]'),null);
    await mode('cart','takeout');assert.equal(await tax(8),'¥75');assert.equal(await tax(10),'¥50');
    await until(()=>customerDisplayPosts.some(event=>event.state?.orderType==='takeout'&&event.state?.subtotal===1550&&event.state?.taxLabel==='内消費税'&&event.state?.taxAmount===125));
    assert.equal(await page.$$eval('.store-pos-item-button',(els,name)=>els.find(el=>el.textContent.includes(name)).disabled,restrictedItem.name),true);
    assert.match(await page.$eval('.store-pos-cart-row',el=>el.textContent),/200g/);
    pass('same gross prices and cart line while 8% and 10% buckets are calculated separately',width);
    await click('.store-pos-discount-panel button');assert.match(await page.$eval('.store-pos-total',el=>el.textContent),/1,450/);
    await mode('cart','eat_in');assert.equal(await tax(10),'¥132');
    await mode('cart','takeout');assert.equal(await tax(8),'¥70');assert.equal(await tax(10),'¥47');
    await page.screenshot({path:join(output,'counter-tax-checkout-'+width+'.png')});
    await page.type('.store-pos-cash-payment input','2000');await page.waitForFunction(()=>!document.querySelector('.store-pos-checkout').disabled);
    await click('.store-pos-checkout');await waitCart(0);
    const submitted=posts.at(-1);assert.equal(submitted.orderType,'takeout');assert.equal(submitted.counterMenuPolicyRevision,revision);
    assert.equal(submitted.offlineExpectedAmount,1450);assert.equal(submitted.discountPresetKey,fixtureDiscount.key);
    assert.equal(submitted.items[0].measuredQuantity,200);assert.deepEqual(submitted.items[0].weightMeasurement,{mode:'manual_net'});
    assert.deepEqual(submitted.items[0].selectedOptions,[{groupId:noodleGroup.id,optionIds:[noodle.id]},{groupId:addonGroup.id,optionIds:[paidAlcohol.id]}]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    pass('discount survives toggles and checkout sends unchanged gross, captured choices, local ID and policy revision',width);
  });
  await withViewport(1024,async()=>{
    await page.waitForSelector('.store-pos-item-button:not(:disabled)');
    await clickItem(restrictedItem.name);await waitCart(1);await mode('cart','takeout');
    assert.match(await page.$eval('#store-pos-counter-takeout-blocked',el=>el.textContent),/持ち帰りできない/);
    await page.type('.store-pos-cash-payment input','2000');assert.equal(await page.$eval('.store-pos-checkout',el=>el.disabled),true);
    await waitCart(1);await mode('cart','eat_in');assert.equal(await page.$eval('.store-pos-checkout',el=>el.disabled),false);
    await click('.store-pos-checkout');await waitCart(0);assert.equal(posts.at(-1).orderType,'eat_in');assert.equal(posts.at(-1).counterMenuPolicyRevision,revision);
    pass('restricted existing basket is retained and checkout only works in dine-in',1024);
  });
  await withViewport(1366,async()=>{
    await page.waitForSelector('.store-pos-item-button:not(:disabled)');await clickItem(dependentItem.name);await mode('options','takeout');
    for(const button of await page.$$('.store-pos-option-choice > button'))if((await button.evaluate(el=>el.textContent)).includes(triggerOption.name)){await button.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await button.click();break;}
    const eligible = await page.$$eval('.store-pos-option-choice > button',(buttons,name)=>{const button=buttons.find(el=>el.textContent.includes(name));return button&&{pressed:button.getAttribute('aria-pressed'),disabled:button.disabled};},onlyRestricted.name);
    assert.deepEqual(eligible,{pressed:'false',disabled:true});assert.equal(await page.$eval('.store-pos-option-add',el=>el.disabled),true);
    assert.match(await page.$eval('.store-pos-option-footer',el=>el.textContent),/必須追加/);
    pass('takeout dependency cannot auto-select a restricted option or relax its required group',1366);
  });
  await withViewport(1366,async()=>{
    await page.waitForSelector('.store-pos-item-button:not(:disabled)');await clickItem(exchangeItem.name);
    await stepOption(paidAlcohol.name,'add');await mode('options','takeout');await click('.store-pos-option-add');await waitCart(1);
    assert.equal(await tax(8),'¥23');assert.equal(await tax(10),'¥50');
    await page.type('.store-pos-member-lookup input','1000');await page.keyboard.press('Enter');await click('.store-pos-coupon-choice');
    assert.equal(await page.$('[data-pos-tax-rate="8"]'),null);assert.equal(await tax(10),'¥50');
    assert.match(await page.$eval('.store-pos-total',el=>el.textContent),/550/);
    await page.type('.store-pos-cash-payment input','1000');await click('.store-pos-checkout');await waitCart(0);
    assert.equal(posts.at(-1).couponId,'exchange-fixture');assert.equal(posts.at(-1).offlineExpectedAmount,550);
    pass('exchange coupon removes the reduced food base first and leaves tax on the paid standard-rate addition',1366);
  });
  await withViewport(1024,async()=>{
    await page.waitForSelector('.store-pos-item-button:not(:disabled)');await clickItem(foodItem.name);await waitCart(1);
    await page.type('.store-pos-cash-payment input','1000');assert.equal(await page.$eval('.store-pos-checkout',el=>el.disabled),false);
    fixturePolicyRevision='fixture-counter-policy:2';
    page.once('dialog',dialog=>void dialog.dismiss());await click('[data-pos-menu-refresh]');await page.waitForSelector('[data-pos-menu-update]');
    await waitCart(1);assert.equal(await page.$eval('.store-pos-checkout',el=>el.disabled),true);
    page.once('dialog',dialog=>void dialog.accept());await click('[data-pos-menu-refresh]');await waitCart(0);
    await page.waitForFunction(()=>document.querySelector('[data-pos-menu-update]')===null);
    pass('policy-only revision change blocks stale checkout and applies only after manual confirmation',1024);
  });
  fixturePolicyRevision=revision;
  fixtureOfflinePrint=true;
  await withViewport(800,async()=>{
    await page.waitForSelector('.store-pos-item-button:not(:disabled)');await setupBowl();await mode('options','takeout');await click('.store-pos-option-add');
    await openPayment();await page.waitForSelector('.store-pos-cash-payment input',{visible:true});
    await page.setOfflineMode(true);
    // The fixture's loopback origin can remain navigator-online during CDP network emulation.
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));});
    await page.waitForSelector('.store-pos-offline-notice');
    await page.type('.store-pos-cash-payment input','2000');await page.waitForFunction(()=>!document.querySelector('.store-pos-checkout').disabled);
    const posted=posts.length;await click('.store-pos-checkout');await waitCart(0);assert.equal(posts.length,posted);
    const queue=await readIndexedStore('pos-orders');
    assert.equal(queue.length,1);assert.equal(queue[0].request.counterMenuPolicyRevision,revision);assert.equal(queue[0].request.offlineQueued,true);
    assert.equal(queue[0].request.offlineExpectedAmount,1550);
    assert.deepEqual(queue[0].localResponse.taxBreakdown,[{rate:8,grossAmount:1000,taxAmount:75},{rate:10,grossAmount:550,taxAmount:50}]);
    const receipt=await page.evaluate(()=>window.__prints.find(payload=>payload.jobType==='receipt'));
    assert.ok(receipt);assert.match(receipt.order.note,/8%対象 ¥1,000.*10%対象 ¥550/);assert.match(receipt.order.items[0].name,/※基礎麻辣湯/);
    assert.ok(receipt.order.items[0].options.some(text=>text.includes('※刀削麺')));
    assert.ok(receipt.order.items[0].options.some(text=>text.includes(paidAlcohol.name)&&!text.includes('※')));
    pass('offline cash sale stores policy revision and immutable tax buckets and prints correct reduced markers',800);
  },'/store/pos?bridge=yes');
  fixtureOfflinePrint=false;fixtureShared=false;fixtureMissingRevision=true;
  await withViewport(1366,async()=>{
    await page.waitForSelector('.store-pos-item-button:not(:disabled)');await setupBowl();
    assert.equal(await page.$('[data-pos-order-type-selector="options"]'),null);
    await click('.store-pos-option-add');await waitCart(1);await mode('cart','takeout');await waitCart(0);
    assert.deepEqual(await page.$$eval('.store-pos-item-button strong',els=>els.map(el=>el.textContent)),[canonical.name]);
    pass('disabled policy retains existing separate menu, clearing incompatible bowl upon mode change',1366);
  });
  await withViewport(800,async()=>{
    await page.waitForSelector('.store-pos-item-button:not(:disabled)');
    await until(async()=>(await readIndexedStore('pos-snapshots')).some(snapshot=>snapshot.storeId===store.id&&!snapshot.data.counterMenuPolicyRevision));
    fixtureShared=true;await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.body.innerText.includes('POS データを読み込めませんでした。'));
    assert.equal(await page.$('.store-pos-item-button'),null);
    fixtureMissingRevision=false;await click('[data-pos-menu-refresh]');await page.waitForSelector('.store-pos-item-button:not(:disabled)');
    pass('authoritative unversioned shared response does not fall back to a cached separate menu; valid manual retry restores service',800);
  });
  fixtureMissingRevision=false;fixtureMissingLocal=true;
  await withViewport(800,async()=>{
    await page.waitForFunction(()=>document.body.innerText.includes('POS で販売できる商品がありません。'));
    assert.equal(await page.$('.store-pos-item-button'),null);pass('shared mode never falls back to brand catalog without local catalog',800);
  });
  assert.deepEqual(pageErrors,[]);assert.deepEqual(serverErrors,[]);assert.deepEqual(externalRequests,[]);
  await writeFile(join(output,'report.json'),JSON.stringify({passed:results.length,results,posts,liveWrites:0,actualReactPos:true,actualIndexedDb:true,syntheticHttpAndPrinter:true},null,2)+'\n');
} catch(error) {
  await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,posts,pageErrors,serverErrors,externalRequests},null,2)+'\n');throw error;
} finally {
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));stop();
}
`;
const entry = join(output, 'executed.mjs');
await writeFile(entry, executable);
const runner = await new Promise((done, reject) => {
  const child = spawn(process.execPath, [entry, '--source', source, '--output', output], { cwd: source, stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => process.stdout.write(chunk));
  child.once('error', reject);
  child.once('exit', (processExitCode, signal) => { clearTimeout(timer); done({ processExitCode, signal }); });
});
await writeFile(join(output,'runner-result.json'),JSON.stringify(runner,null,2)+'\n');
assert.equal(runner.processExitCode,0);
assert.deepEqual(await hashes(),inputHashes);
const report=JSON.parse(await readFile(join(output,'report.json'),'utf8'));
await writeFile(join(output,'report.json'),JSON.stringify({...report,sourceHashes:inputHashes,noSourceDrift:true},null,2)+'\n');
