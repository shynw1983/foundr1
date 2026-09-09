import type {MenuChange} from './uber-menu-diff';

export function canonicalMenuValue(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonicalMenuValue).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${canonicalMenuValue(v)}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}
function parsed(value:string):unknown {try{return JSON.parse(value);}catch{return value;}}
export function meaningfulMenuChanges(changes:MenuChange[]=[]):MenuChange[] {
  return changes.filter(c=>c.field!=='数量ルール'||canonicalMenuValue(parsed(c.before))!==canonicalMenuValue(parsed(c.after)));
}
export function menuChangeValue(change:MenuChange,value:string,language:string):string {
  const label=(ja:string,cn:string,tw=cn)=>language==='ja'?ja:language==='zh-Hant'?tw:cn;
  if(!value)return label('なし','无','無');
  if(change.field==='価格')return `${Number(value).toLocaleString(language)} ${label('円','日元','日圓')}`;
  if(change.field!=='数量ルール')return value;
  const quantity=parsed(value);
  if(!Array.isArray(quantity))return label('数量設定（詳細は技術情報）','数量设置（详见技术信息）','數量設定（詳見技術資訊）');
  const [min,max,info]=quantity;
  const result=[Number(min)>0?label(`最低 ${min} 個を選択`,`至少选 ${min} 份`,`至少選 ${min} 份`):label('選択は任意','可不选','可不選'),Number(max)===-1?label('上限なし','无上限','無上限'):label(`最大 ${max} 個`,`最多 ${max} 份`)];
  const rule=info?.defaultValue??{};
  for(const [key,ja,cn,tw] of [['defaultQuantity','初期選択数','默认份数','預設份數'],['minPermittedUnique','最低種類数','至少种类数','至少種類數'],['maxPermittedUnique','最大種類数','最多种类数','最多種類數'],['chargeAbove','追加料金の基準数','加价起算份数','加價起算份數'],['refundUnder','減額の基準数','减价基准份数','減價基準份數']] as const)if(rule[key]!=null)result.push(`${label(ja,cn,tw)}：${rule[key]}`);
  if(rule.isMinPermittedOptional!=null)result.push(label('最低数の選択は任意','最低份数可选','最低份數可選')+`：${rule.isMinPermittedOptional?label('はい','是'):label('いいえ','否')}`);
  if(info?.overrides?.length)result.push(label(`商品別の例外 ${info.overrides.length} 件`,`商品专属规则 ${info.overrides.length} 条`,`商品專屬規則 ${info.overrides.length} 條`));
  return result.join(' · ');
}
