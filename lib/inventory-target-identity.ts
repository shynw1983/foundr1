// Names are labels, not relationships. Non-ID callers must identify exactly
// one row; quantity, brackets, promotions and translations are never erased.
export function selectInventoryIdentity<T extends {id:string;name:string;displayNames:Record<string,unknown>|null}>(rows:T[],label:string,targetId=''):T|null {
 const normalized=(s:unknown)=>String(s??'').normalize('NFKC').trim();
 const matches=targetId?rows.filter(r=>r.id===targetId):rows.filter(r=>[r.name,...Object.values(r.displayNames??{})].some(name=>normalized(name)===normalized(label)));
 return matches.length===1?matches[0]:null;
}
