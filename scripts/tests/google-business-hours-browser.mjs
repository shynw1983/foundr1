// Actual UI + translation components, local synthetic API only; no Google or production requests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
const root=process.cwd(),output=resolve('outputs/google-business-calendar-20261101');await mkdir(output,{recursive:true});
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{StoreBusinessHoursSection}from'./app/os/timecard/schedule/StoreBusinessHoursSection';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';localStorage.setItem('foundr1-os-language-preference','manual');localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');createRoot(document.getElementById('root')).render(<OsTranslationProvider><main style={{maxWidth:1100,margin:'auto',padding:16}}><StoreBusinessHoursSection storeId="store-1" month="2026-11" today="2026-11-04" refreshKey="fixture"/></main></OsTranslationProvider>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,outfile:'fixture.js',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=await readFile('app/globals.css','utf8')+'\n'+bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
let connection={revision:1,connected:true,enabled:false,preparationMinutes:null,cleanupMinutes:null,locationName:null,locationTitle:null}, received;
let scenario='normal';
const server=createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost');const json=(body,status=200)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(body));};
 if(url.pathname==='/fixture.js'){response.writeHead(200,{'content-type':'text/javascript'});return response.end(js);}
 if(url.pathname==='/fixture.css'){response.writeHead(200,{'content-type':'text/css'});return response.end(css);}
 if(url.pathname.startsWith('/locales/os/'))return json(JSON.parse(await readFile(resolve(root,'public',url.pathname.slice(1)),'utf8')));
 if(url.pathname==='/api/timecard/schedule-confirmation')return json({error:'fixture calendar'},503);
 if(url.pathname==='/api/os/google-business'){
  if(request.method==='GET'){
   if(scenario==='unavailable')return json({error:'Google 連携を読み込めませんでした。環境設定と移行状況を確認してください。'},503);
   if(url.searchParams.has('locations'))return json({locations:[{name:'locations/100',title:'検証用店舗',storefrontAddress:{addressLines:['検証用住所']}}]});
   return json({configured:true,connection,jobs:[{id:'job-1',month:'2026-11',status:'conflict',attempts:1,lastError:'Google の特別営業時間と競合しています: 2026-11-03',syncedAt:null}]});
  }
  let text='';for await(const chunk of request)text+=chunk;received=JSON.parse(text);
  if(received.action==='save')connection={...connection,...received,revision:2};
  return json({ok:true});
 }
 if(url.pathname!=='/'){response.writeHead(404);return response.end();}
 response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let browser;
const settings='#google-business-settings';
const googleSelect=settings+' select';
const googleCheckbox=settings+' input[type=checkbox]';
try{
 browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--disable-background-networking']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);page.on('request',request=>new URL(request.url()).origin===base?request.continue():request.abort());
 for(const [width,lang]of [[390,'ja'],[800,'zh-Hans'],[1366,'zh-Hant']]){
  await page.setViewport({width,height:1100});await page.goto(`${base}/?lang=${lang}`,{waitUntil:'networkidle0'});await page.waitForSelector(googleCheckbox);
  assert.equal(await page.$eval(settings, element=>element.open),false);
  assert.equal(await page.$eval(settings, element=>element.previousElementSibling?.tagName),'SECTION');
  await page.click(settings+' summary');
  assert.equal(await page.$eval(googleCheckbox,element=>element.disabled),true,'no selected location cannot enable sync');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`overflow ${width}`);
  await page.screenshot({path:resolve(output,`hours-${width}-${lang}.png`),fullPage:true});
 }
 await page.goto(base+'/?storeId=store-1&googleBusiness=connected',{waitUntil:'networkidle0'});await page.waitForSelector(googleSelect);
 assert.equal(await page.$eval(settings,element=>element.open),true,'OAuth return opens Google settings');
 const buttons=await page.$$('button');for(const button of buttons)if((await button.evaluate(element=>element.textContent)).includes('Google の店舗を取得'))await button.click();
 await page.waitForSelector('option[value="locations/100"]');await page.select(googleSelect,'locations/100');
 const read=page.waitForResponse(response=>response.url().includes('/api/os/google-business')&&response.request().method()==='GET');
 const refresh=await page.$$('button');for(const button of refresh)if((await button.evaluate(element=>element.textContent)).includes('同期状態を更新'))await button.click();
 await read;await new Promise(resolve=>setTimeout(resolve,100));assert.equal(await page.$eval(googleSelect,element=>element.value),'locations/100','status refresh preserves unsaved location');
 await page.click(googleCheckbox);await page.click(settings+' button.primary-button');await page.waitForFunction(()=>document.body.textContent.includes('保存しました。'));
 assert.equal(received.storeId,'store-1');assert.equal(received.enabled,true);assert.equal(received.preparationMinutes,undefined);assert.equal(received.cleanupMinutes,undefined);assert.equal(received.locationName,'locations/100');
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector(googleSelect);assert.equal(await page.$eval(googleSelect,element=>element.value),'locations/100');
 scenario='unavailable';await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>document.body.textContent.includes('環境設定と移行状況'));assert.ok(await page.$('button'),'error remains retryable');
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'browser-results.json'),JSON.stringify({ok:true,widths:[390,800,1366],checks:['unconfigured disabled','responsive layout','Japanese/Simplified/Traditional Chinese','exact store/rules save','reload persistence','unsaved rules retained on status refresh','error recovery'],errors},null,2));
 console.log('Browser checks passed: 3 viewports, save/readback, disabled configuration and retryable errors.');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
