// Bounded, credential-free telemetry. Creation/migration acknowledgements are
// never throttled: they are part of the durable write protocol, not telemetry.
export function createMenuProgress(report, now=Date.now) {
  let state={startedAt:now(),phaseStartedAt:now(),completed:0,requestsCompleted:0,
    readRequestsCompleted:0,writeRequestsCompleted:0,recent:[]}, sent=-Infinity,sentIdentity='';
  const identity=value=>JSON.stringify(['sourceKey','targetName','targetKind','parentName'].map(key=>value[key]??''));
  const clearTarget={sourceKey:undefined,targetName:undefined,targetKind:undefined,parentName:undefined};
  const publish=async(force=false)=>{
    if(!force&&now()-sent<5000)return;
    await report({...state,updatedAt:now(),recent:[...state.recent]});sent=now();sentIdentity=identity(state);
  };
  return {
    async stage(update) {
      const changed=update.phase!==state.phase;
      const previousIdentity=identity(state);
      if(changed)state={...state,phaseStartedAt:now()};
      if(changed&&!update.sourceKey&&!update.authorityOperation&&!update.authorityMigration)state={...state,...clearTarget,completed:0,total:undefined};
      state={...state,...update};
      if(changed||identity(state)!==previousIdentity)state={...state,action:undefined,requestState:undefined,requestStartedAt:undefined,retry:0};
      const finished=Number.isSafeInteger(update.total)&&update.total>0&&update.completed===update.total;
      // Logical scans run against an already captured snapshot. They must not
      // wait for a network ACK per unchanged object. Actual native requests,
      // phase boundaries, completion and durable receipts still report promptly.
      await publish(changed||finished||Boolean(update.authorityOperation||update.authorityMigration));
      // Do not replay a durable operation on subsequent request heartbeats.
      delete state.authorityOperation;delete state.authorityMigration;
    },
    async request(event) {
      // A request scope is captured before queueing, so concurrent snapshot
      // reads never inherit the target from whichever request finished last.
      if(event.context)state={...state,...Object.fromEntries(Object.keys(clearTarget).map(key=>[key,event.context[key]]))};
      state={...state,action:event.action,requestState:event.state,retry:event.retry??0};
      if(event.state==='waiting')state.requestStartedAt=now();
      if(event.state==='received') {
        state.lastResponseAt=now();state.requestsCompleted++;
        if(event.action==='save')state.writeRequestsCompleted++;
        else state.readRequestsCompleted++;
        const row={at:now(),phase:state.phase,action:event.action,sourceKey:state.sourceKey,
          targetName:state.targetName,targetKind:state.targetKind,parentName:state.parentName,state:'received'};
        const last=state.recent[0];
        const same=last&&last.phase===row.phase&&last.action===row.action&&identity(last)===identity(row);
        state.recent=[{...row,...(same?{occurrences:(last.occurrences??1)+1}:{})},...state.recent.slice(same?1:0)].slice(0,10);
      }
      await publish(event.state==='retrying'||identity(state)!==sentIdentity);
    }
  };
}

export function menuRequestAction(path,method) {
  if(method==='POST'&&/\/stock\/stockout\/target-list(?:\?|$)/.test(path))return 'read_availability';
  if(method==='POST'&&/\/product\/search\/menu-pattern(?:\?|$)/.test(path))return 'read_menu';
  if(method!=='GET')return 'save';
  if(/stock|suspend/.test(path))return 'read_availability';
  if(/option-item|option-group|modifier|all-options/.test(path))return 'read_options';
  if(/\/(?:dishes|item)\/[^/]+(?:\/detail)?(?:\?|$)/.test(path))return 'read_item';
  if(/\/category\//.test(path))return 'read_category';
  return 'read_menu';
}
