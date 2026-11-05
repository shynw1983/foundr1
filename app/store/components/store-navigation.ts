import { BellRing, BookOpen, ChefHat, Clock3, ClipboardList, Home, Lightbulb, MessageSquareWarning, Monitor, PackageCheck, PackageSearch, ShoppingCart, Tags, Users } from "lucide-react";
import { canUseFullStoreWorkbench, canUseStoreInventory } from "../../../lib/store-inventory-policy";

export const storeNavigationItems = [
  { label: "ホーム", href: "/store", icon: Home, group: "home" },
  { label: "POS", href: "/store/pos", icon: ShoppingCart, group: "pos", description: "店頭会計とレジ操作。", homeSection: "orders" },
  { label: "注文", href: "/store/orders", icon: ClipboardList, group: "orders", description: "注文受付から受け渡しまで。", homeSection: "orders" },
  { label: "客席管理", href: "/store/seats", icon: Users, group: "orders", description: "ご案内・利用状況・清掃を確認。", homeSection: "orders" },
  { label: "通知設定", href: "/store/notifications", icon: BellRing, group: "orders" },
  { label: "販売状態", href: "/store/menu", icon: Tags, group: "inventory", description: "売切・販売再開を切り替え。", homeSection: "inventory" },
  { label: "在庫確認", href: "/store/inventory", icon: PackageSearch, group: "inventory", description: "残量を確認し、必要な商品を数える。", homeSection: "inventory" },
  { label: "補充依頼", href: "/store/replenishment", icon: ShoppingCart, group: "inventory", description: "不足を報告し、発注と納品の進み具合を確認。", homeSection: "inventory" },
  { label: "納品・入庫", href: "/store/receiving", icon: PackageCheck, group: "inventory", description: "届いた数量と入庫を記録。", homeSection: "inventory" },
  { label: "店舗設備", href: "/store/devices", icon: Lightbulb, group: "operations", shortcut: true },
  { label: "タイムカード", href: "/store/timecard", icon: Clock3, group: "operations", shortcut: true },
  { label: "SNS素材作成", href: "/store/sns", icon: Tags, group: "operations" },
  { label: "手順書", href: "/store/procedures", icon: BookOpen, group: "operations", shortcut: true },
  { label: "問題報告", href: "/store/feedback", icon: MessageSquareWarning, group: "operations", shortcut: true },
  { label: "キッチン", href: "/store/display/kitchen", icon: ChefHat, group: "displays" },
  { label: "受取表示", href: "/store/display/pickup", icon: Monitor, group: "displays" },
  { label: "Pick Up表示", href: "/store/display/courier", icon: Monitor, group: "displays" },
  { label: "POS客席表示", href: "/store/pos/customer-display", icon: Monitor, group: "displays" }
] as const;

export type StoreNavigationItem = typeof storeNavigationItems[number];
export const storeNavigationGroups = [
  { id: "orders", label: "注文", icon: ClipboardList },
  { id: "inventory", label: "商品・在庫", icon: PackageSearch },
  { id: "operations", label: "店舗運営", icon: BookOpen },
  { id: "displays", label: "表示画面", icon: Monitor }
] as const;

/** Preserve the existing Store workbench and inventory execution visibility. */
export function getVisibleStoreNavigation(role: string | null, canUseInventory: boolean) {
  const fullWorkbench = canUseFullStoreWorkbench(role ?? "");
  const inventoryAccess = canUseInventory && canUseStoreInventory(role ?? "");
  return storeNavigationItems.filter(item => {
    const inventoryExecution = item.href === "/store/inventory" || item.href === "/store/replenishment" || item.href === "/store/receiving";
    return inventoryExecution ? inventoryAccess : fullWorkbench;
  });
}
