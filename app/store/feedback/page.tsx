"use client";

import { MessageSquareWarning } from "lucide-react";
import { FeedbackForm } from "../../../components/feedback/FeedbackForm";
import { StoreNavTabs } from "../components/StoreNavTabs";

const storeModules = [
  { value: "orders", label: "注文" },
  { value: "kitchen", label: "キッチン" },
  { value: "pickup-display", label: "受取表示" },
  { value: "menu", label: "販売状態" },
  { value: "procedures", label: "手順書" },
  { value: "timecard", label: "タイムカード" },
  { value: "pos", label: "POS" },
  { value: "other", label: "その他" }
];

const storeCategories = [
  { value: "unable_to_operate", label: "操作できない" },
  { value: "data_issue", label: "データが違う" },
  { value: "order_issue", label: "注文の問題" },
  { value: "pos_issue", label: "POS の問題" },
  { value: "timecard_issue", label: "勤怠の問題" },
  { value: "unclear_flow", label: "使い方が不明" },
  { value: "other", label: "その他" }
];

export default function StoreFeedbackPage() {
  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>問題フィードバック</h1>
          </div>
        </a>
        <StoreNavTabs active="feedback" />
      </header>

      <section className="store-feedback-shell">
        <div className="feedback-context-strip">
          <MessageSquareWarning size={18} />
          <span>日常業務中に見つけた問題を、短く残せます。送信時に現在のページや端末情報も一緒に記録されます。</span>
        </div>
        <FeedbackForm
          source="store"
          title="店舗業務の問題を報告"
          description="注文、POS、キッチン、手順書、タイムカードなど、作業中に困った内容を送ってください。"
          moduleOptions={storeModules}
          categoryOptions={storeCategories}
          compact
        />
      </section>
    </main>
  );
}
