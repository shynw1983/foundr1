"use client";

import { invoiceRecipientLabel } from '../../../lib/pos-invoice';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { useOsTranslation } from '../components/OsTranslationProvider';
import type { PosSavedPrintContent, PosSavedPrintPreviews as PreviewResponse } from '../../../lib/pos-saved-print-preview';
import styles from './PosSavedPrintPreviews.module.css';

const labels = { kitchen: '厨房伝票', finishing: '出品伝票', pickup: 'お客様番号札', receipt: 'レシート' };
const yen = (value: number | null | undefined) => `¥${Number(value || 0).toLocaleString('ja-JP')}`;
function time(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }); }
function orderType(value: string, zh = false) {
  // Match the Android renderer, including its raw fallback, so historical
  // English labels cannot accidentally disappear from this inspection view.
  const raw = String(value || '').trim();
  if (zh) return ({ eat_in: '堂食', takeout: '自提', pickup: '自提', delivery: '外送', web: 'Web预约', scheduled: 'Web预约' } as Record<string,string>)[raw] || raw || '取餐';
  const normalized = raw.toLowerCase().replace(/[- ]/g, '_');
  return ({ eat_in: '店内', dine_in: '店内', eatin: '店内', dinein: '店内', takeout: '持ち帰り', take_out: '持ち帰り', to_go: '持ち帰り', delivery: '配達', web: 'Web予約' } as Record<string,string>)[normalized] || raw;
}
function paymentLabel(order: NonNullable<PosSavedPrintContent['order']>) {
  const label = String(order.paymentLabel || '').trim();
  const method = String(order.paymentMethod || '').trim();
  return label || ({ cash: '現金', external_card: '外部決済', kitchen: '厨房', test: 'テスト' } as Record<string,string>)[method] || method;
}

function PreviewQr({ value }: { value: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let active = true; setSrc(''); void QRCode.toDataURL(value, { margin: 1, width: 240 }).then(data => { if (active) setSrc(data); }).catch(() => {}); return () => { active = false; }; }, [value]);
  return src ? <img src={src} alt="QR" className={styles.qr} /> : <span>QR</span>;
}

/** The original stored content is used directly, never the current editable template. */
export function PosPrintContentPreview({ content }: { content: PosSavedPrintContent }) {
  const { t } = useOsTranslation();
  const order = content.order;
  if (!order) return <p>{t('保存された注文内容がありません。')}</p>;
  const items = (showOptions: boolean, showAmounts: boolean) => <>{(order.items || []).map((item, index) => <div className={styles.item} key={index}>
    <div className={styles.pair}><span>{item.name} x{item.quantity}</span>{showAmounts ? <span>{yen(item.amount)}</span> : null}</div>
    {showOptions ? item.options?.map((option, n) => <div className={styles.option} key={n}>{option}</div>) : null}
  </div>)}</>;
  const blocks: Array<{ key: string; node: ReactNode; style?: CSSProperties }> = [];
  if (content.jobType === 'kitchen') {
    const template = content.kitchenTicketTemplate;
    if (!template) return <p>{t('保存された伝票テンプレートがありません。')}</p>;
    const zh = template.language === 'zh';
    const values: Record<string, ReactNode> = {
      title: template.showTitle ? template.title : null,
      store: template.showStoreName ? content.storeName : null,
      pickup: template.showPickupCode ? `No. ${order.pickupCode}` : null,
      orderType: template.showOrderType ? orderType(order.orderType, zh) : null,
      items: template.showItems ? <>{items(template.showOptions, template.showAmounts)}{template.showAmounts ? <div className={styles.total}>{zh ? '合计' : '合計'} {yen(order.totalAmount)}</div> : null}</> : null,
      note: template.showNote && order.note ? `${zh ? '备注：' : '備考: '}${order.note}` : null,
      message: template.customMessage || null,
      timestamp: template.showTimestamp ? time(content.printedAt) : null
    };
    for (const key of template.blockOrder) {
      const node = values[key]; if (node == null) continue;
      const style = template.blockStyles[key];
      blocks.push({ key, node, style: { fontSize: ({ small: 12, standard: 14, large: 17, xlarge: 21 } as const)[style.textSize],
        textAlign: style.alignment, fontWeight: style.bold ? 700 : 400,
        ...(style.separatorBefore ? { borderTop: '1px dashed #999', paddingTop: 8, marginTop: 6 } : {}) } });
    }
  } else {
    const template = content.receiptTemplate;
    if (!template) return <p>{t('保存された伝票テンプレートがありません。')}</p>;
    const size = (value: string) => value === 'small' ? 12 : value === 'large' ? 17 : 14;
    const contact = [template.companyInfo, template.address, template.taxRegistrationNumber ? `登録番号: ${template.taxRegistrationNumber}` : '', template.phone ? `TEL: ${template.phone}` : '', template.website].filter(Boolean).join('\n');
    const values: Record<string, ReactNode> = {
      logo: template.showLogo && template.logoUrl ? <img src={template.logoUrl} alt="" style={{ width: `${template.logoWidthPercent}%`, marginBottom: template.logoBottomSpacing }} /> : null,
      business: template.businessName || content.storeName,
      contact: contact || null, message: template.headerMessage || null,
      receipt: <><div className={styles.receiptTitle} style={{ fontSize: size(template.titleTextSize) }}>{order.receiptTitle || (order.receiptRequested ? template.invoiceTitle : template.receiptTitle)}</div>
        {order.receiptRequested ? <><div>{invoiceRecipientLabel(order.receiptRecipientName || template.invoiceRecipientName)}</div><div>但し {order.receiptPurposeText || template.invoicePurposeText || '飲食代'}として</div></> : null}
        <div>No. {order.pickupCode}</div><div>{[orderType(order.orderType), paymentLabel(order)].filter(Boolean).join(' / ')}</div><hr />{items(true, true)}<hr />
        <div className={styles.pair}><span>小計</span><span>{yen(order.subtotalAmount)}</span></div>
        {order.discountAmount ? <div className={styles.pair}><span>割引</span><span>-{yen(order.discountAmount)}</span></div> : null}
        {order.couponDiscountAmount ? <div className={styles.pair}><span>クーポン</span><span>-{yen(order.couponDiscountAmount)}</span></div> : null}
        {template.showTaxSummary ? <div className={styles.pair}><span>{order.taxRate > 0 ? `消費税 ${order.taxRate}%` : '消費税'}</span><span>{yen(order.taxAmount)}</span></div> : null}
        <div className={`${styles.pair} ${styles.total}`}><span>合計</span><span>{yen(order.totalAmount)}</span></div>
        {order.paymentMethod === 'cash' ? <><div className={styles.pair}><span>お預かり</span><span>{yen(order.cashTenderedAmount)}</span></div><div className={styles.pair}><span>お釣り</span><span>{yen(order.cashChangeAmount)}</span></div></> : null}
        {template.showOrderNote && order.note ? <div>備考: {order.note}</div> : null}</>,
      promotion: template.promotionImageUrl || template.promotionMessage ? <>{template.promotionImageUrl ? <img src={template.promotionImageUrl} alt="" style={{ width: `${template.promotionImageWidthPercent}%` }} /> : null}{template.promotionMessage}</> : null,
      qr: template.qrCodeEnabled && template.qrCodeUrl ? <><PreviewQr value={template.qrCodeUrl} /><div>{template.qrCodeLabel}</div></> : null,
      footer: template.footerMessage || template.showTimestamp ? <>{template.footerMessage}{template.showTimestamp ? <div>{time(content.printedAt)}</div> : null}</> : null
    };
    for (const key of template.blockOrder) {
      const node = values[key]; if (node == null) continue;
      const align = key === 'business' ? template.businessNameAlignment : key === 'contact' ? template.contactInfoAlignment : key === 'message' || key === 'footer' ? template.messageAlignment : key === 'logo' ? template.logoAlignment : key === 'promotion' ? template.promotionImageAlignment : key === 'qr' ? template.qrCodeAlignment : 'left';
      blocks.push({ key, node, style: { textAlign: align, fontSize: size(key === 'business' ? template.businessNameTextSize : key === 'message' || key === 'footer' ? template.messageTextSize : 'standard') } });
    }
  }
  return <div className={`${styles.paper} ${content.paperWidth === '58mm' ? styles.narrow : ''}`} data-i18n-ignore data-pos-saved-print-content>
    {blocks.map(block => <div className={styles.block} data-ticket-block={block.key} key={block.key} style={block.style}>{block.node}</div>)}
  </div>;
}

function SavedPrintPreviews({ storeId }: { storeId: string }) {
  const { t } = useOsTranslation();
  const [open, setOpen] = useState(false), [data, setData] = useState<PreviewResponse | null>(null);
  const [query, setQuery] = useState(''), [orderId, setOrderId] = useState(''), [documentId, setDocumentId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null), requestVersion = useRef(0);
  useEffect(() => () => { requestVersion.current++; controller.current?.abort(); }, []);
  async function load(selectedOrder = '', search = query) {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const version = ++requestVersion.current;
    setBusy(true); setError(''); setData(null); setDocumentId(''); setOrderId(selectedOrder);
    try {
      const params = new URLSearchParams({ storeId, ...(search.trim() ? { query: search.trim() } : {}), ...(selectedOrder ? { orderId: selectedOrder } : {}) });
      const response = await fetch(`/api/os/pos/print-preview?${params}`, { cache: 'no-store', signal: abort.signal });
      const result = await response.json() as PreviewResponse & { error?: string };
      if (!response.ok) throw Error(result.error || '保存済み伝票を読み込めませんでした。もう一度お試しください。');
      if (result.selectedStoreId !== storeId || !Array.isArray(result.orders) || !Array.isArray(result.documents)) throw Error('伝票の店舗を確認してください。');
      if (version !== requestVersion.current) return;
      setData(result); setDocumentId(result.documents[0]?.id || '');
    } catch (cause) { if (!abort.signal.aborted && version === requestVersion.current) setError(cause instanceof Error ? cause.message : '保存済み伝票を読み込めませんでした。もう一度お試しください。'); }
    finally { if (version === requestVersion.current) setBusy(false); }
  }
  const selected = data?.documents.find(doc => doc.id === documentId);
  const customerLanguage = data?.orders.find(order => order.orderId === orderId)?.memberLanguage;
  return <section className={styles.root} data-pos-saved-print-previews>
    <button className="secondary-button" type="button" aria-expanded={open} data-pos-preview-load disabled={!storeId} onClick={() => { setOpen(!open); if (!open && !data) void load(); }}>{t('保存済みの伝票を確認')}</button>
    {open ? <div className={styles.body}>
      <p>{t('会計時に保存した伝票の内容です。現在のテンプレートに変更しても、過去の伝票と再印刷の内容は変わりません。')}</p>
      <form className={styles.search} onSubmit={event => { event.preventDefault(); void load(); }}>
        <label>{t('注文・お呼び出し番号')}<input value={query} maxLength={40} onChange={event => setQuery(event.target.value)} data-pos-preview-query /></label>
        <button className="secondary-button" type="submit" disabled={busy}>{t('検索')}</button>
      </form>
      {busy ? <p role="status">{t('読み込み中...')}</p> : null}
      {error ? <p role="alert">{t(error)}</p> : null}
      {data ? <>
        <label className={styles.select}>{t('注文を選択')}<select value={orderId} data-pos-preview-order onChange={event => { void load(event.target.value); }}>
          <option value="">{t('注文を選択してください。')}</option>{data.orders.map(order => <option key={order.orderId} value={order.orderId}>{time(order.createdAt)} / {order.pickupCode} / {order.documentCount} {t('枚')}</option>)}
        </select></label>
        {!data.orders.length ? <p>{t('保存済みの伝票がありません。古いバージョンの会計は表示されない場合があります。')}</p> : null}
        {data.hasMoreOrders ? <p>{t('直近20件を表示しています。番号で絞り込めます。')}</p> : null}
        {orderId && !data.documents.length ? <p>{t('この注文に保存済みの伝票はありません。')}</p> : null}
        {data.documents.length ? <label className={styles.select}>{t('確認する伝票')}<select value={documentId} data-pos-preview-document onChange={event => setDocumentId(event.target.value)}>{data.documents.map(doc => <option value={doc.id} key={doc.id}>{doc.pickupCode} / {t(doc.kind === 'receipt' && doc.content.order?.receiptRequested ? '領収書' : labels[doc.kind])} / {doc.copyNumber} {t('枚目')}</option>)}</select></label> : null}
        {data.hasMoreDocuments ? <p role="status">{t('伝票数が多いため先頭100枚を表示しています。')}</p> : null}
        {selected ? <>{customerLanguage ? <p data-pos-preview-language>{t('お客様の言語')}: {customerLanguage}</p> : null}<p>{t('保存済みの本文を表示します。実際の用紙の余白・字体・印刷日時はプリンターによって異なります。')}</p><PosPrintContentPreview content={selected.content} /></> : null}
      </> : null}
      <p className={styles.help}>{t('この確認では印刷・再印刷や注文の変更を行いません。')}</p>
    </div> : null}
  </section>;
}

export default function PosSavedPrintPreviews({ storeId }: { storeId: string }) {
  return <SavedPrintPreviews key={storeId} storeId={storeId} />;
}
