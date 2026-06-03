"use client";

import {
  Boxes,
  ChartColumn,
  ClipboardList,
  LineChart,
  LogOut,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MobileNavMenu } from "../../components/MobileNavMenu";
import { OsNavList } from "../../components/OsNavList";
import { UserBadge } from "../../components/UserBadge";

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "経営分析", href: "/os/analytics", icon: LineChart },
  { label: "売上分析", href: "/os/analytics/sales", icon: ChartColumn },
  { label: "人件費分析", href: "/os/analytics/labor", icon: WalletCards },
  { label: "原価・経費分析", href: "/os/analytics/cost", icon: Boxes },
  { label: "月次損益", href: "/os/analytics/profit", icon: LineChart },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

export function AnalyticsShell({
  eyebrow,
  title,
  sourceLabel,
  workspaceClassName,
  children
}: {
  eyebrow: string;
  title: string;
  sourceLabel: string;
  workspaceClassName?: string;
  children: ReactNode;
}) {
  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className={`workspace${workspaceClassName ? ` ${workspaceClassName}` : ""}`}>
        <header className="topbar">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <span className="source-indicator">{sourceLabel}</span>
          </div>
        </header>

        {children}
      </section>
    </main>
  );
}
