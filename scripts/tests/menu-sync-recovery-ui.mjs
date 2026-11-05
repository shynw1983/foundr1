import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Actual React component and styles. Every API response is synthetic; no merchant
// or production requests are permitted by this fixture.
const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MenuSyncRecovery} from './app/os/menus/MenuSyncRecovery';import styles from './app/os/menus/UberSourcePanel.module.css';
function Fixture(){const [props,setProps]=useState({brandId:'brand-a',jobId:'job-a',language:'zh-Hans'});window.fixture={setProps};return <main style={{padding:16,maxWidth:1100,margin:'0 auto'}}><h1 style={{fontSize:18}}>菜单同步 · 本地验证</h1><p>原同步结果：失败（保持历史记录）</p><section className={styles.panel}><ul className={styles.jobs}><li><strong>Uber → OS</strong><small>同步成功</small></li><li><strong>Rocket Now</strong><MenuSyncRecovery {...props}/></li><li><strong>出前館</strong><small>等待中</small></li></ul></section></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/private/tmp/menu-sync-recovery-ui-build',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=(await readFile('app/globals.css','utf8'))+'\n'+bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer((request,response)=>{
  response.writeHead(200,{'Content-Type':request.url==='/fixture.js'?'text/javascript':request.url==='/fixture.css'?'text/css':'text/html; charset=utf-8'});
  response.end(request.url==='/fixture.js'?js:request.url==='/fixture.css'?css:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const now=()=>new Date().toISOString();
const native={name:'芝士玉米球 / チーズコーンボール',price:180,hidden:false,isAvailable:true,parentNames:['9月新品']};
const inspection=()=>({id:'inspection-1',at:now(),expiresAt:new Date(Date.now()+600000).toISOString(),native,hold:'unavailable',blockers:[]});
const view=(status='idle',extra={})=>({jobId:'job-a',platform:'rocket_now',supported:true,status,...extra});
const ready=(mode='restore_hidden')=>view('ready',{target:{name:native.name,kind:'option',parentName:'9月新品'},inspection:inspection(),plan:{mode,token:'NEVER_DOWNLOAD_THIS_TOKEN',expiresAt:new Date(Date.now()+600000).toISOString()}});
let scenario='flow',phase=0,requests=[],external=[];
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    try {
      const url=new URL(request.url());
      if(url.origin!==origin){external.push(request.url());await request.abort();return;}
      if(url.pathname!=='/api/menus/recovery'){await request.continue();return;}
      const body=request.postData()?JSON.parse(request.postData()):null;
      const jobId=body?.jobId??url.searchParams.get('jobId');
      requests.push({method:request.method(),body,jobId});
      let result;
      if(scenario==='flow') {
        if(body?.action==='inspect'){phase=1;result=view('checking');}
        else if(body?.action==='restore_hidden'){phase=3;result=view('repairing',{target:ready().target,inspection:inspection()});}
        else if(phase===1){phase=2;result=ready();}
        else if(phase===3){phase=4;result=view('verified',{target:ready().target,inspection:inspection(),continuation:{id:'next-job',status:'pending'}});}
        else if(phase===4)result=view('verified',{target:ready().target,inspection:inspection(),continuation:{id:'next-job',status:'succeeded'}});
        else result=view();
      } else if(scenario==='release'||scenario==='retry') {
        result=body?view('verified',{continuation:{id:'next-job',status:'pending'}}):ready(scenario==='release'?'verify_release':'retry');
        if(scenario==='release'&&result.inspection){result.inspection.hold='available';result.inspection.latestOperation={at:now(),isAvailable:true,status:'succeeded'};}
      } else if(scenario==='expired')result={...ready(),plan:{...ready().plan,expiresAt:new Date(Date.now()-1000).toISOString()}};
      else if(scenario==='continuation-blocked'||scenario==='continuation-unavailable')result=view('blocked',{code:'continuation_blocked',target:ready().target,inspection:{...inspection(),native:{...native,hidden:true,isAvailable:false}},continuation:{id:'job-a',status:'blocked',code:scenario==='continuation-unavailable'?'continuation_unavailable':'uber_publication_reconcile_active'}});
      else if(scenario==='unknown')result=view('unknown',{code:'result_unknown',target:{name:'芝士玉米球 9f51042f-2ddd-4c06-91fe-cc6b6c689368',kind:'option'}});
      else if(scenario==='unsupported')result=view('blocked',{supported:false,code:'bridge_update_required'});
      else if(scenario==='submit-error') {
        if(body){await request.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'result_unknown'})});return;}
        result=view();
      } else if(scenario==='poll-error') {
        if(phase++===0)result=view('checking');
        else {await request.respond({status:503,contentType:'application/json',body:'{"error":"result_unknown"}'});return;}
      } else if(scenario==='stale') {
        if(jobId==='job-a'){await new Promise(resolve=>setTimeout(resolve,250));result={...ready(),target:{name:'旧店舗の商品',kind:'item'}};}
        else result={...view(),jobId};
      }
      await request.respond({status:200,contentType:'application/json',body:JSON.stringify(result)});
    } catch(error) {if(!/handled|closed|detached|interception/.test(String(error)))errors.push(String(error));}
  });
  const text=()=>page.evaluate(()=>document.body.innerText);
  const waitText=value=>page.waitForFunction(value=>document.body.innerText.includes(value),{timeout:15000},value);
  const button=async value=>{
    const elements=await page.$$('button');
    for(const element of elements)if((await element.evaluate(node=>node.innerText)).includes(value)){await element.click();return;}
    throw new Error(`Missing button: ${value}`);
  };
  const load=async next=>{scenario=next;phase=0;requests=[];await page.goto(origin);await page.waitForSelector('[data-menu-recovery]');};
  await load('flow');
  await button('检查并处理');await waitText('正在检查平台现状');
  await waitText('检查完成，可以处理');
  assert.match(await text(),/芝士玉米球/);assert.match(await text(),/9月新品/);
  assert.equal(requests.filter(row=>row.body?.action==='inspect').length,1);
  await button('恢复非公开并继续');
  assert.equal(requests.filter(row=>row.body?.action==='restore_hidden').length,0);
  await waitText('确认将“芝士玉米球');
  await button('确认恢复此商品为非公开');await waitText('正在处理并回读保存结果');
  await waitText('此对象已完成核对处理');await waitText('新同步已验证完成');
  assert.match(await text(),/原同步结果：失败/);
  assert.equal(requests.filter(row=>row.body?.action==='restore_hidden').length,1);
  assert.equal(requests.find(row=>row.body?.action==='restore_hidden').body.token,'NEVER_DOWNLOAD_THIS_TOKEN');
  results.push('inspect → plan → explicit hide confirmation → readback → separate continuation success');

  await load('release');await waitText('按最近上架记录验收并继续');
  assert.match(await text(),/上架/);assert.match(await text(),/保留当前销售状态/);
  await button('按最近上架记录验收并继续');await waitText('此对象已完成核对处理');
  assert.equal(requests.filter(row=>row.body?.action==='verify_release').length,1);
  assert.doesNotMatch(await text(),/确认将/);
  results.push('verified release uses latest inventory intent without an availability mutation confirmation');

  await load('retry');await waitText('重试此平台');await button('重试此平台');await waitText('此对象已完成核对处理');
  assert.equal(requests.filter(row=>row.body?.action==='retry').length,1);results.push('retry plan submits once');

  await load('expired');await waitText('检查结果已过期');
  assert.doesNotMatch(await text(),/恢复非公开并继续/);results.push('expired plan cannot execute');

  await load('unknown');await waitText('结果尚未确认');
  assert.doesNotMatch(await text(),/9f51042f-2ddd/);
  await load('unsupported');await waitText('需要更新 Mac Bridge');
  assert.equal(await page.$$eval('button',nodes=>nodes.some(node=>node.innerText==='检查并处理')),false);results.push('unknown and unsupported guidance stays actionable and avoids UUID labels');

  await load('release');await waitText('按最近上架记录验收并继续');
  await page.evaluate(()=>{const create=URL.createObjectURL;URL.createObjectURL=blob=>{window.__diagnostic=blob;return create(blob);};});
  await button('下载诊断信息');
  const diagnostic=await page.evaluate(()=>window.__diagnostic.text());
  assert.doesNotMatch(diagnostic,/NEVER_DOWNLOAD_THIS_TOKEN|"token"/);assert.match(diagnostic,/inspection-1/);
  results.push('downloaded diagnostics omit mutation token');

  await load('continuation-blocked');await waitText('处理结果已确认，后续同步尚未排队');
  assert.match(await text(),/此对象的处理结果已回读确认/);assert.match(await text(),/其他同步任务仍在处理中/);assert.match(await text(),/尚未排队，需要重新检查/);
  assert.doesNotMatch(await text(),/新同步已验证完成|已排队／处理中/);
  assert.equal(await page.$$eval('button',nodes=>nodes.some(node=>node.innerText==='重新检查'&&!node.disabled)),true);
  await button('更新处理状态');assert.equal(requests.filter(row=>row.method==='POST').length,0);
  results.push('verified native repair with blocked continuation shows reason, refresh and reinspection without success echo');
  await load('continuation-unavailable');await waitText('后续同步的排队处理尚未完成');
  assert.match(await text(),/此对象的处理结果已回读确认/);assert.doesNotMatch(await text(),/新同步已验证完成/);
  results.push('continuation service failure preserves confirmed repair and explains incomplete queue');

  await load('submit-error');await button('检查并处理');await waitText('提交结果尚未确认');
  assert.equal(requests.filter(row=>row.method==='POST').length,1);
  await new Promise(resolve=>setTimeout(resolve,3500));
  assert.equal(requests.filter(row=>row.method==='POST').length,1);
  assert.equal(await page.$$eval('button',nodes=>nodes.find(node=>node.innerText==='检查并处理')?.disabled),true);
  await button('更新处理状态');await page.waitForFunction(()=>!document.body.innerText.includes('提交结果尚未确认'));
  results.push('uncertain POST result requires GET refresh and is never replayed');

  await load('poll-error');await waitText('自动检查已暂停');
  const readCount=requests.length;await new Promise(resolve=>setTimeout(resolve,3500));assert.equal(requests.length,readCount);
  results.push('polling stops after three consecutive errors');

  await load('stale');await page.evaluate(()=>window.fixture.setProps({brandId:'brand-b',jobId:'job-b',language:'zh-Hans'}));
  await new Promise(resolve=>setTimeout(resolve,800));assert.doesNotMatch(await text(),/旧店舗の商品/);
  assert.equal(await page.$eval('[data-menu-recovery]',node=>node.dataset.state),'idle');
  results.push('late responses from previous brand/job do not replace current view');

  await load('release');await waitText('按最近上架记录验收并继续');
  await mkdir('/private/tmp/foundr1-menu-sync-recovery-ui',{recursive:true});
  for(const width of [390,768,1440]) {
    await page.setViewport({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`);
    await page.screenshot({path:`/private/tmp/foundr1-menu-sync-recovery-ui/${width}.png`,fullPage:true});
  }
  await page.evaluate(()=>window.fixture.setProps({brandId:'brand-a',jobId:'job-a',language:'ja'}));await waitText('販売操作を確認して続ける');
  await page.evaluate(()=>window.fixture.setProps({brandId:'brand-a',jobId:'job-a',language:'zh-Hant'}));await waitText('按最近上架記錄驗收並繼續');
  results.push('mobile 390 / tablet 768 / desktop 1440 and ja / zh-Hans / zh-Hant');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:results.length,results,screenshots:'/private/tmp/foundr1-menu-sync-recovery-ui'},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
