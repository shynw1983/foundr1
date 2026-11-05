"use client";

import { useEffect, useState } from "react";
import { loadCurrentEmployee } from "../os/components/currentEmployeeStore";
import { StoreNavTabs } from "./components/StoreNavTabs";
import { getVisibleStoreNavigation } from "./components/store-navigation";

const homeSections = [
  { id: "orders", label: "接客・注文" },
  { id: "inventory", label: "商品・在庫" }
] as const;

export default function StoreHomePage() {
  const [role, setRole] = useState<string | null>(null);
  const [canUseInventory, setCanUseInventory] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadCurrentEmployee().then(employee => {
      if (!alive) return;
      setRole(employee?.role ?? "");
      setCanUseInventory(Boolean(employee?.permissions?.includes("store.inventory") || employee?.permittedNavPaths?.includes("/store/inventory")));
    });
    return () => { alive = false; };
  }, []);
  const visibleItems = getVisibleStoreNavigation(role, canUseInventory);
  const shortcuts = visibleItems.filter(item => "shortcut" in item && item.shortcut);
  return (
    <main className="store-workbench-shell store-home-page">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div><p className="eyebrow">Foundr1 STORE</p><h1>店舗ワークベンチ</h1></div>
        </a>
        <StoreNavTabs active="home" />
      </header>
      <div className="store-home-sections">
        {homeSections.map(section => {
          const items = visibleItems.filter(item => "homeSection" in item && item.homeSection === section.id);
          return items.length ? <section className="store-home-section" aria-labelledby={`store-home-${section.id}`} key={section.id}>
            <h2 id={`store-home-${section.id}`}>{section.label}</h2>
            <div className="store-workbench-grid">
              {items.map(item => {
                const Icon = item.icon;
                return <a className="os-module-card" href={item.href} key={item.href}>
                  <div className="os-module-icon"><Icon size={22} /></div>
                  <div><div className="os-module-heading"><h3>{item.label}</h3></div><p>{"description" in item ? item.description : ""}</p></div>
                </a>;
              })}
            </div>
          </section> : null;
        })}
        {shortcuts.length ? <section className="store-home-shortcuts" aria-labelledby="store-home-operations">
          <h2 id="store-home-operations">店舗運営</h2>
          <nav aria-label="店舗運営のショートカット">
            {shortcuts.map(item => { const Icon = item.icon; return <a href={item.href} key={item.href}><Icon size={17} />{item.label}</a>; })}
          </nav>
        </section> : null}
        {role === null ? <p className="store-home-notice" role="status">ログイン確認中</p> : visibleItems.length === 0 ? <p className="store-home-notice">利用できる機能がありません。</p> : null}
      </div>
    </main>
  );
}
