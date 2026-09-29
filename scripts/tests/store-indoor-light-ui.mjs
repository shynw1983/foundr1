// Real page/navigation/translations. Fake provider, fake clock and blocked outbound HTTP.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const output=resolve(process.env.DEVICES_UI_OUTPUT || 'outputs/store-devices-20260929');await mkdir(output,{recursive:true});
const dictionaries=Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async l=>[l,JSON.parse(await readFile(`public/locales/os/${l}.json`,'utf8'))])));
const fixtureDevices=[
 ['室内照明','Bot','indoorLight',['press'],{lightLevel:12,battery:100,botMode:'pressMode'}],
 ['看板ライト','Bot','bot',['press'],{battery:100,botMode:'pressMode'}],
 ['ロールスクリーン','Roller Shade','shade',['setPosition'],{position:0,moving:false,calibrated:true,battery:13}],
 ['会社ロックPro','Smart Lock Pro','lock',['lock','unlock'],{lockState:'locked',doorState:'closed',calibrated:true,battery:90}],
 ['ハブ２','Hub 2','hub',[],{temperature:22.6,humidity:66,lightLevel:12}],
 ['温湿度計','Meter','meter',[],null],['顔認証パッド','Keypad Vision','keypad',[],{battery:58}],['リモートボタン','Remote','remote',[],null]
].map(([name,type,kind,actions,sample],i)=>({key:String(i+1).repeat(24),name,type,kind,actions,sample,readError:!sample,issue:kind==='meter'?'sensor_unavailable':kind==='remote'?'status_unsupported':'',controlEnabled:true,blockedUntil:null,command:null}));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import Page from './app/store/devices/page';import {OsTranslationProvider} from './app/os/components/OsTranslationProvider';
const NativeDate=Date,nativeTimeout=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window);let sequence=1000000;const jobs=new Map();const clock={now:NativeDate.now(),async advance(ms){const end=this.now+ms;let turns=0;while(true){const next=[...jobs.values()].filter(j=>j.at<=end).sort((a,b)=>a.at-b.at)[0];if(!next)break;if(++turns>3000)throw Error('timer loop');this.now=next.at;jobs.delete(next.id);if(next.interval)jobs.set(next.id,{...next,at:this.now+next.interval});await next.fn(...next.args);await new Promise(r=>nativeTimeout(r,0));}this.now=end;await new Promise(r=>nativeTimeout(r,0));}};window.__clock=clock;
window.Date=class extends NativeDate {constructor(...args){if(args.length)super(...args);else super(clock.now);}static now(){return clock.now;}};
window.setTimeout=(fn,ms=0,...args)=>{const id=++sequence;jobs.set(id,{id,fn,args,at:clock.now+ms});return id;};window.clearTimeout=id=>{jobs.delete(id);nativeClear(id);};window.setInterval=(fn,ms=1,...args)=>{const id=++sequence;jobs.set(id,{id,fn,args,at:clock.now+ms,interval:ms});return id;};window.clearInterval=window.clearTimeout;
const language=new URLSearchParams(location.search).get('language')||'ja';localStorage.setItem('foundr1-os-language',language);localStorage.setItem('foundr1-os-language-preference','manual');
const storeId='10000000-0000-4000-8000-000000000001',dictionaries=${JSON.stringify(dictionaries)};
window.__devices={posts:[],reads:[],failure:false,postFailure:false,view:{configured:true,storeId,devices:${JSON.stringify(fixtureDevices)}}};
window.fetch=async(input,init={})=>{await Promise.resolve();if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');const url=new URL(String(input),'https://fixture.invalid'),state=window.__devices;
if(url.pathname.startsWith('/locales/os/'))return Response.json(dictionaries[url.pathname.includes('zh-Hant')?'zh-Hant':'zh-Hans']);
if(url.pathname==='/api/store/context')return Response.json({selectedStoreId:storeId,access:{role:'store_terminal',canUseAllStoreView:false,stores:[{id:storeId,name:'清水店'}]}});
if(url.pathname==='/api/auth/me')return Response.json({employee:{id:'test-terminal',name:'清水店',role:'store_terminal'}});
if(url.pathname==='/api/settings')return Response.json({});
if(url.pathname==='/api/store/devices'){
if(init.method==='POST'){const body=JSON.parse(init.body);state.posts.push(body);const device=state.view.devices.find(d=>d.key===body.device);const command={id:body.requestId,action:body.action,parameter:body.action==='setPosition'?String(body.position):'default',result:state.postFailure?'unknown':state.deviceCode?'rejected':'accepted',requestedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),before:structuredClone(device.sample),reason:state.alreadyInState?'already_in_state':state.deviceCode?'api_'+state.deviceCode:''};if(state.alreadyInState)command.before={...device.sample,lockState:'locked'};device.command=command;device.blockedUntil=new Date(Date.now()+10000).toISOString();if(state.postFailure)throw new TypeError('Network error');return Response.json({command,blockedUntil:device.blockedUntil});}
state.reads.push({device:url.searchParams.get('device'),at:Date.now()});if(state.failure)return Response.json({error:'unavailable'},{status:503});const devices=state.view.devices.filter(d=>!url.searchParams.get('device')||d.key===url.searchParams.get('device')).map(d=>({...d,fetchedAt:d.sample?new Date().toISOString():null}));return Response.json({...state.view,devices});}
return Response.json({items:[],notifications:[],unreadCount:0});};
createRoot(document.getElementById('root')).render(<React.StrictMode><OsTranslationProvider><Page/></OsTranslationProvider></React.StrictMode>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const css=(await readFile('app/globals.css','utf8'))+'\n'+(await readFile('app/store/store-responsive.css','utf8'));
const fixture=resolve(output,'fixture.html');await writeFile(fixture,`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>清水店 設備 — local fixture</title><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`);
if(process.argv.includes('--prepare')){console.log(fixture);process.exit(0);}
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>/^https?:/.test(r.url())?r.abort():r.continue());
 const card=kind=>`[data-device-kind="${kind}"]`,control=kind=>card(kind)+' .store-device-actions .primary-button';
 const open=async(language='ja')=>{await page.goto('file://'+fixture+'?language='+language,{waitUntil:'load'});await page.waitForFunction(()=>document.querySelectorAll('.store-device-card').length===8);if(language!=='ja')await page.waitForFunction(()=>document.querySelector('.store-devices-toolbar p').textContent.includes('需要'));};
 const advance=async ms=>page.evaluate(ms=>window.__clock.advance(ms),ms);
 const confirm=async()=>{await page.waitForSelector('dialog[open]');const count=await page.evaluate(()=>window.__devices.posts.length);await page.click('.store-device-dialog-actions .primary-button');await page.waitForFunction(n=>{const posts=window.__devices.posts;const card=document.querySelector('[data-device-key=\"'+posts.at(-1)?.device+'\"]');return posts.length>n&&!document.querySelector('dialog').open&&[...card.querySelectorAll('.store-device-help')].some(e=>e.textContent.includes('次の操作まで'));},{},count);};
 const lockButton=action=>card('lock')+` [data-device-action="${action}"]`;
 const refreshLock=async(lockState,readError=false)=>{
  await page.evaluate(({lockState,readError})=>{const d=window.__devices.view.devices[3];d.sample.lockState=lockState;d.readError=readError;},{lockState,readError});
  await page.click(card('lock')+' .store-device-refresh');
  await page.waitForFunction(()=>!document.querySelector('[data-device-kind="lock"] .store-device-refresh').disabled);
 };
 const assertLockActions=async(primary)=>{
  const buttons=await page.$$eval('[data-device-kind="lock"] [data-device-action]',nodes=>nodes.map(n=>({action:n.dataset.deviceAction,primary:n.classList.contains('primary-button'),disabled:n.disabled,background:getComputedStyle(n).backgroundColor,icon:Boolean(n.querySelector('svg'))})));
  assert.deepEqual(buttons.map(b=>b.action),['lock','unlock'],'unsupported latch action is absent');
  assert.deepEqual(buttons.filter(b=>b.primary).map(b=>b.action),primary?[primary]:[],'primary action follows the reported lock state');
  assert.ok(buttons.every(b=>!b.disabled&&b.icon),'both explicit actions remain available with distinct icons');
  if(primary)assert.notEqual(buttons[0].background,buttons[1].background,'known-state actions have visibly different backgrounds');
 };
 for(const width of [1440,768,360]){
  await page.setViewport({width,height:960});await open();await assertLockActions('unlock');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);await page.screenshot({path:resolve(output,`devices-ja-${width}.png`),fullPage:true});
  await (await page.$(card('lock'))).screenshot({path:resolve(output,`lock-locked-${width}.png`)});
  await refreshLock('unlocked');await assertLockActions('lock');await (await page.$(card('lock'))).screenshot({path:resolve(output,`lock-unlocked-${width}.png`)});
  assert.equal(await page.evaluate(()=>window.__devices.posts.length),0,'reading state never actuates a lock');
 }
 await refreshLock('unknown');await assertLockActions(null);
 await refreshLock('locked',true);await assertLockActions(null);
 await open();
 assert.match(await page.$eval(card('bot')+' .store-device-state',e=>e.textContent),/取得できません/);assert.equal(await page.$(card('remote')+' button'),null);
 const initialReads=await page.evaluate(()=>window.__devices.reads.length);await advance(300000);await page.evaluate(()=>{dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>window.__devices.reads.length),initialReads,'five idle minutes and focus produce no status reads');
 await page.click(control('indoorLight'));await page.waitForSelector('dialog[open]');assert.equal(await page.evaluate(()=>window.__devices.reads.length),initialReads+1,'fresh read before confirmation');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(await page.evaluate(()=>window.__devices.posts.length),0);
 await page.click(control('indoorLight'));await page.waitForSelector('dialog[open]');await page.screenshot({path:resolve(output,'devices-confirm-360.png'),fullPage:true});
 await page.evaluate(()=>{const b=document.querySelector('.store-device-dialog-actions .primary-button');b.click();b.click();});await page.waitForFunction(()=>window.__devices.posts.length===1&&!document.querySelector('dialog').open);
 assert.equal(await page.$eval(control('indoorLight'),e=>e.disabled),true);const beforeObserve=await page.evaluate(()=>window.__devices.reads.length);await advance(9000);assert.equal(await page.$eval(control('indoorLight'),e=>e.disabled),true);await advance(1000);assert.equal(await page.$eval(control('indoorLight'),e=>e.disabled),false,'next operation available at ten seconds');
 await advance(30000);assert.equal(await page.evaluate(()=>window.__devices.reads.length),beforeObserve+3,'at most three bounded post-command reads');await advance(300000);assert.equal(await page.evaluate(()=>window.__devices.reads.length),beforeObserve+3,'observations stop');assert.equal(await page.evaluate(()=>window.__devices.posts.length),1);
 await page.click(control('indoorLight'));await confirm();await page.evaluate(()=>window.__devices.view.devices[0].sample.lightLevel=2);const earlyReads=await page.evaluate(()=>window.__devices.reads.length);await advance(5000);assert.match(await page.$eval(card('indoorLight')+' .store-device-notice',e=>e.textContent),/確認しました/);await advance(30000);assert.equal(await page.evaluate(()=>window.__devices.reads.length),earlyReads+1,'observed change cancels remaining checks');
 await page.click(lockButton('unlock'));await page.waitForSelector('dialog[open]');assert.equal(await page.$eval('.store-device-dialog-actions .primary-button',e=>e.disabled),true);await page.screenshot({path:resolve(output,'devices-unlock-confirm-360.png'),fullPage:true});await page.click('dialog input[type=checkbox]');await confirm();assert.equal(await page.evaluate(()=>window.__devices.posts.at(-1).action),'unlock');
 assert.equal(await page.$(control('lock')),null,'pending lock observation does not highlight an assumed state');
 await page.click(card('shade')+' .store-device-actions button:nth-child(2)');await confirm();assert.equal(await page.evaluate(()=>window.__devices.posts.at(-1).position),100);await advance(10000);
 await page.$eval(card('shade')+' input[type=range]',input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'37');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.click(control('shade'));await confirm();assert.equal(await page.evaluate(()=>window.__devices.posts.at(-1).position),37);
 await open();await page.evaluate(()=>{window.__devices.alreadyInState=true;window.__devices.view.devices[3].sample.lockState='unlocked';});await page.click(lockButton('lock'));await confirm();assert.match(await page.$eval(card('lock')+' .store-device-state',e=>e.textContent),/施錠中/);const skipReads=await page.evaluate(()=>window.__devices.reads.length);await advance(40000);assert.equal(await page.evaluate(()=>window.__devices.reads.length),skipReads,'already desired state uses fresh server preflight without extra reads');
 await open();await page.evaluate(()=>window.__devices.failure=true);await page.click(control('indoorLight'));await page.waitForSelector(card('indoorLight')+' [role=alert]');assert.equal(await page.$('dialog[open]'),null);assert.equal(await page.evaluate(()=>window.__devices.posts.length),0,'offline preflight prevents send');
 await open();await page.evaluate(()=>window.__devices.deviceCode=190);await page.click(control('shade'));await confirm();assert.match(await page.$eval(card('shade')+' [role=alert]',e=>e.textContent),/190/);const rejectedReads=await page.evaluate(()=>window.__devices.reads.length);await advance(40000);assert.equal(await page.evaluate(()=>window.__devices.reads.length),rejectedReads,'device rejection does not schedule confirmations');await page.click('.store-devices-toolbar button');await page.waitForFunction(()=>!document.querySelector('.store-devices-toolbar button').disabled);assert.match(await page.$eval(card('shade')+' [role=alert]',e=>e.textContent),/190/,'persisted rejection code survives refresh');await page.screenshot({path:resolve(output,'devices-rejected-190-360.png'),fullPage:true});
 await open();await page.evaluate(()=>window.__devices.postFailure=true);await page.click(control('indoorLight'));await confirm();await page.waitForSelector(card('indoorLight')+' [role=alert]');await advance(120000);assert.equal(await page.evaluate(()=>window.__devices.posts.length),1,'ambiguous response never retries POST');await page.screenshot({path:resolve(output,'devices-uncertain-360.png'),fullPage:true});
 for(const language of ['zh-Hans','zh-Hant']){await open(language);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.$eval('.store-devices-panel',e=>/[ぁ-んァ-ヶ]/.test(e.textContent)),false,'all device copy translated');await page.screenshot({path:resolve(output,`devices-${language}-360.png`),fullPage:true});}
 await page.evaluate(()=>window.__devices.view.configured=false);await page.click('.store-devices-toolbar button');await page.waitForSelector('.store-device-empty');assert.equal(await page.$('.store-device-card'),null);
 assert.deepEqual(errors,[]);const report={passed:true,viewports:[1440,768,360],languages:['ja','zh-Hans','zh-Hant'],checks:['StrictMode','eight device cards','five minutes without polling','no focus polling','fresh preflight','cancel','double-click single POST','10-second cooldown','three bounded observations','early observation stop','unlock confirmation','unsupported latch hidden','lock action emphasis follows refreshed state','unknown and pending lock state stays neutral','explicit same-state action remains available','exact shade position','offline preflight','lost response no retry','legacy skipped command feedback','nested device rejection persists','translations','unconfigured store'],liveDeviceCommands:0};await writeFile(resolve(output,'ui-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
