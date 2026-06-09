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
  MessageSquareWarning,
  PackageCheck,
  ReceiptText,
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

export type OsNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const orderModulePaths = new Set([
  "/os/orders",
  "/os/procurement",
  "/os/history",
  "/os/vouchers",
  "/os/suppliers",
  "/os/field-notes",
  "/os/feedback",
  "/os/product-comparisons",
  "/os/reports"
]);
const analyticsModulePaths = new Set(["/os/analytics", "/os/analytics/sales", "/os/analytics/labor", "/os/analytics/cost", "/os/analytics/expenses", "/os/analytics/profit"]);
const storeOperationsModulePaths = new Set(["/os/procedures", "/os/menus", "/os/brand-sites", "/os/products"]);
const timecardModulePaths = new Set(["/os/timecard", "/os/timecard/schedule", "/os/timecard/workload", "/os/timecard/payroll", "/os/staff", "/os/stores"]);
const posModulePaths = new Set(["/os/pos", "/os/loyalty", "/os/menus", "/os/products", "/os/stores"]);
const sharedDataPaths = new Set(["/os/products", "/os/stores", "/os/staff", "/os/menus", "/os/brand-sites", "/os/loyalty"]);
const settingsNavItem: OsNavItem = { label: "システム設定", href: "/os/settings", icon: Settings };
const systemUsageNavItem: OsNavItem = { label: "外部サービス利用量", href: "/os/system-usage", icon: Gauge };
const canonicalNavItems: OsNavItem[] = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "店舗ワークベンチ", href: "/store", icon: Store },
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
  { label: "負荷分析", href: "/os/timecard/workload", icon: ChartColumn },
  { label: "給与", href: "/os/timecard/payroll", icon: WalletCards },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "メニュー管理", href: "/os/menus", icon: MenuSquare },
  { label: "ブランドサイト", href: "/os/brand-sites", icon: Globe2 },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "手順書管理", href: "/os/procedures", icon: ClipboardCheck },
  { label: "POS", href: "/os/pos", icon: ShoppingCart },
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

const navModules: OsNavModule[] = [
  {
    id: "store-workbench",
    label: "店舗ワークベンチ",
    icon: Store,
    href: "/store",
    paths: [
      { href: "/store" }
    ]
  },
  {
    id: "orders",
    label: "発注・購入管理",
    icon: PackageCheck,
    paths: [
      { href: "/os/orders" },
      { href: "/os/procurement" },
      { href: "/os/history" },
      { href: "/os/vouchers" },
      { href: "/os/field-notes" },
      { href: "/os/reports" },
      { href: "/os/feedback" },
      { href: "/os/suppliers" },
      { href: "/os/product-comparisons", isShortcut: true }
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
    id: "store-operations",
    label: "店舗運営",
    icon: ClipboardCheck,
    paths: [
      { href: "/os/procedures" },
      { href: "/os/menus", isShortcut: true },
      { href: "/os/brand-sites", isShortcut: true },
      { href: "/os/products", isShortcut: true }
    ]
  },
  {
    id: "timecard",
    label: "タイムカード",
    icon: Clock3,
    paths: [
      { href: "/os/timecard" },
      { href: "/os/timecard/schedule" },
      { href: "/os/timecard/workload" },
      { href: "/os/timecard/payroll" },
      { href: "/os/staff", isShortcut: true },
      { href: "/os/stores", isShortcut: true }
    ]
  },
  {
    id: "pos",
    label: "POS",
    icon: ShoppingCart,
    paths: [
      { href: "/os/pos" },
      { href: "/os/loyalty", isShortcut: true },
      { href: "/os/menus", isShortcut: true },
      { href: "/os/products", isShortcut: true },
      { href: "/os/stores", isShortcut: true }
    ]
  },
  {
    id: "shared-data",
    label: "共有データ",
    icon: Boxes,
    paths: [
      { href: "/os/products" },
      { href: "/os/menus" },
      { href: "/os/brand-sites" },
      { href: "/os/loyalty" },
      { href: "/os/stores" },
      { href: "/os/staff" },
      { href: "/os/system-usage" },
      { href: "/os/settings" }
    ]
  }
];

function getModuleNavPaths(pathname: string) {
  if (pathname === "/os/procedures" || pathname.startsWith("/os/procedures/")) {
    return storeOperationsModulePaths;
  }

  if (pathname === "/os/menus" || pathname.startsWith("/os/menus/") || pathname === "/os/brand-sites" || pathname.startsWith("/os/brand-sites/")) {
    return sharedDataPaths;
  }

  if (pathname === "/os/analytics" || pathname.startsWith("/os/analytics/") || pathname === "/os/sales" || pathname.startsWith("/os/sales/")) {
    return analyticsModulePaths;
  }

  if (pathname === "/os/timecard" || pathname.startsWith("/os/timecard/")) {
    return timecardModulePaths;
  }

  if (pathname === "/os/pos" || pathname.startsWith("/os/pos/") || pathname === "/os/loyalty") {
    return posModulePaths;
  }

  if (pathname === "/os/products" || pathname === "/os/stores" || pathname === "/os/staff" || pathname === "/os/system-usage" || pathname === "/os/settings") {
    return new Set([...sharedDataPaths, "/os/system-usage", "/os/settings"]);
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

function buildPermittedNavModules(navItems: OsNavItem[], role: string, permittedNavPaths: Set<string>): OsNavModuleWithChildren[] {
  const permittedNavItems = filterPermittedNavItems(navItems, role, permittedNavPaths);
  const navItemByHref = new Map(permittedNavItems.map((item) => [item.href, item]));

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
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const [permittedNavPaths, setPermittedNavPaths] = useState(() => new Set(cachedEmployee?.permittedNavPaths ?? []));

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

  return useMemo(() => {
    const permittedItems = filterPermittedNavItems(navItems, role, permittedNavPaths);
    return permittedItems.filter((item) => canShowInCurrentModule(pathname, item));
  }, [navItems, pathname, permittedNavPaths, role]);
}

export function usePermittedNavModules(navItems: OsNavItem[]) {
  const cachedEmployee = getCachedCurrentEmployee();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const [permittedNavPaths, setPermittedNavPaths] = useState(() => new Set(cachedEmployee?.permittedNavPaths ?? []));

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

  return useMemo(() => buildPermittedNavModules(navItems, role, permittedNavPaths), [navItems, permittedNavPaths, role]);
}

export function OsNavList({ navItems }: { navItems: OsNavItem[] }) {
  const pathname = usePathname();
  const cachedEmployee = getCachedCurrentEmployee();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const [permittedNavPaths, setPermittedNavPaths] = useState(() => new Set(cachedEmployee?.permittedNavPaths ?? []));
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

  const visibleModules = useMemo(() => buildPermittedNavModules(navItems, role, permittedNavPaths), [navItems, permittedNavPaths, role]);
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
                  {module.children.map(({ label, href, icon: ChildIcon, isShortcut }) => {
                    const isChildActive = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <Link href={href} className={`${isChildActive ? "is-active" : ""}${isShortcut ? " is-shortcut" : ""}`.trim()} key={href}>
                        <ChildIcon size={14} />
                        <span>{label}</span>
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
