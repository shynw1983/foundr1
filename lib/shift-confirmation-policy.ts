import { deriveSpecialHours, parseDate, type PublishedShift, type HoursRules } from './google-business-hours-policy.ts';
export type BusinessStatus = 'pending' | 'open' | 'closed';
export type ConfirmationSettings = { preparationMinutes?:number|null; cleanupMinutes?:number|null; autoConfirm: boolean; firstDay: number | null; firstTime: string | null; secondDay: number | null; secondTime: string | null };
export type SchedulePeriod = { key:string; month:string; half:'first_half'|'second_half'; dates:string[]; startDate:string; endDate:string };
export function schedulePeriod(key:string):SchedulePeriod {
  const match=/^(\d{4})-(0[1-9]|1[0-2])-(first_half|second_half)$/.exec(key);
  if(!match)throw new Error('対象期間を選択してください。');
  const month=key.slice(0,7),half=match[3] as SchedulePeriod['half'];
  const last=new Date(Date.UTC(Number(match[1]),Number(match[2]),0)).getUTCDate();
  const start=half==='first_half'?1:16,end=half==='first_half'?15:last;
  const dates=Array.from({length:end-start+1},(_,index)=>`${month}-${String(start+index).padStart(2,'0')}`);
  return {key,month,half,dates,startDate:dates[0],endDate:dates[dates.length-1]};
}
const validTime=(value:unknown):value is string=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validateConfirmationSettings(value:ConfirmationSettings) {
  if(typeof value.autoConfirm!=='boolean')throw new Error('自動確定の設定を確認してください。');
  for(const [day,time,max]of [[value.firstDay,value.firstTime,31],[value.secondDay,value.secondTime,16]] as const){
    if(day===null&&time===null&&!value.autoConfirm)continue;
    if(!Number.isInteger(day)||day===null||day<0||day>max||(max===16&&day===0)||!validTime(time))throw new Error('確定日と確定時刻を設定してください。');
  }
  return value;
}
export function confirmationDeadline(period:SchedulePeriod,settings:ConfirmationSettings):string|null {
  const day=period.half==='first_half'?settings.firstDay:settings.secondDay;
  const time=period.half==='first_half'?settings.firstTime:settings.secondTime;
  if(day===null||!validTime(time))return null;
  const [year,month]=period.month.split('-').map(Number);
  let date:Date;
  if(period.half==='first_half'&&day===0)date=new Date(Date.UTC(year,month-1,1));
  else if(period.half==='first_half'){
    const previous=new Date(Date.UTC(year,month-1,0));
    date=new Date(Date.UTC(previous.getUTCFullYear(),previous.getUTCMonth(),Math.min(day,previous.getUTCDate())));
  }else date=new Date(Date.UTC(year,month-1,day));
  return `${date.toISOString().slice(0,10)}T${time}:00+09:00`;
}
export function assertAfterSubmission(settings:ConfirmationSettings,submission:{firstDay:number;secondDay:number;time:string}) {
  // Compare full calendar instants, including February and short-month clamping.
  for(let month=1;month<=12;month++)for(const half of ['first_half','second_half'] as const){
    const period=schedulePeriod(`2027-${String(month).padStart(2,'0')}-${half}`);
    const deadline=confirmationDeadline(period,settings);
    if(!deadline)continue;
    const [year,number]=period.month.split('-').map(Number);
    const base=half==='first_half'?new Date(Date.UTC(year,number-1,0)):new Date(Date.UTC(year,number-1,1));
    const day=half==='first_half'?submission.firstDay:submission.secondDay;
    const source=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),day)).toISOString().slice(0,10);
    if(Date.parse(deadline)<=Date.parse(`${source}T${submission.time}:00+09:00`))throw new Error('確定時刻は希望シフトの提出期限より後にしてください。');
  }
}
export function dayReadiness(status:BusinessStatus,shifts:PublishedShift[],date:string,rules?:HoursRules):string|null {
  parseDate(date);
  if(status==='pending')return '営業予定が未確定です。';
  if(status==='closed')return shifts.length?'休業日にシフトがあります。営業予定またはシフトを確認してください。':null;
  if(!shifts.length)return '営業予定ですが人員が未配置です。Google の営業時間は変更しません。';
  try{deriveSpecialHours(shifts,rules??{preparationMinutes:0,cleanupMinutes:0},date.slice(0,7));return null;}
  catch(error){return error instanceof Error?error.message:'シフトの時間を確認してください。';}
}
export const periodKeyForDate=(date:string)=>{parseDate(date);return `${date.slice(0,7)}-${Number(date.slice(8))<=15?'first_half':'second_half'}`;};
