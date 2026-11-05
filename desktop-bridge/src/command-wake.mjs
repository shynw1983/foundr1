import WebSocket from 'ws';

// Reuse the authenticated presence channel used by Android. Notifications only
// wake the ordinary command claim; they never supply or execute command payloads.
export function createCommandWake(api,config,{Socket=WebSocket}={}) {
  const endpoint=`${config.serverUrl}/api/local-bridge/uber-eats/realtime?${new URLSearchParams({storeId:config.storeId,deviceName:config.deviceName||'Desktop Bridge'})}`;
  let socket,subscription=false,stopped=false,retry,heartbeat,pending=false,waiting,failures=0;
  const wake=()=>{pending=true;if(waiting){const resolve=waiting;waiting=null;pending=false;resolve();}};
  const schedule=()=>{if(!stopped){clearTimeout(retry);retry=setTimeout(connect,Math.min(300000,30000*2**Math.min(failures++,4)));retry.unref?.();}};
  async function connect(){
    if(stopped)return;
    try{
      const settings=await api.request(endpoint);
      if(stopped)return;
      if(settings.channel!==`presence-store-bridge-${config.storeId}`||!/^[-a-z0-9]+$/i.test(settings.cluster||'')||!/^[-a-z0-9]+$/i.test(settings.key||''))throw Error('invalid realtime scope');
      const current=new Socket(`wss://ws-${settings.cluster}.pusher.com/app/${settings.key}?protocol=7&client=foundr1-desktop&version=1.0`);
      socket=current;let lastMessage=Date.now();
      const send=value=>{if(socket===current&&current.readyState===1)current.send(JSON.stringify(value));};
      const timeout=setTimeout(()=>current.terminate(),20000);timeout.unref?.();
      current.on('message',async raw=>{
        if(stopped||socket!==current)return;
        try{
          const event=JSON.parse(String(raw));lastMessage=Date.now();
          if(event.event==='pusher:ping'){send({event:'pusher:pong',data:{}});return;}
          if(event.event==='pusher:connection_established'){
            const data=typeof event.data==='string'?JSON.parse(event.data):event.data;
            if(!/^\d+\.\d+$/.test(data?.socket_id||''))throw Error('invalid socket');
            const auth=await api.request(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({socket_id:data.socket_id,channel_name:settings.channel}).toString()});
            if(stopped||socket!==current)return;
            if(typeof auth.auth!=='string'||!auth.auth)throw Error('invalid subscription');
            send({event:'pusher:subscribe',data:{channel:settings.channel,auth:auth.auth,channel_data:auth.channel_data}});
          }else if(event.event==='pusher_internal:subscription_succeeded'&&event.channel===settings.channel){
            clearTimeout(timeout);subscription=true;failures=0;wake();
          }else if(event.event==='bridge.command.available'&&event.channel===settings.channel&&subscription)wake();
          else if(event.event==='pusher:error')current.terminate();
        }catch{current.terminate();}
      });
      current.on('error',()=>current.terminate());
      current.on('close',()=>{
        clearTimeout(timeout);
        if(socket!==current)return;
        socket=null;subscription=false;clearInterval(heartbeat);wake();schedule();
      });
      heartbeat=setInterval(()=>{
        if(Date.now()-lastMessage>90000)current.terminate();
        else send({event:'pusher:ping',data:{}});
      },25000);heartbeat.unref?.();
    }catch{subscription=false;schedule();}
  }
  return {
    get connected(){return subscription;},
    start(){void connect();},
    wait(ms){
      if(pending){pending=false;return Promise.resolve();}
      return new Promise(resolve=>{
        const timer=setTimeout(()=>{if(waiting===finish)waiting=null;resolve();},ms);
        const finish=()=>{clearTimeout(timer);resolve();};waiting=finish;
      });
    },
    stop(){stopped=true;clearTimeout(retry);clearInterval(heartbeat);subscription=false;socket?.terminate();wake();}
  };
}
