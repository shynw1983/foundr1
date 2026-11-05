// Synthetic HTTP data; actual procedure editor and navigation permission code.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
const root=process.cwd(),out=resolve('outputs/franchise-owner-permissions-20261101/browser');await mkdir(out,{recursive:true});
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Page from './app/os/procedures/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';createRoot(document.getElementById('root')).render(<OsTranslationProvider><Page/></OsTranslationProvider>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'peripheral-navigation',setup(b){b.onResolve({filter:/components\/(OsNavList|MobileNavMenu|UserBadge)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'tsx',contents:`export function OsNavList(){return null}export function MobileNavMenu(){return null}export function UserBadge(){return null}`}));}}]});
const local={id:'local',title:'本店手順書',category:'開店',procedureType:'operation',summary:'',status:'published',brandId:'brand',brand:'Local Brand',stores:[{id:'store',name:'Local Store'}],canEdit:true,variants:[],steps:[]};
let title=local.title,writes=0;
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname==='/app.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(resolve(root,'app/globals.css')));return;}
 if(url.pathname==='/api/procedures'){
  if(req.method==='POST'||req.method==='PUT'){let body='';for await(const part of req)body+=part;title=JSON.parse(body).title;writes++;res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
  const head=req.headers.referer?.includes('head=1');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({canEdit:true,canManageShared:head,procedures:[{...local,title},{...local,id:'shared',title:'全店共通手順書',canEdit:head,stores:[]}],stores:[{id:'store',name:'Local Store',brandIds:['brand']}],brands:[{id:'brand',name:'Local Brand'}],products:[],materials:[],menuCatalogItems:[],menuOptions:[],menuOptionGroups:[],actionTypes:[],locations:[],equipment:[],containers:[]}));return;}
 if(url.pathname==='/api/procedures/maamaa-reference'){res.setHeader('Content-Type','application/json');res.end('{}');return;}
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/locales/')){res.setHeader('Content-Type','application/json');res.end('{}');return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
let browser;const results=[];
try{browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--no-first-run','--no-default-browser-check']});
 for(const width of [390,800,1366]){const page=await browser.newPage();await page.setViewport({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.procedure-admin-row');
  assert.equal(await page.$('#maamaa-reference-editor'),null);const rows=await page.$$eval('.procedure-admin-row',rows=>rows.map(r=>({title:r.querySelector('strong').textContent,buttons:r.querySelectorAll('.row-actions button').length})));assert.equal(rows[0].buttons,2);assert.equal(rows[1].buttons,0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`overflow ${width}`);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(out,`owner-${width}.png`),fullPage:true});results.push({width,allowedLocalEdit:true,sharedControlsHidden:true,overflow,errors});
  if(width===1366){await page.click('.procedure-admin-row .row-actions button');await page.evaluate(()=>{const input=document.querySelector('.procedure-editor-panel input')||[...document.querySelectorAll('input')].find(e=>e.value==='本店手順書');if(!input)throw Error('Missing title');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'本店手順書 更新');input.dispatchEvent(new Event('input',{bubbles:true}));});await page.click('button[type=submit]');await page.waitForFunction(()=>document.body.textContent.includes('手順書を保存しました'));assert.equal(title,'本店手順書 更新');assert.equal(writes,1);results.push({saveReload:true});}
  await page.close();}
 const head=await browser.newPage();await head.goto(url+'/?head=1',{waitUntil:'networkidle0'});assert.ok(await head.$('#maamaa-reference-editor'));results.push({headquartersSharedControls:true});await head.close();
 await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
