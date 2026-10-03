import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const evidence='/tmp/sns-evidence';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--no-default-browser-check']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const logo=await fs.readFile('assets/sns/maamaa-complete-logo.png');
const payload=Buffer.from(JSON.stringify({role:'owner',sessionId:'00000000-0000-4000-8000-000000000001',expiresAt:Date.now()+3600000})).toString('base64url');
const signature=crypto.createHmac('sha256','postgresql://local:local@localhost:5432/local').update(payload).digest('base64url');
await page.setCookie({name:'foundr1_os_session',value:payload+'.'+signature,url:'http://localhost:3136'});
await page.setRequestInterception(true);
page.on('request',r=>{
 const u=new URL(r.url());
 if(u.pathname==='/api/sns')return void r.respond(u.searchParams.has('asset')?{status:200,contentType:'image/png',body:logo}:{status:200,contentType:'application/json',body:JSON.stringify({stores:[{id:'test-maamaa',name:'まぁ麻 · テスト店舗'}],canManage:true})});
 if(u.pathname.startsWith('/api/'))return void r.respond({status:200,contentType:'application/json',body:JSON.stringify({employee:{role:'owner',name:'Test',permittedNavPaths:['/os/sns','/store']},access:{role:'owner',stores:[{id:'test-maamaa',name:'まぁ麻 · テスト店舗'}]},selectedStoreId:'test-maamaa',runs:[],notifications:[],settings:{}})});
 if(r.method()!=='GET')throw Error('Unexpected non-GET request '+r.url());
 void r.continue();
});
try{
 await page.goto('http://localhost:3136/os/sns',{waitUntil:'networkidle0',timeout:90000});
 await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='写真を選択')?.disabled);
 const click=async text=>page.evaluate(t=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===t||b.textContent.startsWith(t));if(!b)throw Error(t);b.click()},text);
 const upload=async file=>{await (await page.$('input[type=file]')).uploadFile(file);await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='画像を保存')?.disabled);};
 await upload(evidence+'/10413.jpg');
 await page.evaluate(()=>{window.__exports=[];const originalBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,...args){originalBlob.call(this,blob=>{const reader=new FileReader();reader.onload=()=>{window.__lastBlob={data:reader.result,type:blob.type};callback(blob)};reader.readAsDataURL(blob)},...args)};const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__exports.push({name:this.download,...window.__lastBlob});return;}original.call(this)};});
 const capture=async(name)=>{const d=await page.$eval('canvas',c=>c.toDataURL('image/png'));await fs.writeFile(evidence+'/'+name,Buffer.from(d.split(',')[1],'base64'));};
 await capture('A-original-logo-1080x1920.png');
 // Oracle comparison: original photo decoded and cropped independently, every pixel outside logo must match.
 const originalData='data:image/jpeg;base64,'+(await fs.readFile(evidence+'/10413.jpg')).toString('base64');const compare=await page.evaluate(async src=>{const binary=atob(src.split(',')[1]);const blob=new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:'image/jpeg'});const im=await createImageBitmap(blob,{imageOrientation:'from-image',resizeWidth:1536,resizeQuality:'high'});const c=document.createElement('canvas');c.width=1080;c.height=1920;const ctx=c.getContext('2d',{willReadFrequently:true});const scale=Math.max(1080/im.width,1920/im.height);ctx.drawImage(im,(1080-im.width*scale)/2,(1920-im.height*scale)/2,im.width*scale,im.height*scale);const a=ctx.getImageData(0,0,1080,1600).data,b=document.querySelector('canvas').getContext('2d').getImageData(0,0,1080,1600).data;let count=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])count++;return count;},originalData);assert.equal(compare,0,'original photo pixel oracle');
 await page.evaluate(()=>{const c=document.querySelector('canvas');c.focus();c.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));});
 await new Promise(r=>setTimeout(r,1500));await capture('crop-before.png');const before=await page.$eval('canvas',async c=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,1080,1600).data))).join(','));
 await click('B ·');await new Promise(r=>setTimeout(r,1500));await capture('crop-after.png');
 const after=await page.$eval('canvas',async c=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,1080,1600).data))).join(','));assert.equal(after,before,'switch preserves crop');console.log('Original-photo oracle and crop preservation passed');
 await click('構図をリセット');await new Promise(r=>setTimeout(r,100));await capture('B-small-logo-1080x1920.png');
 await click('画像を保存');await page.waitForFunction(()=>window.__exports.length===1);

 await page.evaluate(()=>{const s=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='image/jpeg'));s.value='image/jpeg';s.dispatchEvent(new Event('change',{bubbles:true}));});
 await click('画像を保存');await page.waitForFunction(()=>window.__exports.length===2);
 for(let i=0;i<2;i++){await page.waitForFunction(i=>Boolean(window.__exports[i]?.data),{},i);const data=await page.evaluate(i=>window.__exports[i],i);const buf=Buffer.from(data.data.split(',')[1],'base64'),meta=await sharp(buf).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,1920);await fs.writeFile(evidence+'/'+(i?'export.jpeg':'export.png'),buf);}
 await page.evaluate(()=>{window.__exports=[];const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='画像を保存');b.click();b.click();b.click()});await page.waitForFunction(()=>window.__exports.length===1);
 // Cancel and select the same original again: input is reset after handling.
 await upload(evidence+'/10413.jpg');assert.equal(await page.$eval('input[type=file]',e=>e.value),'');
 await page.$eval('input[type=file]',e=>e.dispatchEvent(new Event('change',{bubbles:true})));await upload(evidence+'/10413.jpg');
 console.log('PNG/JPEG and export lock passed');for(const [name,width,height] of [['desktop',1280,900],['tablet',820,1180],['phone',390,844]]){await page.setViewport({width,height});await page.screenshot({path:evidence+'/editor-'+name+'.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await sharp({create:{width:400,height:300,channels:3,background:'#ff0000'}}).composite([{input:await sharp({create:{width:200,height:300,channels:3,background:'#0000ff'}}).png().toBuffer(),left:200,top:0}]).jpeg().withMetadata({orientation:6}).toFile(evidence+'/orientation-6.jpg');await upload(evidence+'/orientation-6.jpg');await new Promise(r=>setTimeout(r,100));const orientation=await page.$eval('canvas',c=>{const ctx=c.getContext('2d');return [Array.from(ctx.getImageData(540,400,1,1).data),Array.from(ctx.getImageData(540,1400,1,1).data)]});assert.ok(orientation[0][0]>200&&orientation[0][2]<50&&orientation[1][2]>200&&orientation[1][0]<50,'EXIF6 pixel orientation');
 await sharp({create:{width:4000,height:3000,channels:3,background:'#227744'}}).jpeg().toFile(evidence+'/landscape.jpg');await upload(evidence+'/landscape.jpg');
 await sharp({create:{width:6000,height:8000,channels:3,background:'#227744'}}).jpeg().toFile(evidence+'/large-48mp.jpg');await upload(evidence+'/large-48mp.jpg');
 const fake=Buffer.alloc(32);fake.writeUInt32BE(24,0);fake.write('ftypheic',4);await fs.writeFile(evidence+'/disguised-heic.jpg',fake);await(await page.$('input[type=file]')).uploadFile(evidence+'/disguised-heic.jpg');await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('HEIC'));
 await upload(evidence+'/10413.jpg');await page.evaluate(()=>{window.__nativeCalls=[];window.Foundr1Downloads={supportsImages:()=>true,saveBase64:(name,mime,data)=>{window.__nativeCalls.push({name,mime,size:data.length});return '{"ok":true}'}}});await click('画像を保存');await page.waitForFunction(()=>window.__nativeCalls.length===1);
 await page.evaluate(()=>{window.Foundr1Downloads={saveBase64:()=>{throw Error('old bridge must not be called')}}});await click('画像を保存');await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('App'));
 await page.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.__shared=payload.files.map(f=>({name:f.name,type:f.type,size:f.size}))}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__caption=text}}});});
 await click('画像を共有');await page.waitForFunction(()=>window.__shared?.length===1);assert.equal(await page.evaluate(()=>window.__shared[0].type),'image/jpeg');
 await page.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('cancel','AbortError')}})});await click('画像を共有');await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='画像を保存')?.disabled);
 await page.type('textarea','今日のまぁ麻');await click('投稿文をコピー');await page.waitForFunction(()=>window.__caption==='今日のまぁ麻');
 await click('構図をリセット');await (await page.$('input[type=range]')).focus();for(let i=0;i<10;i++)await page.keyboard.press('ArrowRight');assert.ok(Number(await page.$eval('input[type=range]',e=>e.value))>1);
 const rect=await page.$eval('canvas',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}});await page.mouse.move(rect.x,rect.y);await page.mouse.down();await page.mouse.move(rect.x+25,rect.y+20,{steps:4});await page.mouse.up();
 await click('プレビュー');assert.equal(await page.$eval('input[type=range]',e=>e.disabled),true);await click('編集に戻る');
 assert.deepEqual(errors,[]);
 await fs.writeFile(evidence+'/browser-results.json',JSON.stringify({passed:['A/B output 1080x1920','preset crop retained','PNG/JPEG dimensions','duplicate clicks locked','same file reselection and cancellation','desktop/tablet/phone no overflow','EXIF6 pixel direction verified','landscape accepted','48MP accepted','HEIC content rejection with jpg suffix','pointer dragging and zoom','preview locks editing','caption copy simulated','share success and cancellation simulated','native image bridge simulated','old PDF-only bridge blocked'],pageErrors:errors,limitations:['Authorization APIs mocked; live scope SQL not exercised','Real Android MediaStore/share not exercised']},null,2));
 console.log('Browser checks passed; evidence',evidence);
}finally{await browser.close()}
