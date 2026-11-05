// Actual shared editor, translations and serializers with synthetic save/reload only.
// No live database or merchant platform is contacted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const output = resolve('outputs/store-24-hours-20261018/ui');
await mkdir(output, { recursive: true });
const source = await readFile('app/os/stores/page.tsx', 'utf8');
const editorSource = source.slice(source.indexOf('function BusinessHoursEditor('));
assert.match(editorSource, /open24Hours/);
assert.match(source, /serializeBusinessHours\(newBusinessHours\)/);
assert.match(source, /serializeBusinessHours\(editingBusinessHours\)/);
assert.match(source, /<BusinessHoursEditor value=\{newBusinessHours\} onChange=\{setNewBusinessHours\}/);
assert.match(source, /<BusinessHoursEditor value=\{editingBusinessHours\} onChange=\{setEditingBusinessHours\}/);
const entry = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OsTranslationProvider,OsLanguagePicker,useOsTranslation} from './app/os/components/OsTranslationProvider';
import {defaultBusinessHours,weekdayKeys,weekdayLabels,normalizeBusinessHours,serializeBusinessHours,formatBusinessHoursSummary} from './lib/store-business-hours';
import type {StoreBusinessHours,WeekdayKey} from './lib/store-business-hours';
import businessHoursStyles from './app/os/stores/business-hours.module.css';
${editorSource}
const mode=new URLSearchParams(location.search).get('mode')||'new';
function Fixture(){
 const initial=mode==='edit'?{weekly:{...defaultBusinessHours,mon:{open:'08:30',close:'22:15',closed:new URLSearchParams(location.search).get('conflict')==='1',open24Hours:true},tue:{open:'09:15',close:'21:45',closed:true}}}:{...defaultBusinessHours,mon:{open:'08:30',close:'22:15',closed:false}};
 const [hours,setHours]=useState(()=>normalizeBusinessHours(initial));const [summary,setSummary]=useState('');
 window.__hours=hours;window.__payloads ||= [];
 return <main><OsLanguagePicker/><h1>{mode==='edit'?'店舗の営業時間を編集':'新しい店舗を追加'}</h1><form className='management-form' onSubmit={e=>{e.preventDefault();const payload=serializeBusinessHours(hours);window.__payloads.push(JSON.parse(payload));setHours(normalizeBusinessHours(payload));setSummary(formatBusinessHoursSummary(payload));}}><BusinessHoursEditor value={hours} onChange={setHours}/><button data-save type='submit'>保存</button></form><p data-summary>{summary}</p></main>;
}
createRoot(document.getElementById('root')).render(<OsTranslationProvider><Fixture/></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outfile: '/tmp/store-business-hours-fixture.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = await readFile('app/globals.css', 'utf8') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text + '\nbody{margin:0;background:#f7f8f7}main{box-sizing:border-box;max-width:1000px;padding:20px;margin:auto}h1{font-size:20px;margin:16px 0}.management-form{padding:16px;background:white;border:1px solid var(--line);border-radius:8px}.management-form button{min-height:40px;border:0;border-radius:6px;background:var(--green);color:white}';
const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async language => [language,await readFile(`public/locales/os/${language}.json`,'utf8')])));
const server = createServer((req,res)=>{
 const path = req.url.split('?')[0];
 if(path.startsWith('/locales/os/')){const language=path.split('/').at(-1).replace('.json','');res.setHeader('Content-Type','application/json');res.end(dictionaries[language]||'{}');return;}
 res.setHeader('Content-Type',path==='/fixture.js'?'text/javascript':path==='/fixture.css'?'text/css':'text/html; charset=utf-8');
 res.end(path==='/fixture.js'?bundle.outputFiles.find(file=>file.path.endsWith('.js')).text:path==='/fixture.css'?css:html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[],errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.setRequestInterception(true);page.on('request',request=>request.url().startsWith(origin)?request.continue():request.abort());
 const visit=async(mode,language='ja')=>{await page.goto(`${origin}/?mode=${mode}`,{waitUntil:'networkidle0'});await page.select('.os-language-picker select',language);await page.waitForFunction(lang=>document.documentElement.lang===lang,{},language);await page.waitForFunction(()=>!!window.__hours);if(language!=='ja')await page.waitForFunction(()=>document.querySelector('[data-business-hours-day="mon"]').textContent.includes('24 '));};
 const row=day=>`[data-business-hours-day="${day}"]`;
 const state=day=>page.$eval(row(day),node=>({checked:[...node.querySelectorAll('[type=checkbox]')].map(input=>input.checked),disabled:[...node.querySelectorAll('[type=time]')].map(input=>input.disabled),times:[...node.querySelectorAll('[type=time]')].map(input=>input.value)}));
 for(const width of [1440,768,360]){
  await page.setViewport({width,height:960});
  for(const mode of ['new','edit']){
   await visit(mode);
   assert.equal(await page.$$eval('[data-business-hours-day]',nodes=>nodes.length),7);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${mode}: no overflow at ${width}`);
   assert.deepEqual((await state('mon')).checked,mode==='edit'?[false,true]:[false,false]);
   assert.deepEqual((await state('mon')).disabled,mode==='edit'?[true,true]:[false,false]);
   assert.deepEqual((await state('mon')).times,['08:30','22:15']);
   const sizes=await page.$$eval('[data-business-hours-day] [type=checkbox]',nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return[rect.width,rect.height,getComputedStyle(node).accentColor];}));
   assert.ok(sizes.every(([w,h,color])=>w===16&&h===16&&color!=='auto'),'all checkboxes compact and explicitly themed');
   await page.screenshot({path:resolve(output,`${mode}-ja-${width}.png`),fullPage:true});
  }
 }
 checks.push('Real shared new/edit editor: 7 weekdays, saved explicit 24h preload, compact green checkbox dimensions, 360/768/1440 widths without overflow');
 await visit('new');
 await page.$$eval(`${row('mon')} [type=checkbox]`,nodes=>nodes[1].click());
 assert.deepEqual((await state('mon')).checked,[false,true]);assert.deepEqual((await state('mon')).disabled,[true,true]);assert.deepEqual((await state('mon')).times,['08:30','22:15']);
 await page.click('[data-save]');
 assert.equal(await page.evaluate(()=>window.__payloads.at(-1).weekly.mon.open24Hours),true);
 assert.deepEqual((await state('mon')).checked,[false,true],'24h survives synthetic save/reload through actual serializer');
 assert.match(await page.$eval('[data-summary]',node=>node.textContent),/24時間営業/);
 await page.$$eval(`${row('mon')} [type=checkbox]`,nodes=>nodes[1].click());
 assert.deepEqual((await state('mon')).disabled,[false,false]);assert.deepEqual((await state('mon')).times,['08:30','22:15'],'turning off 24h restores previous times');
 await page.click('[data-save]');assert.notEqual(await page.evaluate(()=>window.__payloads.at(-1).weekly.mon.open24Hours),true);
 checks.push('Create: selecting 24h disables times, preserves 08:30–22:15, survives actual serialize/normalize save/reload, summary says 24h, toggling off restores timed hours');
 await visit('edit');
 await page.$$eval(`${row('mon')} [type=checkbox]`,nodes=>nodes[0].click());
 assert.deepEqual((await state('mon')).checked,[true,false],'closed replaces 24h');
 await page.$$eval(`${row('mon')} [type=checkbox]`,nodes=>nodes[1].click());
 assert.deepEqual((await state('mon')).checked,[false,true],'24h replaces closed');
 assert.deepEqual((await state('tue')).checked,[true,false],'another weekday remains closed');
 await page.click('[data-save]');
 assert.equal(await page.evaluate(()=>window.__payloads.at(-1).weekly.mon.open24Hours),true);
 assert.equal(await page.evaluate(()=>window.__payloads.at(-1).weekly.tue.closed),true);
 assert.deepEqual((await state('mon')).times,['08:30','22:15']);
 checks.push('Edit: explicit saved 24h loads; closed and 24h mutually exclude in both directions; another closed weekday remains unchanged on save');
 await visit('new');
 for(const day of ['mon','tue','wed','thu','fri','sat','sun'])await page.$$eval(`${row(day)} [type=checkbox]`,nodes=>nodes[1].click());
 await page.click('[data-save]');
 assert.equal(await page.evaluate(()=>Object.values(window.__payloads.at(-1).weekly).every(day=>day.open24Hours===true&&!day.closed)),true,'all seven weekdays persist as explicit 24h');
 assert.equal(await page.$$eval('[data-business-hours-day] [type=time]',nodes=>nodes.every(node=>node.disabled)),true);
 const monday24=(await page.$$(`${row('mon')} [type=checkbox]`))[1];await monday24.focus();await page.keyboard.press('Space');
 assert.deepEqual((await state('mon')).checked,[false,false],'keyboard toggling exits 24h');
 assert.deepEqual((await state('mon')).times,['08:30','22:15']);
 checks.push('All seven weekdays save/reload as explicit 24h; keyboard Space toggles the focused checkbox and restores retained times');
 await visit('edit&conflict=1');
 assert.deepEqual((await state('mon')).checked,[true,false],'closed wins over a conflicting saved 24h flag');
 assert.deepEqual((await state('mon')).disabled,[true,true]);
 checks.push('Malformed preexisting closed plus 24h flags display closed only and disable the time controls');
 for(const language of ['zh-Hans','zh-Hant']){
  await page.setViewport({width:360,height:960});await visit('edit',language);
  const text=await page.$eval(row('mon'),node=>node.textContent);
  assert.match(text,language==='zh-Hans'?/星期一.*休息.*24 小时营业/:/星期一.*休息.*24 小時營業/);
  const labels=await page.$$eval(`${row('mon')} input`,nodes=>nodes.map(node=>node.getAttribute('aria-label')));
  assert.deepEqual(labels,language==='zh-Hans'?['星期一 休息','星期一 24 小时营业','星期一 开店时间','星期一 关店时间']:['星期一 休息','星期一 24 小時營業','星期一 開店時間','星期一 關店時間']);
  await page.$$eval(`${row('mon')} [type=checkbox]`,nodes=>nodes[1].click());
  assert.deepEqual((await state('mon')).disabled,[false,false]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${language} no overflow`);
  await page.screenshot({path:resolve(output,`edit-${language}-360.png`),fullPage:true});
 }
 checks.push('Real OS translation provider/dictionaries: simplified and traditional checkbox, weekday and accessible time labels, reactive toggling, mobile no overflow');
 assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'result.json'),JSON.stringify({checks,errors},null,2));
 console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
