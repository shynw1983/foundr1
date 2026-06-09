"use client";

import {
  ClipboardList,
  FileText,
  LogOut,
  PackageCheck,
  ReceiptText,
  Upload
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
  itemCount: number;
  createdByName: string;
  createdLabel: string;
  canDelete: boolean;
};

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

  useEffect(() => {
    void loadVouchers();
  }, []);

  const sortedVouchers = useMemo(() => vouchers, [vouchers]);

  async function loadVouchers() {
    setIsLoading(true);
    const response = await fetch("/api/vouchers", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      canUpload?: boolean;
      stores?: StoreOption[];
      vouchers?: VoucherRecord[];
    };
    if (!response.ok) {
      setMessage(body.error ?? "証憑を読み込めませんでした。");
      setIsLoading(false);
      return;
    }
    const nextStores = body.stores ?? [];
    setStores(nextStores);
    setCanUpload(Boolean(body.canUpload));
    setVouchers(body.vouchers ?? []);
    setSelectedStoreId((current) => current || nextStores[0]?.id || "");
    setIsLoading(false);
  }

  async function uploadVouchers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = new FormData(form)
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

    setIsUploading(true);
    setMessage("証憑を読み取り中...");
    const formData = new FormData();
    formData.set("storeId", selectedStoreId);
    formData.set("usageType", usageType);
    formData.set("paymentType", paymentType);
    for (const file of files) formData.append("receipts", file);

    const response = await fetch("/api/vouchers", { method: "POST", body: formData });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      results?: Array<{ ok?: boolean; ocrError?: string; error?: string }>;
    };
    if (!response.ok) {
      setMessage(body.error ?? "証憑をアップロードできませんでした。");
    } else {
      const failed = (body.results ?? []).filter((result) => !result.ok || result.ocrError);
      setMessage(failed.length
        ? `保存しました。一部OCR結果を確認してください（${failed.length}件）。`
        : "証憑を読み取りました。内容を確認してください。");
      form.reset();
      await loadVouchers();
    }
    setIsUploading(false);
  }

  async function updateVoucher(voucher: VoucherRecord, next: Partial<VoucherRecord>) {
    const nextVoucher = { ...voucher, ...next };
    setVouchers((current) => current.map((item) => item.id === voucher.id ? nextVoucher : item));
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
    setMessage(nextVoucher.usageType === "shiire" ? "証憑を更新しました。仕入の明細は商品候補にも反映されます。" : "証憑を更新しました。");
  }

  async function deleteVoucher(voucher: VoucherRecord) {
    if (!confirm("この証憑を削除しますか？")) return;
    const response = await fetch(`/api/vouchers?id=${encodeURIComponent(voucher.id)}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "証憑を削除できませんでした。");
      return;
    }
    setVouchers((current) => current.filter((item) => item.id !== voucher.id));
    setMessage("証憑を削除しました。");
  }

  return (
    <main className="shell">
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
              <span>ファイル / PDF</span>
              <input name="receipts" type="file" accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" multiple disabled={!canUpload || isUploading} />
            </label>
            <button className="primary-button" type="submit" disabled={!canUpload || isUploading || !stores.length}>
              {isUploading ? "読み取り中..." : "アップロードしてOCR"}
            </button>
          </form>
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
            {sortedVouchers.map((voucher) => (
              <article className="voucher-row" key={voucher.id}>
                <div className="voucher-row-main">
                  <div className="voucher-row-heading">
                    <span className={`status-pill ${voucher.status === "failed" ? "is-danger" : "is-active"}`}>
                      {voucher.status === "failed" ? "OCR失敗" : voucher.status === "confirmed" ? "確定済み" : "確認待ち"}
                    </span>
                    <strong>{buildVoucherTitle(voucher)}</strong>
                  </div>
                  <p>
                    {voucher.storeName || "店舗未設定"} / {voucher.purchaseDate || "日付未読取"} {voucher.purchaseTime || ""} / {voucher.itemCount}行 / 税 {formatMoney(voucher.tax)}
                  </p>
                  <div className="voucher-row-meta">
                    <span>{voucher.sourceType === "voucher" ? "証憑管理" : voucher.sourceType === "procurement" ? "購入管理" : "経費OCR"}</span>
                    <span>{voucher.createdByName || "作成者不明"}</span>
                    <span>{voucher.createdLabel}</span>
                  </div>
                </div>
                <strong className="voucher-total">{formatMoney(voucher.total)}</strong>
                <div className="voucher-controls">
                  <label>
                    <span>用途</span>
                    <select
                      value={voucher.usageType}
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
                  <a className="text-button" href={voucher.receiptPhotoUrl} target="_blank" rel="noreferrer">証憑を見る</a>
                  {voucher.canDelete ? (
                    <button className="danger-button" type="button" onClick={() => void deleteVoucher(voucher)}>削除</button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
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
