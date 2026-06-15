"use client";

import {
  ChevronRight
} from "lucide-react";
import { useEffect, useState } from "react";
import { UserBadge } from "./components/UserBadge";
import { canonicalNavItems, type OsNavModuleWithChildren, usePermittedNavModules } from "./components/OsNavList";
import { getCachedCurrentEmployee, loadCurrentEmployee } from "./components/currentEmployeeStore";

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

function OsHomeModuleCard({ module }: { module: OsNavModuleWithChildren }) {
  const Icon = module.icon;
  const mainHref = module.href ?? module.children[0]?.href ?? "/os";
  const directChild = module.href ? module.children.find((child) => child.href === module.href) : null;
  const childLinks = directChild && module.children.length === 1 ? [] : module.children;

  return (
    <article className="os-home-module-card">
      <a className="os-home-module-main" href={mainHref}>
        <span className="os-home-module-icon">
          <Icon size={24} />
        </span>
        <span className="os-home-module-title">
          <span>
            {module.label}
            {directChild?.beta ? <span className="nav-beta-badge">Beta</span> : null}
          </span>
          <ChevronRight size={17} />
        </span>
      </a>
      {childLinks.length ? (
        <div className="os-home-module-links">
          {childLinks.map((child) => {
            const ChildIcon = child.icon;

            return (
              <a href={child.href} key={child.href}>
                <ChildIcon size={14} />
                <span>{child.label}</span>
                {child.beta ? <span className="nav-beta-badge">Beta</span> : null}
              </a>
            );
          })}
        </div>
      ) : (
        <p className="os-home-module-note">店舗現場の作業画面を開きます。</p>
      )}
    </article>
  );
}

function OsHomeDesktop({ modules }: { modules: OsNavModuleWithChildren[] }) {
  if (!modules.length) return <p className="empty-state">利用できる機能がありません。</p>;

  return (
    <div className="os-home-module-grid">
      {modules.map((module) => (
        <OsHomeModuleCard module={module} key={module.id} />
      ))}
    </div>
  );
}

export default function Foundr1OsHome() {
  const cachedEmployee = getCachedCurrentEmployee();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const permittedNavModules = usePermittedNavModules(canonicalNavItems);
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
          <h2>必要な業務へすぐ入る</h2>
          <p>OS メニューの大タイトルをそのままデスクトップに並べています。権限がある機能だけが表示されます。</p>
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

      <section className="os-module-section" aria-label="重要機能">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Menu Desktop</p>
            <h2>メニューから探す</h2>
          </div>
        </div>
        <OsHomeDesktop modules={permittedNavModules} />
      </section>
    </main>
  );
}
