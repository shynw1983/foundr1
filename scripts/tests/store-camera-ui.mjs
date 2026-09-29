// Builds the real Store page with isolated provider fixtures. Run UI actions through the browser tool.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const output = resolve(process.env.CAMERA_UI_OUTPUT || 'outputs/store-cameras-20260930');
await mkdir(output, { recursive: true });
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async l => [l, JSON.parse(await readFile(`public/locales/os/${l}.json`, 'utf8'))])));
const fakePusher = `export default class Pusher {
  constructor(key,options){this.options=options;this.connection={bind(){}};this.stopped=false;window.fixturePusher=this;}
  subscribe(name){const events={};this.channel={bind:(event,callback)=>{events[event]=callback;},emit:(event,data)=>events[event]?.(data)};
    this.options.channelAuthorization.customHandler({socketId:'1.2',channelName:name},(error)=>setTimeout(()=>this.channel.emit(error?'pusher:subscription_error':'pusher:subscription_succeeded'),100));return this.channel;}
  disconnect(){this.stopped=true;}
}`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './app/store/devices/page';import {OsTranslationProvider} from './app/os/components/OsTranslationProvider';
const params=new URLSearchParams(location.search),language=params.get('language')||'ja';localStorage.setItem('foundr1-os-language',language);localStorage.setItem('foundr1-os-language-preference','manual');
const storeId='10000000-0000-4000-8000-000000000001', dictionaries=${JSON.stringify(dictionaries)};
let scenario=params.get('scenario')||'normal', sequence=0, cachedClip;
const stats={reads:0,prepare:0,capture:0,media:0,cancel:0};
const showStats=()=>document.getElementById('fixture-stats').textContent=JSON.stringify(stats);
async function clip(){if(cachedClip)return cachedClip;const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');
const stream=canvas.captureStream(12),types=['video/mp4;codecs=avc1.42001e','video/mp4','video/webm;codecs=vp8'];const mimeType=types.find(type=>MediaRecorder.isTypeSupported(type));
const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:300000}),chunks=[];
let frame=0;const draw=()=>{ctx.fillStyle='#1f4338';ctx.fillRect(0,0,960,540);ctx.fillStyle='#f3f7f4';ctx.font='32px sans-serif';ctx.fillText('Foundr1 · Camera playback test',60,100);ctx.font='22px sans-serif';ctx.fillText('Synthetic video · No camera connection',60,150);ctx.fillStyle='#a8cabb';ctx.fillRect(60+frame++*8,260,90,90);};draw();const timer=setInterval(draw,80);
const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.ondataavailable=event=>chunks.push(event.data);recorder.start();setTimeout(()=>recorder.stop(),1800);await stopped;clearInterval(timer);stream.getTracks().forEach(track=>track.stop());cachedClip=new Blob(chunks,{type:'video/mp4'});return cachedClip;}
window.fetch=async(input,init={})=>{await Promise.resolve();if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');const url=new URL(String(input),location.href);
if(url.pathname.startsWith('/locales/os/'))return Response.json(dictionaries[url.pathname.includes('zh-Hant')?'zh-Hant':'zh-Hans']);
if(url.pathname==='/api/store/context')return Response.json({selectedStoreId:storeId,access:{role:'store_terminal',canUseAllStoreView:false,stores:[{id:storeId,name:'清水店'}]}});
if(url.pathname==='/api/auth/me')return Response.json({employee:{id:'test',name:'清水店',role:'store_terminal'}});
if(url.pathname==='/api/store/devices')return Response.json({configured:true,storeId,devices:[{key:'a'.repeat(24),name:'室内照明',type:'Bot',kind:'indoorLight',actions:['press'],sample:{lightLevel:12},fetchedAt:new Date().toISOString(),readError:false,issue:'',controlEnabled:true,blockedUntil:null,command:null}]});
if(url.pathname==='/api/store/cameras'){
 if(!init.method){stats.reads++;showStats();return Response.json({cameras:[{id:'parking',name:'駐車場',model:'SoloCam S340'}]});}
 const body=JSON.parse(init.body);if(Object.hasOwn(stats,body.action))stats[body.action]++;showStats();
 if(body.action==='prepare')return Response.json({ticket:'local-test-'+(++sequence),requestId:'request-'+sequence,channel:'private-fixture-'+sequence,key:'test',cluster:'ap3',captureDeadline:Date.now()+(scenario==='timeout'?3500:90000)});
 if(body.action==='realtime')return Response.json({auth:'fixture-auth'});
 if(body.action==='capture'){const client=window.fixturePusher,id='request-'+sequence;setTimeout(()=>{if(scenario==='error')client.channel.emit('camera.failed',{requestId:id,code:'unavailable'});else if(scenario!=='timeout')client.channel.emit('camera.ready',{requestId:id,capturedAt:new Date().toISOString()});},700);return Response.json({accepted:true});}
 if(body.action==='media'){if(scenario==='playback')return new Response('invalid',{headers:{'Content-Type':'video/mp4'}});return new Response(await clip(),{headers:{'Content-Type':'video/mp4'}});}
 return Response.json({stopped:true});
}
return Response.json({items:[],notifications:[],unreadCount:0});};
createRoot(document.getElementById('root')).render(<React.StrictMode><OsTranslationProvider><Page/></OsTranslationProvider></React.StrictMode>);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'fixture-pusher', setup(build) { build.onResolve({ filter: /^pusher-js$/ }, () => ({ path: 'pusher', namespace: 'fixture' })); build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fakePusher })); } }] });
const css = await readFile('app/globals.css', 'utf8') + '\n' + await readFile('app/store/store-responsive.css', 'utf8');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Store camera — local verification</title><style>${css}</style></head><body><aside style="font:12px monospace;padding:8px;background:#f3f6f4">本地测试 · 合成画面 · <a href="?language=ja">日本語</a> · <a href="?language=zh-Hans">简体</a> · <a href="?language=zh-Hant">繁體</a> · <a href="?scenario=error">连接失败</a> · <a href="?scenario=timeout">超时</a> · <a href="?scenario=playback">播放失败</a><output id="fixture-stats"></output></aside><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
await writeFile(resolve(output, 'fixture.html'), html);
if (process.argv.includes('--serve')) {
  createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; media-src blob: data:; connect-src 'self';" });
    response.end(html);
  }).listen(38742, '127.0.0.1', () => console.log('Camera UI fixture http://127.0.0.1:38742'));
} else console.log(resolve(output, 'fixture.html'));
