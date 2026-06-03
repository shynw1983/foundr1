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
  },
  {
    title: "経費設定を開く",
    description: "固定費、変動費、雑費を店舗別に設定します。",
    href: "/os/analytics/expenses",
    icon: Boxes,
    status: "利用可能"
  }
];

const expenseBuckets = [
  {
    title: "固定費",
    description: "毎月ほぼ固定で発生する家賃、設備リースを月次損益へ接続します。",
    status: "接続予定"
  },
  {
    title: "変動費",
    description: "水道光熱費、通信費など、月によって変動する経費を管理します。",
    status: "接続予定"
  },
  {
    title: "雑費",
    description: "ごみ処理、その他の店舗費用を月次の経費として整理します。",
    status: "接続予定"
  }
];

export default function CostAnalyticsPage() {
  return (
    <AnalyticsShell eyebrow="Cost Analytics" title="原価・経費分析" sourceLabel="発注・購入 / 月次経費を参照">
      <section className="panel">
        <div className="panel-title">
          <PackageCheck size={18} />
          <div>
            <h3>原価と経費を分けて集計</h3>
            <p>購入原価は注文システム側の購入実績とレシートから取り、固定費、変動費、雑費は月次経費として整理します。</p>
          </div>
        </div>
      </section>

      <section className="os-module-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Expense Buckets</p>
            <h2>経費の分類</h2>
          </div>
        </div>
        <div className="os-module-grid">
          {expenseBuckets.map((item) => (
            <article className="os-module-card" key={item.title}>
              <div className="os-module-icon">
                <Boxes size={24} />
              </div>
              <div>
                <div className="os-module-heading">
                  <h3>{item.title}</h3>
                  <span className="status-pill">{item.status}</span>
                </div>
                <p>{item.description}</p>
              </div>
            </article>
          ))}
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
