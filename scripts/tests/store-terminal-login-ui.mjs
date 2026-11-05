// Actual approval/login components and translations with local synthetic API responses.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(process.env.FOUNDR1_TEST_REQUIRE_FROM || import.meta.url);
const { build } = require('esbuild');
const puppeteer = require('puppeteer-core');
const root = resolve(process.env.FOUNDR1_UI_SOURCE_ROOT || process.cwd());
const output = resolve(process.env.FOUNDR1_UI_OUTPUT || 'outputs/store-terminal-login-20261029');
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react';import{createRoot}from'react-dom/client';
  import{StoreTerminalLoginApproval}from'./app/os/store-terminal-login/StoreTerminalLoginApproval';
  import{StaffLoginPage}from'./components/auth/StaffLoginPage';
  import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
  localStorage.setItem('foundr1-os-language-preference','manual');
  localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');
  createRoot(document.getElementById('root')).render(<OsTranslationProvider>{location.pathname==='/store/login'?<StaffLoginPage surface="store"/>:<StoreTerminalLoginApproval token="fixture-qr"/>}</OsTranslationProvider>);
` }, bundle: true, write: false, outfile: 'fixture.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = await readFile(resolve(root,'app/globals.css'), 'utf8');
const stores = [
  { id: 'store-a', name: '桜並木店', terminalAccounts: [{ id: 'register-a', name: 'レジ 1', loginId: 'sakura-register-1' }, { id: 'kitchen-a', name: '厨房 2', loginId: 'sakura-kitchen-2' }] },
  { id: 'store-b', name: 'とても長い名前の店舗・設備アカウント検証用店舗', terminalAccounts: [{ id: 'pickup-b', name: '受取口 1', loginId: 'long-store-name-pickup-display-account-1' }] },
  { id: 'store-empty', name: '端末未登録の店舗', terminalAccounts: [] }
];
let scenario = 'normal', failPost = false, posts = [];
const server = createServer(async (request,response) => {
  const url = new URL(request.url,'http://fixture');
  const send = (body,status=200) => {response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(body));};
  if(url.pathname==='/fixture.js'){response.writeHead(200,{'Content-Type':'text/javascript'});return response.end(bundle.outputFiles[0].text);}
  if(url.pathname==='/fixture.css'){response.writeHead(200,{'Content-Type':'text/css'});return response.end(css);}
  if(url.pathname.startsWith('/locales/os/')){response.writeHead(200,{'Content-Type':'application/json'});return response.end(await readFile(resolve(root,'public',url.pathname.slice(1))));}
  if(url.pathname==='/api/auth/me')return send({error:'ログインしてください。'},401);
  if(url.pathname==='/api/store/terminal-login/request')return send({token:'fixture-qr',qrCodeDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT6sAAAAASUVORK5CYII=',expiresAt:new Date(Date.now()+300000).toISOString()});
  if(url.pathname==='/api/store/terminal-login/status')return send({status:'pending'});
  if(url.pathname==='/api/store/terminal-login/approve'){
    if(request.method==='POST'){
      let raw='';for await(const chunk of request)raw+=chunk;posts.push(JSON.parse(raw));
      await new Promise(resolve=>setTimeout(resolve,150));
      if(failPost)return send({error:'選択した店舗の端末アカウントを選択してください。'},400);
      const selected=stores.find(s=>s.id===posts.at(-1).storeId),terminal=selected.terminalAccounts.find(t=>t.id===posts.at(-1).terminalEmployeeId);
      return send({ok:true,storeName:selected.name,terminalName:terminal.name});
    }
    if(scenario==='network')return request.socket.destroy();
    if(scenario==='unauthorized')return send({error:'ログインしてください。'},401);
    if(scenario==='forbidden')return send({error:'店舗端末ログインを承認する権限がありません。'},403);
    if(scenario==='expired')return send({error:'QRコードの有効期限が切れたか、すでに使用されています。'},400);
    return send({stores:scenario==='empty'?[]:scenario==='single'?[stores[0]]:stores});
  }
  if(url.pathname.startsWith('/icons/')){response.writeHead(204);return response.end();}
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
let browser;
if (process.argv.includes('--serve')) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  console.log(`UI fixture ready: http://127.0.0.1:${server.address().port}`);
  await new Promise(() => {});
}
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--no-first-run']});
  const page=await browser.newPage(),errors=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  let abortPost=false;
  page.on('request',request=>{
    if(abortPost&&request.method()==='POST'&&request.url().includes('/terminal-login/approve'))return request.abort();
    return new URL(request.url()).origin===base?request.continue():request.abort();
  });
  const open=async(lang='ja')=>{await page.goto(base+'/?lang='+lang,{waitUntil:'networkidle0'});await page.waitForSelector('select[name=storeId]');};
  for(const [width,lang] of [[390,'ja'],[800,'zh-Hans'],[1440,'zh-Hant']]){
    await page.setViewport({width,height:950});await open(lang);
    assert.equal(await page.$eval('select[name=storeId]',e=>e.value),'');
    assert.equal(await page.$eval('select[name=terminalEmployeeId]',e=>e.disabled),true);
    assert.equal(await page.$eval('button.primary-button',e=>e.disabled),true);
    await page.select('select[name=storeId]','store-b');
    assert.equal(await page.$eval('select[name=terminalEmployeeId]',e=>e.value),'');
    assert.equal(await page.$eval('button.primary-button',e=>e.disabled),true);
    await page.select('select[name=terminalEmployeeId]','pickup-b');
    assert.equal(await page.$eval('button.primary-button',e=>e.disabled),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`overflow ${width}`);
    if(lang==='zh-Hans')assert.equal(await page.$eval('h1',e=>e.textContent),'店铺设备登录授权');
    if(lang==='zh-Hant')assert.equal(await page.$eval('h1',e=>e.textContent),'店舖設備登入授權');
    await page.screenshot({path:resolve(output,`approval-${width}-${lang}.png`),fullPage:true});
    await page.select('select[name=storeId]','store-empty');
    assert.equal(await page.$eval('select[name=terminalEmployeeId]',e=>e.disabled),true);
    assert.equal(await page.$eval('select[name=terminalEmployeeId]',e=>e.value),'');
    assert.equal(await page.$eval('button.primary-button',e=>e.disabled),true);
    const emptyNotice = lang==='ja' ? 'この店舗には有効な端末アカウントがありません。' : lang==='zh-Hant' ? '這家店舖尚無可用的設備帳號' : '这家店铺尚无可用的设备账号';
    await page.waitForFunction(text=>document.querySelector('[role=status]')?.textContent.includes(text),{},emptyNotice);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`empty-store overflow ${width}`);
    await page.screenshot({path:resolve(output,`empty-store-${width}-${lang}.png`),fullPage:true});
    checks.push(`explicit choice, long account name, language and layout at ${width}/${lang}`);
  }
  await open();await page.select('select[name=storeId]','store-a');await page.select('select[name=terminalEmployeeId]','kitchen-a');
  await page.select('select[name=storeId]','store-b');
  assert.equal(await page.$eval('select[name=terminalEmployeeId]',e=>e.value),'');
  await page.select('select[name=storeId]','store-a');await page.select('select[name=terminalEmployeeId]','kitchen-a');
  abortPost=true;await page.click('button.primary-button');await page.waitForSelector('[role=alert]');
  assert.equal(await page.$eval('select[name=terminalEmployeeId]',e=>e.value),'kitchen-a');
  assert.equal(await page.$eval('button.primary-button',e=>e.disabled),false);
  abortPost=false;failPost=true;await page.click('button.primary-button');
  await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('選択した店舗'));
  assert.equal(await page.$eval('select[name=terminalEmployeeId]',e=>e.value),'kitchen-a');
  failPost=false;await page.click('button.primary-button');
  await page.waitForFunction(()=>document.querySelector('select[name=storeId]')?.disabled);
  await page.waitForSelector('[role=status]');
  assert.deepEqual(posts.at(-1),{token:'fixture-qr',storeId:'store-a',terminalEmployeeId:'kitchen-a'});
  assert.equal(await page.$eval('[role=status]',e=>e.textContent),'桜並木店 / 厨房 2');
  assert.equal(await page.$('button.primary-button'),null);
  checks.push('changing stores clears selection; network/server failure allows retry; exact chosen account submitted once per click; success identifies account');
  for(const value of ['unauthorized','forbidden','expired','network']){
    scenario=value;await page.goto(base,{waitUntil:'networkidle0'});await page.waitForSelector('[role=alert]');
    assert.equal(await page.$('select[name=storeId]'),null);
    assert.equal(Boolean(await page.$('a.terminal-approval-login-link')),value==='unauthorized');
  }
  scenario='empty';await open();assert.equal(await page.$eval('button.primary-button',e=>e.disabled),true);
  scenario='single';await open();assert.equal(await page.$eval('select[name=storeId]',e=>e.value),'store-a');
  assert.equal(await page.$eval('select[name=terminalEmployeeId]',e=>e.value),'');
  checks.push('unauthenticated, forbidden, expired, network failure, empty account list and single-store states');
  await page.setViewport({width:390,height:844});await page.goto(base+'/store/login?lang=zh-Hans',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>document.body.textContent.includes('请管理员用手机扫码，选择已建立的店铺设备账号。'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'verification.json'),JSON.stringify({passed:true,checks,errors},null,2));
  console.log('PASS: '+checks.join('; '));
} finally {
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
