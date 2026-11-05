// Actual components; synthetic local API. No Google/production traffic.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
const root=process.cwd(),output=resolve('outputs/store-business-calendar-20261101');await mkdir(output,{recursive:true});
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{ScheduleConfirmation}from'./app/os/timecard/schedule/ScheduleConfirmation';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';localStorage.setItem('foundr1-os-language-preference','manual');localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');createRoot(document.getElementById('root')).render(<OsTranslationProvider><main style={{maxWidth:1100,margin:'auto',padding:16}}><ScheduleConfirmation storeId="store-1" periodKey="2026-11-first_half" onChanged={()=>{}}/></main></OsTranslationProvider>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,outfile:'fixture.js',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=await readFile('app/globals.css','utf8')+'\n'+bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
let settings={autoConfirm:false,firstDay:null,firstTime:null,secondDay:null,secondTime:null,revision:0};
const days=Array.from({length:15},(_,index)=>({workDate:`2026-11-${String(index+1).padStart(2,'0')}`,hoursSource:'schedule',manualPeriods:null,suggestedPeriods:index===0?[{startDate:{year:2026,month:11,day:1},endDate:{year:2026,month:11,day:1},openTime:{hours:12},closeTime:{hours:21}}]:[],businessPeriods:index===0?[{startDate:{year:2026,month:11,day:1},endDate:{year:2026,month:11,day:1},openTime:{hours:12},closeTime:{hours:21}}]:null,businessStatus:index===0||index===3?'open':index===2?'closed':'pending',revision:index===0||index===3?1:0,confirmedAt:index===0||index===3?'2026-10-28T20:00:00+09:00':null,needsRefresh:index===3,attentionReason:index===3?'営業予定ですが人員が未配置です。Google の営業時間は変更しません。':index!==0&&index!==2?'営業予定が未確定です。':null,shifts:index===0?[{}]:[],shiftCount:index===0?1:0,ready:index===0||index===2}));
let received,scenario='normal';
const server=createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost'),json=(body,status=200)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(body));};
 if(url.pathname==='/fixture.js'){response.writeHead(200,{'content-type':'text/javascript'});return response.end(js);}
 if(url.pathname==='/fixture.css'){response.writeHead(200,{'content-type':'text/css'});return response.end(css);}
 if(url.pathname.startsWith('/locales/os/'))return json(JSON.parse(await readFile(resolve(root,'public',url.pathname.slice(1)),'utf8')));
 if(url.pathname==='/api/timecard/schedule-confirmation'){
  if(request.method==='GET')return json({settings,period:{key:'2026-11-first_half',startDate:'2026-11-01',endDate:'2026-11-15'},deadline:settings.firstDay!==null?'2026-10-28T20:00:00+09:00':null,days,summary:{confirmed:days.filter(day=>day.confirmedAt&&day.ready&&!day.needsRefresh).length,total:15,pending:15-days.filter(day=>day.confirmedAt&&day.ready&&!day.needsRefresh).length}});
  let text='';for await(const chunk of request)text+=chunk;received=JSON.parse(text);
  if(scenario==='forbidden')return json({error:'この店舗を操作する権限がありません。'},403);
  if(received.action==='save_settings')settings={...received.settings,revision:settings.revision+1};
  if(received.action==='set_business_day'){const day=days.find(day=>day.workDate===received.date);day.businessStatus=received.status;day.hoursSource=received.hoursSource;day.manualPeriods=received.intervals.map(item=>({startDate:{year:2026,month:11,day:Number(item.workDate.slice(-2))},openTime:{hours:Number(item.scheduledStart.slice(0,2))},closeTime:{hours:Number(item.scheduledEnd.slice(0,2))}}));day.revision++;day.ready=day.businessStatus==='closed'||day.businessStatus==='open'&&day.shiftCount>0;day.attentionReason=day.ready?null:'営業予定が未確定です。';}
  if(received.action==='confirm_period')for(const day of days)if(day.ready){day.confirmedAt=new Date().toISOString();day.revision++;}
  return json({ok:true,result:{}});
 }
 if(url.pathname!=='/'){response.writeHead(404);return response.end();}
 response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--no-first-run']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);page.on('request',request=>new URL(request.url()).origin===base?request.continue():request.abort());
 for(const[width,lang]of[[390,'ja'],[800,'zh-Hans'],[1366,'zh-Hant']]){
  await page.setViewport({width,height:1100});await page.goto(`${base}/?lang=${lang}`,{waitUntil:'networkidle0'});await page.waitForSelector('input[type=number]');
  assert.equal(await page.$('input[type=checkbox]'),null,'scheduled confirmation is not offered');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`overflow at ${width}`);
  assert.equal(await page.$$eval('div[role=group]',elements=>elements.length),15);
  await page.screenshot({path:resolve(output,`confirmation-${width}-${lang}.png`),fullPage:true});
 }
 await page.goto(base,{waitUntil:'networkidle0'});await page.waitForSelector('input[type=number]');
 const row='div[role=group][aria-label="2026-11-02"]';await page.select(`${row} select[aria-label="2026-11-02 営業予定"]`,'closed');
 assert.equal(await page.$eval('button.primary-button',element=>element.disabled),true,'unsaved day state blocks period confirmation');
 await page.click(`${row} button`);await page.waitForFunction(()=>document.body.textContent.includes('営業予定を保存しました。'));
 assert.equal(received.period,'2026-11-first_half');assert.equal(received.date,'2026-11-02');assert.equal(received.status,'closed');
 await page.click('button.primary-button');await page.waitForFunction(()=>document.body.textContent.includes('確認できた日を確定しました。'));
 assert.equal(days[4].businessStatus,'pending');assert.equal(days[3].businessStatus,'open');assert.equal(days[3].needsRefresh,true);
 const minutes=await page.$$('input[type=number]');
 for(const input of minutes)await input.type('0');
 const retainRow='div[role=group][aria-label="2026-11-03"]';await page.select(`${retainRow} select[aria-label="2026-11-03 営業予定"]`,'pending');
 const buttons=await page.$$('button');for(const button of buttons)if((await button.evaluate(element=>element.textContent))==='営業日カレンダー設定を保存')await button.click();
 await page.waitForFunction(()=>document.body.textContent.includes('営業予定を保存しました。'));
 assert.equal(await page.$eval(`${retainRow} select[aria-label="2026-11-03 営業予定"]`,element=>element.value),'pending','saving calendar settings preserves unsaved day edits');
 const discard=await page.$$('button');for(const button of discard)if((await button.evaluate(element=>element.textContent))==='入力を破棄して再読込')await button.click();await page.waitForFunction(()=>document.querySelector('button.primary-button')?.disabled===false);
 assert.equal(settings.autoConfirm,false);assert.equal(settings.preparationMinutes,0);assert.equal(settings.cleanupMinutes,0);
 const manual='div[role=group][aria-label="2026-11-01"]';
 await page.select(`${manual} select[aria-label="2026-11-01 営業時間の決め方"]`,'manual');
 await page.waitForSelector(`${manual} input`);await page.$eval(`${manual} input`,element=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(element,'13:00-20:00');element.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.$eval('button.primary-button',element=>element.disabled),true,'manual hour drafts also block bulk confirmation');
 await page.click(`${manual} button`);await page.waitForFunction(()=>document.body.textContent.includes('営業予定を保存しました。'));
 assert.equal(received.action,'set_business_day');assert.equal(received.hoursSource,'manual');assert.equal(received.intervals[0].scheduledStart,'13:00');
 await page.setViewport({width:390,height:1100});await page.screenshot({path:resolve(output,'manual-hours-mobile.png'),fullPage:true});
 scenario='forbidden';await page.select(`${row} select[aria-label="2026-11-02 営業予定"]`,'pending');await page.click(`${row} button`);await page.waitForFunction(()=>document.body.textContent.includes('この店舗を操作する権限'));
 assert.equal(await page.$eval(`${row} select[aria-label="2026-11-02 営業予定"]`,element=>element.value),'pending','denied mutation retains draft');assert.equal(days[1].businessStatus,'closed','denied mutation cannot alter saved state');
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'browser-results.json'),JSON.stringify({ok:true,widths:[390,800,1366],checks:['three UI languages','no overflow','15 explicit day states','manual confirmation only','unsaved state guard','exact half/date save','pending and unstaffed never become closed','preparation and cleanup save','denied save retains draft'],errors},null,2));console.log('Schedule confirmation UI: 3 viewports, 3 languages and workflow checks passed.');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
