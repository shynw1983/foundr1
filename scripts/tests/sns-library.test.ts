import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import sharp from "sharp";

function load(file: string, modules: Record<string, unknown> = {}, env: Record<string,string> = {}) {
  const exports: Record<string,unknown>={};
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText,{exports,Buffer,Response,Request,Headers,URL,TextEncoder,TextDecoder,Uint8Array,ReadableStream,Date,
    process:{env},console,require:(name:string)=>{if(!(name in modules))throw Error(`Unexpected dependency ${name} in ${file}`);return modules[name];}});
  return exports;
}
const documentModule=load('lib/sns-library-document.ts') as unknown as typeof import('../../lib/sns-library-document');
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const document=()=>({version:1,presetId:'A',logoColor:'black',crop:{zoom:1,x:0,y:0},textLayers:[{
  id:'headline',text:'今日の気分を、',x:-120,y:180,width:2500,fontFamily:'sans',fontSize:128,fontWeight:700,letterSpacing:0,lineHeight:1.02,align:'left',color:'#abcdef',shadow:true
}],format:'image/png',caption:'',photoWidth:1080,photoHeight:1920});
const clean=(value:unknown)=>JSON.parse(JSON.stringify(value));
test('editable documents preserve scaled frames/groups and support all font IDs while rejecting malformed content',()=>{
  const full=document();
  full.textLayers=Array.from({length:8},(_,i)=>({...full.textLayers[0],id:`layer-${i}`,fontFamily:documentModule.snsLibraryFontIds[i],groupId:'group-1'}));
  const normalized=documentModule.normalizeSnsLibraryDocument(full)!;
  assert.equal(normalized.textLayers.length,8); assert.equal(normalized.textLayers[0].x,-120);assert.equal(normalized.textLayers[0].width,2500);
  assert.equal(normalized.textLayers[0].color,'#ABCDEF');assert.equal(normalized.textLayers[0].groupId,'group-1');
  for(const fontFamily of documentModule.snsLibraryFontIds)assert.ok(documentModule.normalizeSnsLibraryDocument({...document(),textLayers:[{...document().textLayers[0],fontFamily}]}));
  for(const broken of [
    {...document(),textLayers:Array(9).fill(document().textLayers[0])},
    {...document(),textLayers:[document().textLayers[0],document().textLayers[0]]},
    {...document(),textLayers:[{...document().textLayers[0],text:'あ'.repeat(181)}]},
    {...document(),textLayers:[{...document().textLayers[0],fontFamily:'https://attacker/font'}]},
    {...document(),textLayers:[{...document().textLayers[0],x:Infinity}]},
    {...document(),textLayers:[{...document().textLayers[0],color:'url(https://attacker)'}]},
    {...document(),crop:{zoom:1,x:NaN,y:0}}, {...document(),caption:'x'.repeat(4001)},
    {...document(),photoWidth:0},{...document(),version:2}, {...document(),unknown:'x'.repeat(70000)}
  ])assert.equal(documentModule.normalizeSnsLibraryDocument(broken),null);
  assert.equal(documentModule.normalizeSnsColor('#aaBbCc'),'#AABBCC');assert.equal(documentModule.normalizeSnsColor('#abc'),null);
});

const pglitePath=process.env.SNS_LIBRARY_TEST_PGLITE_MODULE;
test('real local SQL: permissions, CAS, private asset references, idempotent Save As, and atomic account palettes', {skip:!pglitePath},async t=>{
  type DB={exec:(sql:string)=>Promise<unknown>;query:(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>;close:()=>Promise<void>};
  const {PGlite}=await import(pglitePath!) as {PGlite:new()=>DB};const db=new PGlite();
  const moduleDdl=readFileSync(new URL('../../db/schema.sql',import.meta.url),'utf8').match(/create table if not exists module_settings\s*\([\s\S]*?\n\);/)?.[0];
  assert.ok(moduleDdl,'exercise the repository module_settings schema, not an alternate schema');
  await db.exec(`create table stores(id uuid primary key,status text);create table brands(id uuid primary key,name text,status text);
    create table store_brands(store_id uuid,brand_id uuid);create table employees(id uuid primary key);
    insert into employees values('${uuid(1)}'),('${uuid(8)}'),('${uuid(99)}');${moduleDdl}
    insert into stores values('${uuid(3)}','active'),('${uuid(4)}','active'),('${uuid(5)}','active');
    insert into brands values('${uuid(30)}','まぁ麻','active'),('${uuid(31)}','Other','active');
    insert into store_brands values('${uuid(3)}','${uuid(30)}'),('${uuid(4)}','${uuid(30)}'),('${uuid(5)}','${uuid(31)}');`);
  let session:Record<string,unknown>|null={id:uuid(1),role:'staff',name:'Staff',loginId:'staff',sessionVersion:1,sessionId:uuid(2)};
  let scope={allStores:false,storeIds:[uuid(3)]},osPermission=false;
  const calls:Array<{text:string;values:unknown[]}>=[];
  const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{
    const text=parts.reduce((sum,piece,index)=>sum+piece+(index<values.length?`$${index+1}`:''),'');calls.push({text,values});return (await db.query(text,values)).rows;
  };
  const library=load('lib/sns-library.ts',{'node:crypto':crypto,'./sns-library-document':documentModule,'./db':{sql},
    './api-auth':{requireOsSession:async()=>session,getSessionStoreScope:async()=>scope},'./role-permissions':{roleHasPermission:async()=>osPermission}
  }) as unknown as typeof import('../../lib/sns-library');
  const preferences=load('lib/sns-library-preferences.ts',{'./db':{sql},'./sns-library-document':documentModule,'./sns-library':library}) as unknown as typeof import('../../lib/sns-library-preferences');
  const blobs=new Map<string,{bytes:Buffer;mimeType:string}>();let reads=0;
  const blob={head:async(path:string)=>{const value=blobs.get(path)!;return {pathname:path,size:value.bytes.length,contentType:value.mimeType};},
    get:async(path:string)=>{reads++;const value=blobs.get(path);return value?{statusCode:200,stream:new ReadableStream({start(c){c.enqueue(value.bytes);c.close();}}),blob:{size:value.bytes.length,contentType:value.mimeType}}:null;}};
  const assets=load('lib/sns-library-assets.ts',{'node:crypto':crypto,'@vercel/blob':blob,'sharp':sharp,'./db':{sql},'./sns-library':library},{BLOB_READ_WRITE_TOKEN:'test-only'}) as unknown as typeof import('../../lib/sns-library-assets');
  const failure=(status:number)=>(error:unknown)=>(error as {status:number}).status===status;
  try{
    await t.test('fresh session, exact brand, OS permission and owner-selected-store scope are enforced',async()=>{
      session=null;await assert.rejects(library.requireSnsLibraryAccess(uuid(3),'store'),failure(401));
      session={id:uuid(1),role:'staff',name:'Staff',loginId:'staff',sessionVersion:1};
      await assert.rejects(library.requireSnsLibraryAccess(uuid(4),'store'),failure(403));
      await assert.rejects(library.requireSnsLibraryAccess(uuid(3),'os'),failure(403));
      scope={allStores:true,storeIds:[]};await assert.rejects(library.requireSnsLibraryAccess(uuid(5),'store'),failure(403));
      session.role='owner';scope={allStores:false,storeIds:[uuid(3)]};await assert.rejects(library.requireSnsLibraryAccess(uuid(4),'store'),failure(403));
      osPermission=true;assert.equal((await library.requireSnsLibraryAccess(uuid(3),'os')).storeId,uuid(3));
      session.role='staff';osPermission=false;
    });
    const access=await library.requireSnsLibraryAccess(uuid(3),'store');
    let allocated:Awaited<ReturnType<typeof assets.allocateSnsAsset>>;
    await t.test('allocate reserves an exact immutable path; pending is unreadable and complete verifies real PNG bytes',async()=>{
      const unconfigured=load('lib/sns-library-assets.ts',{'node:crypto':crypto,'@vercel/blob':blob,'sharp':sharp,'./db':{sql},'./sns-library':library},{BLOB_STORE_ID:'store_test_only'}) as unknown as typeof import('../../lib/sns-library-assets');
      const callsBeforeMissingToken=calls.length;
      await assert.rejects(unconfigured.allocateSnsAsset(access,{kind:'photo',mimeType:'image/png',size:10}),failure(503));
      assert.equal(calls.length,callsBeforeMissingToken,'client signing credentials must be checked before reserving a pending row');
      const png=await sharp({create:{width:1080,height:1920,channels:3,background:'#224433'}}).png().toBuffer();
      allocated=await assets.allocateSnsAsset(access,{kind:'photo',mimeType:'image/png',size:png.length});
      assert.match(allocated.pathname,new RegExp(`^sns/${uuid(3)}/${allocated.id}/source.png$`));
      await assert.rejects(library.getReadableSnsAsset(access,allocated.id),failure(404));
      blobs.set(allocated.pathname,{bytes:png,mimeType:'image/png'});
      const completed=await assets.completeSnsAsset(access,allocated.id);assert.equal(completed.width,1080);assert.equal(completed.height,1920);
      assert.deepEqual(clean(await assets.completeSnsAsset(access,allocated.id)),clean(completed));
      await assert.rejects(assets.validateSnsAssetBytes({kind:'photo',mimeType:'image/png',size:png.length},new Uint8Array(png.length)),failure(400));
      const tooWide=await sharp({create:{width:2161,height:500,channels:3,background:'#fff'}}).png().toBuffer();
      await assert.rejects(assets.validateSnsAssetBytes({kind:'photo',mimeType:'image/png',size:tooWide.length},tooWide),failure(400));
      await assert.rejects(assets.allocateSnsAsset(access,{kind:'photo',mimeType:'image/jpeg',size:10}),failure(400));
      const cut=png.subarray(0,png.length-25);
      await assert.rejects(assets.validateSnsAssetBytes({kind:'photo',mimeType:'image/png',size:cut.length},cut),failure(400));
      const jpeg=await sharp({create:{width:270,height:480,channels:3,background:'#fff'}}).jpeg().toBuffer();
      assert.deepEqual(clean(await assets.validateSnsAssetBytes({kind:'preview',mimeType:'image/jpeg',size:jpeg.length},jpeg)),{
        width:270,height:480,sha256:crypto.createHash('sha256').update(jpeg).digest('hex')});
      const cutJpeg=jpeg.subarray(0,Math.floor(jpeg.length*.7));
      await assert.rejects(assets.validateSnsAssetBytes({kind:'preview',mimeType:'image/jpeg',size:cutJpeg.length},cutJpeg),failure(400));
    });
    let saved:Awaited<ReturnType<typeof library.saveSnsTemplate>>;
    const body=()=>({name:'My bowl',document:document(),photoAssetId:allocated.id,previewAssetId:null});
    await t.test('create retries are idempotent, list excludes the editable document, and one CAS writer wins',async()=>{
      saved=await library.saveSnsTemplate(access,body(),uuid(10),true);
      assert.equal((await library.saveSnsTemplate(access,body(),uuid(10),true)).revision,saved.revision);
      await assert.rejects(library.saveSnsTemplate(access,{...body(),name:'Different'},uuid(10),true),failure(409));
      const listed=await library.listSnsTemplates(access);assert.equal(listed.templates.length,1);assert.ok(!('document'in listed.templates[0]));assert.ok(!('fingerprint'in listed.templates[0]));
      const writes=await Promise.allSettled([1,2].map(n=>library.saveSnsTemplate(access,{...body(),name:`Update${n}`,expectedRevision:saved.revision},saved.id,false)));
      assert.equal(writes.filter(x=>x.status==='fulfilled').length,1);assert.equal(writes.filter(x=>x.status==='rejected'&&(x.reason as {status:number}).status===409).length,1);
      saved=await library.getSnsTemplate(access,saved.id);
      const retry=await library.saveSnsTemplate(access,{...body(),name:saved.name,expectedRevision:uuid(999)},saved.id,false);
      assert.equal(retry.revision,saved.revision,'lost-response retry returns the saved version without a second write');
      await assert.rejects(library.saveSnsTemplate(access,{...body(),document:{...document(),photoWidth:100},expectedRevision:saved.revision},saved.id,false),failure(400));
    });
    await t.test('other readers cannot overwrite but can Save As, shared references permit assets while unbound images stay private',async()=>{
      const other={...access,session:{...access.session,id:uuid(8),role:'staff'}};
      assert.equal(library.canEditSnsTemplate(other,saved),false);
      await assert.rejects(library.saveSnsTemplate(other,{...body(),expectedRevision:saved.revision},saved.id,false),failure(403));
      const copy=await library.saveSnsTemplate(other,{...body(),name:'A separate copy'},uuid(11),true);assert.equal(copy.photoAssetId,allocated.id);
      const untouched=await library.getSnsTemplate(access,saved.id);assert.equal(untouched.revision,saved.revision);
      for(const role of ['owner','manager','store_owner','store_manager'])assert.equal(library.canEditSnsTemplate({...other,session:{...other.session,role}},saved),true);
      const png=blobs.get(allocated.pathname)!.bytes;
      const unbound=await assets.allocateSnsAsset(access,{kind:'photo',mimeType:'image/png',size:png.length});blobs.set(unbound.pathname,{bytes:png,mimeType:'image/png'});
      await assets.completeSnsAsset(access,unbound.id);await assert.rejects(library.getReadableSnsAsset(other,unbound.id),failure(403));
      const before=reads;await assert.rejects(assets.readSnsAsset(other,unbound.id),failure(403));assert.equal(reads,before);
      assert.equal((await assets.readSnsAsset(other,allocated.id)).headers.get('cache-control'),'private, no-store, max-age=0');
      await assert.rejects(assets.completeSnsAsset(other,unbound.id),failure(403));
      await assert.rejects(library.getReadableSnsAsset({...access,storeId:uuid(4)},allocated.id),failure(404));
    });
    await t.test('upload-token route signs only the reserved owned path and rejects anonymous, cross-store, cross-origin and expired allocations',async()=>{
      const http=load('lib/sns-library-http.ts',{'./sns-library':library}) as unknown as typeof import('../../lib/sns-library-http');
      let tokenCalls=0;
      const uploadRoute=load('app/api/sns/assets/[id]/upload/route.ts',{
        '@vercel/blob/client':{handleUpload:async(options:{body:{payload:{pathname:string}};onBeforeGenerateToken:(path:string)=>Promise<Record<string,unknown>>})=>{
          const token=await options.onBeforeGenerateToken(options.body.payload.pathname);tokenCalls++;
          assert.equal(token.allowOverwrite,false);assert.equal(token.addRandomSuffix,false);assert.equal(token.maximumSizeInBytes,10);
          assert.deepEqual(clean(token.allowedContentTypes),['image/png']);assert.ok(Number(token.validUntil)>Date.now());
          return {type:'blob.generate-client-token',clientToken:'test-token-only'};
        }},'../../../../../../lib/sns-library':library,'../../../../../../lib/sns-library-assets':assets,'../../../../../../lib/sns-library-http':http
      }) as {POST:(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>};
      const pending=await assets.allocateSnsAsset(access,{kind:'photo',mimeType:'image/png',size:10});
      const request=(path=pending.pathname,store=uuid(3),origin='https://app.test')=>new Request(`https://app.test/api/sns/assets/${pending.id}/upload?storeId=${store}&surface=store`,{
        method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({type:'blob.generate-client-token',payload:{pathname:path}})});
      const context={params:Promise.resolve({id:pending.id})};
      assert.equal((await uploadRoute.POST(request('https://attacker/file'),context)).status,403);assert.equal(tokenCalls,0);
      const malformed=new Request(request().url,{method:'POST',headers:{origin:'https://app.test'},body:JSON.stringify({type:'blob.generate-client-token',payload:null})});
      assert.equal((await uploadRoute.POST(malformed,context)).status,400);assert.equal(tokenCalls,0);
      assert.equal((await uploadRoute.POST(request(),context)).status,200);assert.equal(tokenCalls,1);
      assert.equal((await uploadRoute.POST(request(pending.pathname,uuid(4)),context)).status,403);
      assert.equal((await uploadRoute.POST(request(pending.pathname,uuid(3),'https://attacker.test'),context)).status,403);
      const previous=session;session=null;assert.equal((await uploadRoute.POST(request(),context)).status,401);session=previous;
      await sql`update module_settings set settings=jsonb_set(settings,'{expiresAt}','"2000-01-01T00:00:00Z"'::jsonb) where module_key=${library.snsAssetKey(pending.id)}`;
      assert.equal((await uploadRoute.POST(request(),context)).status,409);assert.equal(tokenCalls,1);
    });
    await t.test('template HTTP routes share the real SQL/ACL/CAS implementation and preserve an author across manager edits',async()=>{
      const http=load('lib/sns-library-http.ts',{'./sns-library':library});
      const collection=load('app/api/sns/templates/route.ts',{'../../../../lib/sns-library':library,'../../../../lib/sns-library-http':http}) as {
        POST:(request:Request)=>Promise<Response>;GET:(request:Request)=>Promise<Response>};
      const detail=load('app/api/sns/templates/[id]/route.ts',{'../../../../../lib/sns-library':library,'../../../../../lib/sns-library-http':http}) as {
        PUT:(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>;GET:(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>};
      const id=uuid(50),context={params:Promise.resolve({id})};
      const request=(method:string,input:unknown,origin='https://app.test')=>new Request(`https://app.test/api/sns/templates/${id}`,{
        method,headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)});
      const input={...body(),id,storeId:uuid(3),surface:'store',createdBy:uuid(99)};
      let response=await collection.POST(request('POST',input));assert.equal(response.status,201);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
      let record=(await response.json()).template;assert.equal(record.createdBy,access.session.id);assert.equal(record.document.textLayers[0].text,'今日の気分を、');
      const oldRevision=record.revision;
      const update={...input,name:'HTTP edit',expectedRevision:oldRevision};
      response=await detail.PUT(request('PUT',update),context);assert.equal(response.status,200);record=(await response.json()).template;
      const savedRevision=record.revision;
      response=await detail.PUT(request('PUT',update),context);assert.equal(response.status,200);assert.equal((await response.json()).template.revision,savedRevision);
      response=await detail.PUT(request('PUT',{...update,name:'Stale content'}),context);assert.equal(response.status,409);
      const original=session;session={...session,id:uuid(8),role:'staff'};
      response=await detail.PUT(request('PUT',{...input,name:'Other staff',expectedRevision:savedRevision}),context);assert.equal(response.status,403);
      response=await detail.GET(new Request(`https://app.test/api/sns/templates/${id}?storeId=${uuid(3)}&surface=store`),context);assert.equal(response.status,200);assert.equal((await response.json()).template.canEdit,false);
      session.role='store_manager';
      response=await detail.PUT(request('PUT',{...input,name:'Scoped manager edit',expectedRevision:savedRevision}),context);assert.equal(response.status,200);assert.equal((await response.json()).template.createdBy,access.session.id);
      session=original;
      response=await collection.POST(request('POST',{...input,id:uuid(51)},'https://attacker.test'));assert.equal(response.status,403);
      response=await collection.POST(request('POST',{...input,id:uuid(51),storeId:uuid(4)}));assert.equal(response.status,403);
      session=null;response=await collection.GET(new Request(`https://app.test/api/sns/templates?storeId=${uuid(3)}&surface=store`));assert.equal(response.status,401);session=original;
    });
    await t.test('keyset pagination exposes 105 records across stable pages without missing or duplicated IDs',async()=>{
      const target=uuid(4);scope={allStores:false,storeIds:[uuid(3),target]};
      for(let index=0;index<105;index++){
        const id=uuid(200+index),settings={...saved,id,name:`Page ${index}`};
        await sql`insert into module_settings(scope_key,module_key,settings,updated_by,updated_at)
          values(${library.snsStoreScopeKey(target)},${library.snsTemplateKey(id)},${JSON.stringify(settings)}::jsonb,${access.session.id}::uuid,'2026-10-24T00:00:00Z')`;
      }
      const pageAccess=await library.requireSnsLibraryAccess(target,'store');
      const first=await library.listSnsTemplates(pageAccess);assert.equal(first.templates.length,40);assert.ok(first.nextCursor);
      const second=await library.listSnsTemplates(pageAccess,first.nextCursor);assert.equal(second.templates.length,40);assert.ok(second.nextCursor);
      const third=await library.listSnsTemplates(pageAccess,second.nextCursor);assert.equal(third.templates.length,25);assert.equal(third.nextCursor,null);
      const ids=[...first.templates,...second.templates,...third.templates].map(row=>row.id);assert.equal(new Set(ids).size,105);
      await assert.rejects(library.listSnsTemplates(access,first.nextCursor),failure(400));
      await assert.rejects(library.listSnsTemplates(access,'broken'),failure(400));
      scope={allStores:false,storeIds:[uuid(3)]};
    });
    await t.test('account favorites atomically add/remove concurrent colors, cap32, canonicalize and stay account-scoped',async()=>{
      await Promise.all(['#aabbcc','#ddeeff','#112233'].map(color=>preferences.changeSnsFavoriteColor(access,'add',color)));
      assert.deepEqual(new Set(await preferences.getSnsFavoriteColors(access)),new Set(['#AABBCC','#DDEEFF','#112233']));
      await Promise.all([preferences.changeSnsFavoriteColor(access,'remove','#aabbcc'),preferences.changeSnsFavoriteColor(access,'add','#ffffff')]);
      let colors=await preferences.getSnsFavoriteColors(access);assert.ok(!colors.includes('#AABBCC'));assert.ok(colors.includes('#FFFFFF'));
      for(let i=0;colors.length<31;i++){await preferences.changeSnsFavoriteColor(access,'add',`#${i.toString(16).padStart(6,'0')}`);colors=await preferences.getSnsFavoriteColors(access);}
      const lastSlots=await Promise.allSettled(['#ABCDEF','#FEDCBA'].map(color=>preferences.changeSnsFavoriteColor(access,'add',color)));
      assert.equal(lastSlots.filter(result=>result.status==='fulfilled').length,1);assert.equal(lastSlots.filter(result=>result.status==='rejected'&&(result.reason as {status:number}).status===409).length,1);
      await assert.rejects(preferences.changeSnsFavoriteColor(access,'add','#00FFFE'),failure(409));assert.equal((await preferences.getSnsFavoriteColors(access)).length,32);
      assert.deepEqual(clean(await preferences.getSnsFavoriteColors({...access,session:{...access.session,id:uuid(99)}})),[]);
      const row=await db.query("select scope_key from module_settings where module_key='sns_preferences'");assert.equal(row.rows[0].scope_key,`employee:${access.session.id}`);
    });
    assert.ok(calls.every(call=>!call.text.includes('alter table')));
  }finally{await db.close();}
});
