"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { buildPosPrintDocumentSnapshots } from "../../../lib/pos-print-document-builder";
import { getPosBowlTicketSettings, resolvePosBowlTicketTemplate, type PosBowlTicketKind, type PosKitchenTicketBlock, type PosKitchenTicketBlockStyle, type PosKitchenTicketTemplateSettings, type PosPrintPayload, type PosPrinterSettings } from "../../../lib/pos-printer";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { PosPrintContentPreview } from "./PosSavedPrintPreviews";
import styles from "./PosPrintDocumentsEditor.module.css";

export type PosPrintOptionGroup = { id: string; name: string; brandId: string; options?: Array<{ name: string }> };

export type PosPrintDocumentTab = PosBowlTicketKind | "receipt";
const documentLabels: Record<PosPrintDocumentTab, string> = { kitchen: "厨房伝票", finishing: "出品伝票", pickup: "お客様番号札", receipt: "レシート" };
const documentKinds = ["kitchen", "finishing", "pickup", "receipt"] as const;
const blockLabels: Record<PosKitchenTicketBlock, string> = { title: "タイトル", store: "店舗・ブランド", pickup: "受取番号", orderType: "注文区分", items: "商品・オプション", note: "備考", message: "固定メッセージ", timestamp: "印刷日時" };
const visibilityKeys = { title: "showTitle", store: "showStoreName", pickup: "showPickupCode", orderType: "showOrderType", items: "showItems", note: "showNote", timestamp: "showTimestamp" } as const;
const sampleName = (en: string, zh: string, zhHant: string) => ({ en, zh, "zh-Hant": zhHant });

/** A read-only example follows the production document builder and resolver. */
export function createPosTicketExample(settings: PosPrinterSettings, kind: PosBowlTicketKind, brandId: string, brandName: string, storeName: string, language = "ja", groups: PosPrintOptionGroup[] = []): PosPrintPayload {
  const noodle = { id: "sample-noodle", groupId: "sample-noodles", groupName: "麺", groupDisplayNames: sampleName("Noodles", "面条", "麵條"), name: "春雨 50g", displayNames: sampleName("Glass noodles 50g", "粉丝 50g", "冬粉 50g") };
  const documents = buildPosPrintDocumentSnapshots(settings, storeName, {
    pickupCode: "037", orderType: "eat_in", paymentMethod: "cash", amount: 1920, subtotalAmount: 1920,
    discountAmount: 0, couponDiscountAmount: 0, taxAmount: 175, taxRate: 10,
    cashTenderedAmount: 2000, cashChangeAmount: 80, receiptRequested: false, note: "", memberLanguage: language, printedAt: "2026-10-22T03:34:00.000Z"
  }, [{
    orderItemId: "sample-bowl", brandId, brandName, name: "麻辣湯", displayNames: sampleName("Malatang", "麻辣烫", "麻辣燙"),
    quantity: 1, amount: 1920, measuredQuantity: 250, measuredUnit: "g", measuredUnitPrice: 4, preparationNote: "辛さ控えめ・アレルギーを確認",
    selectedOptions: groups.length ? groups.map(group => ({ id: `sample-${group.id}`, groupId: group.id, groupName: group.name, name: group.options?.[0]?.name || "選択肢の例" })) : [
      { id: "sample-flavor", groupId: "sample-flavors", groupName: "味", groupDisplayNames: sampleName("Flavor", "口味", "口味"), name: "豚骨", displayNames: sampleName("Pork broth", "豚骨", "豚骨") },
      noodle, noodle,
      { id: "sample-topping", groupId: "sample-toppings", groupName: "追加", groupDisplayNames: sampleName("Add-ons", "加料", "加料"), name: "牛筋 50g", displayNames: sampleName("Beef tendon 50g", "牛筋 50g", "牛筋 50g") },
      { id: "sample-drink", groupId: "sample-drinks", groupName: "飲み物", groupDisplayNames: sampleName("Drinks", "饮料", "飲料"), name: "ウーロン茶", displayNames: sampleName("Oolong tea", "乌龙茶", "烏龍茶") }
    ]
  }], [{ itemIndex: 0, itemId: "sample-bowl", pickupCode: "037" }], "none");
  return documents.find(document => document.kind === kind)!.payload;
}

function isVisible(template: PosKitchenTicketTemplateSettings, block: PosKitchenTicketBlock) {
  return block === "message" ? Boolean(template.customMessage) : template[visibilityKeys[block]];
}

export function PosKitchenTicketPreview({ payload, sample = true }: { payload: PosPrintPayload; sample?: boolean }) {
  const { t } = useOsTranslation();
  if (!payload.kitchenTicketTemplate || !payload.order) return null;
  return <aside className={styles.preview} data-ticket-preview aria-label={t("伝票プレビュー")}>
    <div className={styles.previewHeading}><strong>{t(sample ? "例の注文でプレビュー" : "保存済みの票面")}</strong><span>{payload.printer.paperWidth}</span></div>
    <div data-i18n-ignore data-ticket-paper={payload.printer.paperWidth}><PosPrintContentPreview content={{ ...payload, paperWidth: payload.printer.paperWidth }} /></div>
    <small>{t(sample ? "例の注文です。売上・注文・在庫には保存しません。実際の票面は注文内容と保存した設定で決まります。" : "会計時に保存された内容です。現在のテンプレート変更はこの伝票に反映しません。")}</small>
  </aside>;
}

function PosBowlTicketSettings({ settings, kind, brandId, brandName, storeName, disabled, onChange, optionGroups = [] }: { optionGroups?: PosPrintOptionGroup[]; settings: PosPrinterSettings; kind: PosBowlTicketKind; brandId: string; brandName: string; storeName: string; disabled: boolean; onChange: (settings: PosPrinterSettings) => void }) {
  const { t } = useOsTranslation();
  const [previewLanguage, setPreviewLanguage] = useState("ja");
  const document = getPosBowlTicketSettings(settings, kind);
  const resolved = resolvePosBowlTicketTemplate(settings, kind, brandId, "ja");
  const rawDocument = settings.bowlTickets?.[kind];
  const rawTemplate = rawDocument?.templateVariants?.find(item => item.brandId === brandId)?.template ?? rawDocument?.template;
  // Preserve text while typing. Only the resolved preview applies fallback copy.
  const template = { ...resolved, title: rawTemplate?.title ?? resolved.title, customMessage: rawTemplate?.customMessage ?? resolved.customMessage };
  const hasOverride = brandId ? document.templateVariants.some(item => item.brandId === brandId) : document.template !== null;
  function updateDocument(patch: Partial<typeof document>) {
    if (disabled) return;
    onChange({ ...settings, bowlTickets: { ...settings.bowlTickets, [kind]: { ...document, ...patch } } });
  }
  function updateTemplate(patch: Partial<PosKitchenTicketTemplateSettings>) {
    const next = { ...template, ...patch };
    if (brandId) updateDocument({ templateVariants: [...document.templateVariants.filter(item => item.brandId !== brandId), { brandId, brandName, template: next }] });
    else updateDocument({ template: next });
  }
  function updateStyle(block: PosKitchenTicketBlock, patch: Partial<PosKitchenTicketBlockStyle>) {
    updateTemplate({ blockStyles: { ...template.blockStyles, [block]: { ...template.blockStyles[block], ...patch } } });
  }
  function move(block: PosKitchenTicketBlock, direction: -1 | 1) {
    const order = [...template.blockOrder], index = order.indexOf(block), target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]]; updateTemplate({ blockOrder: order });
  }
  const groups = optionGroups.filter(group => !brandId || group.brandId === brandId);
  const example = createPosTicketExample(settings, kind, brandId || "sample-brand", brandName || "まぁ麻", storeName, kind === "pickup" ? previewLanguage : "ja", groups);
  return <div className={styles.document} data-bowl-editor={kind}>
    <fieldset disabled={disabled} className={styles.fieldset}>
      <div className={styles.documentControls}>
        <label className={styles.check}><input type="checkbox" data-print-document-enabled checked={document.enabled} onChange={event => updateDocument({ enabled: event.target.checked })} /><span>{t("この伝票を印刷する")}</span></label>
        <label className={styles.copies}><span>{t("印刷枚数")}</span><select data-print-document-copies value={document.copies} onChange={event => updateDocument({ copies: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      </div>
      <p className={styles.help}>{t("印刷のON/OFFと枚数は、この票種の全ブランド共通です。ブランド切替はテンプレートだけに適用します。")}</p>
      <div className={styles.scopeNotice}><span>{brandId ? t("選択中のブランドのテンプレート") : t("店舗共通のテンプレート")}</span><button type="button" className="secondary-button compact-button" data-print-template-inherit disabled={!hasOverride} onClick={() => brandId ? updateDocument({ templateVariants: document.templateVariants.filter(item => item.brandId !== brandId) }) : updateDocument({ template: null })}>{t("継承する設定に戻す")}</button></div>
      <p className={styles.help}>{t(kind === "pickup" ? "お客様番号札の備考・金額は既定で非表示です。有効にするとお客様にも表示されます。商品名・選択肢は会員の言語に合わせます。" : "厨房・出品伝票の商品名・選択肢は日本語で印刷します。基本言語は見出しなどの表記に適用します。")}</p>
      {kind === "pickup" ? <p className={styles.help}>{t("既定のタイトル・案内文も会員の言語に合わせます。独自に入力した文章はそのまま印刷します。")}</p> : null}
      <p className={styles.help}>{t("表示する情報を票種ごとに選択します。非表示の情報とその余白は印刷しません。")}</p>
      <div className={styles.workspace}>
        <div className={styles.editor}>
          <div className={styles.grid}>
            <label><span>{t("タイトル")}</span><input data-print-template-title value={template.title} maxLength={80} onChange={event => updateTemplate({ title: event.target.value })} /></label>
            <label><span>{t("見出しの基本表記")}</span><select data-print-template-language value={template.language} onChange={event => updateTemplate({ language: event.target.value as "ja" | "zh" })}><option value="ja">{t("日本語")}</option><option value="zh">{t("中国語")}</option></select></label>
            <label className={styles.check}><input type="checkbox" data-print-template-large checked={template.largeText} onChange={event => updateTemplate({ largeText: event.target.checked })} /><span>{t("大きめの文字で印刷")}</span></label>
            {<label className={styles.check}><input type="checkbox" data-print-template-amounts checked={template.showAmounts} onChange={event => updateTemplate({ showAmounts: event.target.checked })} /><span>{t("金額を表示")}</span></label>}
          </div>
          <div className={styles.contentRules} data-ticket-content-rules>
            <strong>{t("商品情報の表示")}</strong>
            {([['showWeight', '重量を表示'], ['showOptions', '選択肢を表示'], ['showOptionGroupNames', '選択肢のグループ名を表示']] as const).map(([key, label]) => <label className={styles.check} key={key}><input type="checkbox" data-ticket-content={key} checked={template[key]} onChange={event => updateTemplate({ [key]: event.target.checked })} /><span>{t(label)}</span></label>)}
            <details open data-ticket-option-groups><summary>{t("印刷する選択肢グループ")}</summary>
              <p className={styles.help}>{t("未設定・新規グループは表示します。この票種だけに適用され、メニューや他の伝票は変更しません。")}</p>
              <div className={styles.groupActions}><button type="button" className="secondary-button compact-button" onClick={() => updateTemplate({ optionGroupVisibility: { ...template.optionGroupVisibility, ...Object.fromEntries(groups.map(group => [group.id, true])) } })}>{t("すべて表示")}</button><button type="button" className="secondary-button compact-button" onClick={() => updateTemplate({ optionGroupVisibility: { ...template.optionGroupVisibility, ...Object.fromEntries(groups.map(group => [group.id, false])) } })}>{t("すべて非表示")}</button></div>
              {groups.map(group => <label className={styles.check} key={group.id}><input type="checkbox" data-ticket-option-group={group.id} disabled={!template.showOptions} checked={template.optionGroupVisibility[group.id] !== false} onChange={event => updateTemplate({ optionGroupVisibility: { ...template.optionGroupVisibility, [group.id]: event.target.checked } })} /><span data-i18n-ignore>{group.name}</span></label>)}
              {!groups.length ? <p className={styles.help}>{t("現在のメニューに選択肢グループがありません。")}</p> : null}
            </details>
            {!template.showPickupCode ? <p className={styles.help}>{t("受取番号を非表示にすると、伝票同士の照合ができなくなります。")}</p> : null}
          </div>
          <label className={styles.message}><span>{t("固定メッセージ")}</span><textarea data-print-template-message rows={2} maxLength={240} value={template.customMessage} onChange={event => updateTemplate({ customMessage: event.target.value })} /></label>
          <div className={styles.blockHeading}><strong>{t("表示区画と順序")}</strong><span>{t("矢印で並べ替え、区画ごとに印刷スタイルを指定")}</span></div>
          {template.blockOrder.map((block, index) => <div key={block} className={styles.blockRow} data-print-block={block} data-print-block-locked={false}>
            <div className={styles.blockTop}>
              {block === "message" ? <span>{t(blockLabels[block])}</span> : <label className={styles.check}><input type="checkbox" data-print-block-visible checked={isVisible(template, block)} onChange={event => updateTemplate({ [visibilityKeys[block]]: event.target.checked })} /><span>{t(blockLabels[block])}</span></label>}
              <div className={styles.move}><button type="button" data-print-block-move="up" className="icon-button" aria-label={t("「{name}」を上へ", { name: t(blockLabels[block]) })} onClick={() => move(block, -1)} disabled={index === 0}><ArrowUp size={14} /></button><button type="button" data-print-block-move="down" className="icon-button" aria-label={t("「{name}」を下へ", { name: t(blockLabels[block]) })} onClick={() => move(block, 1)} disabled={index === template.blockOrder.length - 1}><ArrowDown size={14} /></button></div>
            </div>
            {<div className={styles.blockControls}>
              <label><span>{t("文字")}</span><select data-print-block-font value={template.blockStyles[block].textSize} onChange={event => updateStyle(block, { textSize: event.target.value as PosKitchenTicketBlockStyle["textSize"] })}>{([['small', '小'], ['standard', '標準'], ['large', '大'], ['xlarge', '特大']] as const).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label>
              <label><span>{t("配置")}</span><select data-print-block-alignment value={template.blockStyles[block].alignment} onChange={event => updateStyle(block, { alignment: event.target.value as "left" | "center" })}><option value="left">{t("左")}</option><option value="center">{t("中央")}</option></select></label>
              <label className={styles.check}><input type="checkbox" data-print-block-bold checked={template.blockStyles[block].bold} onChange={event => updateStyle(block, { bold: event.target.checked })} /><span>{t("太字")}</span></label>
              <label className={styles.check}><input type="checkbox" data-print-block-separator checked={template.blockStyles[block].separatorBefore} onChange={event => updateStyle(block, { separatorBefore: event.target.checked })} /><span>{t("上罫線")}</span></label>
            </div>}
          </div>)}
        </div>
        <div className={styles.previewColumn}>
          {kind === "pickup" ? <label className={styles.previewLanguage}><span>{t("お客様の言語（プレビューのみ）")}</span><select data-print-preview-language value={previewLanguage} onChange={event => setPreviewLanguage(event.target.value)}><option value="ja">日本語</option><option value="en">English</option><option value="zh-Hans">简体中文</option><option value="zh-Hant">繁體中文</option><option value="ko">한국어</option><option value="vi">Tiếng Việt</option><option value="ne">नेपाली</option></select></label> : null}
          <PosKitchenTicketPreview payload={example} />
        </div>
      </div>
    </fieldset>
  </div>;
}

export function PosPrintDocumentsEditor({ settings, kind, onKindChange, brandId, onBrandChange, storeName, brands, disabled, onChange, onSave, saving, receiptEditor, recentDocuments, optionGroups = [] }: {
  settings: PosPrinterSettings; kind: PosPrintDocumentTab; onKindChange: (kind: PosPrintDocumentTab) => void;
  brandId: string; onBrandChange: (brandId: string) => void; storeName: string; brands: Array<{ brandId: string; brandName: string }>;
  disabled: boolean; saving: boolean; onChange: (settings: PosPrinterSettings) => void; onSave: () => void; receiptEditor: ReactNode; recentDocuments?: ReactNode; optionGroups?: PosPrintOptionGroup[];
}) {
  const { t } = useOsTranslation();
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: PosPrintDocumentTab) {
    let index = documentKinds.indexOf(current);
    if (event.key === "ArrowRight") index = (index + 1) % documentKinds.length;
    else if (event.key === "ArrowLeft") index = (index + documentKinds.length - 1) % documentKinds.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = documentKinds.length - 1;
    else return;
    event.preventDefault(); onKindChange(documentKinds[index]);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-print-document-tab="${documentKinds[index]}"]`)?.focus();
  }
  return <section id="printing" className={styles.root} data-pos-print-settings>
    <div className={styles.heading}><div><h4>{t("印刷・伝票")}</h4><p>{t("用途ごとに、印刷のON/OFF・枚数・テンプレートを設定します。保存するまでは実際の印刷に反映しません。")}</p></div><button type="button" className="primary-button compact-button" data-pos-save-section="printing" disabled={disabled} onClick={onSave}>{t(saving ? "保存中..." : "印刷・伝票設定を保存")}</button></div>
    <label className={styles.check}><input type="checkbox" data-printing-enabled checked={settings.enabled} disabled={disabled} onChange={event => onChange({ ...settings, enabled: event.target.checked })} /><span>{t("POS 印刷を有効にする")}</span></label>
    <p className={styles.help}>{t("1杯ごとに厨房伝票・出品伝票・お客様番号札、会計ごとにレシートを作成します。過去の伝票の再印刷には会計時の内容を使用します。")}</p>
    <div className={styles.sharedScope}><label><span>{t("テンプレートのブランド")}</span><select data-print-template-brand value={brandId} onChange={event => onBrandChange(event.target.value)} disabled={disabled}><option value="">{t("店舗共通")}</option>{brands.map(brand => <option value={brand.brandId} key={brand.brandId}>{brand.brandName}</option>)}</select></label><p>{t("店舗共通を基準に、必要なブランドだけテンプレートを変えられます。プリンターの接続先は「プリンター接続」で管理します。")}</p></div>
    <div className={styles.tabs} role="tablist" aria-label={t("伝票の種類")}>{documentKinds.map(value => <button key={value} type="button" role="tab" id={`print-tab-${value}`} data-print-document-tab={value} aria-controls={`print-panel-${value}`} aria-selected={kind === value} tabIndex={kind === value ? 0 : -1} onKeyDown={event => moveTab(event, value)} onClick={() => onKindChange(value)}>{t(documentLabels[value])}</button>)}</div>
    <div className={styles.tabPanel} role="tabpanel" id={`print-panel-${kind}`} aria-labelledby={`print-tab-${kind}`}>
      {kind === "receipt" ? <fieldset disabled={disabled} className={styles.fieldset}>
        <div className={styles.documentControls}><label className={styles.check}><input type="checkbox" data-print-receipt-enabled checked={settings.receiptEnabled} onChange={event => onChange({ ...settings, receiptEnabled: event.target.checked })} /><span>{t("会計後にレシート印刷")}</span></label><label className={styles.copies}><span>{t("印刷枚数")}</span><select data-print-receipt-copies value={settings.receiptCopies} onChange={event => onChange({ ...settings, receiptCopies: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map(value => <option value={value} key={value}>{value}</option>)}</select></label></div>
        <p className={styles.help}>{t("印刷のON/OFFと枚数は、この票種の全ブランド共通です。ブランド切替はテンプレートだけに適用します。")}</p>{receiptEditor}
      </fieldset> : <PosBowlTicketSettings key={`${kind}:${brandId}`} settings={settings} kind={kind} brandId={brandId} brandName={brands.find(brand => brand.brandId === brandId)?.brandName || ""} storeName={storeName} optionGroups={optionGroups} disabled={disabled} onChange={onChange} />}
    </div>
    <section className={styles.recent} data-pos-saved-print-region>{recentDocuments}</section>
  </section>;
}
