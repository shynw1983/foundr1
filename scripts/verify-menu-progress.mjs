import {build} from 'esbuild';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const {default: puppeteer} = await import(process.env.MENU_PROGRESS_PUPPETEER_MODULE || 'puppeteer-core');

// Actual component and public progress projection; synthetic telemetry only.
// No database, merchant requests, or production writes.
const output = process.env.MENU_PROGRESS_OUTPUT || '/private/tmp/foundr1-menu-progress';
await mkdir(output, {recursive: true});
const result = await build({stdin: {contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MenuJobProgress} from './app/os/menus/MenuJobProgress';import {projectMenuSyncProgress} from './lib/menu-sync-progress';import styles from './app/os/menus/UberSourcePanel.module.css';
const now=Date.now(),root=createRoot(document.getElementById('root'));
const targets={a:{targetName:'チーズコーンボール｜芝士玉米球｜치즈 옥수수볼｜Cheese Corn Ball',targetKind:'option',parentName:'十月新品'},b:{targetName:'牛すじ50g',targetKind:'option',parentName:'肉類'}};
const sample={sourceKey:'a',completed:34,total:280,phase:'relationships',startedAt:now-1000000,updatedAt:now,action:'read_item',requestState:'waiting',lastResponseAt:now-12000,requestsCompleted:431,recent:[
{at:now-12000,sourceKey:'a',phase:'relationships',action:'read_item',occurrences:3},
{at:now-13000,sourceKey:'b',phase:'verifying',action:'read_availability'},
{at:now-14000,targetName:'麺類',targetKind:'category',phase:'relationships',action:'read_category'},
{at:now-15000,targetName:'薬膳',targetKind:'option_group',phase:'content',action:'read_options'}]};
window.renderProgress=(override={})=>root.render(<section className={styles.panel}><ul className={styles.jobs}>{['zh-Hans','ja','zh-Hant','en'].map((language,i)=><li key={language} data-language={language}><strong>{override.platform||'Rocket Now'}</strong><MenuJobProgress language={language} updatedAt={new Date(now).toISOString()} progress={projectMenuSyncProgress({...sample,...override,...(i===1?{requestState:'retrying',retry:1}:i===2?{updatedAt:now-70000}:{})},targets)}/></li>)}</ul></section>);
window.renderProgress();`, resolveDir: process.cwd(), loader: 'tsx'}, bundle: true, write: false, outdir: '/virtual/menu-progress', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}});
const css = await readFile('app/globals.css', 'utf8');
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true, timeout: 60000, args: ['--disable-gpu']});
let page;
const errors = [], checks = [];
try {
  page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>${result.outputFiles.find(file => file.path.endsWith('.css')).text}</style></head><body><main id="root" style="padding:16px"></main></body></html>`);
  await page.addScriptTag({content: result.outputFiles.find(file => file.path.endsWith('.js')).text});
  await page.waitForSelector('progress');
  const chinese = '[data-language="zh-Hans"]';
  assert.match(await page.$eval(`${chinese} [data-menu-progress-target]`, element => element.textContent), /当前处理对象 · 选项.*芝士玉米球.*所属：十月新品/);
  assert.match(await page.$eval(chinese, element => element.textContent), /读取商品详情/);
  assert.match(await page.$eval(chinese, element => element.textContent), /本阶段已核对／处理对象：34 \/ 280/);
  assert.doesNotMatch(await page.$eval(chinese, element => element.textContent), /写入.*34|保存.*34|已完成对象/);
  assert.match(await page.$eval(chinese, element => element.textContent), /431 次请求响应/);
  assert.equal(await page.$$eval('progress', elements => elements.every(element => element.value === 34 && element.max === 280)), true);
  checks.push('exact target name, kind, parent, request action and independent stage/response counts');
  assert.equal(await page.$eval(`${chinese} ol`, element => element.children.length), 3);
  assert.match(await page.$eval(`${chinese} ol`, element => element.textContent), /收到响应 × 3/);
  assert.match(await page.$eval(`${chinese} ol`, element => element.textContent), /牛すじ50g/);
  assert.match(await page.$eval(`${chinese} ol`, element => element.textContent), /读取分类/);
  assert.equal(await page.$eval(`${chinese} details`, element => element.open), false);
  await page.click(`${chinese} summary`);
  assert.equal(await page.$eval(`${chinese} details`, element => element.open), true);
  assert.match(await page.$eval(`${chinese} details`, element => element.textContent), /薬膳/);
  checks.push('three recent objects visible by default, repeated response count and older disclosure');
  assert.match(await page.$eval('[data-language="ja"]', element => element.textContent), /読み取りを再試行中/);
  assert.match(await page.$eval('[data-language="zh-Hant"]', element => element.textContent), /進度暫未更新/);
  assert.match(await page.$eval('[data-language="en"]', element => element.textContent), /Current object · Option/);
  assert.match(await page.$eval('[data-language="en"]', element => element.textContent), /Reading product details/);
  checks.push('Japanese, Simplified Chinese, Traditional Chinese and English; waiting, retry and stale states');
  await page.evaluate(() => window.renderProgress({
    telemetryVersion:2,phase:'content',completed:0,total:1,
    checkedTargets:323,totalTargets:323,skippedTargets:322,contentChanges:1,contentCompleted:0,
    readRequestsCompleted:55,writeRequestsCompleted:0
  }));
  await page.waitForFunction(() => document.querySelector('[data-language="zh-Hans"] [data-menu-progress-content]')?.textContent.includes('0 / 1'));
  assert.match(await page.$eval(chinese, element => element.textContent), /已核对差异：323 \/ 323/);
  assert.match(await page.$eval(chinese, element => element.textContent), /内容无变化跳过：322/);
  assert.match(await page.$eval(chinese, element => element.textContent), /内容差异处理：0 \/ 1 · 待处理 1/);
  assert.match(await page.$eval(`${chinese} [data-menu-progress-requests]`, element => element.textContent), /读取响应：55 · 保存响应：0/);
  assert.doesNotMatch(await page.$eval(chinese, element => element.textContent), /431 次请求响应|本阶段已核对／处理对象|同步成功|已全部验证/);
  assert.match(await page.$eval('[data-language="ja"]', element => element.textContent), /差分確認済み：323 \/ 323.*内容変更不要・スキップ：322.*内容差分の処理：0 \/ 1 · 残り 1.*読み取り応答：55 · 保存応答：0/);
  assert.match(await page.$eval('[data-language="zh-Hant"]', element => element.textContent), /已核對差異：323 \/ 323.*內容無變化跳過：322.*內容差異處理：0 \/ 1 · 待處理 1.*讀取回應：55 · 儲存回應：0/);
  assert.match(await page.$eval('[data-language="en"]', element => element.textContent), /Checked for differences：323 \/ 323.*Unchanged content skipped：322.*Content differences processed：0 \/ 1 · Remaining 1.*Read responses：55 · Save responses：0/);
  assert.equal(await page.$$eval('progress', elements => elements.every(element => element.value === 0 && element.max === 1)), true);
  checks.push('version 2 separates all checked objects, skipped content, one pending difference and native read/save response counts in all four languages');
  for (const width of [390, 768, 1440]) {
    await page.setViewport({width, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
    await page.screenshot({path: `${output}/progress-${width}.png`, fullPage: true});
  }
  checks.push('390/768/1440px layouts without horizontal overflow');
  await page.evaluate(() => window.renderProgress({
    platform:'出前館',telemetryVersion:2,phase:'relationships',completed:2,total:9,
    checkedTargets:323,totalTargets:323,skippedTargets:322,contentChanges:1,contentCompleted:1,
    readRequestsCompleted:57,writeRequestsCompleted:2
  }));
  await page.waitForFunction(() => document.querySelector('[data-language="zh-Hans"] [data-menu-progress-content]')?.textContent.includes('1 / 1'));
  assert.match(await page.$eval(chinese, element => element.textContent), /出前館.*内容差异处理：1 \/ 1 · 待处理 0.*本阶段已核对／处理对象：2 \/ 9.*保存响应：2/);
  assert.doesNotMatch(await page.$eval(chinese, element => element.textContent), /同步成功|已全部验证/);
  checks.push('completed content differences stay separate from relationship work and multiple save responses on Demae; no full-publication success claim');
  await page.evaluate(() => window.renderProgress({
    telemetryVersion:2,phase:'content',completed:0,total:0,
    checkedTargets:323,totalTargets:323,skippedTargets:323,contentChanges:0,contentCompleted:0,
    readRequestsCompleted:55,writeRequestsCompleted:0
  }));
  await page.waitForFunction(() => document.querySelector('[data-language="zh-Hans"] [data-menu-progress-content]')?.textContent.includes('0 / 0'));
  assert.match(await page.$eval(chinese, element => element.textContent), /内容无变化跳过：323.*内容差异处理：0 \/ 0 · 待处理 0.*保存响应：0/);
  assert.equal(await page.$$eval('progress', elements => elements.length), 0);
  checks.push('zero differences shows zero pending work and zero save responses without an invalid progress bar');
  await page.evaluate(() => window.renderProgress({sourceKey:'b',targetName:undefined,targetKind:undefined,parentName:undefined,action:'save',updatedAt:Date.now()}));
  await page.waitForFunction(() => document.querySelector('[data-language="zh-Hans"] [data-menu-progress-target]')?.textContent.includes('牛すじ50g'));
  assert.doesNotMatch(await page.$eval(`${chinese} [data-menu-progress-target]`, element => element.textContent), /芝士玉米球|十月新品/);
  checks.push('polling replaces current object and parent without retaining previous target');
  await page.evaluate(() => window.renderProgress({sourceKey:undefined,targetName:undefined,targetKind:undefined,parentName:undefined,action:'read_menu',recent:[],updatedAt:Date.now()}));
  await page.waitForFunction(() => document.querySelector('[data-language="zh-Hans"] [data-menu-progress-target]')?.textContent.includes('平台菜单（整体处理）'));
  assert.doesNotMatch(await page.$eval(`${chinese} [data-menu-progress-target]`, element => element.textContent), /牛すじ50g|芝士玉米球|十月新品/);
  checks.push('global reads show menu scope without borrowing a product name');
  await page.evaluate(() => window.renderProgress({sourceKey:undefined,startedAt:undefined,action:undefined,recent:[]}));
  await page.waitForFunction(() => document.querySelector('[data-language="zh-Hans"] [data-menu-progress-target]')?.textContent.includes('等待 Bridge 上报具体对象'));
  checks.push('older Bridge telemetry shows pending object details explicitly');
  const panelBundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UberSourcePanel} from './app/os/menus/UberSourcePanel';
const root=createRoot(document.getElementById('root')),at=new Date().toISOString();
const data={source:{enabled:true,auto_publish:true,revision:52,last_checked_at:at,last_error:''},runs:[],jobHistory:[],successes:[],devices:[{platform:'desktop',last_seen_at:at}],nextCheck:at,prices:[],jobs:[
{id:'rocket',platform:'rocket_now',status:'processing',phase:'content',updated_at:at,last_error:'',revision:'52',attempts:0,available_at:at,progress:{telemetryVersion:2}},
{id:'demae',platform:'demae_can',status:'processing',phase:'content',updated_at:at,last_error:'',revision:'52',attempts:0,available_at:at,progress:{completed:151,total:323}}]};
window.fetch=async()=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
window.renderPanel=language=>{window.fixtureLanguage=language;root.render(<UberSourcePanel key={language} brandId="local-only"/>)};
window.renderPanel('zh-Hans');`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/virtual/menu-panel-progress',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'local-panel-language',setup(build){build.onLoad({filter:/OsTranslationProvider\.tsx$/},()=>({contents:'export function useOsTranslation(){return {language:window.fixtureLanguage,t:value=>value}}',loader:'js'}));}}]});
  await page.close();
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<html><head><style>${css}</style><style>${panelBundle.outputFiles.find(file=>file.path.endsWith('.css')).text}</style></head><body><div id="root"></div></body></html>`);
  await page.addScriptTag({content:panelBundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  for(const [language,delta,legacy] of [
    ['zh-Hans','正在处理内容差异','正在核对并处理内容'],
    ['ja','内容の差分を処理中','内容を確認・処理中'],
    ['zh-Hant','正在處理內容差異','正在核對並處理內容']
  ]) {
    await page.evaluate(language=>window.renderPanel(language),language);
    await page.waitForFunction(expected=>document.querySelector('#uber-menu-sync')?.textContent.includes(expected),{},delta);
    const badges=await page.$$eval('#uber-menu-sync [data-state="processing"]',rows=>rows.map(row=>row.firstElementChild.textContent));
    assert.deepEqual(badges,[`Rocket Now${delta}`,`出前館${legacy}`]);
  }
  checks.push('actual parent panel badges distinguish delta-only content work from legacy checking/processing in Japanese and both Chinese languages');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({passed: true, scope: 'Actual component and projection with synthetic telemetry; no live writes', checks, errors}, null, 2) + '\n');
  console.log(`PASS menu progress UI: ${checks.join('; ')}`);
} catch (error) {
  if (page) await page.screenshot({path: `${output}/failure.png`, fullPage: true}).catch(() => {});
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({passed: false, checks, errors, error: error.stack}, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
}
