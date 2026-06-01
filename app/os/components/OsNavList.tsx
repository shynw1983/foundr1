"use client";

import Link from "next/link";
import {
  Boxes,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileText,
  Lightbulb,
  MenuSquare,
  MessageSquareWarning,
  PackageCheck,
  Search,
  Settings,
  Store,
  Truck,
  UserCog,
  UsersRound,
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

const masterRoles = new Set(["owner", "manager", "buyer"]);
const productViewerRoles = new Set(["owner", "manager", "buyer", "store_owner"]);
const orderModulePaths = new Set([
  "/os/orders",
  "/os/procurement",
  "/os/history",
  "/os/suppliers",
  "/os/field-notes",
  "/os/product-comparisons",
  "/os/reports"
]);
const procedureModulePaths = new Set(["/os/procedures", "/os/menus"]);
const timecardModulePaths = new Set(["/os/timecard", "/os/timecard/schedule", "/os/timecard/payroll", "/os/staff", "/os/stores"]);
const sharedDataPaths = new Set(["/os/products", "/os/stores", "/os/staff", "/os/menus"]);
const settingsNavItem: OsNavItem = { label: "システム設定", href: "/os/settings", icon: Settings };
const canonicalNavItems: OsNavItem[] = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "発注管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "タイムカード", href: "/os/timecard", icon: Clock3 },
  { label: "排班", href: "/os/timecard/schedule", icon: CalendarDays },
  { label: "給与", href: "/os/timecard/payroll", icon: WalletCards },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "メニュー管理", href: "/os/menus", icon: MenuSquare },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "手順書管理", href: "/os/procedures", icon: ClipboardCheck },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  settingsNavItem
];

type OsNavModule = {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  paths: string[];
};

export type OsNavModuleWithChildren = OsNavModule & {
  children: OsNavItem[];
};

const navModules: OsNavModule[] = [
  { id: "home", label: "OS", icon: ClipboardList, href: "/os", paths: ["/os"] },
  { id: "orders", label: "発注", icon: PackageCheck, paths: ["/os/orders", "/os/procurement", "/os/history", "/os/field-notes", "/os/reports", "/os/suppliers"] },
  { id: "people", label: "人事", icon: UsersRound, paths: ["/os/timecard", "/os/timecard/schedule", "/os/timecard/payroll", "/os/staff"] },
  { id: "catalog", label: "商品", icon: Boxes, paths: ["/os/products", "/os/menus", "/os/product-comparisons"] },
  { id: "operations", label: "運営", icon: ClipboardCheck, paths: ["/os/procedures"] },
  { id: "stores", label: "店舗", icon: Store, paths: ["/os/stores"] },
  { id: "settings", label: "設定", icon: Settings, href: "/os/settings", paths: ["/os/settings"] }
];

function getModuleNavPaths(pathname: string) {
  if (pathname === "/os/procedures" || pathname.startsWith("/os/procedures/")) {
    return procedureModulePaths;
  }

  if (pathname === "/os/menus" || pathname.startsWith("/os/menus/")) {
    return sharedDataPaths;
  }

  if (pathname === "/os/timecard" || pathname.startsWith("/os/timecard/")) {
    return timecardModulePaths;
  }

  if (pathname === "/os/products" || pathname === "/os/stores" || pathname === "/os/staff") {
    return sharedDataPaths;
  }

  return orderModulePaths;
}

function canShowInCurrentModule(pathname: string, item: OsNavItem) {
  if (item.href === "/os/logout") return false;
  if (item.href === "/os") return true;
  if (item.href === "/os/settings") return true;
  return getModuleNavPaths(pathname).has(item.href);
}

function canShowNavItem(role: string, item: OsNavItem) {
  if (item.href === "/os/logout") return false;
  if (item.href === "/os/settings") return masterRoles.has(role);
  if (item.href === "/os/staff") return role === "owner";
  if (item.href === "/os/timecard/payroll") return ["owner", "manager", "store_owner"].includes(role);
  if (item.href === "/os/field-notes") return true;
  if (item.href === "/os/procedures") return ["owner", "manager"].includes(role);
  if (item.href === "/os/menus") return ["owner", "manager"].includes(role);
  if (item.href === "/os/products") return productViewerRoles.has(role);
  if (["/os/stores", "/os/suppliers", "/os/product-comparisons"].includes(item.href)) return masterRoles.has(role);

  return true;
}

function filterPermittedNavItems(_navItems: OsNavItem[], role: string) {
  const availableNavItems = canonicalNavItems;
  if (!role) return [];
  return availableNavItems.filter((item) => canShowNavItem(role, item));
}

function buildPermittedNavModules(navItems: OsNavItem[], role: string) {
  const permittedNavItems = filterPermittedNavItems(navItems, role);
  const navItemByHref = new Map(permittedNavItems.map((item) => [item.href, item]));

  return navModules
    .map((module) => ({
      ...module,
      children: module.paths.map((path) => navItemByHref.get(path)).filter((item): item is OsNavItem => Boolean(item))
    }))
    .filter((module) => {
      if (module.href) return navItemByHref.has(module.href);
      return module.children.length > 0;
    });
}

export function usePermittedNavItems(navItems: OsNavItem[]) {
  const pathname = usePathname();
  const [role, setRole] = useState(() => getCachedCurrentEmployee()?.role ?? "");

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) setRole(employee?.role ?? "");
    }

    void loadCurrentRole();

    return () => {
      isMounted = false;
    };
  }, []);

  return useMemo(() => {
    const permittedItems = filterPermittedNavItems(navItems, role);
    return permittedItems.filter((item) => canShowInCurrentModule(pathname, item));
  }, [navItems, pathname, role]);
}

export function usePermittedNavModules(navItems: OsNavItem[]) {
  const [role, setRole] = useState(() => getCachedCurrentEmployee()?.role ?? "");

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) setRole(employee?.role ?? "");
    }

    void loadCurrentRole();

    return () => {
      isMounted = false;
    };
  }, []);

  return useMemo(() => buildPermittedNavModules(navItems, role), [navItems, role]);
}

export function OsNavList({ navItems }: { navItems: OsNavItem[] }) {
  const pathname = usePathname();
  const [role, setRole] = useState(() => getCachedCurrentEmployee()?.role ?? "");
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) setRole(employee?.role ?? "");
    }

    void loadCurrentRole();

    return () => {
      isMounted = false;
    };
  }, []);

  const visibleModules = useMemo(() => buildPermittedNavModules(navItems, role), [navItems, role]);
  const activeModule = visibleModules.find((module) => module.paths.some((path) => pathname === path || (path !== "/os" && pathname.startsWith(`${path}/`))));
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
                  {module.children.map(({ label, href, icon: ChildIcon }) => {
                    const isChildActive = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <Link href={href} className={isChildActive ? "is-active" : ""} key={href}>
                        <ChildIcon size={14} />
                        <span>{label}</span>
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
