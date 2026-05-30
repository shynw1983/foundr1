import { ShoppingCart } from "lucide-react";
import { StoreNavTabs } from "../components/StoreNavTabs";

export default function StorePosPage() {
  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Store</p>
            <h1>POS</h1>
          </div>
        </a>
        <StoreNavTabs active="pos" />
      </header>
      <section className="panel store-placeholder-panel">
        <ShoppingCart />
        <div>
          <h2>準備中</h2>
          <p>会計、販売、メニュー操作をここに集約します。</p>
        </div>
      </section>
    </main>
  );
}
