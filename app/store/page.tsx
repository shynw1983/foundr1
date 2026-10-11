"use client";

import { BellRing, BookOpen, Clock3, ClipboardList, Lightbulb, MessageSquareWarning, PackageCheck, PackageSearch, ShoppingCart, Tags, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { loadCurrentEmployee } from "../os/components/currentEmployeeStore";
import { StoreNavTabs } from "./components/StoreNavTabs";

const storeModules = [
  { title: "在庫確認", description: "目視で足りるかを確認し、必要なときだけ数えます。保管場所から商品を探せます。", href: "/store/inventory", icon: PackageSearch, status: "利用可能" },
  {
    title: "店舗設備",
    description: "室内照明の明るさと状態を確認し、スイッチを操作します。",
    href: "/store/devices",
    icon: Lightbulb,
    status: "利用可能"
  },
  {
    title: "注文通知",
    description: "指定ユーザーの離店中の注文通知と、スマートフォンの通知設定を管理します。",
    href: "/store/notifications",
    icon: BellRing,
    status: "利用可能"
  },
  {
    title: "客席管理",
    description: "入口で客席を割り当て、選菜中、制作中、食事中、清掃待ちまで店舗設定に合わせて管理します。",
    href: "/store/seats",
    icon: Users,
    status: "利用可能"
  },
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
    title: "POS",
    description: "店頭会計、注文入力、決済、レジ開店・締め、取引履歴、返金を処理します。",
    href: "/store/pos",
    icon: ShoppingCart,
    status: "利用可能"
  },
  {
    title: "納品・入庫",
    description: "実際に届いた数量と保管場所を確認し、入庫を記録します。",
    href: "/store/receiving",
    icon: PackageCheck,
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
    title: "手順書",
    description: "店舗・ブランド・メニュー条件に合う公開手順書を確認し、現場作業を進めます。",
    href: "/store/procedures",
    icon: BookOpen,
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
  const [role, setRole] = useState<string | null>(null);
  const [canUseInventory, setCanUseInventory] = useState(false);
  useEffect(() => { let alive = true; void loadCurrentEmployee().then(employee => { if (alive) { setRole(employee?.role ?? ""); setCanUseInventory(Boolean(employee?.permissions?.includes("store.inventory") || employee?.permittedNavPaths?.includes("/store/inventory"))); } }); return () => { alive = false; }; }, []);
  const visibleModules = role === null || ["staff", "store_owner", "store_manager"].includes(role) ? storeModules.filter(module => ["/store/inventory", "/store/receiving"].includes(module.href)) : storeModules;
  const permittedModules = visibleModules.filter(module => !["/store/inventory", "/store/receiving"].includes(module.href) || canUseInventory);
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
        {permittedModules.map((module) => {
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
