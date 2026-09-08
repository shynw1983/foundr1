import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLocalStatus,publicError} from '../src/local-status.mjs';
test('status exposes only safe task fields, not payload or raw errors',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bridge-status-'));
 const status=await createLocalStatus({deviceName:'Mac',storeId:'store',serverUrl:'https://www.foundr1.jp',bridgeToken:'secret'},dir);
 const command={id:'task',platform:'demae_can',type:'publish_menu_changes',payload:{password:'secret'}};
 await status.progress(command,{phase:'locating',token:'secret'});
 await status.finish(command,'401 secret');
 const raw=await readFile(path.join(dir,'status.json'),'utf8');assert.ok(!raw.includes('secret'));
 assert.equal(JSON.parse(raw).recent[0].ok,false);
 assert.equal(publicError('401'),'授权或登录需要检查');
 await writeFile(path.join(dir,'action.json'),JSON.stringify({action:'delete',at:Date.now()}));assert.equal(await status.action(),null);
 await writeFile(path.join(dir,'action.json'),JSON.stringify({action:'restart',at:0}));assert.equal(await status.action(),null);
 await writeFile(path.join(dir,'action.json'),JSON.stringify({action:'check',at:Date.now()}));assert.equal(await status.action(),'check');assert.equal(await status.action(),null);
});
