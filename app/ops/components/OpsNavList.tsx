"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type OpsNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

type CurrentEmployee = {
  role: string;
};

const masterRoles = new Set(["owner", "manager", "buyer"]);
const productViewerRoles = new Set(["owner", "manager", "buyer", "store_owner"]);

function canShowNavItem(role: string, item: OpsNavItem) {
  if (item.href === "/ops/logout") return true;
  if (item.href === "/ops/staff") return role === "owner";
  if (item.href === "/ops/field-notes") return true;
  if (item.href === "/ops/products") return productViewerRoles.has(role);
  if (["/ops/stores", "/ops/suppliers", "/ops/product-comparisons"].includes(item.href)) return masterRoles.has(role);

  return true;
}

export function usePermittedNavItems(navItems: OpsNavItem[]) {
  const [role, setRole] = useState("");

  useEffect(() => {
    async function loadCurrentRole() {
      const response = await fetch("/api/auth/me");
      if (!response.ok) return;
      const body = await response.json().catch(() => ({})) as { employee?: CurrentEmployee };
      setRole(body.employee?.role ?? "");
    }

    void loadCurrentRole();
  }, []);

  return useMemo(() => {
    if (!role) return navItems.filter((item) => item.href === "/ops/logout");
    return navItems.filter((item) => canShowNavItem(role, item));
  }, [navItems, role]);
}

export function OpsNavList({ navItems }: { navItems: OpsNavItem[] }) {
  const permittedNavItems = usePermittedNavItems(navItems);

  return (
    <nav className="nav-list">
      {permittedNavItems.map(({ label, href, icon: Icon }) => (
        <a href={href} className="nav-item" key={label}>
          <Icon size={18} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}
