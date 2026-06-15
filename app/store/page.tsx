"use client";

import { BookOpen, Clock3, ClipboardList, MessageSquareWarning, ShoppingCart, Tags } from "lucide-react";
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
    title: "問題報告",
    description: "日常業務で見つけた操作不明、データ違い、POS・注文・勤怠の問題を送信します。",
    href: "/store/feedback",
    icon: MessageSquareWarning,
    status: "利用可能"
  }
];

export default function StoreHomePage() {
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
        {storeModules.map((module) => {
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
