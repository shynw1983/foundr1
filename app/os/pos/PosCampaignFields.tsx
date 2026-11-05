"use client";
import type { PosCampaignFields as CampaignFields } from "../../../lib/pos-discount-campaigns";
import { PosGiftSelector } from "./PosGiftSelector";
import type { PosGiftItem } from "../../../lib/pos-bowl-benefits";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./PosCampaignFields.module.css";
export function PosCampaignFields({ value, disabled, onChange, gifts=[] }: { value:CampaignFields; disabled:boolean; onChange:(patch:CampaignFields)=>void; gifts?:PosGiftItem[] }) {
 const {t}=useOsTranslation();
 return <div className={styles.fields} data-pos-campaign-fields>
  <label><span>{t("適用方法")}</span><select data-pos-campaign-mode value={value.applicationMode||"manual"} disabled={disabled} onChange={e=>onChange({applicationMode:e.target.value as "manual"|"campaign"})}><option value="manual">{t("スタッフが選択")}</option><option value="campaign">{t("キャンペーン")}</option></select></label>
  {value.applicationMode==='campaign'?<>
   <label><span>{t("計算単位")}</span><select data-pos-campaign-basis disabled={disabled} value={value.campaignBasis||'order'} onChange={e=>onChange({campaignBasis:e.target.value as 'order'|'bowl_choice',...(e.target.value==='bowl_choice'?{minimumSubtotal:value.minimumSubtotal||1000,startsOn:'',endsOn:'',giftItemIds:value.giftItemIds||[],giftCategories:value.giftCategories||[],giftOptionIds:value.giftOptionIds||[],giftOptionGroupIds:value.giftOptionGroupIds||[],giftButtonLabel:value.giftButtonLabel||'プレゼント'}:{})})}><option value="order">{t("会計全体・自動割引")}</option><option value="bowl_choice">{t("1杯ごとの特典")}</option></select></label>
   <label><span>{t("開始日（日本時間）")}</span><input type="date" data-pos-campaign-start value={value.startsOn||''} disabled={disabled} onChange={e=>onChange({startsOn:e.target.value})}/></label>
   <label><span>{t("終了日（当日を含む）")}</span><input type="date" data-pos-campaign-end value={value.endsOn||''} min={value.startsOn||undefined} disabled={disabled} onChange={e=>onChange({endsOn:e.target.value})}/></label>
   <button type="button" className="secondary-button" disabled={disabled} onClick={()=>onChange({startsOn:'',endsOn:''})}>{t("期間なし")}</button>
   <label><span>{t(value.campaignBasis==='bowl_choice'?'1杯の最低金額（円）':'最低購入金額（円）')}</span><input type="number" data-pos-campaign-minimum min="0" max="9999999" step="1" inputMode="numeric" value={value.minimumSubtotal??''} disabled={disabled} onChange={e=>onChange({minimumSubtotal:e.target.value===''?undefined:Number(e.target.value)})}/></label>
   <p>{t(value.campaignBasis==='bowl_choice'?'重量分と有料オプションを合算し、割引前の1杯ごとに判定します。プレゼントは1杯1点、最低金額には含みません。':'割引前の商品小計が条件を満たすと自動適用します。0円は最低金額なしです。')}{t('日付を両方空欄にすると期間なし。有効スイッチで開始・停止できます。')}</p>
   {value.campaignBasis==='bowl_choice'?<label><span>{t('特典の種類')}</span><select data-pos-bowl-benefit-mode value={value.bowlBenefitMode||'choice'} disabled={disabled} onChange={e=>onChange({bowlBenefitMode:e.target.value as CampaignFields['bowlBenefitMode']})}><option value="choice">{t('割引かプレゼントを選ぶ')}</option><option value="discount_only">{t('割引のみ')}</option><option value="gift_only">{t('プレゼントのみ')}</option></select></label>:null}
   {value.campaignBasis==='bowl_choice'&&value.bowlBenefitMode!=='gift_only'?<label><span>{t('条件達成時の初期選択')}</span><select data-pos-bowl-default-choice value={value.bowlDefaultChoice||'none'} disabled={disabled} onChange={e=>onChange({bowlDefaultChoice:e.target.value as 'none'|'discount'})}><option value="none">{t('スタッフが特典を選ぶ')}</option><option value="discount">{t('割引を自動選択')}</option></select><small>{t('1杯ごとの金額で判定し、プレゼントへの変更や解除もできます。')}</small></label>:null}
   {value.campaignBasis==='bowl_choice'&&value.bowlBenefitMode!=='discount_only'?<>
    <label><span>{t('プレゼントボタン名')}</span><input data-pos-gift-label maxLength={40} value={value.giftButtonLabel||''} placeholder={t('プレゼント')} disabled={disabled} onChange={e=>onChange({giftButtonLabel:e.target.value})}/></label>
    <PosGiftSelector value={value} disabled={disabled} onChange={onChange} gifts={gifts} />
   </>:null}
  </>:null}
 </div>
}
