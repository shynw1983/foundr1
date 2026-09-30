const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const storeId='10000000-0000-4000-8000-000000000001', otherStoreId='10000000-0000-4000-8000-000000000002', actorId='20000000-0000-4000-8000-000000000001';
const ids={light:'ABCDEF123456',hub:'ABCDEF654321',ambient:'ABCDEF123464',shade:'ABCDEF123458',lock:'ABCDEF123459',outside:'ABCDEF123457',foreign:'ABCDEF123463'};
const env={SWITCHBOT_TOKEN:'scene-test-token',SWITCHBOT_SECRET:'scene-test-secret',SWITCHBOT_INDOOR_LIGHT_STORE_ID:storeId,SWITCHBOT_INDOOR_LIGHT_BOT_ID:ids.light,SWITCHBOT_INDOOR_LIGHT_HUB_ID:ids.hub,SWITCHBOT_CONTROL_ENABLED:'true'};
function load(file,modules={},globals={}) {
 const context={exports:{},Response,Request,URL,AbortSignal,Date,Buffer,process:{env},console:{...console,info(){}},require:name=>Object.hasOwn(modules,name.split('/').at(-1))?modules[name.split('/').at(-1)]:require(name),...globals};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context,{filename:file});return context.exports;
}
const policy=load('lib/store-scene-state.ts'),light=load('lib/store-light-state.ts'),state=load('lib/store-device-state.ts',{'store-light-state':light});
async function fixture() {
 const db=new PGlite();
 await db.exec(`create table stores(id uuid primary key);create table employees(id uuid primary key);insert into stores values('${storeId}'),('${otherStoreId}');insert into employees values('${actorId}');`);
 await db.exec(fs.readFileSync('db/schema.sql','utf8').match(/create table if not exists module_settings \([\s\S]*?\n\);/)[0]);
 for(const name of ['20260929-store-indoor-light.sql','20260929-store-device-commands.sql','20260930-store-device-scenes.sql']) await db.exec(fs.readFileSync('db/migrations/'+name,'utf8'));
 await db.query("insert into module_settings(scope_key,module_key,settings) values($1,'store_devices',$2::jsonb)",['store:'+storeId,JSON.stringify({directDeviceIds:[ids.ambient],deviceOrder:[],preserved:'keep'})]);
 const queries=[], posts=[], reads=[], jobs=[];
 const sql=async(strings,...values)=>{const q=strings.reduce((q,s,i)=>q+(i?'$'+i:'')+s,'');queries.push(q);return(await db.query(q,values)).rows;};
 const vendor={level:12,door:'closed',lock:'unlocked',mode:'pressMode',position:0,moving:false,calibrated:true,failLight:false,postError:'',hold:null};
 const list=[['light','Bot','室内照明'],['ambient','Plug Mini (JP)','間接照明'],['shade','Roller Shade','ロールスクリーン'],['lock','Smart Lock Pro','会社ロックPro'],['hub','Hub 2','ハブ２'],['outside','Bot','看板ライト'],['foreign','Bot','別店舗']];
 const fetch=async(url,init)=>{
  const id=url.split('/').at(-2);
  if(init.method==='POST'){
   posts.push({id,...JSON.parse(init.body)});if(vendor.hold)await vendor.hold();
   if(vendor.postError===id) throw Error('lost response');
   const body=JSON.parse(init.body);
   if(id===ids.shade && body.command==='setPosition'){
    // Match the installed firmware: string positions are acknowledged but do
    // not move the shade. An empty response body can also acknowledge numbers.
    if(typeof body.parameter==='number') vendor.position=body.parameter;
    return Response.json({statusCode:100,body:{},message:'success'});
   }
   return Response.json({statusCode:100,body:{items:[{deviceID:id,code:100}]}});
  }
  reads.push(url);
  if(url.endsWith('/devices'))return Response.json({statusCode:100,body:{deviceList:list.map(([key,deviceType,deviceName])=>({deviceId:ids[key],deviceType,deviceName,enableCloudService:true,hubDeviceId:key==='ambient'?'':key==='foreign'?ids.foreign:ids.hub}))}});
  if(vendor.failLight && (id===ids.light || id===ids.hub))throw Error('offline');
  const [key,deviceType]=list.find(([key])=>ids[key]===id);
  const body={deviceId:id,deviceType,hubDeviceId:key==='ambient'?id:ids.hub,battery:99};
  if(deviceType==='Bot')Object.assign(body,{deviceMode:vendor.mode,power:'off'});
  if(key==='hub')Object.assign(body,{lightLevel:vendor.level,temperature:22,humidity:50});
  if(key==='ambient')Object.assign(body,{power:'off'});
  if(key==='shade')Object.assign(body,{calibrate:vendor.calibrated,slidePosition:vendor.position,moving:vendor.moving});
  if(key==='lock')Object.assign(body,{calibrate:vendor.calibrated,lockState:vendor.lock,doorState:vendor.door});
  return Response.json({statusCode:100,body});
 };
 const adapter=load('lib/switchbot.ts',{}, {fetch});
 const service=load('lib/store-devices.ts',{db:{sql},switchbot:adapter,'store-device-state':state,'store-light-state':light,'store-scene-state':policy});
 const scenes=load('lib/store-device-scenes.ts',{db:{sql},'store-devices':service,switchbot:adapter,'store-scene-state':policy,'store-device-state':state});
 const auth={session:{id:actorId,role:'owner'},stores:[{id:storeId}]};
 const access=load('lib/store-device-access.ts',{'api-auth':{requireOsSession:async()=>auth.session},'store-order-access':{getStoreOrderAccess:async()=>({stores:auth.stores})},'store-scene-state':policy});
 const route=load('app/api/store/devices/scenes/route.ts',{'server':{after:fn=>jobs.push(fn)},'store-device-access':access,'store-device-scenes':scenes,'store-devices':service,'store-scene-state':policy});
 return {db,sql,queries,posts,reads,jobs,vendor,service,scenes,route,auth,adapter,policy,storeId,actorId,otherStoreId,ids,
  key:id=>adapter.deviceKey(storeId,id),expire:()=>db.exec("update store_light_runtime set blocked_until=now()-interval '1 second'"),
  request:(method,body={},query='')=>new Request('https://store.example/api/store/devices/scenes?storeId='+storeId+query,{method,headers:{'Content-Type':'application/json',Origin:'https://store.example'},...(method==='GET'?{}:{body:JSON.stringify({storeId,...body})})})};
}
module.exports={fixture,policy,load,storeId,otherStoreId,actorId,ids};
