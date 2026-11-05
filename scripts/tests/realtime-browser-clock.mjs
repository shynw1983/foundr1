// Controlled browser clock for consumer-level request-budget tests.
export const browserClockFixture = `const nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window);
window.__now=Date.now();const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.__now]))}static now(){return window.__now}};
Object.defineProperty(performance,'now',{value:()=>window.__now});Math.random=()=>0;
let timerId=100000,timers=new Map();window.setTimeout=(fn,ms=0,...args)=>{if(ms<500)return nativeSetTimeout(fn,ms,...args);const id=++timerId;timers.set(id,{at:window.__now+ms,fn:()=>fn(...args)});return id};window.clearTimeout=id=>{if(!timers.delete(id))nativeClearTimeout(id)};
window.setInterval=(fn,ms,...args)=>{const id=++timerId;const tick=()=>{timers.set(id,{at:window.__now+ms,fn:tick});fn(...args)};timers.set(id,{at:window.__now+ms,fn:tick});return id};window.clearInterval=id=>timers.delete(id);
window.__advance=async ms=>{const end=window.__now+ms;let budget=3000;while(budget--){const pair=[...timers].filter(([id,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;window.__now=pair[1].at;timers.delete(pair[0]);pair[1].fn();await new Promise(r=>nativeSetTimeout(r,0));await new Promise(r=>nativeSetTimeout(r,0));}if(budget<0)throw Error('Timer runaway');window.__now=end;await new Promise(r=>nativeSetTimeout(r,0))};
`;
