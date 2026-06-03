"use client";

import { ChartColumn, Clock3, LineChart, WalletCards } from "lucide-react";
import { AnalyticsShell } from "../components/AnalyticsShell";

const laborLinks = [
  {
    title: "給与集計を見る",
    description: "月ごとの勤務時間、人件費、交通費、支給額はタイムカードの給与集計を参照します。",
    href: "/os/timecard/payroll",
    icon: WalletCards,
    status: "データ元"
  },
  {
    title: "負荷分析を見る",
    description: "注文数と勤務時間のバランスは、既存の負荷分析から確認します。",
    href: "/os/timecard/workload",
    icon: Clock3,
    status: "データ元"
  },
  {
    title: "売上分析と比較",
    description: "売上、人件費率、時間あたり売上を同じ月次軸で比較します。",
    href: "/os/sales",
    icon: ChartColumn,
    status: "接続先"
  },
  {
    title: "月次損益へ反映",
    description: "給与集計の人件費を月次損益へ接続します。ここで再入力はしません。",
    href: "/os/analytics/profit",
    icon: LineChart,
    status: "接続先"
  }
];

export default function LaborAnalyticsPage() {
  return (
    <AnalyticsShell eyebrow="Labor Analytics" title="人件費分析" sourceLabel="タイムカード / 給与を参照">
      <section className="panel">
        <div className="panel-title">
          <WalletCards size={18} />
          <div>
            <h3>人件費はタイムカードから集計</h3>
            <p>勤務時間と給与設定はすでにタイムカード側にあるため、経営分析ではその結果を参照して売上分析と月次損益へ接続します。</p>
          </div>
        </div>
      </section>

      <section className="os-module-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Source of Truth</p>
            <h2>確認するデータ元</h2>
          </div>
        </div>
        <div className="os-module-grid">
          {laborLinks.map((item) => {
            const Icon = item.icon;
            return (
              <a className="os-module-card" href={item.href} key={item.title}>
                <div className="os-module-icon">
                  <Icon size={24} />
                </div>
                <div>
                  <div className="os-module-heading">
                    <h3>{item.title}</h3>
                    <span className="status-pill is-active">{item.status}</span>
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
