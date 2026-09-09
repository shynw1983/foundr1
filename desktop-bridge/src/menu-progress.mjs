// Bounded, credential-free telemetry. Creation/migration acknowledgements are
// never throttled: they are part of the durable write protocol, not telemetry.
export function createMenuProgress(report, now=Date.now) {
  let state={startedAt:now(),phaseStartedAt:now(),completed:0,requestsCompleted:0,recent:[]}, sent=-Infinity;
  const publish=async(force=false)=>{
    if(!force&&now()-sent<5000)return;
    await report({...state,updatedAt:now(),recent:[...state.recent]});sent=now();
  };
  return {
    async stage(update) {
      const changed=update.phase!==state.phase;
      if(changed)state={...state,phaseStartedAt:now()};
      if(changed&&!update.sourceKey&&!update.authorityOperation&&!update.authorityMigration)state={...state,sourceKey:undefined,targetName:undefined,completed:0,total:undefined};
      state={...state,...update};
      await publish(changed||Boolean(update.authorityOperation||update.authorityMigration));
      // Do not replay a durable operation on subsequent request heartbeats.
      delete state.authorityOperation;delete state.authorityMigration;
    },
    async request(event) {
      state={...state,action:event.action,requestState:event.state,retry:event.retry??0};
      if(event.state==='waiting')state.requestStartedAt=now();
      if(event.state==='received') {
        state.lastResponseAt=now();state.requestsCompleted++;
        state.recent=[{at:now(),action:event.action,targetName:state.targetName??'',state:'received'},...state.recent].slice(0,10);
      }
      await publish(event.state==='retrying');
    }
  };
}

export function menuRequestAction(path,method) {
  if(method!=='GET')return 'save';
  if(/option-item|option-group|modifier/.test(path))return 'read_options';
  if(/stock|suspend/.test(path))return 'read_availability';
  return 'read_menu';
}
