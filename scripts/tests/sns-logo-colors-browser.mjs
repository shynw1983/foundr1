import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const evidence='/tmp/sns-colors-evidence';const base=process.env.SNS_BASE||'http://localhost:3140';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--no-default-browser-check']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const logos=Object.fromEntries(await Promise.all(['black','white'].map(async color=>[color,await fs.readFile(`assets/sns/maamaa-complete-logo-${color}.png`)])));
const payload=Buffer.from(JSON.stringify({role:'owner',sessionId:'00000000-0000-4000-8000-000000000001',expiresAt:Date.now()+3600000})).toString('base64url');
const signature=crypto.createHmac('sha256','postgresql://local:local@localhost:5432/local').update(payload).digest('base64url');
await page.setCookie({name:'foundr1_os_session',value:payload+'.'+signature,url:base});
await page.setRequestInterception(true);
page.on('request',r=>{
 const u=new URL(r.url());
 if(u.pathname==='/api/sns')return void r.respond(u.searchParams.has('asset')?{status:200,contentType:'image/png',body:logos[u.searchParams.get('color')||'black']}:{status:200,contentType:'application/json',body:JSON.stringify({stores:[{id:'test-maamaa',name:'まぁ麻 · テスト店舗'}],canManage:true})});
 if(u.pathname.startsWith('/api/'))return void r.respond({status:200,contentType:'application/json',body:JSON.stringify({employee:{role:'owner',name:'Test',permittedNavPaths:['/os/sns','/store']},access:{role:'owner',stores:[{id:'test-maamaa',name:'まぁ麻 · テスト店舗'}]},selectedStoreId:'test-maamaa',runs:[],notifications:[],settings:{}})});
 if(r.method()!=='GET')throw Error('Unexpected non-GET request '+r.url());
 void r.continue();
});

await fs.mkdir(evidence,{recursive:true});const downloads=evidence+'/downloads';await fs.mkdir(downloads,{recursive:true});for(const name of await fs.readdir(downloads))await fs.unlink(downloads+'/'+name);
const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});const results=[];
try{
 await page.goto(base+'/os/sns',{waitUntil:'networkidle0',timeout:90000});await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='写真を選択')?.disabled);
 await(await page.$('input[type=file]')).uploadFile('/tmp/sns-evidence/10413.jpg');await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='画像を保存')?.disabled);
 const click=async text=>page.evaluate(t=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===t||b.textContent.startsWith(t));if(!b)throw Error(t);b.click()},text);
 const original='data:image/jpeg;base64,'+(await fs.readFile('/tmp/sns-evidence/10413.jpg')).toString('base64');
 await page.evaluate(async src=>{const binary=atob(src.split(',')[1]);const blob=new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:'image/jpeg'});const im=await createImageBitmap(blob,{imageOrientation:'from-image',resizeWidth:1536,resizeQuality:'high'});const c=document.createElement('canvas');c.width=1080;c.height=1920;const ctx=c.getContext('2d',{willReadFrequently:true});const scale=Math.max(1080/im.width,1920/im.height);ctx.drawImage(im,(1080-im.width*scale)/2,(1920-im.height*scale)/2,im.width*scale,im.height*scale);window.__photoOracle=ctx.getImageData(0,0,1080,1920).data;im.close()},original);
 let count=0;
 const waitDownload=async()=>{for(let i=0;i<150;i++){const names=(await fs.readdir(downloads)).filter(n=>!n.endsWith('.crdownload'));if(names.length===count+1){count++;return names.sort((a,b)=>a.localeCompare(b))}await new Promise(r=>setTimeout(r,100))}throw Error('actual file did not complete')};
 for(const preset of ['A','B'])for(const color of ['black','white']){
  await click(preset+' ·');await click(color==='black'?'黒文字':'白文字');await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='画像を保存')?.disabled);await new Promise(r=>setTimeout(r,200));
  const rect=preset==='A'?{x:345,y:1658,width:390,height:130}:{x:403,y:1651,width:274,height:91};
  const mismatch=await page.evaluate(r=>{const data=document.querySelector('canvas').getContext('2d').getImageData(0,0,1080,1920).data,oracle=window.__photoOracle;let mismatches=0;for(let y=0;y<1920;y++)for(let x=0;x<1080;x++){if(x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height)continue;const p=(y*1080+x)*4;for(let i=0;i<4;i++)if(data[p+i]!==oracle[p+i])mismatches++;}return mismatches},rect);assert.equal(mismatch,0,preset+color+' original photo oracle');
  const logoData='data:image/png;base64,'+logos[color].toString('base64');
  const fullMismatch=await page.evaluate(async({r,src})=>{const im=new Image();await new Promise((resolve,reject)=>{im.onload=resolve;im.onerror=reject;im.src=src});const c=document.createElement('canvas');c.width=1080;c.height=1920;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.putImageData(new ImageData(new Uint8ClampedArray(window.__photoOracle),1080,1920),0,0);ctx.drawImage(im,r.x,r.y,r.width,r.height);const expected=ctx.getImageData(0,0,1080,1920).data,actual=document.querySelector('canvas').getContext('2d').getImageData(0,0,1080,1920).data;let n=0;for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])n++;return n},{r:rect,src:logoData});assert.equal(fullMismatch,0,preset+color+' complete logo rendering oracle');

  const canvasData=await page.$eval('canvas',c=>c.toDataURL('image/png'));await fs.writeFile(evidence+`/${preset}-${color}-1080x1920.png`,Buffer.from(canvasData.split(',')[1],'base64'));
  for(const mime of ['image/png','image/jpeg']){
   await page.evaluate(m=>{const s=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='image/jpeg'));s.value=m;s.dispatchEvent(new Event('change',{bubbles:true}))},mime);await click('画像を保存');const names=await waitDownload();const newest=names.find(n=>n.includes(`-${preset}-${color}-`)&&n.endsWith(mime==='image/png'?'.png':'.jpg'));assert.ok(newest);const meta=await sharp(downloads+'/'+newest).metadata();assert.deepEqual([meta.width,meta.height],[1080,1920]);assert.equal(meta.format,mime==='image/png'?'png':'jpeg');
   if(mime==='image/png')assert.equal(crypto.createHash('sha256').update(await sharp(downloads+'/'+newest).raw().toBuffer()).digest('hex'),crypto.createHash('sha256').update(await sharp(Buffer.from(canvasData.split(',')[1],'base64')).raw().toBuffer()).digest('hex'));
  }
  results.push(preset+' '+color+': complete photo oracle, actual PNG/JPEG files 1080x1920');
 }
 const hashPhoto=()=>page.$eval('canvas',async c=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,1080,1600).data))).join(','));
 await page.$eval('canvas',c=>c.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));await new Promise(r=>setTimeout(r,100));const before=await hashPhoto();await click('黒文字');await new Promise(r=>setTimeout(r,200));assert.equal(await hashPhoto(),before);await click('A ·');await new Promise(r=>setTimeout(r,100));assert.equal(await hashPhoto(),before);results.push('manual color and A/B changes retain crop');
 for(const [name,width,height]of[['desktop',1280,900],['tablet',820,1180],['phone',390,844]]){await page.setViewport({width,height});await page.screenshot({path:evidence+`/editor-${name}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}results.push('manual controls fit phone/tablet/desktop');
 assert.deepEqual(errors,[]);await fs.writeFile(evidence+'/color-browser-results.json',JSON.stringify({results,actualDownloads:count,pageErrors:errors,nativeDeviceVerified:false,permissionsMocked:true},null,2));console.log(JSON.stringify({results,actualDownloads:count,pageErrors:errors}));
}finally{await browser.close()}
