"use client";

import {
  ChevronDown,
  ClipboardList,
  FileText,
  LogOut,
  PackageCheck,
  Plus,
  ReceiptText,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type StoreOption = {
  id: string;
  name: string;
};

type VoucherUsageType = "unclassified" | "shiire" | "keihi";
type VoucherPaymentType = "company" | "reimbursement";
type VoucherReimbursementStatus = "none" | "pending" | "paid" | "rejected";

type VoucherRecord = {
  id: string;
  sourceType: string;
  storeId: string;
  storeName: string;
  receiptPhotoUrl: string;
  uploadedFileName: string;
  usageType: VoucherUsageType;
  paymentType: VoucherPaymentType;
  reimbursementStatus: VoucherReimbursementStatus;
  status: string;
  vendorName: string;
  companyName: string;
  brandName: string;
  locationName: string;
  purchaseDate: string;
  purchaseTime: string;
  total: number;
  tax: number;
  accountingLines: VoucherAccountingSummaryLine[];
  itemCount: number;
  createdByName: string;
  createdLabel: string;
  canDelete: boolean;
  items: VoucherOcrItem[];
};

type VoucherOcrItem = {
  id: string;
  rawName: string;
  taxRate: string;
  taxMode: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  category: string;
  accountTitle: string;
  amount: number;
};

type VoucherAccountingDraft = {
  note: string;
  vendorName: string;
  companyName: string;
  brandName: string;
  locationName: string;
  transactionDate: string;
  transactionTime: string;
  taxMode: string;
  lines: VoucherAccountingLine[];
};

type VoucherAccountingLine = {
  id: string;
  accountTitle: string;
  subAccountTitle: string;
  amount: string;
  taxRate: string;
  taxMode: string;
  taxAmount: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  note: string;
};

type VoucherAccountingSummaryLine = {
  accountTitle: string;
  subAccountTitle: string;
  amount: number;
  taxRate: string;
  taxMode: string;
  taxAmount: number;
  note: string;
};

type VoucherAccountingValidation = {
  ok: boolean;
  taxIncomplete: boolean;
  receiptTotal: number;
  lineAmountTotal: number;
  taxTotal: number;
  expectedTotal: number;
  difference: number;
};

type VoucherUploadProgress = {
  total: number;
  completed: number;
  failed: number;
  currentFile: string;
  phase: string;
};

type VoucherPendingAction = "update" | "confirm" | "delete";

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "証憑管理", href: "/os/vouchers", icon: ReceiptText },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const usageLabels: Record<VoucherUsageType, string> = {
  unclassified: "未分類",
  shiire: "仕入",
  keihi: "経費"
};

const paymentLabels: Record<VoucherPaymentType, string> = {
  company: "会社支払",
  reimbursement: "立替"
};

const reimbursementLabels: Record<VoucherReimbursementStatus, string> = {
  none: "-",
  pending: "精算待ち",
  paid: "精算済み",
  rejected: "却下"
};

const expenseAccountTitleOptions = [
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

export default function VouchersPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [usageType, setUsageType] = useState<VoucherUsageType>("unclassified");
  const [paymentType, setPaymentType] = useState<VoucherPaymentType>("company");
  const [vouchers, setVouchers] = useState<VoucherRecord[]>([]);
  const [canUpload, setCanUpload] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [accountingDrafts, setAccountingDrafts] = useState<Record<string, VoucherAccountingDraft>>({});
  const [expandedVoucherIds, setExpandedVoucherIds] = useState<Record<string, boolean>>({});
  const [uploadProgress, setUploadProgress] = useState<VoucherUploadProgress | null>(null);
  const [previewVoucher, setPreviewVoucher] = useState<VoucherRecord | null>(null);
  const [pendingActions, setPendingActions] = useState<Record<string, VoucherPendingAction>>({});

  useEffect(() => {
    void loadVouchers();
  }, []);

  const sortedVouchers = useMemo(() => vouchers, [vouchers]);

  async function loadVouchers() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/vouchers", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        canUpload?: boolean;
        stores?: StoreOption[];
        vouchers?: VoucherRecord[];
      };
      if (!response.ok) {
        setMessage(body.error ?? "証憑を読み込めませんでした。");
        return;
      }
      const nextStores = body.stores ?? [];
      setStores(nextStores);
      setCanUpload(Boolean(body.canUpload));
      setVouchers(body.vouchers ?? []);
      setSelectedStoreId((current) => current || nextStores[0]?.id || "");
    } catch {
      setMessage("証憑一覧を再読み込みできませんでした。時間をおいて更新してください。");
    } finally {
      setIsLoading(false);
    }
  }

  async function uploadVouchers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    let files = new FormData(form)
      .getAll("receipts")
      .filter((file): file is File => file instanceof File && file.size > 0);
    if (!selectedStoreId) {
      setMessage("店舗を選択してください。");
      return;
    }
    if (!files.length) {
      setMessage("写真またはPDFを選択してください。");
      return;
    }
    const pdfFiles = files.filter((file) => isPdfUploadFile(file));
    if (pdfFiles.length > 1 || (pdfFiles.length === 1 && files.length > 1)) {
      setMessage("PDFは単体でアップロードしてください。写真は複数枚を順番に処理します。");
      return;
    }

    setIsUploading(true);
    try {
      if (pdfFiles.length === 1) {
        setMessage("PDFをページごとに分割しています。");
        setUploadProgress({ total: 1, completed: 0, failed: 0, currentFile: pdfFiles[0].name || "PDF", phase: "PDF分割中" });
        files = await splitPdfIntoPageFiles(pdfFiles[0]);
      }

      setMessage("証憑を順番に処理しています。");
      setUploadProgress({ total: files.length, completed: 0, failed: 0, currentFile: files[0]?.name || "", phase: "準備中" });

      let failedCount = 0;
      let savedCount = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const fileName = file.name || `file-${index + 1}`;
        setUploadProgress({ total: files.length, completed: index, failed: failedCount, currentFile: fileName, phase: "アップロード・OCR中" });

        const formData = new FormData();
        formData.set("storeId", selectedStoreId);
        formData.set("usageType", usageType);
        formData.set("paymentType", paymentType);
        formData.append("receipts", file);

        const result = await uploadVoucherFileWithRetry(formData);
        if (!result.ok || result.ocrError) {
          failedCount += 1;
        } else {
          savedCount += 1;
        }
        setUploadProgress({ total: files.length, completed: index + 1, failed: failedCount, currentFile: fileName, phase: "完了" });
        if (index < files.length - 1) await sleep(800);
      }

      const finalMessage = failedCount
        ? `保存処理が完了しました。一部OCR結果を確認してください（成功 ${savedCount}件 / 失敗 ${failedCount}件）。`
        : "証憑を読み取りました。内容を確認してください。";
      setMessage(finalMessage);
      form.reset();
      try {
        await loadVouchers();
        setMessage(finalMessage);
      } catch {
        setMessage(`${finalMessage} 証憑一覧は時間をおいて更新してください。`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "証憑をアップロードできませんでした。");
    } finally {
      setIsUploading(false);
    }
  }

  async function updateVoucher(voucher: VoucherRecord, next: Partial<VoucherRecord>) {
    if (pendingActions[voucher.id]) return;
    setPendingAction(voucher.id, "update");
    const nextVoucher = { ...voucher, ...next };
    setVouchers((current) => current.map((item) => item.id === voucher.id ? nextVoucher : item));
    try {
      if (next.usageType && next.usageType !== voucher.usageType && voucher.sourceType === "voucher" && voucher.status !== "confirmed") {
        setAccountingDrafts((current) => ({ ...current, [voucher.id]: buildVoucherAccountingDraft(nextVoucher) }));
      }
      const response = await fetch("/api/vouchers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: voucher.id,
          usageType: nextVoucher.usageType,
          paymentType: nextVoucher.paymentType,
          reimbursementStatus: nextVoucher.reimbursementStatus
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "証憑を更新できませんでした。");
        await loadVouchers();
        return;
      }
      setMessage(next.usageType
        ? "用途を更新しました。内容を確認してから登録してください。"
        : "証憑を更新しました。");
    } catch {
      setMessage("証憑を更新できませんでした。通信状態を確認してください。");
      await loadVouchers();
    } finally {
      clearPendingAction(voucher.id);
    }
  }

  function updateAccountingDraft(voucherId: string, next: Partial<VoucherAccountingDraft>) {
    setAccountingDrafts((current) => {
      const voucher = vouchers.find((item) => item.id === voucherId);
      const draft = current[voucherId] ?? buildVoucherAccountingDraft(voucher);
      const nextDraft = { ...draft, ...next };
      if ("taxMode" in next) {
        nextDraft.lines = draft.lines.map((line) => {
          const amount = Math.round(Number(line.amount || 0));
          return {
            ...line,
            taxMode: nextDraft.taxMode,
            taxAmount: String(calculateDraftTaxAmount(amount, line.taxRate, nextDraft.taxMode))
          };
        });
      }
      return { ...current, [voucherId]: nextDraft };
    });
  }

  function updateAccountingLine(voucherId: string, lineId: string, next: Partial<VoucherAccountingLine>) {
    setAccountingDrafts((current) => {
      const voucher = vouchers.find((item) => item.id === voucherId);
      const draft = current[voucherId] ?? buildVoucherAccountingDraft(voucher);
      return {
        ...current,
        [voucherId]: {
          ...draft,
          lines: draft.lines.map((line) => {
            if (line.id !== lineId) return line;
            const updated = { ...line, ...next };
            updated.taxMode = draft.taxMode;
            if (!("taxAmount" in next) && ("amount" in next || "taxRate" in next)) {
              const amount = Math.round(Number(updated.amount || 0));
              updated.taxAmount = String(calculateDraftTaxAmount(amount, updated.taxRate, draft.taxMode));
            }
            return updated;
          })
        }
      };
    });
  }

  function addAccountingLine(voucherId: string) {
    setAccountingDrafts((current) => {
      const voucher = vouchers.find((item) => item.id === voucherId);
      const draft = current[voucherId] ?? buildVoucherAccountingDraft(voucher);
      return {
        ...current,
        [voucherId]: {
          ...draft,
          lines: [...draft.lines, buildNewAccountingLine(draft.lines.length, draft.taxMode)]
        }
      };
    });
  }

  function removeAccountingLine(voucherId: string, lineId: string) {
    setAccountingDrafts((current) => {
      const voucher = vouchers.find((item) => item.id === voucherId);
      const draft = current[voucherId] ?? buildVoucherAccountingDraft(voucher);
      return {
        ...current,
        [voucherId]: {
          ...draft,
          lines: draft.lines.length > 1 ? draft.lines.filter((line) => line.id !== lineId) : draft.lines
        }
      };
    });
  }

  function toggleVoucherExpanded(voucherId: string) {
    setExpandedVoucherIds((current) => ({ ...current, [voucherId]: !current[voucherId] }));
  }

  async function confirmVoucherAccounting(voucher: VoucherRecord) {
    if (pendingActions[voucher.id]) return;
    setPendingAction(voucher.id, "confirm");
    const draft = accountingDrafts[voucher.id] ?? buildVoucherAccountingDraft(voucher);
    const vendorName = draft.brandName
      ? [draft.brandName, draft.locationName].map((value) => value.trim()).filter(Boolean).join(" ")
      : [draft.companyName, draft.locationName].map((value) => value.trim()).filter(Boolean).join(" ");
    try {
      const response = await fetch("/api/vouchers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm_accounting",
          id: voucher.id,
          usageType: voucher.usageType,
          paymentType: voucher.paymentType,
          reimbursementStatus: voucher.reimbursementStatus,
          lines: draft.lines.map((line) => ({
            accountTitle: voucher.usageType === "shiire" ? "仕入高" : line.accountTitle,
            subAccountTitle: line.subAccountTitle,
            amount: line.amount,
            taxRate: line.taxRate,
            taxMode: draft.taxMode,
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
      if (!response.ok) {
        setMessage(body.error ?? "証憑を登録できませんでした。");
        return;
      }
      setMessage(voucher.usageType === "keihi" ? "経費として登録しました。" : "仕入として確認しました。商品候補にも反映されます。");
      await loadVouchers();
    } catch {
      setMessage("証憑を登録できませんでした。通信状態を確認してください。");
    } finally {
      clearPendingAction(voucher.id);
    }
  }

  async function deleteVoucher(voucher: VoucherRecord) {
    if (pendingActions[voucher.id]) return;
    if (!confirm("この証憑を削除しますか？")) return;
    setPendingAction(voucher.id, "delete");
    try {
      const response = await fetch(`/api/vouchers?id=${encodeURIComponent(voucher.id)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "証憑を削除できませんでした。");
        return;
      }
      setVouchers((current) => current.filter((item) => item.id !== voucher.id));
      setMessage("証憑を削除しました。");
    } catch {
      setMessage("証憑を削除できませんでした。通信状態を確認してください。");
    } finally {
      clearPendingAction(voucher.id);
    }
  }

  function setPendingAction(voucherId: string, action: VoucherPendingAction) {
    setPendingActions((current) => ({ ...current, [voucherId]: action }));
  }

  function clearPendingAction(voucherId: string) {
    setPendingActions((current) => {
      const next = { ...current };
      delete next[voucherId];
      return next;
    });
  }

  return (
    <main className={`shell ${previewVoucher ? "has-voucher-preview" : ""}`}>
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace voucher-workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Documents</p>
            <h2>証憑管理</h2>
            <span className="source-indicator">レシート・領収書・PDF・購入記録</span>
          </div>
        </header>

        <section className="panel voucher-upload-panel">
          <div className="panel-title">
            <Upload size={22} />
            <div>
              <h3>証憑アップロード</h3>
              <p>写真は複数枚、PDFは単体で登録できます。OCR後に仕入・経費、会社支払・立替を確認します。</p>
            </div>
          </div>
          <form className="voucher-upload-form" onSubmit={uploadVouchers}>
            <label>
              <span>店舗</span>
              <select value={selectedStoreId} onChange={(event) => setSelectedStoreId(event.target.value)} disabled={!canUpload || isUploading}>
                {stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
              </select>
            </label>
            <label>
              <span>用途</span>
              <select value={usageType} onChange={(event) => setUsageType(event.target.value as VoucherUsageType)} disabled={!canUpload || isUploading}>
                <option value="unclassified">未分類</option>
                <option value="shiire">仕入</option>
                <option value="keihi">経費</option>
              </select>
            </label>
            <label>
              <span>支払区分</span>
              <select value={paymentType} onChange={(event) => setPaymentType(event.target.value as VoucherPaymentType)} disabled={!canUpload || isUploading}>
                <option value="company">会社支払</option>
                <option value="reimbursement">立替</option>
              </select>
            </label>
            <label className="voucher-file-field">
              <span>撮影・写真</span>
              <input name="receipts" type="file" accept="image/*" multiple disabled={!canUpload || isUploading} />
            </label>
            <label className="voucher-file-field">
              <span>PDFファイル</span>
              <input name="receipts" type="file" accept="application/pdf,.pdf" disabled={!canUpload || isUploading} />
            </label>
            <button className="primary-button" type="submit" disabled={!canUpload || isUploading || !stores.length}>
              {isUploading ? "処理中..." : "アップロードしてOCR"}
            </button>
          </form>
          {uploadProgress ? <VoucherUploadProgressView progress={uploadProgress} /> : null}
          {message ? <p className="form-status">{message}</p> : null}
        </section>

        <section className="panel voucher-list-panel">
          <div className="panel-title">
            <ReceiptText size={22} />
            <div>
              <h3>証憑一覧</h3>
              <p>OCR結果の発生日・商取引先・金額を確認し、用途と立替状態を管理します。</p>
            </div>
          </div>
          {isLoading ? <p className="empty-state">読み込み中...</p> : null}
          {!isLoading && !sortedVouchers.length ? <p className="empty-state">登録済みの証憑はありません。</p> : null}
          <div className="voucher-list">
            {sortedVouchers.map((voucher) => {
              const isConfirmed = voucher.status === "confirmed";
              const isExpanded = !isConfirmed || expandedVoucherIds[voucher.id];
              const pendingAction = pendingActions[voucher.id];
              const isVoucherBusy = Boolean(pendingAction);
              return (
                <article className={`voucher-row ${isConfirmed && !isExpanded ? "is-collapsed" : ""}`} key={voucher.id}>
                  <div className="voucher-row-main">
                    <div className="voucher-row-heading">
                      <span className={`status-pill ${voucher.status === "failed" ? "is-danger" : "is-active"}`}>
                        {voucher.status === "failed" ? "OCR失敗" : isConfirmed ? "確定済み" : "確認待ち"}
                      </span>
                      <strong>{buildVoucherTitle(voucher)}</strong>
                    </div>
                    <p>
                      {voucher.storeName || "店舗未設定"} / {voucher.purchaseDate || "日付未読取"} {voucher.purchaseTime || ""} / {voucher.itemCount}行 / 税 {formatMoney(voucher.tax)}
                    </p>
                    <div className="voucher-row-meta">
                      <span>{usageLabels[voucher.usageType]}</span>
                      <span>{paymentLabels[voucher.paymentType]}</span>
                      {voucher.paymentType === "reimbursement" ? <span>{reimbursementLabels[voucher.reimbursementStatus]}</span> : null}
                      <span>{voucher.sourceType === "voucher" ? "証憑管理" : voucher.sourceType === "procurement" ? "購入管理" : "経費OCR"}</span>
                      <span>{voucher.createdByName || "作成者不明"}</span>
                      <span>{voucher.createdLabel}</span>
                    </div>
                  </div>
                  <strong className="voucher-total">{formatMoney(voucher.total)}</strong>
                  {isConfirmed ? (
                    <button
                      className={`voucher-expand-button ${isExpanded ? "is-open" : ""}`}
                      type="button"
                      onClick={() => toggleVoucherExpanded(voucher.id)}
                      aria-expanded={isExpanded}
                    >
                      <ChevronDown size={16} />
                      {isExpanded ? "閉じる" : "詳細"}
                    </button>
                  ) : null}
                  {isExpanded ? (
                    <>
                      <div className="voucher-controls">
                        <label>
                          <span>用途</span>
                          <select
                            value={voucher.usageType}
                            disabled={isVoucherBusy}
                            onChange={(event) => void updateVoucher(voucher, { usageType: event.target.value as VoucherUsageType })}
                          >
                            <option value="unclassified">未分類</option>
                            <option value="shiire">仕入</option>
                            <option value="keihi">経費</option>
                          </select>
                        </label>
                        <label>
                          <span>支払</span>
                          <select
                            value={voucher.paymentType}
                            disabled={isVoucherBusy}
                            onChange={(event) => {
                              const nextPaymentType = event.target.value as VoucherPaymentType;
                              void updateVoucher(voucher, {
                                paymentType: nextPaymentType,
                                reimbursementStatus: nextPaymentType === "reimbursement" ? "pending" : "none"
                              });
                            }}
                          >
                            <option value="company">会社支払</option>
                            <option value="reimbursement">立替</option>
                          </select>
                        </label>
                        {voucher.paymentType === "reimbursement" ? (
                          <label>
                            <span>精算</span>
                            <select
                              value={voucher.reimbursementStatus}
                              disabled={isVoucherBusy}
                              onChange={(event) => void updateVoucher(voucher, { reimbursementStatus: event.target.value as VoucherReimbursementStatus })}
                            >
                              <option value="pending">精算待ち</option>
                              <option value="paid">精算済み</option>
                              <option value="rejected">却下</option>
                            </select>
                          </label>
                        ) : (
                          <span className="voucher-reimbursement-placeholder">{reimbursementLabels.none}</span>
                        )}
                      </div>
                      <div className="voucher-actions">
                        <button className="text-button voucher-preview-open" type="button" onClick={() => setPreviewVoucher(voucher)}>証憑を見る</button>
                        <a className="text-button voucher-preview-link" href={buildVoucherPreviewUrl(voucher)} target="_blank" rel="noreferrer">証憑を見る</a>
                        {voucher.canDelete ? (
                          <button className="danger-button" type="button" onClick={() => void deleteVoucher(voucher)} disabled={isVoucherBusy}>
                            {pendingAction === "delete" ? "削除中..." : "削除"}
                          </button>
                        ) : null}
                      </div>
                      {voucher.sourceType === "voucher" && voucher.status !== "confirmed" && voucher.status !== "failed" ? (
                        <VoucherAccountingEditor
                          voucher={voucher}
                          draft={accountingDrafts[voucher.id] ?? buildVoucherAccountingDraft(voucher)}
                          validation={validateVoucherAccounting(voucher, accountingDrafts[voucher.id] ?? buildVoucherAccountingDraft(voucher))}
                          isSaving={pendingAction === "confirm"}
                          onDraftChange={(next) => updateAccountingDraft(voucher.id, next)}
                          onLineChange={(lineId, next) => updateAccountingLine(voucher.id, lineId, next)}
                          onAddLine={() => addAccountingLine(voucher.id)}
                          onRemoveLine={(lineId) => removeAccountingLine(voucher.id, lineId)}
                          onConfirm={() => void confirmVoucherAccounting(voucher)}
                        />
                      ) : null}
                      {voucher.accountingLines?.length ? (
                        <VoucherAccountingSummary lines={voucher.accountingLines} />
                      ) : null}
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </section>
      {previewVoucher ? <VoucherPreviewPanel voucher={previewVoucher} onClose={() => setPreviewVoucher(null)} /> : null}
    </main>
  );
}

function buildVoucherTitle(voucher: VoucherRecord) {
  return [voucher.brandName || voucher.companyName || voucher.vendorName, voucher.locationName]
    .filter(Boolean)
    .join(" ") || voucher.uploadedFileName || "証憑";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function VoucherUploadProgressView({ progress }: { progress: VoucherUploadProgress }) {
  const percentage = progress.total > 0 ? Math.round(progress.completed / progress.total * 100) : 0;
  return (
    <div className="voucher-upload-progress" aria-live="polite">
      <div className="voucher-upload-progress-heading">
        <strong>{percentage}%</strong>
        <span>{progress.completed}/{progress.total}件</span>
      </div>
      <div className="voucher-upload-progress-bar" aria-hidden="true">
        <span style={{ width: `${percentage}%` }} />
      </div>
      <p>
        {progress.phase}：{progress.currentFile || "証憑"}
        {progress.failed ? ` / 要確認 ${progress.failed}件` : ""}
      </p>
    </div>
  );
}

function VoucherPreviewPanel({ voucher, onClose }: { voucher: VoucherRecord; onClose: () => void }) {
  const title = buildVoucherTitle(voucher);
  const isPdf = voucher.uploadedFileName.toLowerCase().endsWith(".pdf");
  const previewUrl = buildVoucherPreviewUrl(voucher);
  return (
    <aside className="voucher-preview-panel" aria-label="証憑プレビュー">
      <div className="voucher-preview-panel-head">
        <div>
          <span>証憑プレビュー</span>
          <strong>{title}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="プレビューを閉じる">
          <X size={18} />
        </button>
      </div>
      <div className="voucher-preview-panel-body">
        {isPdf ? (
          <iframe src={previewUrl} title={title} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={title} />
        )}
      </div>
    </aside>
  );
}

function buildVoucherPreviewUrl(voucher: VoucherRecord) {
  return `/api/vouchers/${encodeURIComponent(voucher.id)}/preview`;
}

function VoucherAccountingEditor({
  voucher,
  draft,
  validation,
  isSaving,
  onDraftChange,
  onLineChange,
  onAddLine,
  onRemoveLine,
  onConfirm
}: {
  voucher: VoucherRecord;
  draft: VoucherAccountingDraft;
  validation: VoucherAccountingValidation;
  isSaving: boolean;
  onDraftChange: (next: Partial<VoucherAccountingDraft>) => void;
  onLineChange: (lineId: string, next: Partial<VoucherAccountingLine>) => void;
  onAddLine: () => void;
  onRemoveLine: (lineId: string) => void;
  onConfirm: () => void;
}) {
  const isShiire = voucher.usageType === "shiire";
  return (
    <div className="receipt-confirm-form voucher-accounting-form">
      <label>
        <span>会社名</span>
        <input value={draft.companyName} onChange={(event) => onDraftChange({ companyName: event.target.value })} placeholder="例: 株式会社G-7スーパーマート" disabled={isSaving} />
      </label>
      <label>
        <span>ブランド名</span>
        <input value={draft.brandName} onChange={(event) => onDraftChange({ brandName: event.target.value })} placeholder="例: 業務スーパー" disabled={isSaving} />
      </label>
      <label>
        <span>店舗名</span>
        <input value={draft.locationName} onChange={(event) => onDraftChange({ locationName: event.target.value })} placeholder="例: 春吉店" disabled={isSaving} />
      </label>
      <label>
        <span>日付</span>
        <input type="date" value={draft.transactionDate} onChange={(event) => onDraftChange({ transactionDate: event.target.value })} disabled={isSaving} />
      </label>
      <label>
        <span>時刻</span>
        <input type="time" value={draft.transactionTime} onChange={(event) => onDraftChange({ transactionTime: event.target.value })} disabled={isSaving} />
      </label>
      <label>
        <span>レシート税区分</span>
        <select value={draft.taxMode} onChange={(event) => onDraftChange({ taxMode: event.target.value })} disabled={isSaving}>
          {taxModeOptions.map((option) => <option value={option} key={option}>{option}</option>)}
        </select>
      </label>
      <label className="receipt-note-field">
        <span>備考</span>
        <input value={draft.note} onChange={(event) => onDraftChange({ note: event.target.value })} placeholder="例: 月次整理、立替精算、店舗用品" disabled={isSaving} />
      </label>
      <div className="receipt-line-editor">
        <div className="receipt-line-editor-title">
          <span>{isShiire ? "仕入会計明細" : "Money Forward式 会計明細"}</span>
          <button className="secondary-button" type="button" onClick={onAddLine} disabled={isSaving}>
            <Plus size={16} />
            明細を追加
          </button>
        </div>
        {draft.lines.map((line) => (
          <div className="receipt-expense-line" key={line.id}>
            <label>
              <span>勘定科目</span>
              {isShiire ? (
                <input value="仕入高" readOnly />
              ) : (
                <select value={line.accountTitle} onChange={(event) => onLineChange(line.id, { accountTitle: event.target.value })} disabled={isSaving}>
                  {expenseAccountTitleOptions.map((option) => <option value={option} key={option}>{option}</option>)}
                </select>
              )}
            </label>
            <label>
              <span>補助科目</span>
              <input value={line.subAccountTitle} onChange={(event) => onLineChange(line.id, { subAccountTitle: event.target.value })} placeholder={isShiire ? "例: 食材、包材" : "例: ガソリン、駐車場"} disabled={isSaving} />
            </label>
            <label>
              <span>金額</span>
              <input type="number" min="1" step="1" value={line.amount} onChange={(event) => onLineChange(line.id, { amount: event.target.value })} disabled={isSaving} />
            </label>
            <label>
              <span>税率</span>
              <select value={line.taxRate} onChange={(event) => onLineChange(line.id, { taxRate: event.target.value })} disabled={isSaving}>
                {taxRateOptions.map((option) => <option value={option} key={option}>{option || "不明"}</option>)}
              </select>
            </label>
            <label>
              <span>消費税</span>
              <input type="number" min="0" step="1" value={line.taxAmount} onChange={(event) => onLineChange(line.id, { taxAmount: event.target.value })} disabled={isSaving} />
            </label>
            <label className="receipt-line-note">
              <span>明細メモ</span>
              <input value={line.note} onChange={(event) => onLineChange(line.id, { note: event.target.value })} disabled={isSaving} />
            </label>
            <div className="receipt-line-ocr-meta">
              <span>数量 {line.quantity || "-"}</span>
              <span>単位 {line.unit || "-"}</span>
              <span>単価 {line.unitPrice ? formatMoney(Number(line.unitPrice)) : "-"}</span>
            </div>
            <button className="text-button danger-button" type="button" onClick={() => onRemoveLine(line.id)} disabled={isSaving || draft.lines.length <= 1}>
              <Trash2 size={16} />
              削除
            </button>
          </div>
        ))}
        <div className={`voucher-accounting-check ${validation.ok ? "is-ok" : "is-warning"}`}>
          <strong>{validation.ok ? "金額チェックOK" : "金額を確認してください"}</strong>
          <span>
            明細合計 {formatMoney(validation.lineAmountTotal)}
            {" / "}
            消費税 {formatMoney(validation.taxTotal)}
            {" / "}
            計算上の総額 {formatMoney(validation.expectedTotal)}
            {" / "}
            レシート総額 {formatMoney(validation.receiptTotal)}
          </span>
          {!validation.ok ? (
            <small>
              {validation.taxIncomplete ? "税率・税区分が未確認の明細があります。 " : ""}
              差額 {formatMoney(validation.difference)}。税区分・税率・金額が正しいか確認してください。
            </small>
          ) : null}
        </div>
      </div>
      <button className="primary-button" type="button" onClick={onConfirm} disabled={isSaving || voucher.usageType === "unclassified"}>
        {isSaving ? "登録中..." : voucher.usageType === "unclassified" ? "用途を選択してください" : voucher.usageType === "keihi" ? "この内容で経費登録" : "この内容で仕入確認"}
      </button>
    </div>
  );
}

function buildVoucherAccountingDraft(voucher?: VoucherRecord): VoucherAccountingDraft {
  const lines = buildVoucherAccountingLines(voucher);
  const taxMode = inferReceiptTaxMode(lines);
  const normalizedLines = lines.map((line) => {
    const amount = Math.round(Number(line.amount || 0));
    return {
      ...line,
      taxMode,
      taxAmount: taxMode === "不明" ? line.taxAmount : String(calculateDraftTaxAmount(amount, line.taxRate, taxMode))
    };
  });
  return {
    note: "",
    vendorName: voucher?.vendorName || "",
    companyName: voucher?.companyName || "",
    brandName: voucher?.brandName || "",
    locationName: voucher?.locationName || "",
    transactionDate: voucher?.purchaseDate || getCurrentDate(),
    transactionTime: voucher?.purchaseTime || "",
    taxMode,
    lines: normalizedLines
  };
}

function buildVoucherAccountingLines(voucher?: VoucherRecord): VoucherAccountingLine[] {
  const isShiire = voucher?.usageType === "shiire";

  const lines = (voucher?.items ?? []).flatMap((item, index) => {
    const amount = Math.round(Number(item.amount ?? 0));
    if (!amount) return [];
    const accountTitle = isShiire ? "仕入高" : item.accountTitle || getDefaultAccountTitle(item.category);
    const subAccountTitle = getDefaultSubAccountTitle(voucher?.usageType ?? "unclassified", item.category, item.accountTitle);
    const taxRate = normalizeDraftTaxRate(item.taxRate);
    const taxMode = normalizeDraftTaxMode(item.taxMode);
    return [{
      id: `ocr-${index}-${item.id}`,
      accountTitle,
      subAccountTitle,
      amount: String(amount || ""),
      taxRate,
      taxMode,
      taxAmount: String(calculateDraftTaxAmount(amount, taxRate, taxMode)),
      quantity: item.quantity === null || item.quantity === undefined ? "" : String(item.quantity),
      unit: item.unit || "",
      unitPrice: item.unitPrice === null || item.unitPrice === undefined ? "" : String(item.unitPrice),
      note: item.rawName || ""
    }];
  });
  if (lines.length) return lines;

  const amount = Math.round(voucher?.total ?? 0);
  return [{
    id: "manual-0",
    accountTitle: isShiire ? "仕入高" : "雑費",
    subAccountTitle: "",
    amount: String(amount || ""),
    taxRate: "",
    taxMode: "不明",
    taxAmount: String(Math.round(voucher?.tax ?? 0)),
    quantity: "",
    unit: "",
    unitPrice: "",
    note: ""
  }];
}

function buildNewAccountingLine(index: number, taxMode = "不明"): VoucherAccountingLine {
  return {
    id: `manual-${Date.now()}-${index}`,
    accountTitle: "雑費",
    subAccountTitle: "",
    amount: "",
    taxRate: "",
    taxMode,
    taxAmount: "0",
    quantity: "",
    unit: "",
    unitPrice: "",
    note: ""
  };
}

function validateVoucherAccounting(voucher: VoucherRecord, draft: VoucherAccountingDraft): VoucherAccountingValidation {
  const lineAmountTotal = draft.lines.reduce((sum, line) => sum + Math.round(Number(line.amount || 0)), 0);
  const taxTotal = draft.lines.reduce((sum, line) => sum + Math.round(Number(line.taxAmount || 0)), 0);
  const expectedTotal = draft.taxMode === "外税" ? lineAmountTotal + taxTotal : lineAmountTotal;
  const receiptTotal = Math.round(Number(voucher.total || 0));
  const difference = expectedTotal - receiptTotal;
  const taxIncomplete = !draft.taxMode || draft.taxMode === "不明" || draft.lines.some((line) => !line.taxRate);
  return {
    ok: Math.abs(difference) <= 1 && !taxIncomplete,
    taxIncomplete,
    receiptTotal,
    lineAmountTotal,
    taxTotal,
    expectedTotal,
    difference
  };
}

function inferReceiptTaxMode(lines: VoucherAccountingLine[]) {
  const modes = lines
    .map((line) => normalizeDraftTaxMode(line.taxMode))
    .filter((mode) => mode === "内税" || mode === "外税");
  if (!modes.length) return "不明";
  const uniqueModes = new Set(modes);
  if (uniqueModes.size === 1) return modes[0] ?? "不明";
  return "不明";
}

function VoucherAccountingSummary({ lines }: { lines: VoucherAccountingSummaryLine[] }) {
  return (
    <div className="voucher-accounting-summary">
      <span>会計集計</span>
      {lines.map((line, index) => (
        <div className="voucher-accounting-summary-row" key={`${line.accountTitle}-${line.subAccountTitle}-${line.taxRate}-${line.taxMode}-${index}`}>
          <strong>{line.accountTitle}{line.subAccountTitle ? ` / ${line.subAccountTitle}` : ""}</strong>
          <small>{line.taxRate || "税率不明"} / {line.taxMode || "税区分不明"} / 消費税 {formatMoney(line.taxAmount)}</small>
          <b>{formatMoney(line.amount)}</b>
        </div>
      ))}
    </div>
  );
}

function getCurrentDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getDefaultAccountTitle(category: string) {
  if (category === "清掃用品" || category === "消耗品" || category === "包材") return "消耗品費";
  if (category === "設備") return "修繕費";
  return "雑費";
}

function getDefaultSubAccountTitle(usageType: VoucherUsageType, category: string, accountTitle: string) {
  if (usageType === "shiire") {
    if (category === "包材") return "包材";
    if (category === "消耗品" || category === "清掃用品") return "消耗品";
    return "食材";
  }
  if (category && category !== "未分類") return category;
  if (accountTitle === "車両費") return "車両関連";
  return "";
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
  if (taxMode === "内税") return Math.round(amount * rate / (100 + rate));
  return 0;
}

function isPdfUploadFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function uploadVoucherFileWithRetry(formData: FormData) {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("/api/vouchers", { method: "POST", body: formData });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        results?: Array<{ ok?: boolean; ocrError?: string; error?: string }>;
      };
      const result = body.results?.[0];
      if (response.ok && result?.ok) {
        return { ok: true, ocrError: result.ocrError || "" };
      }
      lastError = body.error || result?.error || "証憑をアップロードできませんでした。";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "通信に失敗しました。";
    }
    await sleep(1200 * (attempt + 1));
  }
  return { ok: false, ocrError: lastError || "証憑をアップロードできませんでした。" };
}

async function splitPdfIntoPageFiles(file: File) {
  const { PDFDocument } = await import("pdf-lib");
  const sourcePdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const pageCount = sourcePdf.getPageCount();
  if (pageCount <= 0) throw new Error("PDFページを読み取れませんでした。");

  const baseName = (file.name || "receipt.pdf").replace(/\.pdf$/i, "");
  const pageFiles: File[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const pagePdf = await PDFDocument.create();
    const [page] = await pagePdf.copyPages(sourcePdf, [index]);
    pagePdf.addPage(page);
    const bytes = await pagePdf.save();
    pageFiles.push(new File([bytes], `${baseName}-page-${String(index + 1).padStart(3, "0")}.pdf`, { type: "application/pdf" }));
  }
  return pageFiles;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
