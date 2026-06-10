"use client";

import {
  BadgePercent,
  Boxes,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileText,
  Globe2,
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
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { UserBadge } from "./components/UserBadge";
import { getCachedCurrentEmployee, loadCurrentEmployee } from "./components/currentEmployeeStore";
import { getCachedNavigationSettings, loadNavigationSettings } from "./components/navigationSettingsStore";

type HomeFeature = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  importance: "primary" | "secondary";
};

type HomeFeatureGroup = {
  title: string;
  description: string;
  features: HomeFeature[];
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

const homeFeatureGroups: HomeFeatureGroup[] = [
  {
    title: "日常実行",
    description: "店舗が毎日開く入口。注文、購入、納品、証憑、勤怠をここに集約します。",
    features: [
      {
        title: "店舗ワークベンチ",
        description: "現場スタッフ用の注文、キッチン、販売状態、手順書、タイムカード、POS入口。",
        href: "/store",
        icon: Store,
        importance: "primary"
      },
      {
        title: "発注依頼",
        description: "店舗側の発注作成、店舗確認、購入状況の確認。",
        href: "/os/orders",
        icon: PackageCheck,
        importance: "primary"
      },
      {
        title: "購入管理",
        description: "発注先ごとの購入、納品、到着日、購入不可、レシート管理。",
        href: "/os/procurement",
        icon: ClipboardList,
        importance: "primary"
      },
      {
        title: "証憑管理",
        description: "レシート、領収書、PDF、OCR結果の整理。",
        href: "/os/vouchers",
        icon: ReceiptText,
        importance: "secondary"
      },
      {
        title: "発注履歴",
        description: "完了済みの発注、納品、レシート確認。",
        href: "/os/history",
        icon: FileText,
        importance: "secondary"
      },
      {
        title: "タイムカード",
        description: "出退勤、休憩、勤務実績の確認。",
        href: "/os/timecard",
        icon: Clock3,
        importance: "secondary"
      }
    ]
  },
  {
    title: "店舗運営",
    description: "手順書、現場記録、連絡、改善要望など、店舗品質を維持するための入口です。",
    features: [
      {
        title: "手順書管理",
        description: "商品・メニューと連動する店舗手順、チェックリスト、教育資料。",
        href: "/os/procedures",
        icon: ClipboardCheck,
        importance: "primary"
      },
      {
        title: "現場記録",
        description: "店舗で起きた改善点、気づき、運用メモ。",
        href: "/os/field-notes",
        icon: Lightbulb,
        importance: "secondary"
      },
      {
        title: "連絡・報告",
        description: "店舗確認、報告、連絡事項の確認。",
        href: "/os/reports",
        icon: MessageSquareWarning,
        importance: "secondary"
      },
      {
        title: "フィードバック",
        description: "Store と OS から送られた問題報告や要望。",
        href: "/os/feedback",
        icon: MessageSquareWarning,
        importance: "secondary"
      }
    ]
  },
  {
    title: "売上・顧客",
    description: "POS、Web予約、メニュー、ブランドサイト、会員を一体で管理します。",
    features: [
      {
        title: "POS",
        description: "店舗会計、税率・決済設定、取引状況。",
        href: "/os/pos",
        icon: ShoppingCart,
        importance: "primary"
      },
      {
        title: "日次レジ締め",
        description: "日次締め、差額、決済別の確認。",
        href: "/os/pos/reconciliation",
        icon: ReceiptText,
        importance: "secondary"
      },
      {
        title: "メニュー管理",
        description: "POS、ブランドサイト、キッチン表示で共有するメニュー master。",
        href: "/os/menus",
        icon: MenuSquare,
        importance: "primary"
      },
      {
        title: "ブランドサイト",
        description: "公開メニュー、Web予約、販売状態との連携確認。",
        href: "/os/brand-sites",
        icon: Globe2,
        importance: "secondary"
      },
      {
        title: "会員・ポイント",
        description: "会員カード、ポイント、特典、言語設定。",
        href: "/os/loyalty",
        icon: BadgePercent,
        importance: "secondary"
      }
    ]
  },
  {
    title: "分析",
    description: "売上、人件費、原価、経費、月次損益を分けて見ます。",
    features: [
      {
        title: "経営分析",
        description: "経営指標の全体確認。",
        href: "/os/analytics",
        icon: LineChart,
        importance: "primary"
      },
      {
        title: "売上分析",
        description: "POS、Web予約、デリバリー売上の確認。",
        href: "/os/analytics/sales",
        icon: ChartColumn,
        importance: "secondary"
      },
      {
        title: "人件費分析",
        description: "勤怠データに基づく人件費と労働時間。",
        href: "/os/analytics/labor",
        icon: UserCog,
        importance: "secondary"
      },
      {
        title: "原価・経費分析",
        description: "原価と月次経費を分けて確認。",
        href: "/os/analytics/cost",
        icon: Boxes,
        importance: "secondary"
      },
      {
        title: "月次損益",
        description: "月次の利益、固定費、変動費、雑費。",
        href: "/os/analytics/profit",
        icon: LineChart,
        importance: "secondary"
      }
    ]
  },
  {
    title: "マスタ・設定",
    description: "全モジュールの前提になる商品、店舗、スタッフ、発注先、システム設定です。",
    features: [
      {
        title: "商品マスタ",
        description: "発注、手順、原価計算で使う商品データ。",
        href: "/os/products",
        icon: Boxes,
        importance: "primary"
      },
      {
        title: "店舗・ブランド",
        description: "店舗、ブランド、営業設定、表示範囲。",
        href: "/os/stores",
        icon: Store,
        importance: "primary"
      },
      {
        title: "スタッフ管理",
        description: "アカウント、役割、店舗・ブランド・発注先の表示範囲。",
        href: "/os/staff",
        icon: UserCog,
        importance: "primary"
      },
      {
        title: "発注先管理",
        description: "発注先、購入 URL、納品先、連絡先の管理。",
        href: "/os/suppliers",
        icon: Truck,
        importance: "secondary"
      },
      {
        title: "商品比較",
        description: "候補商品、輸入品、価格・重量・送料の比較。",
        href: "/os/product-comparisons",
        icon: Search,
        importance: "secondary"
      },
      {
        title: "システム設定",
        description: "会社情報、通知、勤怠、POS、外部サービス利用量。",
        href: "/os/settings",
        icon: Settings,
        importance: "secondary"
      }
    ]
  }
];

function canAccessFeature(role: string, permittedNavPaths: Set<string>, feature: HomeFeature) {
  if (!role) return false;
  if (feature.href === "/os") return true;
  return permittedNavPaths.has(feature.href);
}

function HomeFeatureCard({ feature, isBeta }: { feature: HomeFeature; isBeta: boolean }) {
  const Icon = feature.icon;

  return (
    <a className={`os-module-card is-${feature.importance}`} href={feature.href}>
      <div className="os-module-icon">
        <Icon size={feature.importance === "primary" ? 23 : 18} />
      </div>
      <div>
        <div className="os-module-heading">
          <h3>{feature.title}</h3>
          {isBeta ? <span className="nav-beta-badge">Beta</span> : null}
        </div>
        <p>{feature.description}</p>
      </div>
    </a>
  );
}

export default function Foundr1OsHome() {
  const cachedEmployee = getCachedCurrentEmployee();
  const cachedNavigationSettings = getCachedNavigationSettings();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const [permittedNavPaths, setPermittedNavPaths] = useState(() => new Set(cachedEmployee?.permittedNavPaths ?? []));
  const [betaNavPaths, setBetaNavPaths] = useState(() => new Set(cachedNavigationSettings?.betaNavPaths ?? []));
  const [payrollAlerts, setPayrollAlerts] = useState<PayrollStatutoryAlert[]>([]);
  const [dismissingAlertKey, setDismissingAlertKey] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) {
        setRole(employee?.role ?? "");
        setPermittedNavPaths(new Set(employee?.permittedNavPaths ?? []));
      }
    }

    void loadRole();

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

  const permittedHomeFeatureGroups = useMemo(() => {
    return homeFeatureGroups
      .map((group) => ({
        ...group,
        features: group.features.filter((feature) => canAccessFeature(role, permittedNavPaths, feature))
      }))
      .filter((group) => group.features.length > 0);
  }, [permittedNavPaths, role]);
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
          <p>現在の OS メニューから日常利用する重要な入口だけを整理しています。権限がある機能だけが表示されます。</p>
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
            <p className="eyebrow">Core Workspaces</p>
            <h2>重要な機能ブロック</h2>
          </div>
        </div>
        {permittedHomeFeatureGroups.length ? (
          <div className="os-home-feature-groups">
            {permittedHomeFeatureGroups.map((group) => {
              const primaryFeatures = group.features.filter((feature) => feature.importance === "primary");
              const secondaryFeatures = group.features.filter((feature) => feature.importance === "secondary");

              return (
                <section className="os-home-feature-group" key={group.title}>
                  <div className="os-home-feature-group-heading">
                    <h3>{group.title}</h3>
                    <p>{group.description}</p>
                  </div>
                  {primaryFeatures.length ? (
                    <div className="os-module-grid">
                      {primaryFeatures.map((feature) => <HomeFeatureCard feature={feature} isBeta={betaNavPaths.has(feature.href)} key={feature.href} />)}
                    </div>
                  ) : null}
                  {secondaryFeatures.length ? (
                    <div className="os-module-link-grid">
                      {secondaryFeatures.map((feature) => <HomeFeatureCard feature={feature} isBeta={betaNavPaths.has(feature.href)} key={feature.href} />)}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : (
          <p className="empty-state">利用できる機能がありません。</p>
        )}
      </section>
    </main>
  );
}
