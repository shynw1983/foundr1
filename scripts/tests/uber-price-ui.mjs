// Isolated UI fixture: no live store requests or writes.
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UberSourcePanel} from './app/os/menus/UberSourcePanel';createRoot(document.getElementById('root')).render(<UberSourcePanel brandId="test"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'/tmp/price-ui.js',jsx:'automatic',plugins:[{name:'translation',setup(b){b.onLoad({filter:/OsTranslationProvider\.tsx$/},()=>({contents:'export function useOsTranslation(){return {language:"ja",t:s=>s}}',loader:'js'}));}}]});
const data={source:{store_id:'test',enabled:true,auto_publish:true,revision:18,last_checked_at:'2026-09-13T01:00:00Z',last_error:''},runs:[],jobs:[],jobHistory:[],successes:[],devices:[],nextCheck:'2026-09-14T03:00:00Z',prices:[]};
const css=await readFile('app/globals.css','utf8');
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  for(const width of [375,768,1440]) {
    const page=await browser.newPage();
    await page.setViewport({width,height:900});
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text||''}</style><main style="padding:16px"><div id="root"></div></main>`);
    await page.evaluate(d=>{window.fetch=async()=>({ok:true,json:async()=>d});},data);
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
    await page.waitForFunction(()=>document.body.textContent.includes('価格は Uber と統一'));
    await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=true;}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.evaluate(()=>document.querySelectorAll('input[type="number"]').length),0);
    await page.screenshot({path:`/tmp/foundr1-price-${width}.png`,fullPage:true});
    console.log(`PASS ${width}px: unified price rule, no separate price editor, no overflow`);
    await page.close();
  }
} finally {await browser.close();}
