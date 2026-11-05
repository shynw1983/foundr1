// Actual relay panel with local fixtures only. No orders, refunds or printing.
import { build, stop } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output=process.env.RELAY_REFUND_UI_OUTPUT||'outputs/store-pos-reliability-20261017/refund-ui';
await mkdir(output,{recursive:true});
const dictionaries=Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async lang=>[lang,JSON.parse(await readFile(`public/locales/os/${lang}.json`,'utf8'))])));
const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{StoreRelayPanel}from'./app/store/components/StoreRelayPanel';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
const lang=new URLSearchParams(location.search).get('lang')||'ja';localStorage.setItem('foundr1-os-language',lang);localStorage.setItem('foundr1-os-language-preference','manual');
window.__calls=[];window.__prompts=[];window.__confirm=true;window.__hold=false;window.confirm=m=>{window.__prompts.push(m);return window.__confirm};
const station={id:'station-a',name:'レジ A',enabled:true,print_enabled:true,scale_enabled:true,epoch:1,owner_until:new Date(Date.now()+60000).toISOString(),device_online:true,device_paired:true,scale_session:null,scale_sequence:-1,scale_reading:null,scale_received_at:null};
const jobs=[{id:'kitchen-a',station_id:station.id,kind:'kitchen',documentRole:'kitchen',state:'sent',pickup_code:'101',sequence:1,error:'',reprintEligible:true,voidEligible:false},
{id:'finishing-a',station_id:station.id,kind:'kitchen',documentRole:'finishing',state:'sent',pickup_code:'101',sequence:2,error:'',reprintEligible:true,voidEligible:false},
{id:'receipt-a',station_id:station.id,kind:'receipt',documentRole:'receipt',state:'sent',pickup_code:'D101',sequence:4,error:'',reprintEligible:true,voidEligible:false,receiptHasRefund:true},
{id:'refunded-a',station_id:station.id,kind:'pickup',documentRole:'pickup',state:'uncertain',pickup_code:'102',sequence:3,error:'',reprintEligible:false,voidEligible:true}];
function App(){const[state,setState]=useState({owner:{stationId:station.id,token:'fixture-owner',epoch:1},jobs});window.__setState=patch=>setState(s=>({...s,...patch}));
const relay={...state,station,stations:[station],required:true,error:'',now:()=>Date.now(),refresh:async()=>[station],action:async(action,extra)=>{window.__calls.push({action,extra});if(window.__hold)await new Promise(resolve=>{window.__release=resolve});return{ok:true}}};
return <OsTranslationProvider><main className="store-shell" style={{maxWidth:960,margin:'0 auto',padding:20}}><StoreRelayPanel relay={relay} storeId="fixture-store"/></main></OsTranslationProvider>};
createRoot(document.getElementById('root')).render(<App/>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/virtual',charset:'utf8',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const js=bundled.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=(await readFile('app/globals.css','utf8'))+'\n'+(bundled.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
const unexpected=[],external=[],errors=[],checks=[];
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/fixture.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});res.end(js);return;}
 if(url.pathname.startsWith('/locales/os/')){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(dictionaries[url.pathname.includes('Hant')?'zh-Hant':'zh-Hans']||{}));return;}
 if(url.pathname==='/'||url.pathname==='/fixture'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);return;}
 if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 unexpected.push(url.pathname);res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let page;
const open=async(lang='ja')=>{
 if(page)await page.close();page=await browser.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(45000);
 page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',req=>{if(req.url().startsWith(origin)||req.url().startsWith('data:'))req.continue();else{external.push(req.url());req.abort();}});
 await page.setViewport({width:768,height:1100});await page.goto(`${origin}/fixture?lang=${lang}`,{waitUntil:'networkidle0'});
 await page.waitForSelector('details');
 const compactToggle=await page.$('button[aria-expanded="false"][aria-controls]');if(compactToggle)await compactToggle.click();
 await page.$eval('details',d=>{d.open=true;});
};
const clickText=async text=>{assert.equal(await page.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);if(!b)return false;b.click();return true;},text),true,`button ${text}`);};
const snapshots=async(prefix)=>{for(const width of[390,768,1440]){await page.setViewport({width,height:1100});await page.screenshot({path:`${output}/${prefix}-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${prefix} ${width}`);}};
try{
 await open();
 let text=await page.$eval('details',e=>e.textContent);
 assert.match(text,/101 · 厨房伝票/);assert.match(text,/101 · 出品伝票/);assert.match(text,/返金あり：金額は返金前の元会計です。/);
 assert.equal(await page.$$eval('details button',buttons=>buttons.filter(b=>b.textContent.trim()==='再印刷').length),3);
 checks.push('kitchen and finishing tickets are distinct; original-sale receipt warns of refund; refunded bowl cannot be reprinted');
 await page.evaluate(()=>{window.__confirm=false;});await clickText('確認して伝票を無効化');
 assert.deepEqual(await page.evaluate(()=>window.__calls),[]);
 checks.push('canceling physical verification never sends voidRefunded');
 await page.evaluate(()=>{window.__confirm=true;window.__hold=true;});
 await clickText('確認して伝票を無効化');await clickText('確認して伝票を無効化');
 assert.deepEqual(await page.evaluate(()=>window.__calls),[{action:'voidRefunded',extra:{jobId:'refunded-a',confirmed:true}}]);
 assert.equal(await page.$$eval('details button',buttons=>buttons.every(b=>b.disabled)),true);
 await page.evaluate(()=>{window.__hold=false;window.__release();});await page.waitForFunction(()=>[...document.querySelectorAll('details button')].every(b=>!b.disabled));
 checks.push('explicit physical verification sends only the selected job with confirmed=true and suppresses duplicate actions');
 await clickText('再印刷');assert.equal((await page.evaluate(()=>window.__calls)).at(-1).action,'reprint');
 checks.push('unrefunded bowl retains the existing confirmed reprint action');
 await page.evaluate(()=>window.__setState({jobs:[{id:'active',station_id:'station-a',kind:'receipt',state:'uncertain',pickup_code:'201',sequence:1,error:'',voidEligible:false,reprintEligible:true}]}));
 await page.waitForFunction(()=>document.querySelector('details').textContent.includes('201'));
 assert.equal(await page.$$eval('details button',buttons=>buttons.some(b=>b.textContent.includes('無効化'))),false);
 checks.push('active unknown jobs do not expose a refund-void control');
 for(const lang of['zh-Hans','zh-Hant']){
  await open(lang);const dictionary=dictionaries[lang];const source='確認して伝票を無効化';assert.ok(dictionary[source],`${lang} void label`);
  await page.waitForFunction(expected=>document.body.textContent.includes(expected),{},dictionary[source]);
  await page.waitForFunction(expected=>document.querySelector('details').textContent.includes(expected),{},dictionary['レシート']);
  await snapshots(lang);await clickText(dictionary[source]);
  const prompt=(await page.evaluate(()=>window.__prompts)).at(-1);
  assert.equal(prompt,dictionary['返金・キャンセル済みの伝票を無効にして、次の印刷へ進めます。現物を確認し、印刷済み・遅れて出る伝票を使用しないことを確認しましたか。']);
 }
 checks.push('Simplified and Traditional Chinese render at390/768/1440 without overflow and translate the physical-verification dialog');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);
 await writeFile(`${output}/verification.json`,JSON.stringify({passed:true,checks,pageErrors:errors,externalRequests:external,unexpectedRequests:unexpected},null,2)+'\n');
 console.log(`PASS refund relay panel: ${checks.length} groups`);
}finally{await browser.close();await new Promise(r=>server.close(r));stop();}
