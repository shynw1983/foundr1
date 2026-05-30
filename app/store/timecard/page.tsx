import { Clock3 } from "lucide-react";
import { StoreNavTabs } from "../components/StoreNavTabs";

export default function StoreTimecardPage() {
  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Store</p>
            <h1>タイムカード</h1>
          </div>
        </a>
        <StoreNavTabs active="timecard" />
      </header>
      <section className="panel store-placeholder-panel">
        <Clock3 />
        <div>
          <h2>準備中</h2>
          <p>店舗現場の出退勤、休憩、シフト確認をここに集約します。</p>
        </div>
      </section>
    </main>
  );
}
