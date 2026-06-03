"use client";

import { Boxes, Plus, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AnalyticsShell } from "../components/AnalyticsShell";

type StoreOption = { id: string; name: string };
type ExpenseCategory = "fixed" | "variable" | "misc";
type ExpenseItem = {
  id: string;
  category: ExpenseCategory;
  name: string;
  amount: number;
  startMonth: string;
  endMonth: string;
  note: string;
};
type ExpensesPayload = {
  month: string;
  stores: StoreOption[];
  selectedStoreId: string;
  canEditExpenses: boolean;
  expenses: ExpenseItem[];
  monthlyTotals: {
    fixed: number;
    variable: number;
    misc: number;
    total: number;
  };
};

const categoryLabels: Record<ExpenseCategory, string> = {
  fixed: "固定費",
  variable: "変動費",
  misc: "雑費"
};

function getCurrentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount);
}

function isActiveInMonth(item: ExpenseItem, month: string) {
  return item.startMonth <= month && (!item.endMonth || item.endMonth >= month);
}

const analyticsMonthStorageKey = "foundr1:analytics:selected-month";
const analyticsStoreStorageKey = "foundr1:analytics:selected-store-id";

function getStoredAnalyticsMonth() {
  if (typeof window === "undefined") return getCurrentMonth();
  const stored = window.localStorage.getItem(analyticsMonthStorageKey);
  return stored && /^\d{4}-\d{2}$/.test(stored) ? stored : getCurrentMonth();
}

function getStoredAnalyticsStoreId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(analyticsStoreStorageKey) ?? "";
}

function storeAnalyticsSelection(nextMonth: string, nextStoreId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(analyticsMonthStorageKey, nextMonth);
  if (nextStoreId) window.localStorage.setItem(analyticsStoreStorageKey, nextStoreId);
}

export default function ExpensesPage() {
  const [month, setMonth] = useState(getStoredAnalyticsMonth);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [data, setData] = useState<ExpensesPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadExpenses(nextMonth = month, nextStoreId = selectedStoreId) {
    setIsLoading(true);
    const params = new URLSearchParams({ month: nextMonth });
    if (nextStoreId) params.set("storeId", nextStoreId);
    const response = await fetch(`/api/analytics/expenses?${params.toString()}`, { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as ExpensesPayload;
      setData(body);
      setMonth(body.month);
      setSelectedStoreId(body.selectedStoreId);
      storeAnalyticsSelection(body.month, body.selectedStoreId);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    void loadExpenses(getStoredAnalyticsMonth(), getStoredAnalyticsStoreId());
  }, []);

  async function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStoreId) return;
    setIsSaving(true);
    setMessage("");
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/analytics/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: selectedStoreId,
        category: formData.get("category"),
        name: formData.get("name"),
        amount: formData.get("amount"),
        startMonth: formData.get("startMonth"),
        endMonth: formData.get("endMonth"),
        note: formData.get("note")
      })
    });
    if (response.ok) {
      event.currentTarget.reset();
      setMessage("経費を追加しました。");
      await loadExpenses(month, selectedStoreId);
    } else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setMessage(body.error ?? "経費を保存できませんでした。");
    }
    setIsSaving(false);
  }

  async function deleteExpense(id: string) {
    if (!window.confirm("この経費を削除しますか？")) return;
    const response = await fetch(`/api/analytics/expenses?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) {
      setMessage("経費を削除しました。");
      await loadExpenses(month, selectedStoreId);
    } else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setMessage(body.error ?? "経費を削除できませんでした。");
    }
  }

  const stores = data?.stores ?? [];
  const canEdit = Boolean(data?.canEditExpenses && selectedStoreId);
  const selectedStoreName = stores.find((store) => store.id === selectedStoreId)?.name ?? "店舗";
  const expenses = data?.expenses ?? [];
  const activeExpenses = expenses.filter((item) => isActiveInMonth(item, month));

  return (
    <AnalyticsShell eyebrow="Expense Settings" title="経費設定" sourceLabel={isLoading ? "読み込み中" : `${selectedStoreName} / ${month}`}>
      <section className="panel analytics-overview-panel">
        <div className="panel-title">
          <Boxes size={18} />
          <div>
            <h3>月次経費を管理</h3>
            <p>固定費、変動費、雑費を店舗別に設定します。開始月から終了月まで、選択月の月次損益に反映します。</p>
          </div>
        </div>
        <div className="analytics-control-row">
          <label>
            <span>対象月</span>
            <input
              type="month"
              value={month}
              onChange={(event) => {
                const nextMonth = event.target.value || getCurrentMonth();
                setMonth(nextMonth);
                storeAnalyticsSelection(nextMonth, selectedStoreId);
                void loadExpenses(nextMonth, selectedStoreId);
              }}
            />
          </label>
          <label>
            <span>店舗</span>
            <select
              value={selectedStoreId}
              onChange={(event) => {
                setSelectedStoreId(event.target.value);
                storeAnalyticsSelection(month, event.target.value);
                void loadExpenses(month, event.target.value);
              }}
            >
              {stores.map((store) => (
                <option value={store.id} key={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="metric-grid analytics-metric-grid">
        <article className="metric-card">
          <span>固定費</span>
          <strong>{formatMoney(data?.monthlyTotals.fixed ?? 0)}</strong>
          <p>家賃、設備リース</p>
        </article>
        <article className="metric-card">
          <span>変動費</span>
          <strong>{formatMoney(data?.monthlyTotals.variable ?? 0)}</strong>
          <p>水道光熱費、通信費</p>
        </article>
        <article className="metric-card">
          <span>雑費</span>
          <strong>{formatMoney(data?.monthlyTotals.misc ?? 0)}</strong>
          <p>ごみ処理、その他の店舗費用</p>
        </article>
        <article className="metric-card">
          <span>当月経費</span>
          <strong>{formatMoney(data?.monthlyTotals.total ?? 0)}</strong>
          <p>選択月に有効な経費 {activeExpenses.length}件</p>
        </article>
      </section>

      <section className="panel analytics-overview-panel">
        <div className="panel-title">
          <Plus size={18} />
          <div>
            <h3>経費を追加</h3>
            <p>終了月を空にすると、開始月以降ずっと毎月計上します。</p>
          </div>
        </div>
        <form className="expense-form" key={`${selectedStoreId}-${month}`} onSubmit={createExpense}>
          <label>
            <span>分類</span>
            <select name="category" defaultValue="fixed" disabled={!canEdit}>
              <option value="fixed">固定費</option>
              <option value="variable">変動費</option>
              <option value="misc">雑費</option>
            </select>
          </label>
          <label>
            <span>経費名</span>
            <input name="name" placeholder="例: 家賃" required disabled={!canEdit} />
          </label>
          <label>
            <span>金額</span>
            <input name="amount" type="number" min="0" step="1" placeholder="例: 120000" required disabled={!canEdit} />
          </label>
          <label>
            <span>開始月</span>
            <input name="startMonth" type="month" defaultValue={month} required disabled={!canEdit} />
          </label>
          <label>
            <span>終了月</span>
            <input name="endMonth" type="month" disabled={!canEdit} />
          </label>
          <label>
            <span>メモ</span>
            <input name="note" placeholder="任意" disabled={!canEdit} />
          </label>
          <button className="primary-button" type="submit" disabled={!canEdit || isSaving}>
            経費を保存
          </button>
        </form>
        {message ? <p className="empty-state-text">{message}</p> : null}
      </section>

      <section className="panel analytics-overview-panel">
        <div className="panel-title">
          <Boxes size={18} />
          <div>
            <h3>登録済み経費</h3>
            <p>選択月に有効な経費を濃く表示します。</p>
          </div>
        </div>
        <div className="expense-list">
          {expenses.map((item) => {
            const isActive = isActiveInMonth(item, month);
            return (
              <article className={`expense-row${isActive ? " is-active" : ""}`} key={item.id}>
                <div>
                  <span>{categoryLabels[item.category]}</span>
                  <strong>{item.name}</strong>
                  <p>{item.startMonth} - {item.endMonth || "継続"}{item.note ? ` / ${item.note}` : ""}</p>
                </div>
                <b>{formatMoney(item.amount)}</b>
                {canEdit ? (
                  <button className="icon-button" type="button" aria-label="削除" onClick={() => void deleteExpense(item.id)}>
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </article>
            );
          })}
          {!expenses.length ? <p className="empty-state-text">登録済み経費はありません。</p> : null}
        </div>
      </section>
    </AnalyticsShell>
  );
}
