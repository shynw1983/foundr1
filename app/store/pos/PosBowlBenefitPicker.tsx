"use client";
import { isPosCampaignActive, type PosDiscountRule } from "../../../lib/pos-discount-campaigns";
import {resolvePosBowlChoice,posBowlEligible,posGiftAllowed,type PosBowlChoice,type PosBowlLine,type PosGiftItem,type PosBowlApplication} from "../../../lib/pos-bowl-benefits";
import {useOsTranslation} from "../../os/components/OsTranslationProvider";
export function PosBowlBenefitPicker({rules,line,gifts,now,disabled,onChange,applied}:{rules:PosDiscountRule[];line:PosBowlLine;gifts:PosGiftItem[];now:number;disabled:boolean;onChange:(value:PosBowlChoice|undefined)=>void;applied?:PosBowlApplication}) {
 const {t}=useOsTranslation();const active=rules.filter(r=>r.campaignBasis==='bowl_choice'&&isPosCampaignActive(r,now));
 const effective=resolvePosBowlChoice(rules,line,now), defaultChoice=resolvePosBowlChoice(rules,{...line,choice:undefined},now);
 const clear=()=>onChange(defaultChoice?{campaignKey:defaultChoice.campaignKey,kind:'none'}:undefined);
 if(!active.length&&!line.choice)return null;
 return <div className="store-pos-bowl-benefits" data-pos-bowl-benefits>
  {active.map(rule=>{const eligible=posBowlEligible(rule,line,now),selected=effective?.campaignKey===rule.key&&effective.kind!=='none'?effective:undefined,allowed=gifts.filter(g=>posGiftAllowed(rule,g));return <div key={rule.key}>
   <small>{rule.name} · {t('1杯')} ¥{rule.minimumSubtotal?.toLocaleString('ja-JP')}〜{!eligible?` · ${t('対象金額未満・通常価格')}`:''}</small>
   {eligible?<div className="store-pos-bowl-benefit-actions">{rule.bowlBenefitMode!=="gift_only"?<button type="button" data-pos-bowl-discount aria-pressed={selected?.kind==='discount'} disabled={disabled} onClick={()=>selected?.kind==='discount'?clear():onChange({campaignKey:rule.key,kind:'discount'})}>{t('割引')} {rule.discountType==='percent'?`${rule.discountValue}%`:`¥${rule.discountValue}`}</button>:null}
    {rule.bowlBenefitMode!=="discount_only"?<button type="button" data-pos-bowl-gift aria-pressed={selected?.kind==='gift'} disabled={disabled||!allowed.length} onClick={()=>selected?.kind==='gift'?clear():onChange({campaignKey:rule.key,kind:'gift'})}>{rule.giftButtonLabel||t('プレゼント')}</button>:null}
    {selected?.kind==='gift'&&rule.bowlBenefitMode!=="discount_only"?<label><span className="sr-only">{t('プレゼント')}</span><select data-pos-bowl-gift-item disabled={disabled} value={selected.giftItemId||''} onChange={e=>onChange({...selected,giftItemId:e.target.value})}><option value="">{t('プレゼントを選択')}</option>{allowed.map(g=><option key={g.id} value={g.id}>{g.kind==='option'?`${g.groupName} / `:''}{g.name} · ¥0</option>)}</select></label>:null}
    {!selected?<small>{t('特典を選択できます')}</small>:applied?.campaignKey!==rule.key&&(selected.kind!=='gift'||selected.giftItemId)?<small>{t('他の割引の方がお得なため、そちらを適用')}</small>:null}
   </div>:null}
  </div>})}
  {!line.choice&&effective?<small data-pos-bowl-auto>{t('条件を満たしたため割引を自動選択')}</small>:null}
  {line.choice?.kind==='none'?<small>{t('この杯の特典は適用しません')}</small>:null}
  {line.choice&&line.choice.kind!=='none'&&!active.some(r=>posBowlEligible(r,line,now)&&r.key===line.choice!.campaignKey)?<small>{t('特典の条件が変わりました。解除して確認してください。')}</small>:null}
  {effective&&effective.kind!=='none'?<button type="button" data-pos-bowl-clear disabled={disabled} onClick={clear}>{t('特典を解除')}</button>:line.choice?.kind==='none'&&defaultChoice?<button type="button" data-pos-bowl-auto-restore disabled={disabled} onClick={()=>onChange(undefined)}>{t('自動選択に戻す')}</button>:null}
  {applied?.gift?<small data-pos-bowl-applied-gift>{t('サービス')} · {applied.gift.name} · ¥0</small>:applied?<small>{t('この杯の割引')} −¥{applied.discountAmount}</small>:null}
 </div>
}
