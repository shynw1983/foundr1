export type PosMenuKind = 'item' | 'group' | 'option';
export type PosMenuSetting = { kind: PosMenuKind; targetId: string; visible: boolean | null; price: number | null };
export function posSetting(settings: PosMenuSetting[], kind: PosMenuKind, id: string) {
  return settings.find(s => s.kind === kind && s.targetId === id);
}
export function parsePosMenuChange(body: Record<string, unknown>) {
  if (!['item','group','option'].includes(String(body.kind))) throw new Error('対象の種類を確認してください。');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.targetId))) throw new Error('対象を選択してください。');
  if (body.visible !== null && typeof body.visible !== 'boolean') throw new Error('POS 公開設定を確認してください。');
  const price = body.price;
  if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 999999 || !Number.isInteger(price))) throw new Error('店内価格は0〜999999円の整数で入力してください。');
  if (body.kind === 'group' && price !== null) throw new Error('グループに価格は設定できません。');
  return { kind: body.kind as PosMenuKind, targetId: String(body.targetId), visible: body.visible as boolean | null, price: price as number | null };
}
export function applyPosItems<T extends {id: string; basePrice?: number | null; priceOverride?: number | null; price?: number}>(items: T[], settings: PosMenuSetting[]) {
  return items.filter(i => posSetting(settings,'item',i.id)?.visible !== false).map(i => {
    const setting = posSetting(settings,'item',i.id);
    if (!setting) return i;
    return {...i, priceOverride: setting.price === null ? null : Number(setting.price), price: Number(setting.price ?? i.basePrice ?? 0)};
  });
}
export function applyPosOptions<T extends {id: string; groupId: string; priceDelta: number | null}>(options: T[], settings: PosMenuSetting[]) {
  return options.filter(o => posSetting(settings,'group',o.groupId)?.visible !== false && posSetting(settings,'option',o.id)?.visible !== false)
    .map(o => ({...o, posEnabled: posSetting(settings,'group',o.groupId)?.visible === true,
      priceDelta: Number(posSetting(settings,'option',o.id)?.price ?? o.priceDelta ?? 0)}));
}
