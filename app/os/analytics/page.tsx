import {
  Boxes,
  ChartColumn,
  LineChart,
  WalletCards
} from "lucide-react";
import { AnalyticsShell } from "./components/AnalyticsShell";

const analyticsCards = [
  {
    title: "売上分析",
    description: "売上、入金見込み、チャネル、忙しさ、天気、取込状況を確認します。",
    href: "/os/sales",
    icon: ChartColumn,
    status: "利用可能"
  },
  {
    title: "人件費分析",
    description: "勤怠と給与設定から、人件費率や売上/人件費のバランスを確認します。",
    href: "/os/analytics/labor",
    icon: WalletCards,
    status: "準備中"
  },
  {
    title: "原価分析",
    description: "発注・購入・レシートから、食材原価や包材・消耗品コストを集計します。",
    href: "/os/analytics/cost",
    icon: Boxes,
    status: "準備中"
  },
  {
    title: "月次損益",
    description: "売上、人件費、原価、手数料を統合し、月ごとの利益を確認します。",
    href: "/os/analytics/profit",
    icon: LineChart,
    status: "準備中"
  }
];

export default function AnalyticsPage() {
  return (
    <AnalyticsShell eyebrow="Management Analytics" title="経営分析" sourceLabel="分析体系">
        <section className="os-module-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Analytics</p>
              <h2>分析メニュー</h2>
            </div>
          </div>
          <div className="os-module-grid">
            {analyticsCards.map((card) => {
              const Icon = card.icon;
              return (
                <a className="os-module-card" href={card.href} key={card.title}>
                  <div className="os-module-icon">
                    <Icon size={24} />
                  </div>
                  <div>
                    <div className="os-module-heading">
                      <h3>{card.title}</h3>
                      <span className={card.status === "利用可能" ? "status-pill is-active" : "status-pill"}>{card.status}</span>
                    </div>
                    <p>{card.description}</p>
                  </div>
                </a>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <LineChart size={18} />
            <div>
              <h3>月次損益への接続</h3>
              <p>売上分析を起点に、人件費、発注・購入原価、手数料を順に接続して月次損益を作ります。</p>
            </div>
          </div>
        </section>
    </AnalyticsShell>
  );
}
