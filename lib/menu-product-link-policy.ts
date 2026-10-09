export type MenuProductLinkKind = "item" | "option";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MenuProductLinksError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function canManageMenuProductLinks(role: string, hasMenuEditPermission: boolean) {
  return (role === "owner" || role === "manager") && hasMenuEditPermission;
}

export function normalizeMenuProductLinkTarget(kind: unknown, targetId: unknown) {
  if (kind !== "item" && kind !== "option") throw new MenuProductLinksError("メニュー商品または選択肢を指定してください。");
  if (typeof targetId !== "string" || !uuidPattern.test(targetId.trim())) throw new MenuProductLinksError("対象メニューIDが不正です。");
  return { kind: kind as MenuProductLinkKind, targetId: targetId.trim().toLowerCase() };
}

export function normalizeMenuProductIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50 || value.some((id) => typeof id !== "string" || !uuidPattern.test(id.trim()))) {
    throw new MenuProductLinksError("商品IDの一覧を正しく指定してください。");
  }
  const ids = value.map((id: string) => id.trim().toLowerCase());
  if (new Set(ids).size !== ids.length) throw new MenuProductLinksError("同じ商品を重複して指定できません。");
  return ids.sort();
}
