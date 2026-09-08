import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

export const statusDirectory = path.join(homedir(), 'Library', 'Application Support', 'Foundr1 Bridge');
export function publicError(error) {
  const value = String(error ?? '');
  if (/401|403|login|credentials|MWA0007/i.test(value)) return '授权或登录需要检查';
  if (/timeout|timed out/i.test(value)) return '连接超时';
  if (/mapping|未登録|not found|未找到|verification failed/i.test(value)) return '商品对应关系需要检查';
  return '执行异常，请查看网页任务详情';
}

export async function createLocalStatus(config, directory = statusDirectory) {
  await mkdir(directory, {recursive:true, mode:0o700});
  const state = {version:'0.2.0', pid:process.pid, deviceName:config.deviceName, storeId:config.storeId,
    serverUrl:config.serverUrl, startedAt:Date.now(), heartbeatAt:Date.now(), lastServerAt:0,
    current:null, recent:[], platforms:{}, serviceError:'', activity:'启动中'};
  let saving = Promise.resolve();
  const save = () => {
    state.heartbeatAt=Date.now();
    const data=JSON.stringify(state);
    saving=saving.catch(()=>{}).then(async()=>{
      await writeFile(path.join(directory,'status.tmp'),data,{mode:0o600});
      await rename(path.join(directory,'status.tmp'),path.join(directory,'status.json'));
    }).catch(()=>{console.error('local_status_write_failed');});
    return saving;
  };
  await save();
  const timer=setInterval(()=>void save().catch(()=>{}),2000);timer.unref();
  return {state,save,
    async action() {
      const file=path.join(directory,'action.json');let request;
      try {request=JSON.parse(await readFile(file,'utf8'));await unlink(file);} catch {return null;}
      if (!Number.isFinite(request.at)||Math.abs(Date.now()-request.at)>600000) return null;
      if (!['check','restart','open:uber_eats','open:rocket_now','open:demae_can'].includes(request.action)) return null;
      return request.action;
    },
    progress(command,progress) {
      // Explicit allowlist: no command payload, credentials, customer data or raw errors.
      state.current={id:command.id,platform:command.platform,type:command.type,phase:String(progress.phase??'executing'),
        attempt:Number(progress.attempt)||null,updatedAt:Date.now(),startedAt:state.current?.startedAt??Date.now()};
      return save();
    },
    finish(command,error) {
      const row={id:command.id,platform:command.platform,type:command.type,at:Date.now(),ok:!error,error:error?publicError(error):''};
      state.recent=[row,...state.recent].slice(0,8);
      state.platforms[command.platform]={...state.platforms[command.platform],task:row};
      state.current=null;state.activity='空闲';return save();
    }
  };
}
