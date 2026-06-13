"use client";

import { BookOpen, ChefHat, Clock3, ClipboardList, FileText, MessageSquareWarning, Monitor, Settings, ShoppingCart, Tags } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StoreNavTabs } from "./components/StoreNavTabs";

const storeModules = [
  {
    title: "注文",
    description: "Web予約注文を受け取り、制作開始、受け取り可、受け渡し完了まで処理します。",
    href: "/store/orders",
    icon: ClipboardList,
    status: "利用可能"
  },
  {
    title: "キッチン",
    description: "Web予約と POS の制作タスクを、構造化された商品・オプション情報で確認します。",
    href: "/store/display/kitchen",
    icon: ChefHat,
    status: "利用可能"
  },
  {
    title: "受取表示",
    description: "制作中と受け取り可能な番号を客席向け画面に表示し、受け渡しを案内します。",
    href: "/store/display/pickup",
    icon: Monitor,
    status: "利用可能"
  },
  {
    title: "販売状態",
    description: "本日の売切、販売再開、Web・POS の販売可否、現場メモを商品ごとに更新します。",
    href: "/store/menu",
    icon: Tags,
    status: "利用可能"
  },
  {
    title: "手順書",
    description: "店舗・ブランド・メニュー条件に合う公開手順書を確認し、現場作業を進めます。",
    href: "/store/procedures",
    icon: BookOpen,
    status: "利用可能"
  },
  {
    title: "タイムカード",
    description: "店舗端末でスタッフの出退勤、休憩、退勤を記録します。個人のシフト・給与確認は Staff App で行います。",
    href: "/store/timecard",
    icon: Clock3,
    status: "利用可能"
  },
  {
    title: "POS",
    description: "店頭会計、注文入力、決済、レジ開店・締め、取引履歴、返金を処理します。",
    href: "/store/pos",
    icon: ShoppingCart,
    status: "利用可能"
  },
  {
    title: "個人情報文書",
    description: "同意済みの個人情報・マイナンバー取扱文書を確認し、必要に応じてダウンロードします。",
    href: "/store/privacy-documents",
    icon: FileText,
    status: "利用可能"
  },
  {
    title: "問題報告",
    description: "日常業務で見つけた操作不明、データ違い、POS・注文・勤怠の問題を送信します。",
    href: "/store/feedback",
    icon: MessageSquareWarning,
    status: "利用可能"
  },
  {
    title: "Foundr1 OS",
    description: "管理画面へ移動し、商品、メニュー、スタッフ、店舗、設定、分析を確認します。",
    href: "/os",
    icon: Settings,
    status: "利用可能"
  }
];

export default function StoreHomePage() {
  const [employeeRole, setEmployeeRole] = useState("");
  const visibleModules = useMemo(() => (
    employeeRole === "store_terminal"
      ? storeModules.filter((module) => ["/store/orders", "/store/display/kitchen", "/store/display/pickup", "/store/menu", "/store/procedures", "/store/timecard", "/store/pos", "/store/feedback"].includes(module.href))
      : storeModules
  ), [employeeRole]);

  useEffect(() => {
    let isMounted = true;
    async function loadCurrentEmployee() {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { employee?: { role?: string; isTimecardEmployee?: boolean } | null };
      if (isMounted) {
        setEmployeeRole(String(body.employee?.role ?? ""));
      }
    }
    void loadCurrentEmployee();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>店舗ワークベンチ</h1>
          </div>
        </a>
        <StoreNavTabs active="home" />
      </header>

      <section className="store-workbench-grid">
        {visibleModules.map((module) => {
          const Icon = module.icon;
          const content = (
            <>
              <div className="os-module-icon">
                <Icon size={24} />
              </div>
              <div>
                <div className="os-module-heading">
                  <h2>{module.title}</h2>
                  <span className={module.status === "利用可能" ? "status-pill is-active" : "status-pill"}>{module.status}</span>
                </div>
                <p>{module.description}</p>
              </div>
            </>
          );

          return module.status === "利用可能" ? (
            <a className="os-module-card" href={module.href} key={module.href}>{content}</a>
          ) : (
            <div className="os-module-card is-disabled" aria-disabled="true" key={module.href}>{content}</div>
          );
        })}
      </section>
    </main>
  );
}
