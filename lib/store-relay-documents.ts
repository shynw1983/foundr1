import { applyPosReceiptTaxBreakdown, getReceiptPrinter, getKitchenPrinterForBrand, hasPosPrinterDestination, prefixPosReducedTaxMarker, resolvePosKitchenTicketTemplate, resolvePosReceiptTemplate, type PosPrinterSettings, type PosPrintPayload } from './pos-printer';
import type { PosServingTicket } from './pos-serving-policy';
import { isPosImmediateItem } from './pos-item-fulfillment';
import { buildPosPrintDocumentSnapshots, type PosPrintSnapshotItem, type PosPrintSnapshotSale } from './pos-print-document-builder';
export type RelayDocument={kind:'kitchen'|'pickup'|'receipt';payload:PosPrintPayload};
const localized=(name:string,names:Record<string,string>|undefined,lang:string)=>lang==='ja'?name:names?.[lang]||names?.en||name;
export function buildRelayDocuments(settings:PosPrinterSettings,storeName:string,sale:PosPrintSnapshotSale,items:PosPrintSnapshotItem[],tickets:PosServingTicket[]):RelayDocument[]{
  const receiptPrinter=getReceiptPrinter(settings);
  if(items.length>0&&items.every(isPosImmediateItem)&&(!settings.enabled||!settings.receiptEnabled))return [];
  if(!settings.enabled||!settings.receiptEnabled||!hasPosPrinterDestination(receiptPrinter))throw new Error('レシートプリンターを設定してください。');
  const printedAt=new Date().toISOString();
  const line=(item:PosPrintSnapshotItem,lang='ja',markReducedRate=false)=>({
    name:prefixPosReducedTaxMarker(localized(item.name,item.displayNames,lang),markReducedRate&&!item.counterStandardTax),
    quantity:item.quantity,amount:item.amount,unitPrice:item.amount/item.quantity,
    options:[item.measuredQuantity?`${item.measuredQuantity}${item.measuredUnit}`:'',...item.selectedOptions.map(option=>
      prefixPosReducedTaxMarker(localized(option.name,option.displayNames,lang),
        markReducedRate&&!(option.counterStandardTax??item.counterStandardTax)&&!option.complimentary&&Number(option.priceDelta)>0))].filter(Boolean)});
  const base={pickupCode:sale.pickupCode,orderType:sale.orderType,paymentMethod:sale.paymentMethod,paymentLabel:({cash:'現金',card:'カード',qr:'QRコード決済',other:'その他'} as Record<string,string>)[sale.paymentMethod] || sale.paymentMethod,
    note:sale.note,subtotalAmount:sale.subtotalAmount,discountAmount:sale.discountAmount,couponDiscountAmount:sale.couponDiscountAmount,
    taxAmount:sale.taxAmount,taxRate:sale.taxRate,totalAmount:sale.amount,cashTenderedAmount:sale.cashTenderedAmount,cashChangeAmount:sale.cashChangeAmount};
  const jobs:RelayDocument[]=[];
  for (const document of buildPosPrintDocumentSnapshots(settings, storeName, sale, items, tickets, 'auto')) {
    if (!document.requested || !document.documentKey.startsWith('item:') || document.kind === 'receipt') continue;
    jobs.push({ kind: document.kind === 'finishing' ? 'kitchen' : document.kind, payload: document.payload });
  }
  if(settings.kitchenEnabled){
    const other=items.filter((item,i)=>!tickets.some(t=>t.itemIndex===i)&&!isPosImmediateItem(item));
    for(const brandId of new Set(other.map(i=>i.brandId))){
      const group=other.filter(i=>i.brandId===brandId),amount=group.reduce((sum,item)=>sum+item.amount,0);
      const printer=getKitchenPrinterForBrand(settings,brandId);if(!hasPosPrinterDestination(printer))throw new Error('厨房プリンターを設定してください。');
      for(let n=0;n<settings.kitchenCopies;n++)jobs.push({kind:'kitchen',payload:{version:1,jobType:'kitchen',printer:{...printer,openCashDrawer:false},storeName,printedAt,
        kitchenTicketTemplate:resolvePosKitchenTicketTemplate(settings,brandId),order:{...base,paymentMethod:'kitchen',paymentLabel:'厨房',subtotalAmount:amount,totalAmount:amount,discountAmount:0,couponDiscountAmount:0,taxAmount:0,taxRate:0,cashTenderedAmount:null,cashChangeAmount:null,items:group.map(i=>line(i))}}});
    }
  }
  const brandIds=[...new Set(items.map(i=>i.brandId))];
  const template=structuredClone(resolvePosReceiptTemplate(settings,brandIds.length===1?brandIds[0]:null,sale.receiptRequested?'invoice':'receipt'));
  const markReducedRate=sale.taxBreakdown?.some(bucket=>bucket.rate===8)??false;
  const receipt=applyPosReceiptTaxBreakdown(template,{
    ...base,paymentRoundingAmount:sale.paymentRoundingAmount,receiptRequested:sale.receiptRequested,receiptTitle:sale.receiptRequested?template.invoiceTitle:template.receiptTitle,
    receiptRecipientName:sale.receiptRequested?template.invoiceRecipientName:'',receiptPurposeText:sale.receiptRequested?template.invoicePurposeText:'',
    items:items.map((item,index)=>{
      const printedLine=line(item,'ja',markReducedRate);
      const pickupCode=!isPosImmediateItem(item)?tickets.find(ticket=>ticket.itemIndex===index)?.pickupCode:undefined;
      return {...printedLine,name:[pickupCode,printedLine.name].filter(Boolean).join(' ')};
    })
  },sale.taxBreakdown);
  jobs.push({kind:'receipt',payload:{version:1,jobType:'receipt',printer:receiptPrinter,storeName,printedAt,...receipt}});
  for (const job of jobs) {
    if (job.payload.printer.deviceType !== 'escpos_network') throw new Error('中継印刷は ESC/POS Wi-Fi / LAN のみ対応しています。');
    if (job.payload.receiptTemplate) {
      for (const key of ['logoUrl','promotionImageUrl'] as const) {
        const value=job.payload.receiptTemplate[key];
        if(value)job.payload.receiptTemplate[key]=new URL(value,'https://www.foundr1.jp').toString();
      }
    }
  }
  return jobs;
}
