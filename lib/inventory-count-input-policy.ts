import { parseInventoryCountQuantity,resolveProductUnitConversion,type ProductUnitConfigurationInput } from "./product-unit-conversions";
export function normalizeInventoryCountInput(value: unknown,inputUnit: string,countUnit: string,product: ProductUnitConfigurationInput) {
  const quantity=parseInventoryCountQuantity(value);
  if(quantity===null) throw new Error("数量は0以上、小数は6桁までです。分数は正確に記録できる値を入力するか、1/X単位を選んでください。");
  if(inputUnit===countUnit) return {quantity,enteredQuantity:quantity,enteredUnit:inputUnit};
  const from=resolveProductUnitConversion(product,inputUnit),to=resolveProductUnitConversion(product,countUnit);
  if(!from||!to) throw new Error("入力単位と棚卸単位の対応を商品設定で確認してください。");
  const rational=(n:number):[bigint,bigint]=>{
    const m=String(n).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    if(!m) throw new Error("数量を正確に換算できません。");
    const places=(m[2]?.length??0)-Number(m[3]??0);
    return places>=0?[BigInt(m[1]+(m[2]??"")),BigInt(10)**BigInt(places)]:[BigInt(m[1]+(m[2]??""))*BigInt(10)**BigInt(-places),BigInt(1)];
  };
  const a=rational(quantity),b=rational(to.unitsPerPurchase),c=rational(from.unitsPerPurchase);
  const numerator=a[0]*b[0]*c[1]*BigInt(1_000_000),denominator=a[1]*b[1]*c[0];
  if(denominator<=BigInt(0)||numerator%denominator!==BigInt(0)) throw new Error("換算数量を小数点以下6桁まで正確に保存できません。個数・重量で数えるか、1/X単位で記録してください。");
  const scaled=numerator/denominator;
  if(scaled>BigInt("999999999999999999")) throw new Error("在庫量が保存範囲を超えています。");
  const normalized=Number(scaled)/1_000_000;
  const saved=rational(normalized);
  if(saved[0]*BigInt(1_000_000)!==scaled*saved[1]) throw new Error("数量を正確に換算できません。");
  return {quantity:normalized,enteredQuantity:quantity,enteredUnit:inputUnit};
}
