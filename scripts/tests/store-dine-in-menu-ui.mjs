// Actual React editor -> actual OS route -> isolated PostgreSQL, with local-only HTTP.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDineInMenuFixture} from './store-dine-in-menu-fixture.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-menu-ui');await mkdir(output,{recursive:true});
const require=createRequire(join(source,'package.json')),{build,stop}=require('esbuild'),puppeteer=require('puppeteer-core');
const f=await createDineInMenuFixture(source);await f.installMigration();const {db,ids}=f;
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
const results=[];function record(result){results.push(result);console.log(`PASS ${result.name}`);}
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
try{
  for(const width of [390,800,1366]){
    await db.exec('delete from store_dine_in_menu_operations;delete from store_dine_in_menus;');posts.length=0;
    const {page,context}=await pageAt(width);assert.equal(posts.length,0);await assertGeometry(page,'[data-dine-in-action="initialize"]');
    await page.screenshot({path:join(output,`editor-${width}-preview.png`),fullPage:true});
    await click(page,'input[name="dine-in-initialize-mode"][value="source"]');await click(page,'[data-dine-in-action="initialize"]');await page.waitForSelector('[data-dine-in-action="setEnabled"]');
    let menu=await readMenu();const item=menu.catalog.items.find(x=>x.sourceItemId===ids.menu);
    await renamed(page,item.id,`店内麻辣湯 ${width}`);menu=await readMenu();assert.equal(menu.catalog.items.find(x=>x.id===item.id).name,`店内麻辣湯 ${width}`);
    await assertGeometry(page,'[data-dine-in-action="rename"]');await page.screenshot({path:join(output,`editor-${width}-renamed.png`),fullPage:true});
    await click(page,'details summary');await fill(page,'details input',`店内派生 ${width}`);await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="duplicate"]').disabled);await click(page,'[data-dine-in-action="duplicate"]');await page.waitForFunction(name=>[...document.querySelectorAll('[data-target-id]')].some(el=>el.textContent.includes(name)),{},`店内派生 ${width}`);
    menu=await readMenu();const copy=menu.catalog.items.find(x=>x.name===`店内派生 ${width}`);assert.equal(copy.sourceItemId,ids.menu);assert.equal(copy.posWeightUnitPrice,4);assert.equal(copy.price,600);
    assert.equal(posts.filter(x=>x.action==='initialize').length,1);assert.equal(posts.filter(x=>x.action==='rename').length,1);assert.equal(posts.filter(x=>x.action==='duplicate').length,1);
    await assertGeometry(page,'[data-dine-in-action="setEnabled"]');await context.close();record({name:`actual-react-route-sql-preview-initialize-rename-derive-${width}`,passed:true,width});
  }
  // Unknown result after a committed copy: reload retains the exact retry body and ID.
  {
    const {page,context}=await pageAt();let menu=await readMenu();const item=menu.catalog.items.find(x=>x.sourceItemId===ids.menu);
    await click(page,`[data-target-id="${item.id}"]`);await click(page,'details summary');await fill(page,'details input','不明結果の店内版');loseNextMutation=true;
    await click(page,'[data-dine-in-action="duplicate"]');await page.waitForSelector('[data-dine-in-action="retry"]');await assertGeometry(page,'[data-dine-in-action="retry"]');
    const first=posts.at(-1);assert.equal(first.action,'duplicate');menu=await readMenu();assert.equal(menu.catalog.items.filter(x=>x.name==='不明結果の店内版').length,1);
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-dine-in-action="retry"]');await click(page,'[data-dine-in-action="retry"]');await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="retry"]'));
    assert.deepEqual(posts.at(-1),first);menu=await readMenu();assert.equal(menu.catalog.items.filter(x=>x.name==='不明結果の店内版').length,1);
    await context.close();record({name:'committed-unknown-result-reload-retry-reuses-identity-without-second-item',passed:true});
  }
  {
    const {page,context}=await pageAt(800);const menu=await readMenu(),item=menu.catalog.items.find(x=>x.sourceItemId===ids.menu);
    await click(page,`[data-target-id="${item.id}"]`);await fill(page,'[data-dine-in-name]','古い画面の編集');await db.query('update store_dine_in_menus set revision=revision+1 where store_id=$1',[ids.store]);
    await click(page,'[data-dine-in-action="rename"]');await page.waitForSelector('[role="alert"]');assert.equal(await page.$eval('[data-dine-in-action="rename"]',el=>el.disabled),true);await assertGeometry(page,'[role="alert"]');
    await page.screenshot({path:join(output,'editor-800-stale.png'),fullPage:true});await context.close();record({name:'stale-revision-visible-blocks-edit-until-reload',passed:true});
  }
  {
    const {page,context}=await pageAt(390);const menu=await readMenu(),item=menu.catalog.items.find(x=>x.sourceItemId===ids.menu);
    await page.evaluate(()=>Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem(){throw new Error('fixture storage denied');},setItem(){throw new Error('fixture storage denied');},removeItem(){throw new Error('fixture storage denied');}}}));
    await click(page,`[data-target-id="${item.id}"]`);await click(page,'details summary');await fill(page,'details input','メモリ保留コピー');loseNextMutation=true;
    await click(page,'[data-dine-in-action="duplicate"]');await page.waitForSelector('[data-dine-in-action="retry"]');const first=posts.at(-1);
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='再読込').click());
    await page.waitForFunction(()=>document.querySelector('[data-dine-in-action="retry"]')&&!document.querySelector('[data-dine-in-action="retry"]').disabled&&document.querySelectorAll('[data-target-id]').length>0);
    await click(page,'[data-dine-in-action="retry"]');await page.waitForFunction(()=>!document.querySelector('[data-dine-in-action="retry"]'));
    assert.deepEqual(posts.at(-1),first);assert.equal((await readMenu()).catalog.items.filter(x=>x.name==='メモリ保留コピー').length,1);await context.close();record({name:'blocked-session-storage-keeps-in-memory-operation-through-editor-refresh-and-safe-retry',passed:true});
  }
  {
    forceSchemaMissing=true;const {page,context}=await pageAt(390);await page.waitForSelector('[role="alert"]');assert.equal(await page.$('[data-dine-in-action="initialize"]'),null);await assertGeometry(page,'[role="alert"]');forceSchemaMissing=false;await context.close();record({name:'schema-not-ready-visible-no-enable-control',passed:true});
  }
  {
    const {page,context}=await pageAt(800);delayNextGet=400;
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='再読込').click());
    await page.click('[data-fixture-brand] button:nth-child(2)');await page.waitForFunction(()=>document.querySelector('[data-dine-in-menu-editor]').innerText.includes('第二ブランド')&&document.querySelectorAll('[data-target-id]').length===0);
    await new Promise(resolve=>setTimeout(resolve,550));assert.equal(await page.$$eval('[data-target-id]',els=>els.length),0);await context.close();record({name:'late-get-from-previous-brand-cannot-replace-new-brand-context',passed:true});
  }
  {
    const {page,context}=await pageAt(800),beforePosts=posts.length;
    await page.select('select[aria-label="店内メニューの対象店舗"]',ids.other);await page.waitForSelector('[role="alert"]');
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[role="alert"]');assert.equal(await page.$eval('select[aria-label="店内メニューの対象店舗"]',el=>el.value),ids.other);
    await page.click('[data-fixture-brand] button:nth-child(2)');await page.waitForFunction(id=>document.querySelector('select[aria-label="店内メニューの対象店舗"]')?.value===id,{},ids.store);
    await page.click('[data-fixture-brand] button:first-child');await page.waitForFunction(id=>document.querySelector('select[aria-label="店内メニューの対象店舗"]')?.value===id,{},ids.other);
    assert.equal(posts.length,beforePosts);await context.close();record({name:'target-store-memory-is-per-brand-and-restoration-never-writes-menu',passed:true});
  }
  {
    const {page,context}=await pageAt(390,'zh-Hans');await page.waitForFunction(label=>document.querySelector('[data-dine-in-menu-editor]').innerText.includes(label),{},dictionaries['zh-Hans']['店舗の店内飲食メニュー']);
    assert.ok((await page.$eval('[data-dine-in-menu-editor]',el=>el.innerText)).includes('店内麻辣湯 1366'));await page.screenshot({path:join(output,'editor-390-zh-Hans.png'),fullPage:true});await context.close();record({name:'chinese-ui-translates-controls-without-replacing-store-product-labels',passed:true});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const sourceHashes=Object.fromEntries(await Promise.all(['app/os/menus/DineInMenuEditor.tsx','app/os/menus/DineInMenuComposer.tsx','app/os/menus/DineInMenuEditor.module.css','lib/store-dine-in-menu-policy.ts','app/os/components/OsTranslationProvider.tsx'].map(async path=>[path,createHash('sha256').update(await readFile(join(source,path))).digest('hex')])));
  const report={passed:results.length,results,errors,externalRequests:external,source,sourceHashes,actualReact:true,actualOsRoute:true,isolatedPostgreSQL:true};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await f.db.close();stop();}
