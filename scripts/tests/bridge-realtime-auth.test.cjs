const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
function fixture({platform='desktop',enabled=true,configured=true}={}){
 const device={id:'device-a',store:'store-a',platform,token:'test-token',enabled},signatures=[];
 const process={env:{NODE_ENV:'production',...(configured?{PUSHER_KEY:'key',PUSHER_CLUSTER:'ap3'}:{})}};
 const sql=async(parts,...values)=>{const[hash,store,requestedPlatform]=values;return device.enabled&&store===device.store&&requestedPlatform===device.platform&&hash===crypto.createHash('sha256').update(device.token).digest('hex')?[{id:device.id}]:[];};
 function load(path,modules){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Request,Response,URL,Buffer,process,require:name=>{if(name==='node:crypto')return crypto;const key=name.split('/').at(-1);if(!modules[key])throw Error('unexpected module '+name);return modules[key];}});return exports;}
 const auth=load('lib/local-bridge-auth.ts',{db:{sql}});
 const route=load('app/api/local-bridge/uber-eats/realtime/route.ts',{'local-bridge-auth':auth,'local-bridge-realtime':{bridgeRealtimeChannel:store=>'presence-store-bridge-'+store},'order-realtime':{getPusher:()=>({authorizeChannel:(...args)=>{signatures.push(args);return{auth:'signature'};}})}});
 const request=(method,{store='store-a',token='test-token',channel='presence-store-bridge-store-a',socket='1.2'}={})=>new Request('https://fixture.invalid/api/local-bridge/uber-eats/realtime?'+new URLSearchParams({storeId:store,deviceName:'Mac'}),{method,headers:{authorization:'Bearer '+token,...(method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:new URLSearchParams({socket_id:socket,channel_name:channel})}:{})});
 return{route,request,signatures};
}
test('enabled desktop credential reads realtime config and signs only its own presence channel',async()=>{
 const f=fixture();let response=await f.route.GET(f.request('GET'));assert.equal(response.status,200);assert.equal((await response.json()).channel,'presence-store-bridge-store-a');
 response=await f.route.POST(f.request('POST'));assert.equal(response.status,200);assert.equal(f.signatures.length,1);assert.equal(f.signatures[0][2].user_id,'bridge:device-a');assert.equal(f.signatures[0][2].user_info.platform,'desktop');
});
test('wrong token, disabled credential and other-store scope cannot read config or sign',async()=>{
 for(const[settings,params]of[[{}, {token:'wrong'}],[{enabled:false},{}],[{}, {store:'store-b'}]]){
  const f=fixture(settings);for(const method of ['GET','POST'])assert.equal((await f.route[method](f.request(method,params))).status,401);assert.equal(f.signatures.length,0);
 }
});
test('valid desktop token cannot subscribe to another channel or omit socket identity',async()=>{
 const f=fixture();for(const params of[{channel:'presence-store-bridge-store-b'},{channel:'public'},{socket:''}])assert.equal((await f.route.POST(f.request('POST',params))).status,400);assert.equal(f.signatures.length,0);
});
test('Android platform credentials retain existing realtime access',async()=>{
 for(const platform of ['uber_eats','rocket_now','demae_can']){const f=fixture({platform});assert.equal((await f.route.GET(f.request('GET'))).status,200);assert.equal((await f.route.POST(f.request('POST'))).status,200);}
});
test('missing realtime service configuration returns unavailable without changing authentication',async()=>{
 const f=fixture({configured:false});assert.equal((await f.route.GET(f.request('GET'))).status,503);assert.equal((await f.route.GET(f.request('GET',{token:'wrong'}))).status,401);assert.equal(f.signatures.length,0);
});
