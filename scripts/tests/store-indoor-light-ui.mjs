// Browser fixture for the real page, navigation and translations. All API calls
// are intercepted in-browser; this cannot address any physical shop device.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output=resolve(process.env.LIGHT_UI_OUTPUT || 'outputs/store-indoor-light-20260929');
await mkdir(output,{recursive:true});
const dictionaries=Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async l=>[l,JSON.parse(await readFile(`public/locales/os/${l}.json`,'utf8'))])));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import Page from './app/store/devices/page';import {OsTranslationProvider} from './app/os/components/OsTranslationProvider';
const language=new URLSearchParams(location.search).get('language')||'ja';localStorage.setItem('foundr1-os-language',language);localStorage.setItem('foundr1-os-language-preference','manual');
const storeId='10000000-0000-4000-8000-000000000001';const dictionaries=${JSON.stringify(dictionaries)};
window.__light={posts:[],reads:0,failure:false,postFailure:false,view:{configured:true,storeId,sample:{lightLevel:12,battery:100,botMode:'pressMode'},fetchedAt:new Date().toISOString(),estimate:'on',readError:false,canPress:true,controlEnabled:true,blockedUntil:null,command:null,offMax:3,onMin:10}};
window.fetch=async(input,init={})=>{const url=new URL(String(input),'https://fixture.invalid');const state=window.__light;
if(url.pathname.startsWith('/locales/os/'))return Response.json(dictionaries[url.pathname.includes('zh-Hant')?'zh-Hant':'zh-Hans']);
if(url.pathname==='/api/store/context')return Response.json({selectedStoreId:storeId,access:{role:'store_terminal',canUseAllStoreView:false,stores:[{id:storeId,name:'清水店'}]}});
if(url.pathname==='/api/auth/me')return Response.json({employee:{id:'test-terminal',name:'清水店',role:'store_terminal'}});
if(url.pathname==='/api/settings')return Response.json({});
if(url.pathname==='/api/store/indoor-light'){
await new Promise(r=>setTimeout(r,30));if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');
if(init.method==='POST'){const body=JSON.parse(init.body);state.posts.push(body);const command={id:body.requestId,result:state.postFailure?'unknown':'accepted',requestedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),beforeState:state.view.estimate,reason:''};state.view={...state.view,command,estimate:'unknown',canPress:false,blockedUntil:new Date(Date.now()+90000).toISOString()};if(state.postFailure)throw new TypeError('Network error');return Response.json({command});}
state.reads++;return state.failure?Response.json({error:'unavailable'},{status:503}):Response.json(state.view);}
return Response.json({items:[],notifications:[],unreadCount:0});};
createRoot(document.getElementById('root')).render(<React.StrictMode><OsTranslationProvider><Page/></OsTranslationProvider></React.StrictMode>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const css=(await readFile('app/globals.css','utf8'))+'\n'+(await readFile('app/store/store-responsive.css','utf8'));
const fixture=resolve(output,'fixture.html');
await writeFile(fixture,`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>清水店 室内照明 — local fixture</title><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`);
if(process.argv.includes('--prepare')){console.log(fixture);process.exit(0);}
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>{if(/^https?:/.test(r.url()))r.abort();else r.continue();});
 const open=async(language='ja')=>{await page.goto('file://'+fixture+'?language='+language,{waitUntil:'load'});await page.waitForFunction(()=>document.querySelector('.store-light-state')?.textContent.includes('推'));};
 const refresh=async()=>{await page.click('.store-light-toolbar button');await page.waitForFunction(()=>!document.querySelector('.store-light-toolbar button').disabled);};
 for(const width of [1440,768,360]){
  await page.setViewport({width,height:width===1440?1000:960});await open();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);
  await page.screenshot({path:resolve(output,`light-ja-${width}.png`),fullPage:true});
 }
 await page.click('.store-light-actions button');await page.waitForSelector('dialog[open]');
 assert.match(await page.$eval('dialog',e=>e.textContent),/1回押/);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog').open);
 assert.equal(await page.evaluate(()=>window.__light.posts.length),0,'cancel does not send a command');
 await page.click('.store-light-actions button');await page.waitForSelector('dialog[open]');
 await page.screenshot({path:resolve(output,'light-confirm-360.png'),fullPage:true});
 await page.evaluate(()=>{const button=document.querySelector('.store-light-dialog-actions .primary-button');button.click();button.click();});
 await page.waitForFunction(()=>window.__light.posts.length===1&&!document.querySelector('dialog').open);
 assert.equal(await page.$eval('.store-light-actions button',b=>b.disabled),true);
 await page.waitForFunction(()=>window.__light.reads>1,{timeout:10000});
 assert.equal(await page.evaluate(()=>window.__light.posts.length),1,'polling never repeats POST');
 await page.evaluate(()=>{const s=window.__light;s.view={...s.view,sample:{...s.view.sample,lightLevel:2},fetchedAt:new Date().toISOString(),estimate:'off',command:{...s.view.command,requestedAt:new Date(Date.now()-10000).toISOString(),finishedAt:new Date(Date.now()-6000).toISOString()}};});
 await refresh();assert.match(await page.$eval('.store-light-state',e=>e.textContent),/消灯/);
 assert.match(await page.$eval('.store-light-notice.is-success',e=>e.textContent),/変化/);
 await page.evaluate(()=>window.__light.failure=true);await refresh();
 assert.match(await page.$eval('.store-light-state',e=>e.textContent),/判定できません/);
 assert.equal(await page.$eval('.store-light-actions button',b=>b.disabled),true);
 await page.screenshot({path:resolve(output,'light-offline-360.png'),fullPage:true});
 await open();await page.evaluate(()=>{const s=window.__light;s.view={...s.view,estimate:'unknown',sample:{...s.view.sample,lightLevel:6}};});await refresh();
 assert.match(await page.$eval('.store-light-state',e=>e.textContent),/判定できません/);
 await page.click('.store-light-actions button');await page.waitForSelector('dialog[open]');assert.match(await page.$eval('dialog',e=>e.textContent),/現地で状態を確認/);await page.keyboard.press('Escape');
 await page.evaluate(()=>{window.__light.view.fetchedAt=new Date(Date.now()-180000).toISOString();});await refresh();
 assert.equal(await page.$eval('.store-light-actions button',b=>b.disabled),true);
 await open();await page.evaluate(()=>window.__light.postFailure=true);
 await page.click('.store-light-actions button');await page.waitForSelector('dialog[open]');await page.click('.store-light-dialog-actions .primary-button');
 await page.waitForSelector('.store-light-notice.is-error');assert.equal(await page.evaluate(()=>window.__light.posts.length),1);assert.equal(await page.$eval('.store-light-actions button',b=>b.disabled),true);
 await page.screenshot({path:resolve(output,'light-uncertain-360.png'),fullPage:true});
 for(const language of ['zh-Hans','zh-Hant']){await open(language);await page.waitForFunction(()=>document.querySelector('.store-light-actions button')?.textContent.includes('灯')||document.querySelector('.store-light-actions button')?.textContent.includes('燈'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(output,`light-${language}-360.png`),fullPage:true});}
 await open();await page.evaluate(()=>{window.__light.view.configured=false;});await refresh();await page.waitForSelector('.store-light-empty');assert.equal(await page.$('.store-light-actions button'),null);
 assert.deepEqual(errors,[]);
 const report={passed:true,viewports:[1440,768,360],languages:['ja','zh-Hans','zh-Hant'],checks:['React StrictMode','confirmation cancel','double-click single POST','read-only polling','observed light change','offline disables control','dead-band manual confirmation','stale reading disables control','ambiguous POST no retry','unconfigured store'],liveDeviceCommands:0};
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
