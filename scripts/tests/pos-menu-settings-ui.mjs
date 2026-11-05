// Local React + synthetic APIs only. No production browser, menu or database writes.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const output='outputs/pos-menu-settings-20261016';await mkdir(output,{recursive:true});
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{PosMenuSettings}from'./app/os/menus/PosMenuSettings';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
createRoot(document.getElementById('root')).render(<OsTranslationProvider><main style={{padding:16}}><PosMenuSettings brandId="brand" stores={[{id:'store-a',name:'桜並木店',brandIds:['brand']},{id:'store-b',name:'別店舗',brandIds:['brand']}]} initialStoreId="store-a"/></main></OsTranslationProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/virtual',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const javascript=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=(await readFile('app/globals.css','utf8'))+'\n'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const dictionary=JSON.parse(await readFile('public/locales/os/zh-Hans.json','utf8'));
let revision=0,posts=[],reject=false;
const targets=[{id:'item',kind:'item',name:'自選マーラータン',category:'マーラータン',brandPrice:415,legacyVisible:true,setting:null},
{id:'group',kind:'group',name:'Premium',category:'選択肢グループ',brandPrice:null,legacyVisible:true,setting:null},
{id:'option',kind:'option',name:'牛すじ50g',category:'Premium',brandPrice:699,legacyVisible:true,setting:null}];
const send=(res,b,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(b));};
const server=createServer(async(req,res)=>{
 if(req.url==='/fixture.js'){res.end(javascript);return;}
 if(req.url.startsWith('/locales/'))return send(res,dictionary);
 if(req.url.startsWith('/api/os/menus/pos-settings')){
  if(req.method==='POST'){
   let body='';for await(const part of req)body+=part;const b=JSON.parse(body);posts.push(b);
   if(reject)return send(res,{error:'設定が変更されました。再読込して確認してください。'},409);
   targets.find(t=>t.id===b.targetId).setting={kind:b.kind,targetId:b.targetId,visible:b.visible,price:b.price};
   return send(res,{ok:true,revision:String(++revision).padStart(32,'0')});
  }
  const store=new URL(req.url,'http://test').searchParams.get('storeId');
  return send(res,{revision:String(revision).padStart(32,'0'),targets:store==='store-b'?[]:targets});
 }
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const click=async text=>{await page.waitForFunction(text=>[...document.querySelectorAll('button,summary')].some(e=>e.textContent===text),{},text);await page.evaluate(text=>[...document.querySelectorAll('button,summary')].find(e=>e.textContent===text||e.querySelector('span')?.textContent===text)?.click(),text);};
try{
 await page.goto(url);await click('実店舗メニュー・追加料金');await page.waitForSelector('button[aria-pressed]');
 await page.select('label:nth-child(2) select','option');
 await page.waitForFunction(()=>[...document.querySelectorAll('button[aria-pressed]')].some(e=>e.textContent.includes('牛すじ50g')));
 await page.evaluate(()=>[...document.querySelectorAll('button[aria-pressed]')].find(e=>e.textContent.includes('牛すじ50g')).click());
 await page.waitForFunction(()=>document.querySelector('h4')?.textContent==='牛すじ50g');
 await page.evaluate(()=>{const select=[...document.querySelectorAll('select')].find(e=>e.parentElement.textContent.startsWith('価格設定'));select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForSelector('input[inputmode="numeric"]');await page.type('input[inputmode="numeric"]','250');
 await click('店内メニュー設定を保存');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('保存しました'));
 assert.equal(posts[0].price,250);assert.equal(posts[0].storeId,'store-a');assert.equal(posts[0].visible,null);
 await page.evaluate(()=>{const e=[...document.querySelectorAll('select')].find(e=>e.parentElement.textContent.startsWith('POS 公開設定'));e.value='hide';e.dispatchEvent(new Event('change',{bubbles:true}));});
 await click('店内メニュー設定を保存');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('保存しました'));
 assert.equal(posts.at(-1).visible,false);assert.equal(targets[2].brandPrice,699);
 reject=true;await click('店内メニュー設定を保存');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('設定が変更'));
 for(const width of [390,768,1024,1440]){await page.setViewport({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`${output}/settings-${width}.png`,fullPage:true});}
 await page.select('label:first-child select','store-b');await page.waitForFunction(()=>document.body.textContent.includes('対象がありません。'));assert.equal(await page.$('h4'),null);
 await page.goto(url+'/?lang=zh-Hans');await click('实体店菜单与追加收费');await page.waitForFunction(()=>document.body.textContent.includes('沿用原公开设置'));await page.screenshot({path:`${output}/settings-zh-Hans.png`,fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS POS menu UI: local actual React; independent visibility/price; unchanged brand price; stale-save notice; store switch; 390/768/1024/1440 no overflow; Simplified Chinese.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
