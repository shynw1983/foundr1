// Real Staff views with synthetic personal records. All writes are blocked.
import {context} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const root=process.cwd(),output=resolve(root,'outputs/staff-responsive-review-20260917');
const stores=[{id:'s1',name:'桜並木店・駅前テスト店舗'},{id:'s2',name:'清水店（検証用）'}];
const employee={id:'e1',name:'検証用スタッフ長い名前',role:'staff',loginId:'fixture-only',storeIds:['s1','s2']};
const days=Array.from({length:4},(_,i)=>`2026-09-${String(i+18).padStart(2,'0')}`);
const shifts=days.map((workDate,i)=>({id:'shift'+i,workDate,scheduledStart:'10:00',scheduledEnd:i?'18:00':'26:00',employeeName:employee.name}));
const fixtures={
 '/api/auth/me':{employee},
 '/api/os/store-context':{stores,selectedStoreId:'s2',canSelectStore:true},
 '/api/timecard':{month:'2026-09',currentEmployeeId:'e1',currentEmployeeRole:'staff',stores,selectedStoreId:'s1',employees:[employee],latestPunch:null,latestPunches:[],dailySummaries:days.slice(0,2).map((workDate,i)=>({key:'day'+i,employeeId:'e1',employeeName:employee.name,workDate,storeName:stores[0].name,clockIn:workDate+'T01:00:00Z',clockOut:workDate+'T09:00:00Z',breakMinutes:60,workMinutes:420,alerts:i?['退勤時刻の確認が必要です。担当者に確認してください。']:[]}))},
 '/api/timecard/shift-requests':{requests:[{id:'request1',requestType:'swap',status:'open',workDate:days[0],title:'交代募集',note:'学校の予定が変更になったため、交代できる方がいればお願いします。',employeeId:'e2',employeeName:'別の検証スタッフ',candidates:[]}],myShifts:shifts,nextShift:shifts[0],myShiftsPeriod:{startDate:'2026-09-01',endDate:'2026-09-30',label:'2026-09'},submissionPeriod:{label:'2026-09 後半',startDate:days[0],endDate:days.at(-1),deadlineAt:'2026-09-17 23:59'},submissionDates:days},
 '/api/staff/payroll':{payrolls:[{id:'pay1',storeName:stores[0].name,payrollMonth:'2026-08',periodStart:'2026-08-01',periodEnd:'2026-08-31',confirmedAt:'2026-09-10T00:00:00Z',row:{workDays:20,workMinutes:9600,breakMinutes:1200,nightMinutes:180,basePay:200000,overtimePay:10000,nightPremiumPay:2000,commuteAllowance:12000,socialInsurance:8000,employmentInsurance:1200,incomeTax:3000,residentTax:7000,totalPay:204800,alerts:[]}}]},
 '/api/privacy-consents/history':{consents:[{consentId:'doc1',companyLegalName:'検証用株式会社レストラン運営',version:'v2026-09',title:'従業員の個人情報の取扱いおよび利用目的に関する文書',agreedAt:'2026-09-01T00:00:00Z',body:'Fixture only',storeNames:[stores[0].name]}]}
};
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {StaffPortalClient} from './app/staff/components/StaffPortalClient';import {OsTranslationProvider} from './app/os/components/OsTranslationProvider';import './app/staff/staff-interface.css';
const query=new URLSearchParams(location.search);localStorage.setItem('foundr1-os-language',query.get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
const originalFetch=window.fetch;window.__writes=[];window.__reads=[];
window.fetch=async(input,init={})=>{const url=new URL(String(input),location.href);if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);window.__reads.push(url.pathname);if(init.method&&init.method!=='GET'){window.__writes.push(url.pathname);return Response.json({error:'Writes blocked'},{status:409});}const value=structuredClone(window.__fixtures[url.pathname]||{});if(url.pathname==='/api/timecard'){value.selectedStoreId=url.searchParams.get('storeId')||'s1';if(query.get('state')==='working')value.latestPunch={employeeId:'e1',punchType:'clock_in',punchedAt:'2026-09-17T01:00:00Z'};}if(query.get('empty')==='1'){if(value.dailySummaries)value.dailySummaries=[];for(const key of ['requests','myShifts','submissionDates','payrolls','consents'])if(key in value)value[key]=[];}return Response.json(value);};
const views={'/staff':'home','/staff/timecard':'timecard','/staff/shifts':'shifts','/staff/shift-requests':'requests','/staff/payroll':'payroll','/staff/privacy-documents':'documents'};createRoot(document.getElementById('root')).render(<OsTranslationProvider><div className="staff-interface"><StaffPortalClient view={views[location.pathname]||'home'}/></div></OsTranslationProvider>);`;
const compiler=await context({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,outdir:'/private/tmp/staff-ui-fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'}});
let bundle;
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/fixture.js'||path==='/fixture.css'){bundle??=await compiler.rebuild();res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(path.endsWith('.js')?bundle.outputFiles.find(f=>f.path.endsWith('.js')).text:(await readFile('app/globals.css','utf8'))+'\n'+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n'));return;}
 if(path.startsWith('/locales/')||path.startsWith('/icons/')){res.end(await readFile(resolve(root,'public',path.slice(1))));return;}
 if(path.startsWith('/api/')){res.writeHead(403).end();return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.__fixtures='+JSON.stringify(fixtures).replaceAll('<','\\u003c')+'</script><script src="/fixture.js"></script></body></html>');
}catch(e){res.writeHead(404).end(String(e));}});
await new Promise(ok=>server.listen(4180,'127.0.0.1',ok));console.log('Staff fixture http://127.0.0.1:4180/staff; writes blocked');
if(process.argv.includes('--serve'))await new Promise(()=>{});
await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const routes=['/staff','/staff/timecard','/staff/shifts','/staff/shift-requests','/staff/payroll','/staff/privacy-documents'];
try{
 for(const width of [360,390,430,768,1024,1440]){
  await page.setViewport({width,height:844});
  for(const route of routes){
   await page.goto('http://127.0.0.1:4180'+route,{waitUntil:'networkidle0'});
   assert.ok(await page.$('.staff-status-store'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,route+' overflow '+width);
   assert.equal(await page.$('.os-global-store-picker'),null,'OS store picker leaked into Staff');
   assert.equal(await page.$$eval('.staff-nav a',links=>links.every(a=>a.getBoundingClientRect().height>=44)),true);
   if(width<761)assert.equal(await page.$eval('.staff-nav',e=>Math.round(e.getBoundingClientRect().bottom)),844);
   await page.screenshot({path:output+'/'+route.replaceAll('/','-')+'-'+width+'.png'});
  }
  console.log('PASS '+width+'px / 6 Staff views');
 }
 await page.setViewport({width:360,height:740});
 for(const language of ['zh-Hans','zh-Hant'])for(const route of routes){await page.goto('http://127.0.0.1:4180'+route+'?lang='+language,{waitUntil:'networkidle0'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Language overflow '+route+' '+language);}
 await page.goto('http://127.0.0.1:4180/staff/shift-requests',{waitUntil:'networkidle0'});
 assert.equal(await page.$eval('.store-shift-request-times input',e=>e.disabled),true);
 await page.click('.store-shift-wants-work input');
 assert.equal(await page.$eval('.store-shift-request-times input',e=>e.disabled),false);
 assert.equal(await page.$eval('.store-shift-request-times input',e=>Boolean(e.getAttribute('aria-label'))),true);
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
 assert.ok(await page.evaluate(()=>document.querySelector('.staff-page-stack').getBoundingClientRect().bottom<=document.querySelector('.staff-nav').getBoundingClientRect().top),'Bottom navigation covers content');
 await page.goto('http://127.0.0.1:4180/staff/timecard?state=working',{waitUntil:'networkidle0'});
 assert.deepEqual(await page.$$eval('.timecard-punch-button',buttons=>buttons.map(b=>b.disabled)),[true,false,true,false]);
 assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
 await page.goto('http://127.0.0.1:4180/staff?empty=1',{waitUntil:'networkidle0'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('PASS Chinese layouts, request editing, punch states, empty state and bottom clearance');
}finally{await browser.close();server.close();await compiler.dispose();}
