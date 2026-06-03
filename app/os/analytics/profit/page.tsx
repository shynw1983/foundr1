"use client";

import { Boxes, ChartColumn, LineChart, WalletCards } from "lucide-react";
import { AnalyticsShell } from "../components/AnalyticsShell";

const profitItems = [
  {
    title: "売上",
    description: "売上分析から、月別の売上、入金見込み、販売チャネルを参照します。",
    href: "/os/sales",
    icon: ChartColumn,
    status: "接続済み"
  },
  {
    title: "人件費",
    description: "タイムカードの給与集計から、月別の人件費と勤務時間を参照します。",
    href: "/os/timecard/payroll",
    icon: WalletCards,
    status: "接続元"
  },
  {
    title: "原価",
    description: "発注・購入・レシートの実績から、食材、包材、消耗品の原価を接続します。",
    href: "/os/analytics/cost",
    icon: Boxes,
    status: "接続予定"
  },
  {
    title: "月次損益",
    description: "売上から人件費、原価、手数料を差し引き、月ごとの利益を確認します。",
    href: "/os/analytics/profit",
    icon: LineChart,
    status: "設計中"
  }
];

export default function ProfitAnalyticsPage() {
  return (
    <AnalyticsShell eyebrow="Monthly Profit" title="月次損益" sourceLabel="売上・人件費・原価を統合">
      <section className="panel">
        <div className="panel-title">
          <LineChart size={18} />
          <div>
            <h3>月次損益は集計レイヤー</h3>
            <p>ここでは新しく入力欄を増やさず、売上分析、タイムカードの給与集計、発注・購入原価を月次でまとめます。</p>
          </div>
        </div>
      </section>

      <section className="os-module-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Profit Model</p>
            <h2>接続する指標</h2>
          </div>
        </div>
        <div className="os-module-grid">
          {profitItems.map((item) => {
            const Icon = item.icon;
            return (
              <a className="os-module-card" href={item.href} key={item.title}>
                <div className="os-module-icon">
                  <Icon size={24} />
                </div>
                <div>
                  <div className="os-module-heading">
                    <h3>{item.title}</h3>
                    <span className={item.status === "接続済み" ? "status-pill is-active" : "status-pill"}>{item.status}</span>
                  </div>
                  <p>{item.description}</p>
                </div>
              </a>
            );
          })}
        </div>
      </section>
    </AnalyticsShell>
  );
}
