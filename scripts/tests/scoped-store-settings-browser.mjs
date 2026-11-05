// Local synthetic data only. Renders the actual settings, hours and translation components.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const root = process.cwd(), output = resolve(process.env.PERMISSION_BROWSER_OUTPUT || 'outputs/role-permission-audit-20261028/browser');
await mkdir(output, { recursive: true });
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import{ScopedStoreSettings}from'./app/os/stores/ScopedStoreSettings';
import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
localStorage.setItem('foundr1-os-language-preference','manual');localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');
createRoot(document.getElementById('root')).render(<OsTranslationProvider><ScopedStoreSettings/></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false,
  outfile: 'fixture.js', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'peripheral-navigation', setup(build) {
    build.onResolve({ filter: /components\/(OsNavList|MobileNavMenu|UserBadge)$/ }, args => ({ path: args.path, namespace: 'nav-fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'nav-fixture' }, () => ({ loader: 'tsx', resolveDir: root, contents: `import React from'react';import{OsLanguagePicker}from'${root}/app/os/components/OsTranslationProvider';
      export const canonicalNavItems=[];export function OsNavList(){return <nav><OsLanguagePicker/><a href='/os'>OS</a></nav>}
      export function MobileNavMenu(){return null}export function UserBadge(){return <span>検証用アカウント</span>}` }));
  } }]
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = await readFile('app/globals.css', 'utf8') + '\n' + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
const weekly = Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(day => [day,{open:'11:00',close:'22:00',closed:false}]));
let saved = { id: '00000000-0000-4000-8000-000000000001', name: '検証用店舗', revision: 'revision-1', businessHours: weekly, reservationNote: '',
  attendanceAddress: '検証用住所', attendanceLocationEnabled: true, attendanceLatitude: 33.5, attendanceLongitude: 130.4, attendanceRadiusMeters: 100, attendanceAccuracyThresholdMeters: 100, payroll: { payrollCycleType:'specified_day', payrollClosingDay:25, prescribedMonthlyWorkMinutes:10428, socialInsurancePrefecture:'福岡県', socialInsuranceDeductionTiming:'next_month', shiftFirstHalfSubmissionDeadlineDay:25, shiftSecondHalfSubmissionDeadlineDay:10, shiftSubmissionDeadlineTime:'18:00' } };
let scenario = 'normal', writes = 0, received;
const server = createServer(async (request,response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const json = (body,status=200) => { response.writeHead(status,{'Content-Type':'application/json'}); response.end(JSON.stringify(body)); };
  if (url.pathname === '/fixture.js') { response.writeHead(200,{'Content-Type':'text/javascript'}); return response.end(js); }
  if (url.pathname === '/fixture.css') { response.writeHead(200,{'Content-Type':'text/css'}); return response.end(css); }
  if (url.pathname.startsWith('/locales/os/')) { try { response.writeHead(200,{'Content-Type':'application/json'}); return response.end(await readFile(resolve(root,'public',url.pathname.slice(1)))); } catch { return json({},404); } }
  if (url.pathname === '/api/stores/scoped-settings') {
    if (request.method === 'GET') return json({ stores:[saved], canEdit:scenario !== 'readonly' });
    let text='';for await(const chunk of request)text+=chunk;received=JSON.parse(text);writes++;
    if (scenario === 'stale') return json({error:'設定または権限が変更されました。再読み込みして確認してください。'},409);
    if (scenario === 'forbidden') return json({error:'権限がありません。'},403);
    await new Promise(resolve=>setTimeout(resolve,250));
    saved={...saved,...received,revision:'revision-'+(writes+1)};return json({ok:true,revision:saved.revision});
  }
  if (url.pathname === '/api/os/store-temporary-closures') return json({temporaryClosures:[],affectedOrders:[]});
  if (url.pathname.startsWith('/api/')) return json({});
  if (url.pathname !== '/') { response.writeHead(404); return response.end(); }
  response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
let browser;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--no-first-run','--no-default-browser-check']});
  const page=await browser.newPage(),errors=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.setRequestInterception(true);
  page.on('request',request=>new URL(request.url()).origin===base?request.continue():request.abort());
  const ready=()=>page.waitForSelector('textarea');
  for(const [width,language] of [[390,'ja'],[800,'zh-Hans'],[1366,'zh-Hant']]){
    await page.setViewport({width,height:1000});await page.goto(base+'/?lang='+language,{waitUntil:'networkidle0'});await ready();
    await page.waitForFunction(()=>document.querySelector('textarea')&&!document.querySelector('textarea').disabled);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`overflow at ${width}`);
    assert.equal(await page.$$('input[type=time]').then(nodes=>nodes.length),17);
    assert.equal(await page.evaluate(()=>Array.from(document.querySelectorAll('input')).some(input=>/secret|paymentAccount|company/i.test(input.name))),false);
    if(language==='zh-Hans')assert.ok((await page.$eval('h2',e=>e.textContent)).includes('所属店铺'));
    if(language==='zh-Hant')assert.ok((await page.$eval('h2',e=>e.textContent)).includes('所屬店鋪'));
    await page.screenshot({path:resolve(output,`settings-${width}-${language}.png`),fullPage:true});checks.push(`layout and language ${width}/${language}`);
  }
  await page.goto(base+'/?lang=ja',{waitUntil:'networkidle0'});await ready();
  await page.type('textarea','検証用メモ');
  await page.select('select[name=payrollCycleType]','specified_day');
  await page.$eval('input[name=payrollClosingDay]',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'20');e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.select('select[name=socialInsurancePrefecture]','東京都');
  await page.click('button.primary-button');
  await page.waitForFunction(()=>document.querySelector('section.workspace select').disabled);
  await page.waitForFunction(()=>document.body.textContent.includes('店舗設定を保存しました。'));
  assert.equal(saved.reservationNote,'検証用メモ');assert.equal(received.storeId,saved.id);assert.equal(received.paymentAccount,undefined);assert.equal(saved.payroll.payrollClosingDay,20);assert.equal(saved.payroll.socialInsurancePrefecture,'東京都');checks.push('payroll and operations save with synthetic persistence');
  await page.reload({waitUntil:'networkidle0'});await ready();assert.equal(await page.$eval('input[name=payrollClosingDay]',e=>e.value),'20');checks.push('payroll reload preserves saved values');
  scenario='stale';await page.type('textarea','-変更');const staleDraft=await page.$eval('textarea',e=>e.value);await page.select('select[name=socialInsuranceDeductionTiming]','current_month');await page.click('button.primary-button');
  await page.waitForSelector('[role=alert]');assert.ok((await page.$eval('[role=alert]',e=>e.textContent)).includes('再読み込み'));assert.equal(await page.$eval('textarea',e=>e.value),staleDraft);assert.equal(await page.$eval('select[name=socialInsuranceDeductionTiming]',e=>e.value),'current_month');checks.push('conflict retains draft');
  scenario='forbidden';await page.click('button.primary-button');await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('権限がありません'));checks.push('permission denial is visible');
  scenario='readonly';await page.goto(base,{waitUntil:'networkidle0'});await ready();assert.equal(await page.$eval('textarea',e=>e.matches(':disabled')),true);assert.equal((await page.$$('button.primary-button')).length,0);assert.equal(await page.$eval('select[name=payrollCycleType]',e=>e.matches(':disabled')),true);checks.push('read-only hides writes');
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({passed:true,checks,writes,pageErrors:errors,syntheticOnly:true},null,2));console.log(JSON.stringify({passed:true,checks,writes,pageErrors:errors}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
