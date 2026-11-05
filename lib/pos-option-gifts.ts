import type { PosGiftItem } from "./pos-bowl-benefits";
export type PosGiftOptionInput = { id:string; brandId:string; groupId:string; groupName:string; name:string; displayNames?:Record<string,string>; priceDelta:number|null; available?:boolean };
/** Namespaced choice IDs prevent a product and its product-backed option colliding. */
export function createPosOptionGift(option:PosGiftOptionInput):PosGiftItem {
  return {id:`option:${option.id}`,kind:"option",optionId:option.id,groupId:option.groupId,groupName:option.groupName,
    brandId:option.brandId,category:option.groupName,name:option.name,displayNames:option.displayNames,
    price:Number(option.priceDelta ?? 0),available:option.available!==false,fixed:true};
}
export function posOptionGiftCatalog(groups:Array<{id:string;brandId:string;name:string;posEnabled?:boolean;options:Array<{id:string;name:string;displayNames?:Record<string,string>;priceDelta:number|null;isAvailable?:boolean}>}>) {
  return groups.flatMap(group=>group.options.map(option=>createPosOptionGift({...option,brandId:group.brandId,groupId:group.id,groupName:group.name,available:group.posEnabled!==false&&option.isAvailable!==false})))
    .filter(gift=>gift.available&&Number.isSafeInteger(gift.price)&&gift.price>=0);
}
