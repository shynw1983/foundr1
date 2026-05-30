"use client";

import {
  ClipboardCheck,
  Clock3,
  LogOut,
  PackageCheck,
  ShoppingCart,
  Store,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { UserBadge } from "./components/UserBadge";
import { getCachedCurrentEmployee, loadCurrentEmployee } from "./components/currentEmployeeStore";

type OsModule = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  status: "active" | "building";
  roles: string[];
};

const osModules: OsModule[] = [
  {
    title: "訂貨システム",
    description: "店舗発注、購入、納品、レシート、発注先管理",
    href: "/os/orders",
    icon: PackageCheck,
    status: "active",
    roles: ["owner", "manager", "buyer", "store_owner", "staff"]
  },
  {
    title: "電子手順書",
    description: "ブランド・店舗ごとの標準作業、商品、設備、容器、提供形式",
    href: "/os/procedures",
    icon: ClipboardCheck,
    status: "active",
    roles: ["owner", "manager"]
  },
  {
    title: "Timecard",
    description: "出退勤、休憩、シフト、勤怠確認",
    href: "/os/timecard",
    icon: Clock3,
    status: "building",
    roles: ["owner", "manager", "store_owner", "staff"]
  },
  {
    title: "POS",
    description: "販売、会計、メニュー、売上レポート",
    href: "/os/pos",
    icon: ShoppingCart,
    status: "building",
    roles: ["owner", "manager"]
  }
];

const systemModules: OsModule[] = [
  {
    title: "店舗・ブランド",
    description: "全モジュールで共有する店舗、ブランド、スコープ",
    href: "/os/stores",
    icon: Store,
    status: "active",
    roles: ["owner", "manager", "buyer"]
  },
  {
    title: "スタッフ管理",
    description: "ユーザー、権限、表示範囲、ログイン管理",
    href: "/os/staff",
    icon: UserCog,
    status: "active",
    roles: ["owner"]
  }
];

function canAccessModule(role: string, module: OsModule) {
  return module.roles.includes(role);
}

function ModuleCard({ module }: { module: OsModule }) {
  const Icon = module.icon;
  const content = (
    <>
      <div className="os-module-icon">
        <Icon size={24} />
      </div>
      <div>
        <div className="os-module-heading">
          <h3>{module.title}</h3>
          <span className={module.status === "active" ? "status-pill is-active" : "status-pill"}>
            {module.status === "active" ? "利用可能" : "準備中"}
          </span>
        </div>
        <p>{module.description}</p>
      </div>
    </>
  );

  return module.status === "active" ? (
    <a className="os-module-card" href={module.href}>
      {content}
    </a>
  ) : (
    <div className="os-module-card is-disabled" aria-disabled="true">
      {content}
    </div>
  );
}

export default function Foundr1OsHome() {
  const [role, setRole] = useState(() => getCachedCurrentEmployee()?.role ?? "");

  useEffect(() => {
    let isMounted = true;

    async function loadRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) setRole(employee?.role ?? "");
    }

    void loadRole();

    return () => {
      isMounted = false;
    };
  }, []);

  const permittedModules = useMemo(() => osModules.filter((module) => canAccessModule(role, module)), [role]);
  const permittedSystemModules = useMemo(() => systemModules.filter((module) => canAccessModule(role, module)), [role]);

  return (
    <main className="os-home-shell">
      <header className="os-home-topbar">
        <a className="brand-block" href="/os" aria-label="Foundr1 OS ホーム">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>バックオフィス</h1>
          </div>
        </a>
        <div className="os-home-user">
          <UserBadge />
          <a className="secondary-button" href="/os/logout">
            <LogOut size={17} />
            ログアウト
          </a>
        </div>
      </header>

      <section className="os-home-hero">
        <div>
          <p className="eyebrow">Restaurant Operating System</p>
          <h2>店舗運営の機能を選択</h2>
          <p>商品マスタ、スタッフ、店舗、ブランド、権限を共有しながら、必要な業務モジュールへ入ります。</p>
        </div>
      </section>

      <section className="os-module-section" aria-label="業務モジュール">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Modules</p>
            <h2>業務モジュール</h2>
          </div>
        </div>
        <div className="os-module-grid">
          {permittedModules.map((module) => <ModuleCard module={module} key={module.title} />)}
          {!permittedModules.length ? <p className="empty-state">利用できるモジュールがありません。</p> : null}
        </div>
      </section>

      {permittedSystemModules.length ? (
        <section className="os-module-section" aria-label="共有データ">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Shared Data</p>
              <h2>共有データ</h2>
            </div>
          </div>
          <div className="os-module-grid is-compact">
            {permittedSystemModules.map((module) => <ModuleCard module={module} key={module.title} />)}
          </div>
        </section>
      ) : null}
    </main>
  );
}
