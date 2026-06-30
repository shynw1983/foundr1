"use client";

import Link from "next/link";
import {
  Boxes,
  CalendarDays,
  BadgePercent,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  ExternalLink,
  FileText,
  Gauge,
  Globe2,
  ChartColumn,
  Lightbulb,
  LineChart,
  MenuSquare,
  MessageSquare,
  MessageSquareWarning,
  PackageCheck,
  ReceiptText,
  QrCode,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  UserCog,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getCachedCurrentEmployee, loadCurrentEmployee } from "./currentEmployeeStore";
import { getCachedNavigationSettings, loadNavigationSettings } from "./navigationSettingsStore";

export type OsNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  beta?: boolean;
};

const orderModulePaths = new Set([
  "/os/orders",
  "/os/procurement",
  "/os/history",
  "/os/vouchers",
  "/os/suppliers",
  "/os/product-comparisons"
]);
const analyticsModulePaths = new Set(["/os/analytics", "/os/analytics/sales", "/os/analytics/labor", "/os/analytics/cost", "/os/analytics/expenses", "/os/analytics/profit"]);
const storeOperationsModulePaths = new Set(["/os/procedures", "/os/field-notes", "/os/reports", "/os/feedback"]);
const posModulePaths = new Set(["/os/pos", "/os/pos/reconciliation", "/os/pos/table-order", "/os/menus", "/os/brand-sites", "/os/loyalty"]);
const timecardModulePaths = new Set(["/os/timecard", "/os/timecard/schedule", "/os/timecard/requests", "/os/timecard/workload", "/os/timecard/payroll", "/os/staff"]);
const settingsModulePaths = new Set(["/os/products", "/os/stores", "/os/settings", "/os/system-usage"]);
const settingsNavItem: OsNavItem = { label: "システム設定", href: "/os/settings", icon: Settings };
const systemUsageNavItem: OsNavItem = { label: "外部サービス利用量", href: "/os/system-usage", icon: Gauge };
export const canonicalNavItems: OsNavItem[] = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "証憑管理", href: "/os/vouchers", icon: ReceiptText },
  { label: "経営分析", href: "/os/analytics", icon: LineChart },
  { label: "売上分析", href: "/os/analytics/sales", icon: ChartColumn },
  { label: "人件費分析", href: "/os/analytics/labor", icon: WalletCards },
  { label: "原価・経費分析", href: "/os/analytics/cost", icon: Boxes },
  { label: "経費設定", href: "/os/analytics/expenses", icon: Boxes },
  { label: "月次損益", href: "/os/analytics/profit", icon: LineChart },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "フィードバック", href: "/os/feedback", icon: MessageSquareWarning },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "タイムカード", href: "/os/timecard", icon: Clock3 },
  { label: "シフト", href: "/os/timecard/schedule", icon: CalendarDays },
  { label: "シフト連絡", href: "/os/timecard/requests", icon: MessageSquare },
  { label: "負荷分析", href: "/os/timecard/workload", icon: ChartColumn },
  { label: "給与", href: "/os/timecard/payroll", icon: WalletCards },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "メニュー管理", href: "/os/menus", icon: MenuSquare },
  { label: "ブランドサイト", href: "/os/brand-sites", icon: Globe2 },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "手順書管理", href: "/os/procedures", icon: ClipboardCheck },
  { label: "POS", href: "/os/pos", icon: ShoppingCart },
  { label: "日次レジ締め", href: "/os/pos/reconciliation", icon: WalletCards },
  { label: "テーブルQR注文", href: "/os/pos/table-order", icon: QrCode },
  { label: "会員・ポイント", href: "/os/loyalty", icon: BadgePercent },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  systemUsageNavItem,
  settingsNavItem
];

type OsNavModulePath = {
  href: string;
  isShortcut?: boolean;
};

type OsNavModule = {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  paths: OsNavModulePath[];
};

export type OsNavChildItem = OsNavItem & {
  isShortcut?: boolean;
};

export type OsNavModuleWithChildren = OsNavModule & {
  children: OsNavChildItem[];
};

export const navModules: OsNavModule[] = [
  {
    id: "orders",
    label: "発注・購入",
    icon: PackageCheck,
    paths: [
      { href: "/os/orders" },
      { href: "/os/procurement" },
      { href: "/os/history" },
      { href: "/os/vouchers" },
      { href: "/os/suppliers" },
      { href: "/os/product-comparisons" }
    ]
  },
  {
    id: "store-operations",
    label: "店舗運営",
    icon: ClipboardCheck,
    paths: [
      { href: "/os/procedures" },
      { href: "/os/field-notes" },
      { href: "/os/reports" },
      { href: "/os/feedback" }
    ]
  },
  {
    id: "pos",
    label: "売上・POS・会員",
    icon: ShoppingCart,
    paths: [
      { href: "/os/pos" },
      { href: "/os/pos/reconciliation" },
      { href: "/os/pos/table-order" },
      { href: "/os/menus" },
      { href: "/os/brand-sites" },
      { href: "/os/loyalty" }
    ]
  },
  {
    id: "timecard",
    label: "勤怠・スタッフ",
    icon: Clock3,
    paths: [
      { href: "/os/timecard" },
      { href: "/os/timecard/schedule" },
      { href: "/os/timecard/requests" },
      { href: "/os/timecard/workload" },
      { href: "/os/timecard/payroll" },
      { href: "/os/staff" }
    ]
  },
  {
    id: "analytics",
    label: "経営分析",
    icon: LineChart,
    paths: [
      { href: "/os/analytics" },
      { href: "/os/analytics/sales" },
      { href: "/os/sales" },
      { href: "/os/analytics/labor" },
      { href: "/os/analytics/cost" },
      { href: "/os/analytics/expenses" },
      { href: "/os/analytics/profit" }
    ]
  },
  {
    id: "shared-data",
    label: "マスタ・設定",
    icon: Boxes,
    paths: [
      { href: "/os/products" },
      { href: "/os/stores" },
      { href: "/os/system-usage" },
      { href: "/os/settings" }
    ]
  }
];

function getModuleNavPaths(pathname: string) {
  if (
    pathname === "/os/procedures" || pathname.startsWith("/os/procedures/")
    || pathname === "/os/field-notes"
    || pathname === "/os/reports"
    || pathname === "/os/feedback"
  ) {
    return storeOperationsModulePaths;
  }

  if (
    pathname === "/os/pos" || pathname.startsWith("/os/pos/")
    || pathname === "/os/menus" || pathname.startsWith("/os/menus/")
    || pathname === "/os/brand-sites" || pathname.startsWith("/os/brand-sites/")
    || pathname === "/os/loyalty"
  ) {
    return posModulePaths;
  }

  if (pathname === "/os/analytics" || pathname.startsWith("/os/analytics/") || pathname === "/os/sales" || pathname.startsWith("/os/sales/")) {
    return analyticsModulePaths;
  }

  if (pathname === "/os/timecard" || pathname.startsWith("/os/timecard/") || pathname === "/os/staff") {
    return timecardModulePaths;
  }

  if (pathname === "/os/products" || pathname === "/os/stores" || pathname === "/os/system-usage" || pathname === "/os/settings") {
    return settingsModulePaths;
  }

  return orderModulePaths;
}

function canShowInCurrentModule(pathname: string, item: OsNavItem) {
  if (item.href === "/os/logout") return false;
  if (item.href === "/os" || item.href === "/store") return true;
  return getModuleNavPaths(pathname).has(item.href);
}

function canShowNavItem(role: string, item: OsNavItem, permittedNavPaths: Set<string>) {
  if (item.href === "/os/logout") return false;
  if (item.href === "/os") return Boolean(role);
  return permittedNavPaths.has(item.href);
}

function filterPermittedNavItems(_navItems: OsNavItem[], role: string, permittedNavPaths: Set<string>) {
  const availableNavItems = canonicalNavItems;
  if (!role) return [];
  return availableNavItems.filter((item) => canShowNavItem(role, item, permittedNavPaths));
}

function buildPermittedNavModules(navItems: OsNavItem[], role: string, permittedNavPaths: Set<string>, betaNavPaths: Set<string>): OsNavModuleWithChildren[] {
  const permittedNavItems = filterPermittedNavItems(navItems, role, permittedNavPaths);
  const navItemByHref = new Map(permittedNavItems.map((item) => [item.href, { ...item, beta: betaNavPaths.has(item.href) }]));

  return navModules
    .map((module) => ({
      ...module,
      children: module.paths
        .flatMap((path): OsNavChildItem[] => {
          const item = navItemByHref.get(path.href);
          if (!item) return [];
          return [{ ...item, ...(path.isShortcut ? { isShortcut: true } : {}) }];
        })
    }))
    .filter((module) => {
      if (module.href) return navItemByHref.has(module.href);
      return module.children.length > 0;
    });
}

export function usePermittedNavItems(navItems: OsNavItem[]) {
  const pathname = usePathname();
  const cachedEmployee = getCachedCurrentEmployee();
  const cachedNavigationSettings = getCachedNavigationSettings();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const [permittedNavPaths, setPermittedNavPaths] = useState(() => new Set(cachedEmployee?.permittedNavPaths ?? []));
  const [betaNavPaths, setBetaNavPaths] = useState(() => new Set(cachedNavigationSettings?.betaNavPaths ?? []));

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) {
        setRole(employee?.role ?? "");
        setPermittedNavPaths(new Set(employee?.permittedNavPaths ?? []));
      }
    }

    void loadCurrentRole();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadBetaNavPaths() {
      const settings = await loadNavigationSettings();
      if (isMounted) setBetaNavPaths(new Set(settings.betaNavPaths));
    }

    void loadBetaNavPaths();

    return () => {
      isMounted = false;
    };
  }, []);

  return useMemo(() => {
    const permittedItems = filterPermittedNavItems(navItems, role, permittedNavPaths);
    return permittedItems
      .filter((item) => canShowInCurrentModule(pathname, item))
      .map((item) => ({ ...item, beta: betaNavPaths.has(item.href) }));
  }, [betaNavPaths, navItems, pathname, permittedNavPaths, role]);
}

export function usePermittedNavModules(navItems: OsNavItem[]) {
  const cachedEmployee = getCachedCurrentEmployee();
  const cachedNavigationSettings = getCachedNavigationSettings();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const [permittedNavPaths, setPermittedNavPaths] = useState(() => new Set(cachedEmployee?.permittedNavPaths ?? []));
  const [betaNavPaths, setBetaNavPaths] = useState(() => new Set(cachedNavigationSettings?.betaNavPaths ?? []));

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) {
        setRole(employee?.role ?? "");
        setPermittedNavPaths(new Set(employee?.permittedNavPaths ?? []));
      }
    }

    void loadCurrentRole();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadBetaNavPaths() {
      const settings = await loadNavigationSettings();
      if (isMounted) setBetaNavPaths(new Set(settings.betaNavPaths));
    }

    void loadBetaNavPaths();

    return () => {
      isMounted = false;
    };
  }, []);

  return useMemo(() => buildPermittedNavModules(navItems, role, permittedNavPaths, betaNavPaths), [betaNavPaths, navItems, permittedNavPaths, role]);
}

export function OsNavList({ navItems }: { navItems: OsNavItem[] }) {
  const pathname = usePathname();
  const cachedEmployee = getCachedCurrentEmployee();
  const cachedNavigationSettings = getCachedNavigationSettings();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const [permittedNavPaths, setPermittedNavPaths] = useState(() => new Set(cachedEmployee?.permittedNavPaths ?? []));
  const [betaNavPaths, setBetaNavPaths] = useState(() => new Set(cachedNavigationSettings?.betaNavPaths ?? []));
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) {
        setRole(employee?.role ?? "");
        setPermittedNavPaths(new Set(employee?.permittedNavPaths ?? []));
      }
    }

    void loadCurrentRole();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadBetaNavPaths() {
      const settings = await loadNavigationSettings();
      if (isMounted) setBetaNavPaths(new Set(settings.betaNavPaths));
    }

    void loadBetaNavPaths();

    return () => {
      isMounted = false;
    };
  }, []);

  const visibleModules = useMemo(() => buildPermittedNavModules(navItems, role, permittedNavPaths, betaNavPaths), [betaNavPaths, navItems, permittedNavPaths, role]);
  const activeModule = visibleModules.find((module) => module.paths.some((path) => !path.isShortcut && (pathname === path.href || (path.href !== "/os" && pathname.startsWith(`${path.href}/`)))))
    ?? visibleModules.find((module) => module.paths.some((path) => pathname === path.href || (path.href !== "/os" && pathname.startsWith(`${path.href}/`))));
  const openModule = visibleModules.find((module) => module.id === openModuleId);

  useEffect(() => {
    setOpenModuleId(null);
  }, [pathname]);

  function handleModuleClick(module: OsNavModuleWithChildren) {
    if (module.href && module.children.length <= 1) {
      setOpenModuleId(null);
      return;
    }

    setOpenModuleId((current) => current === module.id ? null : module.id);
  }

  return (
    <div className={`nav-shell${openModule ? " is-expanded" : ""}`}>
      <nav className="nav-list" aria-label="OS モジュール">
        {visibleModules.map((module) => {
          const Icon = module.icon;
          const isActive = activeModule?.id === module.id;
          const isOpen = openModule?.id === module.id;
          const className = `nav-item${isActive ? " is-active" : ""}${isOpen ? " is-open" : ""}`;
          const content = (
            <>
              <Icon size={19} />
              <span>{module.label}</span>
              {module.href && module.children.some((child) => child.href === module.href && child.beta) ? <span className="nav-beta-badge">Beta</span> : null}
            </>
          );

          if (module.href && module.children.length <= 1) {
            return (
              <Link href={module.href} className={className} key={module.id}>
                {content}
              </Link>
            );
          }

          return (
            <div className={`nav-module${isOpen ? " is-open" : ""}`} key={module.id}>
              <button className={className} type="button" onClick={() => handleModuleClick(module)} aria-expanded={isOpen}>
                {content}
              </button>
              {isOpen ? (
                <nav className="nav-sub-list" aria-label={`${module.label}サブメニュー`}>
                  {module.children.map(({ label, href, icon: ChildIcon, isShortcut, beta }) => {
                    const isChildActive = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <Link href={href} className={`${isChildActive ? "is-active" : ""}${isShortcut ? " is-shortcut" : ""}`.trim()} key={href}>
                        <ChildIcon size={14} />
                        <span>{label}</span>
                        {beta ? <span className="nav-beta-badge">Beta</span> : null}
                        {isShortcut ? <ExternalLink className="nav-shortcut-icon" size={12} aria-label="快捷リンク" /> : null}
                      </Link>
                    );
                  })}
                </nav>
              ) : null}
            </div>
          );
        })}
      </nav>
      {openModule ? <button className="nav-flyout-backdrop" type="button" aria-label="メニューを閉じる" onClick={() => setOpenModuleId(null)} /> : null}
    </div>
  );
}
