import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {InventoryReadProgress} from './app/store/menu/InventoryReadProgress';import {InventoryComparisonPreview} from './app/store/menu/InventoryComparisonPreview';
const rows=Array.from({length:38},(_,i)=>({kind:'option',targetId:String(i),label:'未上架配料 '+i,isAvailable:true,changes:i<3?['rocket_now']:[],cells:{uber_eats:{state:'available'},foundr1:{state:'available'},demae_can:{state:'staged'},rocket_now:{state:i<3?'sold_out':'available'}}}));
createRoot(document.getElementById('root')).render(<><InventoryReadProgress language="zh-Hans" reads={[{id:'d',platform:'demae_can',status:'succeeded',count:236}]} counts={{demae_can:3}} stagedByPlatform={{demae_can:38}} confirmedByPlatform={{demae_can:198}} unknownByPlatform={{}} onRetry={()=>{}} disabled={false}/><InventoryComparisonPreview language="zh-Hans" comparison={{rows,platforms:['demae_can','rocket_now'],counts:{foundr1:0,demae_can:0,rocket_now:3},unknown:0,pending:false,ready:true}}/></>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic'});
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(`<html><head><style>${await readFile('app/globals.css','utf8')}</style></head><body><main id="root" class="panel inventory-calibration-panel" style="padding:16px"></main></body></html>`);
 await page.addScriptTag({content:result.outputFiles[0].text});await page.waitForSelector('select');
 assert.ok((await page.$eval('body',e=>e.innerText)).includes('198 项销售状态已确认'));
 assert.equal(await page.$$('.inventory-comparison-row').then(r=>r.length),3);
 for(const width of [390,768,1440]) {
  await page.setViewport({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);
  await page.screenshot({path:`/private/tmp/foundr1-inventory-staging-${width}.png`,fullPage:true});
 }
 await page.select('select','staged');
 await page.waitForFunction(()=>document.querySelectorAll('.inventory-comparison-row').length===38);
 assert.ok(await page.$$eval('.inventory-comparison-cell .is-neutral',rows=>rows.length===38&&rows.every(r=>r.textContent.includes('已同步・未上架')&&!r.textContent.includes('?'))));
 await page.select('select','unknown');await page.waitForFunction(()=>!document.querySelector('.inventory-comparison-row'));
 assert.deepEqual(errors,[]);console.log('PASS: 198 confirmed / 38 staged; filters; neutral tags; 390/768/1440 layout; no console errors');
}finally{await browser.close();}
