import { parseInventoryCountQuantity } from "./product-unit-conversions";

export type ProductBatchPackaging = {
  purchaseUnit: string; contentQuantity: number; contentUnit: string; countUnit: string;
  stockQuantityPerPurchase: number; templateId?: string | null;
};
export type ProductPackagingTemplate = ProductBatchPackaging & {
  id: string; productId: string; name: string; supplierId: string | null;
  status: "active" | "inactive"; updatedAt: string;
};
export class ProductPackagingError extends Error {
  constructor(message: string, public status = 400, public code = "invalid_packaging") { super(message); }
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function unit(value:unknown) {
  if(typeof value!=="string" || !value.trim() || value.trim().length>64 || /[\u0000-\u001f\u007f]/.test(value)) throw new ProductPackagingError("包装・内容量・棚卸の単位を明示してください。");
  return value.trim();
}
/** A literal batch fact. Never derives edible quantity from freight weight or a product name. */
export function normalizeProductBatchPackaging(value:unknown):ProductBatchPackaging {
  if(!value || typeof value!=="object" || Array.isArray(value)) throw new ProductPackagingError("今回の包装仕様を確認してください。");
  const raw=value as Record<string,unknown>;
  const contentQuantity=parseInventoryCountQuantity(raw.contentQuantity),stockQuantityPerPurchase=parseInventoryCountQuantity(raw.stockQuantityPerPurchase);
  if(contentQuantity===null || contentQuantity<=0 || stockQuantityPerPurchase===null || stockQuantityPerPurchase<=0 || stockQuantityPerPurchase>1_000_000_000) throw new ProductPackagingError("1購入単位の内容量と棚卸数量を正の数で明示してください。");
  const result:ProductBatchPackaging={purchaseUnit:unit(raw.purchaseUnit),contentQuantity,contentUnit:unit(raw.contentUnit),countUnit:unit(raw.countUnit),stockQuantityPerPurchase};
  if(result.contentUnit===result.countUnit && result.contentQuantity!==result.stockQuantityPerPurchase) throw new ProductPackagingError("内容単位と棚卸単位が同じ場合、数量を一致させてください。");
  if(raw.templateId!==undefined && raw.templateId!==null) {
    if(typeof raw.templateId!=="string" || !uuid.test(raw.templateId)) throw new ProductPackagingError("包装テンプレートを確認してください。");
    result.templateId=raw.templateId.toLowerCase();
  }
  return result;
}
export function productBatchPackagingEquals(left:unknown,right:unknown) {
  try {
    const a=normalizeProductBatchPackaging(left),b=normalizeProductBatchPackaging(right);
    // Template identity is a convenience, never the identity of the actual batch specification.
    return a.purchaseUnit===b.purchaseUnit && a.contentQuantity===b.contentQuantity && a.contentUnit===b.contentUnit && a.countUnit===b.countUnit && a.stockQuantityPerPurchase===b.stockQuantityPerPurchase;
  } catch{return false;}
}
