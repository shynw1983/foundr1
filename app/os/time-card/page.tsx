import { Clock3 } from "lucide-react";

export default function TimeCardPage() {
  return (
    <main className="os-home-shell">
      <header className="os-home-topbar">
        <a className="brand-block" href="/os" aria-label="Foundr1 OS ホーム">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Time Card</h1>
          </div>
        </a>
      </header>
      <section className="os-home-hero">
        <div>
          <p className="eyebrow">Coming Soon</p>
          <h2>Time Card</h2>
          <p>出退勤、休憩、シフト、勤怠確認を Foundr1 OS の共有スタッフ・店舗データに接続して開発します。</p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <Clock3 />
          <div>
            <h3>準備中</h3>
            <p>このモジュールは入口だけ先に配置しています。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
