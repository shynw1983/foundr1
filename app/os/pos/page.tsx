import { ShoppingCart } from "lucide-react";

export default function PosPage() {
  return (
    <main className="os-home-shell">
      <header className="os-home-topbar">
        <a className="brand-block" href="/os" aria-label="Foundr1 OS ホーム">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>POS</h1>
          </div>
        </a>
      </header>
      <section className="os-home-hero">
        <div>
          <p className="eyebrow">Coming Soon</p>
          <h2>POS</h2>
          <p>販売、会計、メニュー、売上レポートを Foundr1 OS の商品・店舗・スタッフデータに接続して開発します。</p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <ShoppingCart />
          <div>
            <h3>準備中</h3>
            <p>このモジュールは入口だけ先に配置しています。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
