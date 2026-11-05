import { getReceiptPrinter, getKitchenPrinterForBrand, hasPosPrinterDestination, resolvePosKitchenTicketTemplate, resolvePosReceiptTemplate, type PosPrinterSettings, type PosPrintPayload } from './pos-printer';
import { posPickupTicketCopy } from './pos-pickup-ticket-copy';
import type { PosServingTicket } from './pos-serving-policy';
import { isPosImmediateItem, type PosItemFulfillmentMode } from './pos-item-fulfillment';
type Item={fulfillmentMode?:PosItemFulfillmentMode;productionType?:string;itemKind?:string;brandId:string;brandName:string;name:string;displayNames?:Record<string,string>;quantity:number;amount:number;measuredQuantity:number|null;measuredUnit:string;preparationNote:string;selectedOptions:Array<{name:string;displayNames?:Record<string,string>}>};
type Sale={pickupCode:string;orderType:string;paymentMethod:string;amount:number;subtotalAmount:number;discountAmount:number;couponDiscountAmount:number;taxAmount:number;taxRate:number;cashTenderedAmount:number|null;cashChangeAmount:number|null;receiptRequested:boolean;note:string;memberLanguage:string};
export type RelayDocument={kind:'kitchen'|'pickup'|'receipt';payload:PosPrintPayload};
const localized=(name:string,names:Record<string,string>|undefined,lang:string)=>lang==='ja'?name:names?.[lang]||names?.en||name;
export function buildRelayDocuments(settings:PosPrinterSettings,storeName:string,sale:Sale,items:Item[],tickets:PosServingTicket[]):RelayDocument[]{
  const receiptPrinter=getReceiptPrinter(settings);
  if(items.length>0&&items.every(isPosImmediateItem)&&(!settings.enabled||!settings.receiptEnabled))return [];
  if(!settings.enabled||!settings.receiptEnabled||!hasPosPrinterDestination(receiptPrinter))throw new Error('レシートプリンターを設定してください。');
  const printedAt=new Date().toISOString();
  const line=(item:Item,lang='ja')=>({name:localized(item.name,item.displayNames,lang),quantity:item.quantity,amount:item.amount,
    unitPrice:item.amount/item.quantity,options:[item.measuredQuantity?`${item.measuredQuantity}${item.measuredUnit}`:'',...item.selectedOptions.map(o=>localized(o.name,o.displayNames,lang))].filter(Boolean)});
  const base={pickupCode:sale.pickupCode,orderType:sale.orderType,paymentMethod:sale.paymentMethod,paymentLabel:({cash:'現金',card:'カード',other:'その他'} as Record<string,string>)[sale.paymentMethod] || sale.paymentMethod,
    note:sale.note,subtotalAmount:sale.subtotalAmount,discountAmount:sale.discountAmount,couponDiscountAmount:sale.couponDiscountAmount,
    taxAmount:sale.taxAmount,taxRate:sale.taxRate,totalAmount:sale.amount,cashTenderedAmount:sale.cashTenderedAmount,cashChangeAmount:sale.cashChangeAmount,items:items.map(i=>line(i))};
  const jobs:RelayDocument[]=[];
  for(const ticket of tickets){
    const item=items[ticket.itemIndex];if(!item)throw new Error('料理と伝票の対応を確認してください。');
    if(isPosImmediateItem(item))continue;
    const template=resolvePosKitchenTicketTemplate(settings,item.brandId);
    const kitchen:PosPrintPayload={version:1,jobType:'kitchen',printer:{...receiptPrinter,openCashDrawer:false},storeName:`${storeName} / ${item.brandName}`,printedAt,
      kitchenTicketTemplate:{...template,title:'厨房伝票',showTitle:true,showPickupCode:true,showItems:true,showOptions:true,showNote:true,largeText:true,
        blockStyles:{...template.blockStyles,pickup:{...template.blockStyles.pickup,textSize:'xlarge',bold:true}}},
      order:{...base,subtotalAmount:item.amount,totalAmount:item.amount,discountAmount:0,couponDiscountAmount:0,taxAmount:0,taxRate:0,pickupCode:ticket.pickupCode,paymentMethod:'kitchen',paymentLabel:'厨房',note:[item.preparationNote,sale.note].filter(Boolean).join(' / '),items:[line(item)]}};
    jobs.push({kind:'kitchen',payload:kitchen});
    // Both internal documents use the kitchen transport; their printed titles distinguish the roles.
    jobs.push({kind:'kitchen',payload:{...kitchen,kitchenTicketTemplate:{...kitchen.kitchenTicketTemplate!,title:'出品伝票',showTitle:true,showAmounts:false,
      customMessage:'厨房伝票と番号を照合し、味付け・追加・メモを確認してください。'}}});
    const copy=posPickupTicketCopy[sale.memberLanguage]||posPickupTicketCopy.ja;
    jobs.push({kind:'pickup',payload:{...kitchen,order:{...kitchen.order!,note:'',items:[line(item,sale.memberLanguage)]},
      kitchenTicketTemplate:{...kitchen.kitchenTicketTemplate!,language:'ja',title:copy.title,customMessage:copy.message,showTitle:true,showAmounts:false,showNote:false,showOrderType:false}}});
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
  const receipt=resolvePosReceiptTemplate(settings,brandIds.length===1?brandIds[0]:null,sale.receiptRequested?'invoice':'receipt');
  jobs.push({kind:'receipt',payload:{version:1,jobType:'receipt',printer:receiptPrinter,storeName,printedAt,receiptTemplate:receipt,
    order:{...base,receiptRequested:sale.receiptRequested,receiptTitle:sale.receiptRequested?receipt.invoiceTitle:receipt.receiptTitle,
      receiptRecipientName:sale.receiptRequested?receipt.invoiceRecipientName:'',receiptPurposeText:sale.receiptRequested?receipt.invoicePurposeText:'',
      items:items.map((item,i)=>({...line(item),name:[!isPosImmediateItem(item)?tickets.find(t=>t.itemIndex===i)?.pickupCode:undefined,line(item).name].filter(Boolean).join(' ')}))}}});
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
