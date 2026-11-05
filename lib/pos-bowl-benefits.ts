import { evaluatePosDiscounts, isPosCampaignActive, posDiscountAmount, posDiscountEligibleAmount, type PosDiscountLine, type PosDiscountRule } from "./pos-discount-campaigns.ts";

export type PosBowlChoice = { campaignKey: string; kind: "discount" | "gift" | "none"; giftItemId?: string };
export type PosGiftItem = { id: string; brandId: string; category: string; name: string; displayNames?: Record<string,string>; price: number; available: boolean; fixed: boolean; requiresOptions?: boolean; sourceItemId?: string; kind?: "item" | "option"; optionId?: string; groupId?: string; groupName?: string };
export type PosBowlLine = PosDiscountLine & { isBowl: boolean; quantity: number; choice?: PosBowlChoice };
export type PosBowlApplication = { index: number; campaignKey: string; campaignName: string; kind: "discount" | "gift"; discountAmount: number; gift?: PosGiftItem; minimumSubtotal: number; subtotal: number };
export function posGiftAllowed(rule: PosDiscountRule, gift: PosGiftItem) {
  const sourceAllowed = gift.kind === "option"
    ? Boolean(gift.optionId && gift.groupId && ((rule.giftOptionIds || []).includes(gift.optionId) || (rule.giftOptionGroupIds || []).includes(gift.groupId)))
    : (rule.giftItemIds || []).includes(gift.id) || (rule.giftCategories || []).some(c => c.brandId === gift.brandId && c.category === gift.category);
  return rule.bowlBenefitMode !== "discount_only" && gift.available && gift.fixed && !gift.requiresOptions && Number.isSafeInteger(gift.price) && gift.price >= 0 && sourceAllowed;
}
export function posBowlEligible(rule: PosDiscountRule, line: PosBowlLine, now: number | Date = Date.now()) {
  return line.isBowl && line.quantity === 1 && rule.campaignBasis === "bowl_choice" && isPosCampaignActive(rule, now)
    && Number.isSafeInteger(rule.minimumSubtotal) && (rule.minimumSubtotal ?? -1) >= 0 && line.amount >= (rule.minimumSubtotal ?? 0)
    && posDiscountEligibleAmount(rule, [line], line.amount) > 0;
}
/** Explicit choices and opt-outs win; overlapping defaults choose one greatest discount. */
export function resolvePosBowlChoice(rules: PosDiscountRule[], line: PosBowlLine, now: number | Date = Date.now()): PosBowlChoice | undefined {
  if (line.choice) return line.choice;
  const candidates = rules.filter(r => r.bowlDefaultChoice === "discount" && r.bowlBenefitMode !== "gift_only" && posBowlEligible(r, line, now))
    .map(rule => ({ rule, amount: posDiscountAmount(rule, [line], line.amount) })).filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.rule.key.localeCompare(b.rule.key, "en"));
  return candidates[0] ? { campaignKey: candidates[0].rule.key, kind: "discount" } : undefined;
}
/** Integer allocations are deterministic and conserve the original discount. */
function shares(amount: number, weights: number[]) {
  const normalized=weights.map(weight=>Math.max(0,Math.round(weight))),total=normalized.reduce((a,b)=>a+b,0);
  if(!total || amount<=0)return weights.map(()=>0);
  const raw=normalized.map(weight=>Math.min(amount,total)*weight/total), result=raw.map(Math.floor);
  let remaining=Math.min(amount,total)-result.reduce((a,b)=>a+b,0);
  raw.map((value,index)=>({index,fraction:value-Math.floor(value)})).sort((a,b)=>b.fraction-a.fraction||a.index-b.index).forEach(({index})=>{if(remaining>0){result[index]++;remaining--;}});
  return result;
}
export function evaluatePosBowlBenefits<T extends PosDiscountRule>(rules:T[], manualKey:string, lines:PosBowlLine[], gifts:PosGiftItem[], now:number|Date=Date.now()) {
  const subtotal=lines.reduce((sum,l)=>sum+l.amount,0), base=evaluatePosDiscounts(rules,manualKey,lines,subtotal,now);
  const weights=lines.map(l=>base.preset ? posDiscountEligibleAmount(base.preset,[l],l.amount):0);
  // Match the checkout largest-remainder allocation; never charge a rounding residual to one bowl.
  const eligible=weights.flatMap((w,i)=>w>0?[i]:[]), allocations=lines.map(()=>0);
  shares(base.amount,eligible.map(i=>weights[i])).forEach((v,i)=>{allocations[eligible[i]]=v;});
  const applications:PosBowlApplication[]=[], errors:string[]=[], usedRules:T[]=[];
  lines.forEach((line,index)=>{
    const choice = resolvePosBowlChoice(rules, line, now);
    if (!choice || choice.kind === "none") return;
    const rule=rules.find(r=>r.key===choice.campaignKey);
    if (!rule || !posBowlEligible(rule,line,now)) { errors.push("この杯はキャンペーン対象外です。特典を解除して内容を確認してください。"); return; }
    const kind=choice.kind;
    if (kind !== "discount" && kind !== "gift") {errors.push("特典を選び直してください。");return;}
    if ((kind === "discount" && rule.bowlBenefitMode === "gift_only") || (kind === "gift" && rule.bowlBenefitMode === "discount_only")) { errors.push("特典の種類が変わりました。特典を選び直してください。"); return; }
    const gift=kind==='gift'?gifts.find(g=>g.id===choice.giftItemId && posGiftAllowed(rule,g)):undefined;
    if (kind==='gift'&&!gift) {errors.push(!choice.giftItemId ? "プレゼント商品を選択してください。" : "プレゼント商品の販売状態が変わりました。メニューを更新して選び直してください。");return;}
    const discount=kind==='discount'?posDiscountAmount(rule,[line],line.amount):0;
    // Compare against the other discount already allocated to this bowl; never stack on it.
    if ((gift?.price ?? discount) < allocations[index]) return;
    allocations[index]=discount;usedRules.push(rule);
    applications.push({index,campaignKey:rule.key,campaignName:rule.name,kind,discountAmount:discount,gift,minimumSubtotal:rule.minimumSubtotal ?? 0,subtotal:line.amount});
  });
  const hasBase=allocations.some((a,i)=>a>0&&!applications.some(app=>app.index===i));
  if(hasBase&&base.preset)usedRules.push(base.preset);
  const amount=allocations.reduce((a,b)=>a+b,0);
  const appliedKey=applications.length ? 'bowl:'+applications.map(a=>`${a.index}:${a.campaignKey}:${a.kind}:${a.gift?.id||''}`).join('|')+(hasBase?`+${base.appliedKey}`:'') : base.appliedKey;
  const preset=applications.length ? {...usedRules[0],key:appliedKey,name:[...new Set(usedRules.map(r=>r.name))].join(' / '),allowCouponCombination:usedRules.every(r=>r.allowCouponCombination===true),stampEligible:usedRules.every(r=>r.stampEligible===true)} : base.preset;
  return {amount,allocations,applications,errors,preset,appliedKey,usedRules,base};
}
export function posBowlQuote(result:ReturnType<typeof evaluatePosBowlBenefits>) {
  return {version:2,appliedKey:result.appliedKey,amount:result.amount,bowls:result.applications.map(a=>({index:a.index,campaignKey:a.campaignKey,kind:a.kind,giftItemId:a.gift?.id||'',giftPrice:a.gift?.price??0,discountAmount:a.discountAmount,subtotal:a.subtotal}))};
}
export function matchesPosBowlQuote(value:unknown, result:ReturnType<typeof evaluatePosBowlBenefits>) {
  if (!value || typeof value !== 'object') return false;
  const quote=value as Record<string,unknown>, expected=posBowlQuote(result);
  return quote.version===2 && quote.appliedKey===expected.appliedKey && quote.amount===expected.amount && Array.isArray(quote.bowls) && quote.bowls.length===expected.bowls.length && expected.bowls.every((entry,index)=>{
    const row=(quote.bowls as unknown[])[index];return !!row && typeof row==='object' && Object.entries(entry).every(([key,v])=>(row as Record<string,unknown>)[key]===v);
  });
}
