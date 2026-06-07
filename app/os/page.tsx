"use client";

import {
  ClipboardCheck,
  Clock3,
  LineChart,
  MenuSquare,
  MessageSquareWarning,
  PackageCheck,
  Settings,
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

type PayrollStatutoryAlert = {
  key: string;
  level: "critical" | "warning";
  title: string;
  message: string;
  actionLabel: string;
  dueLabel: string;
  targetYear?: number;
  dismissible?: boolean;
  dismissActionLabel?: string;
};

const osModules: OsModule[] = [
  {
    title: "店舗ワークベンチ",
    description: "店舗スタッフが注文、キッチン表示、販売状態、手順書、タイムカード、POSをまとめて操作します。",
    href: "/store",
    icon: Store,
    status: "active",
    roles: ["owner", "manager", "store_owner", "store_manager", "staff"]
  },
  {
    title: "発注・購入管理",
    description: "店舗発注から購入、納品、店舗確認、レシート、発注先まで一連の実行を管理します。",
    href: "/os/orders",
    icon: PackageCheck,
    status: "active",
    roles: ["owner", "manager", "store_owner", "store_manager", "staff"]
  },
  {
    title: "店舗運営",
    description: "商品・メニューと連動する手順書を中心に、チェックリスト、清掃・点検、トレーニングを管理します。",
    href: "/os/procedures",
    icon: ClipboardCheck,
    status: "active",
    roles: ["owner", "manager"]
  },
  {
    title: "タイムカード",
    description: "出退勤、休憩、希望シフト、勤務実績、給与、負荷分析を店舗別に確認します。",
    href: "/os/timecard",
    icon: Clock3,
    status: "active",
    roles: ["owner", "manager", "store_owner", "store_manager", "staff"]
  },
  {
    title: "経営分析",
    description: "POS・Web予約・デリバリー売上、人件費、原価、経費、月次損益を横断して確認します。",
    href: "/os/analytics",
    icon: LineChart,
    status: "active",
    roles: ["owner", "manager"]
  },
  {
    title: "POS",
    description: "店舗 POS の会計状況、税率・決済設定、日次レジ締め、取引履歴を管理します。",
    href: "/os/pos",
    icon: ShoppingCart,
    status: "active",
    roles: ["owner", "manager"]
  }
];

const systemModules: OsModule[] = [
  {
    title: "メニュー管理",
    description: "ブランドサイト、POS、キッチン表示、手順書で共有するメニュー、選択肢、販売可否を管理します。",
    href: "/os/menus",
    icon: MenuSquare,
    status: "active",
    roles: ["owner", "manager"]
  },
  {
    title: "店舗・ブランド",
    description: "店舗、ブランド、表示範囲、営業設定を整え、全モジュールの基礎データとして利用します。",
    href: "/os/stores",
    icon: Store,
    status: "active",
    roles: ["owner", "manager"]
  },
  {
    title: "スタッフ管理",
    description: "スタッフアカウント、役割、店舗・ブランド・発注先の表示範囲、ログイン情報を管理します。",
    href: "/os/staff",
    icon: UserCog,
    status: "active",
    roles: ["owner", "manager", "store_owner", "store_manager"]
  },
  {
    title: "フィードバック",
    description: "Store と OS から送られた問題報告、データ修正、機能要望を確認し、対応状態を管理します。",
    href: "/os/feedback",
    icon: MessageSquareWarning,
    status: "active",
    roles: ["owner", "manager", "store_owner", "store_manager"]
  },
  {
    title: "システム設定",
    description: "会社情報、Store 表示、販売状態、通知、勤怠、POS などモジュールごとの動作を設定します。",
    href: "/os/settings",
    icon: Settings,
    status: "active",
    roles: ["owner", "manager"]
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
  const [payrollAlerts, setPayrollAlerts] = useState<PayrollStatutoryAlert[]>([]);
  const [dismissingAlertKey, setDismissingAlertKey] = useState("");

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

  useEffect(() => {
    let isMounted = true;

    async function loadPayrollAlerts() {
      const response = await fetch("/api/settings/payroll-statutory-alerts", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { alerts?: PayrollStatutoryAlert[]; canView?: boolean };
      if (isMounted && body.canView) setPayrollAlerts(body.alerts ?? []);
    }

    void loadPayrollAlerts();

    return () => {
      isMounted = false;
    };
  }, []);

  async function dismissPayrollStatutoryAlert(alert: PayrollStatutoryAlert) {
    if (!alert.targetYear) return;
    setDismissingAlertKey(alert.key);
    const response = await fetch("/api/settings/payroll-statutory-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "dismiss_payroll_statutory_alert",
        alertKey: alert.key,
        targetYear: alert.targetYear
      })
    });
    if (response.ok) {
      const nextResponse = await fetch("/api/settings/payroll-statutory-alerts", { cache: "no-store" });
      if (nextResponse.ok) {
        const body = await nextResponse.json() as { alerts?: PayrollStatutoryAlert[]; canView?: boolean };
        if (body.canView) setPayrollAlerts(body.alerts ?? []);
      }
    }
    setDismissingAlertKey("");
  }

  const permittedModules = useMemo(() => osModules.filter((module) => canAccessModule(role, module)), [role]);
  const permittedSystemModules = useMemo(() => systemModules.filter((module) => canAccessModule(role, module)), [role]);
  const payrollAlertActionHref = ["store_owner", "store_manager"].includes(role) ? "/os/timecard/payroll" : "/os/settings";
  const payrollAlertActionLabel = ["store_owner", "store_manager"].includes(role) ? "給与へ" : "システム設定へ";

  return (
    <main className="os-home-shell">
      <header className="os-home-topbar">
        <a className="brand-block" href="/os" aria-label="Foundr1 OS ホーム">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>管理画面</h1>
          </div>
        </a>
        <div className="os-home-user">
          <UserBadge />
        </div>
      </header>

      <section className="os-home-hero">
        <div>
          <p className="eyebrow">Restaurant Operating System</p>
          <h2>店舗運営の機能を選択</h2>
          <p>商品マスタ、スタッフ、店舗、ブランド、権限を共有しながら、必要な業務アプリへ入ります。</p>
        </div>
      </section>

      {payrollAlerts.length ? (
        <section className="statutory-alert-panel" aria-label="給与法定データ更新アラート">
          <div className="statutory-alert-heading">
            <strong>給与計算データの更新が必要です</strong>
            <a className="secondary-button" href={payrollAlertActionHref}>{payrollAlertActionLabel}</a>
          </div>
          <div className="statutory-alert-list">
            {payrollAlerts.map((alert) => (
              <article className={`statutory-alert-card is-${alert.level}`} key={alert.key}>
                <div>
                  <span>{alert.dueLabel}</span>
                  <h3>{alert.title}</h3>
                  <p>{alert.message}</p>
                </div>
                <div className="statutory-alert-card-actions">
                  <strong>{alert.actionLabel}</strong>
                  {alert.dismissible ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={dismissingAlertKey === alert.key}
                      onClick={() => void dismissPayrollStatutoryAlert(alert)}
                    >
                      {dismissingAlertKey === alert.key ? "保存中" : alert.dismissActionLabel ?? "閉じる"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="os-module-section" aria-label="業務アプリ">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Modules</p>
            <h2>業務アプリ</h2>
          </div>
        </div>
        <div className="os-module-grid">
          {permittedModules.map((module) => <ModuleCard module={module} key={module.title} />)}
          {!permittedModules.length ? <p className="empty-state">利用できる業務アプリがありません。</p> : null}
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
