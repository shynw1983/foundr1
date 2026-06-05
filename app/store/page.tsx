"use client";

import { BookOpen, Clock3, ClipboardList, Settings, ShoppingCart, Tags } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StoreNavTabs } from "./components/StoreNavTabs";

const storeModules = [
  {
    title: "注文",
    description: "Web予約注文を確認し、制作開始から受け渡し完了まで処理します。",
    href: "/store/orders",
    icon: ClipboardList,
    status: "利用可能"
  },
  {
    title: "販売状態",
    description: "本日の売切、販売再開、現場メモを商品ごとに更新します。",
    href: "/store/menu",
    icon: Tags,
    status: "利用可能"
  },
  {
    title: "手順書",
    description: "公開中の作業手順を確認し、店舗オペレーションを進めます。",
    href: "/store/procedures",
    icon: BookOpen,
    status: "利用可能"
  },
  {
    title: "タイムカード",
    description: "出退勤、休憩、シフト確認を行います。",
    href: "/store/timecard",
    icon: Clock3,
    status: "利用可能"
  },
  {
    title: "POS",
    description: "会計、販売、メニュー操作を行います。",
    href: "/store/pos",
    icon: ShoppingCart,
    status: "準備中"
  },
  {
    title: "OS",
    description: "管理画面で商品、スタッフ、店舗、設定を確認します。",
    href: "/os",
    icon: Settings,
    status: "利用可能"
  }
];

export default function StoreHomePage() {
  const [employeeRole, setEmployeeRole] = useState("");
  const [isTimecardEmployee, setIsTimecardEmployee] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const visibleModules = useMemo(() => (
    isMobileViewport && employeeRole === "staff" && isTimecardEmployee
      ? storeModules.filter((module) => module.href === "/store/procedures" || module.href === "/store/timecard" || module.href === "/os")
      : storeModules
  ), [employeeRole, isMobileViewport, isTimecardEmployee]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setIsMobileViewport(query.matches);
    updateViewport();
    query.addEventListener("change", updateViewport);
    return () => query.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadCurrentEmployee() {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { employee?: { role?: string; isTimecardEmployee?: boolean } | null };
      if (isMounted) {
        setEmployeeRole(String(body.employee?.role ?? ""));
        setIsTimecardEmployee(body.employee?.isTimecardEmployee === true);
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
            <p className="eyebrow">Foundr1 Store</p>
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
