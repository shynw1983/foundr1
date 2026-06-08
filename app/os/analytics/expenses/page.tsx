"use client";

import { Ban, Boxes, Camera, CheckCircle, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
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
type ExpenseReceipt = {
  id: string;
  receiptPhotoUrl: string;
  ocrResultId: string;
  vendorName: string;
  purchaseDate: string;
  category: ExpenseCategory;
  subtotal: number;
  tax: number;
  total: number;
  note: string;
  status: string;
  createdLabel: string;
};
type ProductCandidate = {
  id: string;
  rawName: string;
  suggestedName: string;
  category: string;
  subcategory: string;
  unit: string;
  referencePrice: number;
  supplierName: string;
  vendorName: string;
  purchaseDate: string;
  createdLabel: string;
};
type ProductOption = {
  id: string;
  name: string;
  category: string;
  unit: string;
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
type ExpenseReceiptsPayload = {
  canEditExpenseReceipts: boolean;
  receipts: ExpenseReceipt[];
};
type ProductCandidatesPayload = {
  candidates: ProductCandidate[];
  products: ProductOption[];
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
const receiptCompressionTargetBytes = 2 * 1024 * 1024;
const receiptCompressionEdges = [1800, 1400, 1100];
const receiptCompressionQualities = [0.82, 0.72, 0.62];

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
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [message, setMessage] = useState("");
  const [receiptMessage, setReceiptMessage] = useState("");
  const [expenseReceipts, setExpenseReceipts] = useState<ExpenseReceipt[]>([]);
  const [canEditExpenseReceipts, setCanEditExpenseReceipts] = useState(false);
  const [productCandidates, setProductCandidates] = useState<ProductCandidate[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [candidateProductIds, setCandidateProductIds] = useState<Record<string, string>>({});
  const [candidateEdits, setCandidateEdits] = useState<Record<string, Partial<ProductCandidate>>>({});

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

  useEffect(() => {
    if (!selectedStoreId) return;
    void loadExpenseReceipts(selectedStoreId);
  }, [selectedStoreId]);

  useEffect(() => {
    void loadProductCandidates();
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

  async function loadExpenseReceipts(storeId = selectedStoreId) {
    if (!storeId) return;
    const response = await fetch(`/api/analytics/expense-receipts?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as ExpenseReceiptsPayload;
    setExpenseReceipts(body.receipts);
    setCanEditExpenseReceipts(body.canEditExpenseReceipts);
  }

  async function loadProductCandidates() {
    const response = await fetch("/api/product-candidates", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as ProductCandidatesPayload;
    setProductCandidates(body.candidates);
    setProductOptions(body.products);
    setCandidateEdits(Object.fromEntries(body.candidates.map((candidate) => [candidate.id, {
      suggestedName: candidate.suggestedName,
      category: candidate.category,
      subcategory: candidate.subcategory,
      unit: candidate.unit,
      referencePrice: candidate.referencePrice
    }])));
  }

  async function uploadExpenseReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStoreId) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("receipt");
    if (!(file instanceof File) || file.size === 0) return;

    setIsUploadingReceipt(true);
    setReceiptMessage("");
    try {
      const uploadData = new FormData();
      uploadData.set("storeId", selectedStoreId);
      uploadData.set("receipt", await compressReceiptImage(file));
      const response = await fetch("/api/analytics/expense-receipts", {
        method: "POST",
        body: uploadData
      });
      const body = await response.json().catch(() => ({})) as { error?: string; ocrError?: string };
      if (!response.ok) throw new Error(body.error ?? "経費レシートを保存できませんでした。");
      form.reset();
      setReceiptMessage(body.ocrError ? `レシート写真を保存しました。OCR: ${body.ocrError}` : "レシートを読み取りました。内容を確認してください。");
      await Promise.all([loadExpenseReceipts(selectedStoreId), loadProductCandidates()]);
    } catch (error) {
      setReceiptMessage(error instanceof Error ? error.message : "経費レシートを保存できませんでした。");
    } finally {
      setIsUploadingReceipt(false);
    }
  }

  async function reviewCandidate(candidate: ProductCandidate, action: "create_product" | "link_product" | "ignore") {
    const edit = candidateEdits[candidate.id] ?? {};
    const productId = candidateProductIds[candidate.id] ?? "";
    if (action === "link_product" && !productId) {
      window.alert("紐付ける既存商品を選択してください。");
      return;
    }
    const response = await fetch("/api/product-candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: candidate.id,
        action,
        productId,
        name: edit.suggestedName ?? candidate.suggestedName,
        category: edit.category ?? candidate.category,
        subcategory: edit.subcategory ?? candidate.subcategory,
        unit: edit.unit ?? candidate.unit,
        referencePrice: edit.referencePrice ?? candidate.referencePrice
      })
    });
    if (response.ok) {
      await loadProductCandidates();
    } else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "候補を更新できませんでした。");
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
          <Camera size={18} />
          <div>
            <h3>経費レシート OCR</h3>
            <p>日常経費のレシートを撮影し、AI 読み取り後に台帳へ仮登録します。最終反映前に内容を確認してください。</p>
          </div>
        </div>
        <form className="expense-form" onSubmit={uploadExpenseReceipt}>
          <label>
            <span>レシート写真</span>
            <input name="receipt" type="file" accept="image/*" capture="environment" disabled={!canEditExpenseReceipts || isUploadingReceipt} required />
          </label>
          <button className="primary-button" type="submit" disabled={!canEditExpenseReceipts || isUploadingReceipt}>
            {isUploadingReceipt ? "読み取り中..." : "レシートを読み取る"}
          </button>
        </form>
        {receiptMessage ? <p className="empty-state-text">{receiptMessage}</p> : null}
        <div className="expense-list receipt-ledger-list">
          {expenseReceipts.map((receipt) => (
            <article className="expense-row receipt-ledger-row" key={receipt.id}>
              <div>
                <span>{receipt.status === "ocr_failed" ? "OCR未完了" : "確認待ち"}</span>
                <strong>{receipt.vendorName || "店舗名未読取"}</strong>
                <p>{receipt.purchaseDate || "日付未読取"} / {receipt.createdLabel}{receipt.tax ? ` / 税 ${formatMoney(receipt.tax)}` : ""}</p>
              </div>
              <b>{formatMoney(receipt.total)}</b>
              <a className="text-button" href={receipt.receiptPhotoUrl} target="_blank" rel="noreferrer">レシートを見る</a>
            </article>
          ))}
          {!expenseReceipts.length ? <p className="empty-state-text">経費レシートはまだありません。</p> : null}
        </div>
      </section>

      <section className="panel analytics-overview-panel">
        <div className="panel-title">
          <RefreshCw size={18} />
          <div>
            <h3>未登録商品候補</h3>
            <p>OCR 明細で商品マスタに見つからなかった品目を確認します。承認後、商品マスタと小票名辞書に反映します。</p>
          </div>
        </div>
        <div className="product-candidate-list">
          {productCandidates.map((candidate) => {
            const edit = candidateEdits[candidate.id] ?? {};
            return (
              <article className="product-candidate-row" key={candidate.id}>
                <div className="product-candidate-source">
                  <span>{candidate.supplierName || candidate.vendorName || "発注先未読取"}</span>
                  <strong>{candidate.rawName}</strong>
                  <p>{candidate.purchaseDate || candidate.createdLabel}</p>
                </div>
                <div className="product-candidate-fields">
                  <input
                    aria-label="商品名"
                    value={String(edit.suggestedName ?? candidate.suggestedName)}
                    onChange={(event) => setCandidateEdits((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], suggestedName: event.target.value } }))}
                  />
                  <input
                    aria-label="分類"
                    value={String(edit.category ?? candidate.category)}
                    onChange={(event) => setCandidateEdits((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], category: event.target.value } }))}
                  />
                  <input
                    aria-label="単位"
                    value={String(edit.unit ?? candidate.unit)}
                    onChange={(event) => setCandidateEdits((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], unit: event.target.value } }))}
                  />
                  <input
                    aria-label="参考価格"
                    type="number"
                    min="0"
                    step="1"
                    value={Number(edit.referencePrice ?? candidate.referencePrice)}
                    onChange={(event) => setCandidateEdits((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], referencePrice: Number(event.target.value) } }))}
                  />
                </div>
                <div className="product-candidate-link">
                  <select value={candidateProductIds[candidate.id] ?? ""} onChange={(event) => setCandidateProductIds((current) => ({ ...current, [candidate.id]: event.target.value }))}>
                    <option value="">既存商品を選択</option>
                    {productOptions.map((product) => (
                      <option value={product.id} key={product.id}>{product.name} / {product.category}</option>
                    ))}
                  </select>
                </div>
                <div className="product-candidate-actions">
                  <button className="secondary-button" type="button" onClick={() => void reviewCandidate(candidate, "link_product")}><Link2 size={15} />紐付け</button>
                  <button className="primary-button" type="button" onClick={() => void reviewCandidate(candidate, "create_product")}><CheckCircle size={15} />新規追加</button>
                  <button className="text-button" type="button" onClick={() => void reviewCandidate(candidate, "ignore")}><Ban size={15} />無視</button>
                </div>
              </article>
            );
          })}
          {!productCandidates.length ? <p className="empty-state-text">未登録商品候補はありません。</p> : null}
        </div>
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

async function compressReceiptImage(file: File) {
  if (file.size <= receiptCompressionTargetBytes && file.type === "image/jpeg") return file;
  const image = await loadImage(file);
  for (const maxEdge of receiptCompressionEdges) {
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.drawImage(image, 0, 0, width, height);
    for (const quality of receiptCompressionQualities) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= receiptCompressionTargetBytes) {
        return new File([blob], buildReceiptFileName(file), { type: "image/jpeg" });
      }
    }
  }
  return file;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("レシート写真を読み込めませんでした。別の画像を選択してください。"));
    };
    image.src = url;
  });
}

function buildReceiptFileName(originalFile: File) {
  const baseName = originalFile.name.replace(/\.[^.]+$/, "") || "receipt";
  return `${baseName}.jpg`;
}
