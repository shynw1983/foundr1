"use client";

import { Boxes, FileText, LineChart, PackageCheck, ShoppingCart } from "lucide-react";
import { AnalyticsShell } from "../components/AnalyticsShell";

const costLinks = [
  {
    title: "購入管理を見る",
    description: "発注先ごとの購入、納品、レシートの実績を原価分析のデータ元にします。",
    href: "/os/procurement",
    icon: ShoppingCart,
    status: "データ元"
  },
  {
    title: "発注履歴を見る",
    description: "過去の発注・購入・レシートから、月次の原価候補を確認します。",
    href: "/os/history",
    icon: FileText,
    status: "データ元"
  },
  {
    title: "商品マスタを見る",
    description: "商品単位、参考価格、発注先情報を原価の補助情報として使います。",
    href: "/os/products",
    icon: Boxes,
    status: "補助データ"
  },
  {
    title: "月次損益へ反映",
    description: "発注・購入側で確定した原価を月次損益へ接続します。",
    href: "/os/analytics/profit",
    icon: LineChart,
    status: "接続先"
  }
];

export default function CostAnalyticsPage() {
  return (
    <AnalyticsShell eyebrow="Cost Analytics" title="原価分析" sourceLabel="発注・購入 / レシートを参照">
      <section className="panel">
        <div className="panel-title">
          <PackageCheck size={18} />
          <div>
            <h3>原価は発注・購入から集計</h3>
            <p>購入原価は将来的に注文システム側の購入実績とレシートから取ります。経営分析では商品別、発注先別、月次損益への接続をまとめます。</p>
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
          {costLinks.map((item) => {
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
