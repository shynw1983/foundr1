import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Isolated, synthetic progress states: no merchant requests or production writes.
const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MenuJobProgress} from './app/os/menus/MenuJobProgress';import styles from './app/os/menus/UberSourcePanel.module.css';
const now=Date.now();createRoot(document.getElementById('root')).render(<section className={styles.panel}><ul className={styles.jobs}>{['zh-Hans','ja','zh-Hant'].map((language,i)=><li key={language}><strong>出前館</strong><MenuJobProgress language={language} updatedAt={new Date(now).toISOString()} progress={{targetName:'芝士玉米球 / チーズコーンボール',completed:34,total:280,startedAt:now-1000000,updatedAt:now-(i===2?70000:0),action:'read_options',requestState:i===1?'retrying':'waiting',retry:i===1?1:0,lastResponseAt:now-12000,requestsCompleted:431,recent:[{at:now-12000,action:'read_options',targetName:'芝士玉米球'}]}}/></li>)}</ul></section>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/private/tmp/menu-progress-build',jsx:'automatic'});
const css=await readFile('app/globals.css','utf8');
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(`<html><head><style>${css}</style><style>${result.outputFiles.find(f=>f.path.endsWith('.css')).text}</style></head><body><main id="root" style="padding:16px"></main></body></html>`);
 await page.addScriptTag({content:result.outputFiles.find(f=>f.path.endsWith('.js')).text});
 await page.waitForSelector('progress');
 for(const width of [390,768,1440]) {
  await page.setViewport({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`);
  await page.screenshot({path:`/private/tmp/foundr1-menu-progress-${width}.png`,fullPage:true});
 }
 await page.click('summary');assert.equal(await page.$eval('details',e=>e.open),true);
 assert.equal(await page.$$eval('progress',rows=>rows.every(e=>e.value===34&&e.max===280)),true);
 assert.deepEqual(errors,[]);console.log('Progress UI: mobile, tablet, desktop, disclosure and console passed');
}finally{await browser.close();}
