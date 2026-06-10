"use client";

import { Boxes, Camera, Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AnalyticsShell } from "../components/AnalyticsShell";

type StoreOption = { id: string; name: string };
type ExpenseCategory = "fixed" | "variable" | "misc";
type ExpenseItem = {
  id: string;
  category: ExpenseCategory;
  accountTitle: string;
  name: string;
  amount: number;
  taxRate: string;
  taxMode: string;
  taxAmount: number;
  vendorName: string;
  transactionDate: string;
  transactionTime: string;
  expenseReceiptId: string;
  startMonth: string;
  endMonth: string;
  note: string;
};
type ExpenseReceipt = {
  id: string;
  receiptPhotoUrl: string;
  ocrResultId: string;
  vendorName: string;
  companyName: string;
  brandName: string;
  locationName: string;
  purchaseDate: string;
  purchaseTime: string;
  category: ExpenseCategory;
  accountTitle: string;
  subtotal: number;
  tax: number;
  total: number;
  note: string;
  status: string;
  createdLabel: string;
  downloadFileName: string;
  items: ExpenseReceiptOcrItem[];
};
type ExpenseReceiptOcrItem = {
  rawName: string;
  taxRate: string;
  taxMode: string;
  category: string;
  accountTitle: string;
  amount: number;
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
type ExpenseReceiptDraft = {
  note: string;
  vendorName: string;
  companyName: string;
  brandName: string;
  locationName: string;
  transactionDate: string;
  transactionTime: string;
  lines: ExpenseReceiptDraftLine[];
};
type ExpenseReceiptDraftLine = {
  id: string;
  accountTitle: string;
  amount: string;
  taxRate: string;
  taxMode: string;
  taxAmount: string;
  note: string;
};
type ExpenseEditDraft = {
  category: ExpenseCategory;
  accountTitle: string;
  name: string;
  amount: string;
  taxRate: string;
  taxMode: string;
  taxAmount: string;
  vendorName: string;
  transactionDate: string;
  transactionTime: string;
  startMonth: string;
  endMonth: string;
  note: string;
};
const categoryLabels: Record<ExpenseCategory, string> = {
  fixed: "固定費",
  variable: "変動費",
  misc: "雑費"
};
const accountTitleOptions = [
  "租税公課",
  "荷造運賃",
  "水道光熱費",
  "旅費交通費",
  "通信費",
  "広告宣伝費",
  "接待交際費",
  "損害保険料",
  "修繕費",
  "消耗品費",
  "減価償却費",
  "福利厚生費",
  "給料賃金",
  "外注工賃",
  "利子割引料",
  "地代家賃",
  "貸倒金",
  "支払手数料",
  "車両費",
  "リース料",
  "新聞図書費",
  "研修採用費",
  "会議費",
  "諸会費",
  "衛生管理費",
  "雑費"
];
const taxRateOptions = ["", "8%", "10%", "非課税"];
const taxModeOptions = ["内税", "外税", "不明"];

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
const expenseReceiptDraftStorageKey = "foundr1-os:expense-receipt-drafts:v1";
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

function readExpenseReceiptDrafts() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(expenseReceiptDraftStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<ExpenseReceiptDraft>>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([receiptId, draft]) => [
      receiptId,
      normalizeExpenseReceiptDraft(draft)
    ])) as Record<string, ExpenseReceiptDraft>;
  } catch {
    try {
      window.localStorage.removeItem(expenseReceiptDraftStorageKey);
    } catch {
      // Ignore storage cleanup failures.
    }
    return {};
  }
}

function writeExpenseReceiptDrafts(drafts: Record<string, ExpenseReceiptDraft>) {
  try {
    window.localStorage.setItem(expenseReceiptDraftStorageKey, JSON.stringify(drafts));
  } catch {
    // Local storage is best-effort; expense receipt editing should keep working without it.
  }
}

function normalizeExpenseReceiptDraft(draft: Partial<ExpenseReceiptDraft> | undefined): ExpenseReceiptDraft {
  return {
    note: String(draft?.note ?? ""),
    vendorName: String(draft?.vendorName ?? ""),
    companyName: String(draft?.companyName ?? ""),
    brandName: String(draft?.brandName ?? ""),
    locationName: String(draft?.locationName ?? ""),
    transactionDate: String(draft?.transactionDate ?? getCurrentDate()),
    transactionTime: String(draft?.transactionTime ?? ""),
    lines: Array.isArray(draft?.lines) && draft.lines.length
      ? draft.lines.map((line, index) => ({
        id: String(line?.id ?? `restored-${index}`),
        accountTitle: String(line?.accountTitle ?? "雑費"),
        amount: String(line?.amount ?? ""),
        taxRate: taxRateOptions.includes(String(line?.taxRate ?? "")) ? String(line?.taxRate ?? "") : "",
        taxMode: taxModeOptions.includes(String(line?.taxMode ?? "")) ? String(line?.taxMode ?? "") : "内税",
        taxAmount: String(line?.taxAmount ?? ""),
        note: String(line?.note ?? "")
      }))
      : [buildNewReceiptLine(0)]
  };
}

function filterExpenseReceiptDrafts(drafts: Record<string, ExpenseReceiptDraft>, validReceiptIds: Set<string>) {
  return Object.fromEntries(Object.entries(drafts).filter(([receiptId]) => validReceiptIds.has(receiptId))) as Record<string, ExpenseReceiptDraft>;
}

function getCurrentDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function buildReceiptDraft(receipt?: ExpenseReceipt): ExpenseReceiptDraft {
  return {
    note: receipt?.note || "",
    vendorName: receipt?.vendorName || "",
    companyName: receipt?.companyName || "",
    brandName: receipt?.brandName || "",
    locationName: receipt?.locationName || "",
    transactionDate: receipt?.purchaseDate || getCurrentDate(),
    transactionTime: receipt?.purchaseTime || "",
    lines: buildReceiptDraftLines(receipt)
  };
}

function buildReceiptDraftLines(receipt?: ExpenseReceipt): ExpenseReceiptDraftLine[] {
  const grouped = new Map<string, {
    accountTitle: string;
    taxRate: string;
    taxMode: string;
    amount: number;
    itemNames: string[];
  }>();
  for (const item of receipt?.items ?? []) {
    const amount = Math.round(Number(item.amount ?? 0));
    if (!amount) continue;
    const accountTitle = item.accountTitle || getDefaultAccountTitle(item.category);
    const taxRate = normalizeDraftTaxRate(item.taxRate);
    const taxMode = normalizeDraftTaxMode(item.taxMode);
    const key = `${accountTitle}:${taxRate}:${taxMode}`;
    const current = grouped.get(key) ?? { accountTitle, taxRate, taxMode, amount: 0, itemNames: [] };
    current.amount += amount;
    if (item.rawName) current.itemNames.push(item.rawName);
    grouped.set(key, current);
  }

  const lines = Array.from(grouped.values()).map((line, index) => {
    const amount = Math.round(line.amount);
    return {
      id: `ocr-${index}`,
      accountTitle: line.accountTitle,
      amount: String(amount || ""),
      taxRate: line.taxRate,
      taxMode: line.taxMode,
      taxAmount: String(calculateDraftTaxAmount(amount, line.taxRate, line.taxMode)),
      note: line.itemNames.slice(0, 4).join("、")
    };
  });
  if (lines.length) return lines;

  const amount = Math.round(receipt?.total ?? 0);
  const taxAmount = Math.round(receipt?.tax ?? 0);
  return [{
    id: "manual-0",
    accountTitle: receipt?.accountTitle || "雑費",
    amount: String(amount || ""),
    taxRate: "",
    taxMode: "不明",
    taxAmount: String(taxAmount),
    note: receipt?.note || ""
  }];
}

function getDefaultAccountTitle(category: string) {
  if (category === "清掃用品" || category === "消耗品" || category === "包材") return "消耗品費";
  if (category === "設備") return "修繕費";
  return "雑費";
}

function normalizeDraftTaxRate(value: string) {
  const text = String(value ?? "").replace("%", "").trim();
  if (text === "8" || text === "8.0") return "8%";
  if (text === "10" || text === "10.0") return "10%";
  if (text === "非課税" || text === "0") return "非課税";
  return "";
}

function normalizeDraftTaxMode(value: string) {
  return value === "内税" || value === "外税" ? value : "不明";
}

function calculateDraftTaxAmount(amount: number, taxRate: string, taxMode: string) {
  const rate = taxRate === "8%" ? 8 : taxRate === "10%" ? 10 : 0;
  if (!rate || amount <= 0) return 0;
  if (taxMode === "外税") return Math.round(amount * rate / 100);
  return Math.round(amount * rate / (100 + rate));
}

function buildNewReceiptLine(index: number): ExpenseReceiptDraftLine {
  return {
    id: `manual-${Date.now()}-${index}`,
    accountTitle: "雑費",
    amount: "",
    taxRate: "",
    taxMode: "不明",
    taxAmount: "0",
    note: ""
  };
}

function buildExpenseEditDraft(item: ExpenseItem): ExpenseEditDraft {
  return {
    category: item.category,
    accountTitle: item.accountTitle || "",
    name: item.name,
    amount: String(Math.round(item.amount) || ""),
    taxRate: item.taxRate || "",
    taxMode: item.taxMode || "不明",
    taxAmount: String(Math.round(item.taxAmount) || 0),
    vendorName: item.vendorName || "",
    transactionDate: item.transactionDate || "",
    transactionTime: item.transactionTime || "",
    startMonth: item.startMonth,
    endMonth: item.endMonth,
    note: item.note
  };
}

function appendReceiptDownloadParams(receiptPhotoUrl: string, filename: string, download: boolean) {
  try {
    const url = new URL(receiptPhotoUrl, "https://foundr1.local");
    if (filename) url.searchParams.set("filename", filename);
    if (download) url.searchParams.set("download", "1");
    return `${url.pathname}${url.search}`;
  } catch {
    return receiptPhotoUrl;
  }
}

function getReceiptDisplayName(receipt: Pick<ExpenseReceipt, "vendorName" | "companyName" | "brandName" | "locationName">) {
  const primary = receipt.brandName
    ? [receipt.brandName, receipt.locationName]
    : [receipt.companyName, receipt.locationName];
  return primary.map((value) => value.trim()).filter(Boolean).join(" ") || receipt.vendorName || "店舗名未読取";
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
  const [hasLoadedExpenseReceipts, setHasLoadedExpenseReceipts] = useState(false);
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ExpenseReceiptDraft>>(() => readExpenseReceiptDrafts());
  const [editingExpenseId, setEditingExpenseId] = useState("");
  const [expenseEditDraft, setExpenseEditDraft] = useState<ExpenseEditDraft | null>(null);
  const [canEditExpenseReceipts, setCanEditExpenseReceipts] = useState(false);

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
    if (!hasLoadedExpenseReceipts) return;
    const validReceiptIds = new Set(expenseReceipts.map((receipt) => receipt.id));
    setReceiptDrafts((current) => filterExpenseReceiptDrafts(current, validReceiptIds));
  }, [expenseReceipts, hasLoadedExpenseReceipts]);

  useEffect(() => {
    writeExpenseReceiptDrafts(receiptDrafts);
  }, [receiptDrafts]);

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
        accountTitle: formData.get("accountTitle"),
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

  function startEditExpense(item: ExpenseItem) {
    setEditingExpenseId(item.id);
    setExpenseEditDraft(buildExpenseEditDraft(item));
  }

  function updateExpenseEditDraft(patch: Partial<ExpenseEditDraft>) {
    setExpenseEditDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if ("amount" in patch || "taxRate" in patch || "taxMode" in patch) {
        next.taxAmount = String(calculateDraftTaxAmount(Number(next.amount), next.taxRate, next.taxMode));
      }
      return next;
    });
  }

  async function saveExpenseEdit(id: string) {
    if (!expenseEditDraft) return;
    const response = await fetch("/api/analytics/expenses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...expenseEditDraft })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) {
      setMessage("経費を更新しました。");
      setEditingExpenseId("");
      setExpenseEditDraft(null);
      await loadExpenses(month, selectedStoreId);
    } else {
      setMessage(body.error ?? "経費を更新できませんでした。");
    }
  }

  async function loadExpenseReceipts(storeId = selectedStoreId) {
    if (!storeId) return;
    setHasLoadedExpenseReceipts(false);
    const response = await fetch(`/api/analytics/expense-receipts?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as ExpenseReceiptsPayload;
    setExpenseReceipts(body.receipts);
    setHasLoadedExpenseReceipts(true);
    setReceiptDrafts((current) => {
      const next = { ...current };
      for (const receipt of body.receipts) {
        if (!next[receipt.id]) next[receipt.id] = buildReceiptDraft(receipt);
      }
      return next;
    });
    setCanEditExpenseReceipts(body.canEditExpenseReceipts);
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
      uploadData.set("receipt", await prepareReceiptUploadFile(file));
      const response = await fetch("/api/analytics/expense-receipts", {
        method: "POST",
        body: uploadData
      });
      const body = await response.json().catch(() => ({})) as { error?: string; ocrError?: string };
      if (!response.ok) throw new Error(body.error ?? "経費レシートを保存できませんでした。");
      form.reset();
      setReceiptMessage(body.ocrError ? `レシート写真を保存しました。OCR: ${body.ocrError}` : "レシートを読み取りました。内容を確認してください。");
      await loadExpenseReceipts(selectedStoreId);
    } catch (error) {
      setReceiptMessage(error instanceof Error ? error.message : "経費レシートを保存できませんでした。");
    } finally {
      setIsUploadingReceipt(false);
    }
  }

  async function deleteExpenseReceipt(id: string) {
    if (!window.confirm("この経費レシートを削除しますか？ テスト登録の場合のみ削除してください。")) return;
    const response = await fetch(`/api/analytics/expense-receipts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) {
      setReceiptMessage("経費レシートを削除しました。");
      clearExpenseReceiptDraft(id);
      await loadExpenseReceipts(selectedStoreId);
    } else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setReceiptMessage(body.error ?? "経費レシートを削除できませんでした。");
    }
  }

  function updateReceiptDraft(id: string, patch: Partial<ExpenseReceiptDraft>) {
    setReceiptDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? buildReceiptDraft(expenseReceipts.find((receipt) => receipt.id === id))),
        ...patch
      }
    }));
  }

  function updateReceiptDraftLine(receiptId: string, lineId: string, patch: Partial<ExpenseReceiptDraftLine>) {
    setReceiptDrafts((current) => {
      const draft = current[receiptId] ?? buildReceiptDraft(expenseReceipts.find((receipt) => receipt.id === receiptId));
      return {
        ...current,
        [receiptId]: {
          ...draft,
          lines: draft.lines.map((line) => {
            if (line.id !== lineId) return line;
            const nextLine = { ...line, ...patch };
            if ("amount" in patch || "taxRate" in patch || "taxMode" in patch) {
              nextLine.taxAmount = String(calculateDraftTaxAmount(Number(nextLine.amount), nextLine.taxRate, nextLine.taxMode));
            }
            return nextLine;
          })
        }
      };
    });
  }

  function addReceiptDraftLine(receiptId: string) {
    setReceiptDrafts((current) => {
      const draft = current[receiptId] ?? buildReceiptDraft(expenseReceipts.find((receipt) => receipt.id === receiptId));
      return {
        ...current,
        [receiptId]: {
          ...draft,
          lines: [...draft.lines, buildNewReceiptLine(draft.lines.length)]
        }
      };
    });
  }

  function removeReceiptDraftLine(receiptId: string, lineId: string) {
    setReceiptDrafts((current) => {
      const draft = current[receiptId] ?? buildReceiptDraft(expenseReceipts.find((receipt) => receipt.id === receiptId));
      return {
        ...current,
        [receiptId]: {
          ...draft,
          lines: draft.lines.length > 1 ? draft.lines.filter((line) => line.id !== lineId) : draft.lines
        }
      };
    });
  }

  async function confirmExpenseReceipt(receipt: ExpenseReceipt) {
    const draft = receiptDrafts[receipt.id] ?? buildReceiptDraft(receipt);
    const vendorName = draft.brandName
      ? [draft.brandName, draft.locationName].map((value) => value.trim()).filter(Boolean).join(" ")
      : [draft.companyName, draft.locationName].map((value) => value.trim()).filter(Boolean).join(" ");
    const response = await fetch("/api/analytics/expense-receipts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: receipt.id,
        lines: draft.lines.map((line) => ({
          accountTitle: line.accountTitle,
          amount: line.amount,
          taxRate: line.taxRate,
          taxMode: line.taxMode,
          taxAmount: line.taxAmount,
          note: line.note
        })),
        vendorName: vendorName || draft.vendorName,
        companyName: draft.companyName,
        brandName: draft.brandName,
        locationName: draft.locationName,
        transactionDate: draft.transactionDate,
        transactionTime: draft.transactionTime,
        note: draft.note
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) {
      setReceiptMessage("経費に登録しました。");
      clearExpenseReceiptDraft(receipt.id);
      await Promise.all([loadExpenseReceipts(selectedStoreId), loadExpenses(month, selectedStoreId)]);
    } else {
      setReceiptMessage(body.error ?? "経費に登録できませんでした。");
    }
  }

  function clearExpenseReceiptDraft(receiptId: string) {
    setReceiptDrafts((current) => {
      const next = { ...current };
      delete next[receiptId];
      return next;
    });
  }

  const stores = data?.stores ?? [];
  const canEdit = Boolean(data?.canEditExpenses && selectedStoreId);
  const selectedStoreName = stores.find((store) => store.id === selectedStoreId)?.name ?? "店舗";
  const expenses = data?.expenses ?? [];
  const activeExpenses = expenses.filter((item) => isActiveInMonth(item, month));
  const accountTotals = activeExpenses.reduce((totals, item) => {
    const title = item.accountTitle || item.name || "雑費";
    totals.set(title, (totals.get(title) ?? 0) + item.amount);
    return totals;
  }, new Map<string, number>());
  const visibleAccountTotals = Array.from(accountTotals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, 4);
  const accountMetricCards: Array<[string, number]> = visibleAccountTotals.length
    ? visibleAccountTotals
    : [["経費合計", data?.monthlyTotals.total ?? 0]];

  return (
    <AnalyticsShell eyebrow="Expense Settings" title="経費設定" sourceLabel={isLoading ? "読み込み中" : `${selectedStoreName} / ${month}`}>
      <section className="panel analytics-overview-panel">
        <div className="panel-title">
          <Boxes size={18} />
          <div>
            <h3>月次経費を管理</h3>
            <p>勘定科目別に経費を管理します。開始月から終了月まで、選択月の月次損益に反映します。</p>
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
        {accountMetricCards.map(([title, total]) => (
          <article className="metric-card" key={title}>
            <span>{title}</span>
            <strong>{formatMoney(total)}</strong>
            <p>選択月の勘定科目別集計</p>
          </article>
        ))}
        <article className="metric-card">
          <span>当月経費</span>
          <strong>{formatMoney(data?.monthlyTotals.total ?? 0)}</strong>
          <p>選択月に有効な経費 {activeExpenses.length}件 / {accountTotals.size}科目</p>
        </article>
      </section>

      <section className="panel analytics-overview-panel">
        <div className="panel-title">
          <Plus size={18} />
          <div>
            <h3>経費を追加</h3>
            <p>勘定科目を選んで登録します。固定費/変動費などの分析分類は科目から自動判定します。</p>
          </div>
        </div>
        <form className="expense-form" key={`${selectedStoreId}-${month}`} onSubmit={createExpense}>
          <label>
            <span>勘定科目</span>
            <select name="accountTitle" defaultValue="雑費" disabled={!canEdit}>
              {accountTitleOptions.map((option) => (
                <option value={option} key={option}>{option}</option>
              ))}
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
            <p>日常経費のレシートを撮影し、OCR結果を確認してから勘定科目別に経費台帳へ登録します。</p>
          </div>
        </div>
        <form className="expense-form" onSubmit={uploadExpenseReceipt}>
          <label>
            <span>レシート写真 / PDF</span>
            <input name="receipt" type="file" accept="image/*,application/pdf,.pdf" disabled={!canEditExpenseReceipts || isUploadingReceipt} required />
          </label>
          <button className="primary-button" type="submit" disabled={!canEditExpenseReceipts || isUploadingReceipt}>
            {isUploadingReceipt ? "読み取り中..." : "レシートを読み取る"}
          </button>
        </form>
        {receiptMessage ? <p className="empty-state-text">{receiptMessage}</p> : null}
        <div className="expense-list receipt-ledger-list">
          {expenseReceipts.map((receipt) => {
            const draft = receiptDrafts[receipt.id] ?? buildReceiptDraft(receipt);
            const canConfirm = canEditExpenseReceipts && receipt.status !== "confirmed" && receipt.status !== "ocr_failed";
            return (
              <article className="expense-row receipt-ledger-row" key={receipt.id}>
                <div className="receipt-ledger-summary">
                  <span>{receipt.status === "confirmed" ? "登録済み" : receipt.status === "ocr_failed" ? "OCR未完了" : "確認待ち"}</span>
                  <strong>{getReceiptDisplayName(receipt)}</strong>
                  <p>{receipt.purchaseDate || "日付未読取"} {receipt.purchaseTime || ""} / {receipt.createdLabel}{receipt.tax ? ` / OCR税 ${formatMoney(receipt.tax)}` : ""}</p>
                </div>
                <b>{formatMoney(receipt.total)}</b>
                <a className="text-button" href={appendReceiptDownloadParams(receipt.receiptPhotoUrl, receipt.downloadFileName, false)} target="_blank" rel="noreferrer">レシートを見る</a>
                <a className="text-button" href={appendReceiptDownloadParams(receipt.receiptPhotoUrl, receipt.downloadFileName, true)} download={receipt.downloadFileName}>ダウンロード</a>
                {canEditExpenseReceipts ? (
                  <button className="text-button danger-button" type="button" onClick={() => void deleteExpenseReceipt(receipt.id)}>
                    削除
                  </button>
                ) : null}
                {canConfirm ? (
                  <div className="receipt-confirm-form">
                    <label>
                      <span>会社名</span>
                      <input value={draft.companyName} onChange={(event) => updateReceiptDraft(receipt.id, { companyName: event.target.value })} placeholder="例: 株式会社G-7スーパーマート" />
                    </label>
                    <label>
                      <span>ブランド名</span>
                      <input value={draft.brandName} onChange={(event) => updateReceiptDraft(receipt.id, { brandName: event.target.value })} placeholder="例: 業務スーパー" />
                    </label>
                    <label>
                      <span>店舗名</span>
                      <input value={draft.locationName} onChange={(event) => updateReceiptDraft(receipt.id, { locationName: event.target.value })} placeholder="例: 春吉店" />
                    </label>
                    <label>
                      <span>日付</span>
                      <input type="date" value={draft.transactionDate} onChange={(event) => updateReceiptDraft(receipt.id, { transactionDate: event.target.value })} />
                    </label>
                    <label>
                      <span>時刻</span>
                      <input type="time" value={draft.transactionTime} onChange={(event) => updateReceiptDraft(receipt.id, { transactionTime: event.target.value })} />
                    </label>
                    <label className="receipt-note-field">
                      <span>備考</span>
                      <input value={draft.note} onChange={(event) => updateReceiptDraft(receipt.id, { note: event.target.value })} placeholder="例: 打合せ用、車両燃料、店舗用品" />
                    </label>
                    <div className="receipt-line-editor">
                      <div className="receipt-line-editor-title">
                        <span>AI 推奨の経費明細</span>
                        <button className="secondary-button" type="button" onClick={() => addReceiptDraftLine(receipt.id)}>明細を追加</button>
                      </div>
                      {draft.lines.map((line, index) => (
                        <div className="receipt-expense-line" key={line.id}>
                          <label>
                            <span>勘定科目</span>
                            <select value={line.accountTitle} onChange={(event) => updateReceiptDraftLine(receipt.id, line.id, { accountTitle: event.target.value })}>
                              {accountTitleOptions.map((option) => (
                                <option value={option} key={option}>{option}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>金額（税込）</span>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={line.amount}
                              onChange={(event) => updateReceiptDraftLine(receipt.id, line.id, { amount: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>税率</span>
                            <select value={line.taxRate} onChange={(event) => updateReceiptDraftLine(receipt.id, line.id, { taxRate: event.target.value })}>
                              {taxRateOptions.map((option) => (
                                <option value={option} key={option}>{option || "不明"}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>税区分</span>
                            <select value={line.taxMode} onChange={(event) => updateReceiptDraftLine(receipt.id, line.id, { taxMode: event.target.value })}>
                              {taxModeOptions.map((option) => (
                                <option value={option} key={option}>{option}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>消費税</span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={line.taxAmount}
                              onChange={(event) => updateReceiptDraftLine(receipt.id, line.id, { taxAmount: event.target.value })}
                            />
                          </label>
                          <label className="receipt-line-note">
                            <span>明細メモ</span>
                            <input value={line.note} onChange={(event) => updateReceiptDraftLine(receipt.id, line.id, { note: event.target.value })} placeholder={`明細 ${index + 1}`} />
                          </label>
                          <button className="text-button danger-button" type="button" onClick={() => removeReceiptDraftLine(receipt.id, line.id)} disabled={draft.lines.length <= 1}>
                            削除
                          </button>
                        </div>
                      ))}
                    </div>
                    <button className="primary-button" type="button" onClick={() => void confirmExpenseReceipt(receipt)}>
                      この内容で経費登録
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
          {!expenseReceipts.length ? <p className="empty-state-text">経費レシートはまだありません。</p> : null}
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
                  <span>{item.accountTitle || categoryLabels[item.category]}</span>
                  <strong>{item.name}</strong>
                  <p>
                    {item.transactionDate || item.startMonth}{item.transactionTime ? ` ${item.transactionTime}` : ""} / {item.startMonth} - {item.endMonth || "継続"}
                    {item.taxRate ? ` / ${item.taxRate}` : ""}{item.taxMode ? ` ${item.taxMode}` : ""}{item.taxAmount ? ` / 税 ${formatMoney(item.taxAmount)}` : ""}
                    {item.note ? ` / ${item.note}` : ""}
                  </p>
                </div>
                <b>{formatMoney(item.amount)}</b>
                {canEdit ? (
                  <>
                    <button className="icon-button" type="button" aria-label="編集" onClick={() => startEditExpense(item)}>
                      <Pencil size={16} />
                    </button>
                    <button className="icon-button" type="button" aria-label="削除" onClick={() => void deleteExpense(item.id)}>
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : null}
                {editingExpenseId === item.id && expenseEditDraft ? (
                  <div className="expense-edit-form">
                    <label>
                      <span>勘定科目</span>
                      <select value={expenseEditDraft.accountTitle} onChange={(event) => updateExpenseEditDraft({ accountTitle: event.target.value })}>
                        <option value="">未設定</option>
                        {accountTitleOptions.map((option) => (
                          <option value={option} key={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>経費名</span>
                      <input value={expenseEditDraft.name} onChange={(event) => updateExpenseEditDraft({ name: event.target.value })} />
                    </label>
                    <label>
                      <span>金額（税込）</span>
                      <input type="number" min="1" step="1" value={expenseEditDraft.amount} onChange={(event) => updateExpenseEditDraft({ amount: event.target.value })} />
                    </label>
                    <label>
                      <span>税率</span>
                      <select value={expenseEditDraft.taxRate} onChange={(event) => updateExpenseEditDraft({ taxRate: event.target.value })}>
                        {taxRateOptions.map((option) => (
                          <option value={option} key={option}>{option || "不明"}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>税区分</span>
                      <select value={expenseEditDraft.taxMode} onChange={(event) => updateExpenseEditDraft({ taxMode: event.target.value })}>
                        {taxModeOptions.map((option) => (
                          <option value={option} key={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>消費税</span>
                      <input type="number" min="0" step="1" value={expenseEditDraft.taxAmount} onChange={(event) => updateExpenseEditDraft({ taxAmount: event.target.value })} />
                    </label>
                    <label>
                      <span>支払先</span>
                      <input value={expenseEditDraft.vendorName} onChange={(event) => updateExpenseEditDraft({ vendorName: event.target.value })} />
                    </label>
                    <label>
                      <span>日付</span>
                      <input type="date" value={expenseEditDraft.transactionDate} onChange={(event) => updateExpenseEditDraft({ transactionDate: event.target.value })} />
                    </label>
                    <label>
                      <span>時刻</span>
                      <input type="time" value={expenseEditDraft.transactionTime} onChange={(event) => updateExpenseEditDraft({ transactionTime: event.target.value })} />
                    </label>
                    <label>
                      <span>開始月</span>
                      <input type="month" value={expenseEditDraft.startMonth} onChange={(event) => updateExpenseEditDraft({ startMonth: event.target.value })} />
                    </label>
                    <label>
                      <span>終了月</span>
                      <input type="month" value={expenseEditDraft.endMonth} onChange={(event) => updateExpenseEditDraft({ endMonth: event.target.value })} />
                    </label>
                    <label className="receipt-note-field">
                      <span>メモ</span>
                      <input value={expenseEditDraft.note} onChange={(event) => updateExpenseEditDraft({ note: event.target.value })} />
                    </label>
                    <div className="expense-edit-actions">
                      <button className="primary-button" type="button" onClick={() => void saveExpenseEdit(item.id)}>保存</button>
                      <button className="secondary-button" type="button" onClick={() => { setEditingExpenseId(""); setExpenseEditDraft(null); }}>キャンセル</button>
                    </div>
                  </div>
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

async function prepareReceiptUploadFile(file: File) {
  if (isPdfReceiptFile(file)) return file;
  return compressReceiptImage(file);
}

function isPdfReceiptFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
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
