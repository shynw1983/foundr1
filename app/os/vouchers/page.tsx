"use client";

import {
  CheckCircle,
  ChevronDown,
  ClipboardList,
  FileText,
  Link2,
  LogOut,
  PackageCheck,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { useModalHistory } from "../components/useModalHistory";
import { UserBadge } from "../components/UserBadge";

type StoreOption = {
  id: string;
  name: string;
};

type VoucherUsageType = "unclassified" | "shiire" | "keihi";
type VoucherPaymentType = "company" | "reimbursement";
type VoucherReimbursementStatus = "none" | "pending" | "paid" | "rejected";
type VoucherReviewStatusFilter = "all" | "confirmed" | "unconfirmed";
type VoucherDateSort = "desc" | "asc";

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
  linkedSupplierName: string;
  linkedSupplierLocationName: string;
  supplierMatchStatus: string;
  purchaseDate: string;
  purchaseTime: string;
  total: number;
  tax: number;
  accountingLines: VoucherAccountingSummaryLine[];
  receiptTaxLines: ReceiptTaxLine[];
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
  matchStatus: string;
  matchedProductId: string;
  matchedProductName: string;
  purchaseActualId: string;
  reconciliationStatus: string;
  reconciliationNote: string;
};

type ProductOption = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  unit: string;
  referencePrice: number;
  productFamilyName?: string;
  variantName?: string;
  packageQuantity?: string;
  packageQuantityUnit?: string;
  mainSupplier?: string;
};

type ProductReferencePriceDialog = {
  voucher: VoucherRecord;
  line: VoucherAccountingLine;
  product: ProductOption;
  receiptUnitPrice: number;
};

type ProductCreateDialog = {
  voucher: VoucherRecord;
  line: VoucherAccountingLine;
  productName: string;
  category: string;
  subcategory: string;
  unit: string;
  referencePrice: number;
};

type VoucherAccountingDraft = {
  note: string;
  vendorName: string;
  companyName: string;
  brandName: string;
  locationName: string;
  transactionDate: string;
  transactionTime: string;
  receiptTotal: string;
  receiptTaxTotal: string;
  receiptTaxLines: ReceiptTaxLine[];
  taxMode: string;
  lines: VoucherAccountingLine[];
};

type ReceiptTaxLine = {
  id: string;
  taxRate: string;
  taxAmount: string;
};

type VoucherAccountingLine = {
  id: string;
  ocrItemId: string;
  matchedProductId: string;
  matchedProductName: string;
  matchStatus: string;
  purchaseActualId: string;
  reconciliationStatus: string;
  reconciliationNote: string;
  confirmed: boolean;
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
  lineNo?: number;
  accountTitle: string;
  subAccountTitle: string;
  amount: number;
  taxIncludedAmount?: number;
  taxRate: string;
  taxMode: string;
  taxAmount: number;
  quantity?: number | null;
  unit?: string;
  unitPrice?: number | null;
  ocrItemId?: string;
  matchedProductId?: string;
  matchedProductName?: string;
  matchStatus?: string;
  purchaseActualId?: string;
  reconciliationStatus?: string;
  reconciliationNote?: string;
  note: string;
};

type ConfirmedAccountingLine = {
  voucherId: string;
  lineNo: number;
  summaryKey?: string;
  purchaseDate: string;
  purchaseTime: string;
  storeName: string;
  vendorName: string;
  usageType: string;
  paymentType: string;
  reimbursementStatus: string;
  accountTitle: string;
  subAccountTitle: string;
  amount: number;
  taxIncludedAmount?: number;
  taxRate: string;
  taxMode: string;
  taxAmount: number;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineCount?: number;
  note: string;
  details?: ConfirmedAccountingLineDetail[];
};

type ConfirmedAccountingLineDetail = {
  voucherId: string;
  lineNo: number;
  accountTitle: string;
  subAccountTitle: string;
  amount: number;
  taxRate: string;
  taxMode: string;
  taxAmount: number;
  quantity: string;
  unit: string;
  unitPrice: string;
  ocrItemId: string;
  matchedProductId: string;
  matchedProductName: string;
  matchStatus: string;
  purchaseActualId: string;
  reconciliationStatus: string;
  reconciliationNote: string;
  note: string;
};

type ConfirmedVoucherBasicDraft = {
  companyName: string;
  brandName: string;
  locationName: string;
  receiptTaxTotal: string;
  receiptTaxLines: ReceiptTaxLine[];
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
  currentProgress?: number;
  failed: number;
  currentFile: string;
  phase: string;
};

type VoucherPendingAction = "update" | "confirm" | "delete";

type VoucherWorkspaceSnapshot = {
  selectedStoreId: string;
  usageType: VoucherUsageType;
  paymentType: VoucherPaymentType;
  exportStartDate: string;
  exportEndDate: string;
  accountingDrafts: Record<string, VoucherAccountingDraft>;
  expandedVoucherIds: Record<string, boolean>;
  previewVoucherId: string;
  lineProductSelections: Record<string, string>;
  lineProductCategorySelections: Record<string, string>;
  lineProductSubcategorySelections: Record<string, string>;
  savedAt: number;
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

const expenseAccountTitleOptions = [
  "租税公課",
  "荷造運賃",
  "水道光熱費",
  "旅費交通費",
  "通信費",
  "広告宣伝費",
  "接待交際費",
  "損害保険料",
  "保険料",
  "修繕費",
  "消耗品費",
  "事務用品費",
  "減価償却費",
  "福利厚生費",
  "法定福利費",
  "給料賃金",
  "外注工賃",
  "支払報酬料",
  "利子割引料",
  "地代家賃",
  "貸倒金",
  "支払手数料",
  "車両費",
  "リース料",
  "新聞図書費",
  "図書研修費",
  "研修採用費",
  "会議費",
  "諸会費",
  "衛生管理費",
  "雑費"
];
const taxRateOptions = ["", "8%", "10%", "非課税", "不課税", "対象外"];
const taxModeOptions = ["内税", "外税", "対象外", "不明"];
const legacyVoucherWorkspaceStorageKeys = ["foundr1-os:voucher-workspace:v1"];
const voucherWorkspaceStorageKey = "foundr1-os:voucher-workspace:v2";
const voucherWorkspaceSnapshotMaxAgeMs = 1000 * 60 * 60 * 6;

export default function VouchersPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [usageType, setUsageType] = useState<VoucherUsageType>("unclassified");
  const [paymentType, setPaymentType] = useState<VoucherPaymentType>("company");
  const [vouchers, setVouchers] = useState<VoucherRecord[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [exportStartDate, setExportStartDate] = useState(getCurrentMonthStartDate());
  const [exportEndDate, setExportEndDate] = useState(getCurrentDate());
  const [confirmedAccountingLines, setConfirmedAccountingLines] = useState<ConfirmedAccountingLine[]>([]);
  const [isLoadingConfirmedLines, setIsLoadingConfirmedLines] = useState(false);
  const [confirmedLineDrafts, setConfirmedLineDrafts] = useState<Record<string, ConfirmedAccountingLineDetail>>({});
  const [confirmedSummaryDrafts, setConfirmedSummaryDrafts] = useState<Record<string, string>>({});
  const [editingConfirmedSummaryKeys, setEditingConfirmedSummaryKeys] = useState<Record<string, boolean>>({});
  const [voucherSearchInput, setVoucherSearchInput] = useState("");
  const [voucherSearchTerm, setVoucherSearchTerm] = useState("");
  const [voucherFilterStartDate, setVoucherFilterStartDate] = useState("");
  const [voucherFilterEndDate, setVoucherFilterEndDate] = useState("");
  const [voucherReviewStatusFilter, setVoucherReviewStatusFilter] = useState<VoucherReviewStatusFilter>("all");
  const [voucherDateSort, setVoucherDateSort] = useState<VoucherDateSort>("desc");
  const [savingConfirmedLineKeys, setSavingConfirmedLineKeys] = useState<Record<string, boolean>>({});
  const [savingConfirmedSummaryKeys, setSavingConfirmedSummaryKeys] = useState<Record<string, boolean>>({});
  const [creatingConfirmedPurchaseActualKeys, setCreatingConfirmedPurchaseActualKeys] = useState<Record<string, boolean>>({});
  const [savingConfirmedBasicIds, setSavingConfirmedBasicIds] = useState<Record<string, boolean>>({});
  const [lineProductSelections, setLineProductSelections] = useState<Record<string, string>>({});
  const [lineProductCategorySelections, setLineProductCategorySelections] = useState<Record<string, string>>({});
  const [lineProductSubcategorySelections, setLineProductSubcategorySelections] = useState<Record<string, string>>({});
  const [pendingProductLineIds, setPendingProductLineIds] = useState<Record<string, boolean>>({});
  const [canUpload, setCanUpload] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [recentDuplicateVoucherIds, setRecentDuplicateVoucherIds] = useState<Record<string, boolean>>({});
  const [accountingDrafts, setAccountingDrafts] = useState<Record<string, VoucherAccountingDraft>>({});
  const [expandedVoucherIds, setExpandedVoucherIds] = useState<Record<string, boolean>>({});
  const [uploadProgress, setUploadProgress] = useState<VoucherUploadProgress | null>(null);
  const [previewVoucher, setPreviewVoucher] = useState<VoucherRecord | null>(null);
  const [restoredPreviewVoucherId, setRestoredPreviewVoucherId] = useState("");
  const [hasRestoredWorkspace, setHasRestoredWorkspace] = useState(false);
  const [referencePriceDialog, setReferencePriceDialog] = useState<ProductReferencePriceDialog | null>(null);
  const [createProductDialog, setCreateProductDialog] = useState<ProductCreateDialog | null>(null);
  const [pendingActions, setPendingActions] = useState<Record<string, VoucherPendingAction>>({});
  const voucherRowRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const snapshot = readVoucherWorkspaceSnapshot();
    if (snapshot) {
      setSelectedStoreId(snapshot.selectedStoreId);
      setUsageType(snapshot.usageType);
      setPaymentType(snapshot.paymentType);
      setExportStartDate(snapshot.exportStartDate);
      setExportEndDate(snapshot.exportEndDate);
      setAccountingDrafts(normalizeStoredAccountingDrafts(snapshot.accountingDrafts));
      setExpandedVoucherIds(snapshot.expandedVoucherIds);
      setLineProductSelections(snapshot.lineProductSelections);
      setLineProductCategorySelections(snapshot.lineProductCategorySelections);
      setLineProductSubcategorySelections(snapshot.lineProductSubcategorySelections);
      setRestoredPreviewVoucherId(snapshot.previewVoucherId);
    }
    setHasRestoredWorkspace(true);
  }, []);

  useEffect(() => {
    void loadVouchers();
  }, []);

  useEffect(() => {
    void loadConfirmedAccountingLines(exportStartDate, exportEndDate);
  }, [exportStartDate, exportEndDate]);

  const sortedVouchers = useMemo(() => vouchers, [vouchers]);
  const filteredVouchers = useMemo(() => {
    const term = normalizeSearchText(voucherSearchTerm);
    return sortedVouchers
      .filter((voucher) => {
        const voucherDate = voucher.purchaseDate || "";
        if (voucherFilterStartDate && (!voucherDate || voucherDate < voucherFilterStartDate)) return false;
        if (voucherFilterEndDate && (!voucherDate || voucherDate > voucherFilterEndDate)) return false;
        if (voucherReviewStatusFilter === "confirmed" && voucher.status !== "confirmed") return false;
        if (voucherReviewStatusFilter === "unconfirmed" && voucher.status === "confirmed") return false;
        return !term || voucherMatchesProductSearch(voucher, term);
      })
      .sort((left, right) => compareVoucherReviewPriority(left, right, voucherDateSort));
  }, [sortedVouchers, voucherSearchTerm, voucherFilterStartDate, voucherFilterEndDate, voucherReviewStatusFilter, voucherDateSort]);

  useEffect(() => {
    if (!hasRestoredWorkspace || !vouchers.length) return;
    const validVoucherIds = new Set(vouchers.map((voucher) => voucher.id));
    setAccountingDrafts((current) => filterVoucherRecord(current, validVoucherIds));
    setExpandedVoucherIds((current) => filterVoucherRecord(current, validVoucherIds));
  }, [hasRestoredWorkspace, vouchers]);

  useEffect(() => {
    if (!restoredPreviewVoucherId || !vouchers.length) return;
    const restoredVoucher = vouchers.find((voucher) => voucher.id === restoredPreviewVoucherId);
    if (restoredVoucher) setPreviewVoucher(restoredVoucher);
    setRestoredPreviewVoucherId("");
  }, [restoredPreviewVoucherId, vouchers]);

  useEffect(() => {
    if (!hasRestoredWorkspace) return;
    const snapshot: VoucherWorkspaceSnapshot = {
      selectedStoreId,
      usageType,
      paymentType,
      exportStartDate,
      exportEndDate,
      accountingDrafts,
      expandedVoucherIds,
      previewVoucherId: previewVoucher?.id ?? "",
      lineProductSelections,
      lineProductCategorySelections,
      lineProductSubcategorySelections,
      savedAt: Date.now()
    };
    writeVoucherWorkspaceSnapshot(snapshot);
  }, [
    hasRestoredWorkspace,
    selectedStoreId,
    usageType,
    paymentType,
    exportStartDate,
    exportEndDate,
    accountingDrafts,
    expandedVoucherIds,
    previewVoucher,
    lineProductSelections,
    lineProductCategorySelections,
    lineProductSubcategorySelections
  ]);

  async function loadVouchers() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/vouchers", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        canUpload?: boolean;
        stores?: StoreOption[];
        products?: ProductOption[];
        vouchers?: VoucherRecord[];
      };
      if (!response.ok) {
        setMessage(body.error ?? "証憑を読み込めませんでした。");
        return;
      }
      const nextStores = body.stores ?? [];
      setStores(nextStores);
      setProductOptions(body.products ?? []);
      setCanUpload(Boolean(body.canUpload));
      const nextVouchers = body.vouchers ?? [];
      setVouchers(nextVouchers);
      setPreviewVoucher((current) => current ? nextVouchers.find((voucher) => voucher.id === current.id) ?? current : current);
      setSelectedStoreId((current) => current || nextStores[0]?.id || "");
    } catch {
      setMessage("証憑一覧を再読み込みできませんでした。時間をおいて更新してください。");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadConfirmedAccountingLines(fromDate = exportStartDate, toDate = exportEndDate) {
    setIsLoadingConfirmedLines(true);
    try {
      const params = new URLSearchParams({ view: "confirmed_accounting_lines" });
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const response = await fetch(`/api/vouchers?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { lines?: ConfirmedAccountingLine[]; error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "確定済み明細を読み込めませんでした。");
        return;
      }
      const lines = body.lines ?? [];
      setConfirmedAccountingLines(lines);
      setConfirmedSummaryDrafts((current) => {
        const next = { ...current };
        for (const line of lines) {
          const key = getConfirmedLineKey(line);
          next[key] = line.note ?? "";
        }
        return next;
      });
    } catch {
      setMessage("確定済み明細を読み込めませんでした。通信状態を確認してください。");
    } finally {
      setIsLoadingConfirmedLines(false);
    }
  }

  async function refreshVoucherViews() {
    await Promise.all([
      loadVouchers(),
      loadConfirmedAccountingLines(exportStartDate, exportEndDate)
    ]);
  }

  function getConfirmedLineDraft(voucher: VoucherRecord, detail: ConfirmedAccountingLineDetail) {
    const key = getConfirmedVoucherDetailKey(voucher.id, detail);
    return confirmedLineDrafts[key] ?? detail;
  }

  function updateConfirmedLineDraft(voucher: VoucherRecord, detail: ConfirmedAccountingLineDetail, next: Partial<ConfirmedAccountingLineDetail>) {
    const key = getConfirmedVoucherDetailKey(voucher.id, detail);
    setConfirmedLineDrafts((current) => {
      const draft = current[key] ?? detail;
      const updated = { ...draft, ...next };
      const previousTaxRate = draft.taxRate;
      if ("subAccountTitle" in next && !("taxRate" in next)) {
        updated.taxRate = updated.taxRate || getDefaultTaxRateForSubAccountTitle(updated.subAccountTitle);
      }
      if (shouldAutoCalculateTaxAmount(next, updated) || updated.taxRate !== previousTaxRate) {
        updated.taxAmount = calculateDraftTaxAmount(Number(updated.amount || 0), updated.taxRate, updated.taxMode);
      }
      if (!("unitPrice" in next) && ("amount" in next || "quantity" in next || "taxAmount" in next)) {
        updated.unitPrice = calculateDraftUnitPrice(String(updated.amount || ""), updated.quantity, updated.taxRate, updated.taxMode, updated.taxAmount);
      }
      if (!("unitPrice" in next)) {
        updated.unitPrice = normalizeDraftUnitPrice(updated.unitPrice, updated.amount, updated.quantity, updated.taxRate, updated.taxMode, updated.taxAmount, { force: "taxAmount" in next });
      }
      return { ...current, [key]: "taxAmount" in next ? updated : normalizeConfirmedLineDetail(updated, { preserveUnitPrice: "unitPrice" in next }) };
    });
  }

  async function saveConfirmedLineDetail(voucher: VoucherRecord, detail: ConfirmedAccountingLineDetail, basicDraft?: ConfirmedVoucherBasicDraft) {
    const key = getConfirmedVoucherDetailKey(voucher.id, detail);
    const draft = normalizeConfirmedLineDetail(confirmedLineDrafts[key] ?? detail);
    const companyName = basicDraft?.companyName ?? voucher.companyName;
    const brandName = basicDraft?.brandName ?? voucher.brandName;
    const locationName = basicDraft?.locationName ?? voucher.locationName;
    const receiptTaxTotal = basicDraft?.receiptTaxTotal ?? String(Math.round(Number(voucher.tax ?? 0)));
    const vendorName = buildVendorNameFromParts(companyName, brandName, locationName, voucher.vendorName);
    setSavingConfirmedLineKeys((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch("/api/vouchers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_confirmed_accounting_line",
          id: voucher.id,
          usageType: voucher.usageType,
          paymentType: voucher.paymentType,
          reimbursementStatus: voucher.reimbursementStatus,
          vendorName,
          companyName,
          brandName,
          locationName,
          receiptTaxTotal,
          receiptTaxLines: basicDraft?.receiptTaxLines?.map((line) => ({
            taxRate: line.taxRate,
            taxAmount: line.taxAmount
          })),
          lineNo: detail.lineNo,
          lines: [{
            accountTitle: draft.accountTitle,
            subAccountTitle: draft.subAccountTitle,
            amount: draft.amount,
            taxRate: draft.taxRate,
            taxMode: draft.taxMode,
            taxAmount: draft.taxAmount,
            quantity: draft.quantity,
            unit: draft.unit,
            unitPrice: draft.unitPrice,
            ocrItemId: draft.ocrItemId,
            note: draft.note
          }]
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "確定済み明細を保存できませんでした。");
        return;
      }
      setConfirmedLineDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setMessage("確定済み明細を更新しました。");
      await refreshVoucherViews();
    } catch {
      setMessage("確定済み明細を保存できませんでした。通信状態を確認してください。");
    } finally {
      setSavingConfirmedLineKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function saveConfirmedSummaryNote(line: ConfirmedAccountingLine) {
    const key = getConfirmedLineKey(line);
    if (savingConfirmedSummaryKeys[key]) return;
    setSavingConfirmedSummaryKeys((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch("/api/vouchers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_confirmed_accounting_summary_note",
          id: line.voucherId,
          summaryKey: line.summaryKey || buildConfirmedSummaryKey(line),
          note: (confirmedSummaryDrafts[key] ?? line.note ?? "").trim()
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "摘要を保存できませんでした。");
        return;
      }
      setMessage("摘要を保存しました。CSV出力にも反映されます。");
      setEditingConfirmedSummaryKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await loadConfirmedAccountingLines(exportStartDate, exportEndDate);
    } catch {
      setMessage("摘要を保存できませんでした。通信状態を確認してください。");
    } finally {
      setSavingConfirmedSummaryKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function createPurchaseActualFromConfirmedLine(line: ConfirmedAccountingLine) {
    const key = getConfirmedLineKey(line);
    const detail = getConfirmedLinePurchaseActualCandidate(line);
    if (!detail || creatingConfirmedPurchaseActualKeys[key]) return;

    setCreatingConfirmedPurchaseActualKeys((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch("/api/vouchers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: line.voucherId,
          usageType: line.usageType,
          action: "create_purchase_actual_from_receipt_item",
          ocrItemId: detail.ocrItemId
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "購入実績を作成できませんでした。");
        return;
      }
      setMessage("購入実績を作成しました。");
      await Promise.all([
        loadVouchers(),
        loadConfirmedAccountingLines(exportStartDate, exportEndDate)
      ]);
    } catch {
      setMessage("購入実績を作成できませんでした。通信状態を確認してください。");
    } finally {
      setCreatingConfirmedPurchaseActualKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function saveConfirmedVoucherBasic(voucher: VoucherRecord, basicDraft: ConfirmedVoucherBasicDraft) {
    const companyName = basicDraft.companyName;
    const brandName = basicDraft.brandName;
    const locationName = basicDraft.locationName;
    const vendorName = buildVendorNameFromParts(companyName, brandName, locationName, voucher.vendorName);
    setSavingConfirmedBasicIds((current) => ({ ...current, [voucher.id]: true }));
    try {
      const response = await fetch("/api/vouchers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_confirmed_voucher_basic",
          id: voucher.id,
          usageType: voucher.usageType,
          paymentType: voucher.paymentType,
          reimbursementStatus: voucher.reimbursementStatus,
          vendorName,
          companyName,
          brandName,
          locationName,
          receiptTaxTotal: basicDraft.receiptTaxTotal,
          receiptTaxLines: basicDraft.receiptTaxLines.map((line) => ({
            taxRate: line.taxRate,
            taxAmount: line.taxAmount
          }))
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "確定済み証憑の基本情報を保存できませんでした。");
        return;
      }
      setMessage("確定済み証憑の基本情報を更新しました。");
      await refreshVoucherViews();
    } catch {
      setMessage("確定済み証憑の基本情報を保存できませんでした。通信状態を確認してください。");
    } finally {
      setSavingConfirmedBasicIds((current) => {
        const next = { ...current };
        delete next[voucher.id];
        return next;
      });
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
      setRecentDuplicateVoucherIds({});

      let failedCount = 0;
      let savedCount = 0;
      let duplicateCount = 0;
      const duplicateVoucherIds: Record<string, boolean> = {};
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const fileName = file.name || `file-${index + 1}`;
        setUploadProgress({ total: files.length, completed: index, currentProgress: 0.08, failed: failedCount, currentFile: fileName, phase: "アップロード・OCR中" });
        const progressTimer = window.setInterval(() => {
          setUploadProgress((current) => {
            if (!current || current.currentFile !== fileName || current.completed !== index) return current;
            return {
              ...current,
              currentProgress: Math.min(0.9, (current.currentProgress ?? 0) + 0.03)
            };
          });
        }, 900);

        const formData = new FormData();
        formData.set("storeId", selectedStoreId);
        formData.set("usageType", usageType);
        formData.set("paymentType", paymentType);
        formData.append("receipts", file);

        const result = await uploadVoucherFileWithRetry(formData).finally(() => window.clearInterval(progressTimer));
        if (!result.ok || result.ocrError) {
          failedCount += 1;
        } else if (result.duplicate) {
          duplicateCount += Math.max(1, result.duplicateCount);
          for (const existingId of result.existingOcrResultIds) duplicateVoucherIds[existingId] = true;
        } else {
          savedCount += Math.max(1, result.createdCount);
          duplicateCount += result.duplicateCount;
          for (const existingId of result.existingOcrResultIds) duplicateVoucherIds[existingId] = true;
        }
        setUploadProgress({ total: files.length, completed: index + 1, currentProgress: 0, failed: failedCount, currentFile: fileName, phase: "完了" });
        if (index < files.length - 1) await sleep(800);
      }

      const finalMessage = failedCount
        ? `保存処理が完了しました。一部OCR結果を確認してください（成功 ${savedCount}件 / 重複 ${duplicateCount}件 / 失敗 ${failedCount}件）。`
        : duplicateCount
          ? `証憑を読み取りました。重複している証憑は登録しませんでした（新規 ${savedCount}件 / 重複 ${duplicateCount}件）。`
          : "証憑を読み取りました。内容を確認してください。";
      setRecentDuplicateVoucherIds(duplicateVoucherIds);
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
      const draft = normalizeVoucherAccountingDraft(current[voucherId] ?? buildVoucherAccountingDraft(voucher));
      const nextDraft = { ...draft, ...next };
      if ("taxMode" in next) {
        nextDraft.lines = draft.lines.map((line) => {
          return normalizeAccountingLineTax({
            ...line,
            confirmed: false,
            taxMode: nextDraft.taxMode
          }, nextDraft.taxMode, { force: true, forceUnitPrice: true });
        });
      }
      return { ...current, [voucherId]: nextDraft };
    });
  }

  function updateAccountingLine(voucherId: string, lineId: string, next: Partial<VoucherAccountingLine>) {
    setAccountingDrafts((current) => {
      const voucher = vouchers.find((item) => item.id === voucherId);
      const draft = normalizeVoucherAccountingDraft(current[voucherId] ?? buildVoucherAccountingDraft(voucher));
      const nextLines = draft.lines.map((line) => {
        if (line.id !== lineId) return line;
        const updated = { ...line, ...next };
        updated.taxMode = draft.taxMode;
        const previousTaxRate = line.taxRate;
        if ("subAccountTitle" in next && !("taxRate" in next)) {
          updated.taxRate = updated.taxRate || getDefaultTaxRateForSubAccountTitle(updated.subAccountTitle);
        }
        if (shouldAutoCalculateTaxAmount(next, updated) || updated.taxRate !== previousTaxRate) {
          return normalizeAccountingLineTax(updated, draft.taxMode, { force: true, forceUnitPrice: true, preserveUnitPrice: "unitPrice" in next });
        }
        if (!("unitPrice" in next) && ("amount" in next || "quantity" in next || "taxAmount" in next)) {
          updated.unitPrice = calculateDraftUnitPrice(updated.amount, updated.quantity, updated.taxRate, updated.taxMode, updated.taxAmount);
        }
        return "taxAmount" in next ? updated : normalizeAccountingLineTax(updated, draft.taxMode, { preserveUnitPrice: "unitPrice" in next, autoFixStaleTax: false });
      });
      return {
        ...current,
        [voucherId]: {
          ...draft,
          lines: nextLines
        }
      };
    });
  }

  function updateAccountingDraftTaxLines(voucherId: string, taxLines: ReceiptTaxLine[]) {
    setAccountingDrafts((current) => {
      const voucher = vouchers.find((item) => item.id === voucherId);
      const draft = normalizeVoucherAccountingDraft(current[voucherId] ?? buildVoucherAccountingDraft(voucher));
      const normalizedTaxLines = normalizeReceiptTaxLines(taxLines, draft.lines, draft.receiptTaxTotal);
      return {
        ...current,
        [voucherId]: {
          ...draft,
          receiptTaxLines: normalizedTaxLines,
          receiptTaxTotal: String(calculateReceiptTaxLinesTotal(normalizedTaxLines)),
          lines: draft.lines
        }
      };
    });
  }

  function addAccountingLine(voucherId: string, placement?: { lineId: string; position: "before" | "after" }) {
    setAccountingDrafts((current) => {
      const voucher = vouchers.find((item) => item.id === voucherId);
      const draft = normalizeVoucherAccountingDraft(current[voucherId] ?? buildVoucherAccountingDraft(voucher));
      const targetIndex = placement ? draft.lines.findIndex((line) => line.id === placement.lineId) : -1;
      const insertIndex = targetIndex >= 0
        ? targetIndex + (placement?.position === "after" ? 1 : 0)
        : draft.lines.length;
      const sourceLine = targetIndex >= 0 ? draft.lines[targetIndex] : undefined;
      const nextLine = buildNewAccountingLine(draft.lines.length, draft.taxMode, sourceLine, voucher?.usageType);
      const nextLines = [...draft.lines];
      nextLines.splice(insertIndex, 0, nextLine);
      return {
        ...current,
        [voucherId]: {
          ...draft,
          lines: nextLines
        }
      };
    });
  }

  async function bindAccountingLineProduct(voucher: VoucherRecord, line: VoucherAccountingLine) {
    const { selectedProductId: productId } = getEffectiveProductBindingState({
      lineId: line.id,
      line,
      productOptions,
      lineProductSelections,
      lineProductCategorySelections,
      lineProductSubcategorySelections
    });
    if (!productId) {
      window.alert("紐付ける商品を選択してください。");
      return;
    }
    const product = productOptions.find((option) => option.id === productId);
    if (!product) {
      window.alert("選択した商品を読み込めませんでした。再読み込みしてからもう一度お試しください。");
      return;
    }
    const receiptUnitPrice = calculateTaxIncludedUnitPrice(line);
    if (!receiptUnitPrice || receiptUnitPrice <= 0) {
      window.alert("今回の税込単価を計算できません。金額・数量・税区分を確認してください。");
      return;
    }
    setReferencePriceDialog({ voucher, line, product, receiptUnitPrice });
  }

  async function confirmAccountingLineProductBinding(updateReferencePrice: boolean) {
    if (!referencePriceDialog) return;
    const { voucher, line, product, receiptUnitPrice } = referencePriceDialog;
    setReferencePriceDialog(null);
    const normalizedLine = normalizeAccountingLineTax(line, line.taxMode);
    await updateAccountingLineProduct(voucher, line, {
      action: "link_product_to_item",
      productId: product.id,
      updateReferencePrice,
      referencePrice: updateReferencePrice ? receiptUnitPrice : undefined,
      receiptUnitPrice,
      amount: normalizedLine.amount,
      taxRate: normalizedLine.taxRate,
      taxMode: normalizedLine.taxMode,
      taxAmount: normalizedLine.taxAmount,
      quantity: normalizedLine.quantity,
      unit: normalizedLine.unit || "個"
    }, updateReferencePrice ? "商品マスタに紐付け、参考価格を更新しました。" : "商品マスタに紐付けました。");
  }

  async function createProductFromAccountingLine(voucher: VoucherRecord, line: VoucherAccountingLine) {
    if (!line.note.trim()) {
      window.alert("商品名が空の明細は新規追加できません。");
      return;
    }
    const receiptUnitPrice = calculateTaxIncludedUnitPrice(line) || Number(line.unitPrice || 0);
    setCreateProductDialog({
      voucher,
      line,
      productName: line.note.trim(),
      category: line.subAccountTitle || "食材",
      subcategory: "未分類",
      unit: line.unit || "個",
      referencePrice: Number.isFinite(receiptUnitPrice) && receiptUnitPrice > 0 ? receiptUnitPrice : 0
    });
  }

  async function confirmCreateProductFromAccountingLine(draft: ProductCreateDialog) {
    if (!draft.productName.trim()) {
      window.alert("商品名を入力してください。");
      return;
    }
    if (!draft.category.trim()) {
      window.alert("大分類を選択してください。");
      return;
    }
    if (!draft.subcategory.trim()) {
      window.alert("小分類を選択してください。");
      return;
    }
    if (!draft.unit.trim()) {
      window.alert("単位を入力してください。");
      return;
    }
    setCreateProductDialog(null);
    const { voucher, line } = draft;
    const normalizedLine = normalizeAccountingLineTax(line, line.taxMode);
    await updateAccountingLineProduct(voucher, line, {
      action: "create_product_from_item",
      productName: draft.productName.trim(),
      category: draft.category.trim(),
      subcategory: draft.subcategory.trim(),
      unit: draft.unit.trim(),
      referencePrice: draft.referencePrice,
      receiptUnitPrice: draft.referencePrice,
      amount: normalizedLine.amount,
      taxRate: normalizedLine.taxRate,
      taxMode: normalizedLine.taxMode,
      taxAmount: normalizedLine.taxAmount,
      quantity: normalizedLine.quantity
    }, "商品マスタに追加して紐付けました。");
  }

  async function updateAccountingLineProduct(voucher: VoucherRecord, line: VoucherAccountingLine, payload: Record<string, unknown>, successMessage: string) {
    await updateAccountingLineProductState(voucher, line, payload, successMessage);
  }

  async function ignoreAccountingLineProduct(voucher: VoucherRecord, line: VoucherAccountingLine, ignored: boolean) {
    await updateAccountingLineProductState(voucher, line, {
      action: ignored ? "ignore_product_item" : "unignore_product_item"
    }, ignored ? "この明細を商品マスタ対象外にしました。" : "この明細を商品マスタ対象に戻しました。", {
      preserveDraft: true,
      linePatch: {
        matchStatus: ignored ? "ignored" : "unmatched",
        matchedProductId: "",
        matchedProductName: "",
        confirmed: false
      }
    });
  }

  async function createPurchaseActualFromReceiptLine(voucher: VoucherRecord, line: VoucherAccountingLine) {
    if (!line.ocrItemId || !line.matchedProductId || line.purchaseActualId || line.reconciliationStatus === "manual_matched" || line.reconciliationStatus === "auto_matched") return;
    await updateAccountingLineProductState(voucher, line, {
      action: "create_purchase_actual_from_receipt_item"
    }, "レシート明細から購入実績を作成しました。", {
      preserveDraft: true,
      linePatch: {
        reconciliationStatus: "manual_matched",
        reconciliationNote: "レシート明細から購入実績を作成しました。"
      }
    });
  }

  async function updateAccountingLineProductState(
    voucher: VoucherRecord,
    line: VoucherAccountingLine,
    payload: Record<string, unknown>,
    successMessage: string,
    options: { preserveDraft?: boolean; linePatch?: Partial<VoucherAccountingLine> } = {}
  ) {
    if (pendingProductLineIds[line.id]) return;
    setPendingProductLineIds((current) => ({ ...current, [line.id]: true }));
    try {
      const response = await fetch("/api/vouchers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: voucher.id,
          usageType: voucher.usageType,
          ocrItemId: line.ocrItemId,
          rawName: line.note,
          accountTitle: line.accountTitle,
          subAccountTitle: line.subAccountTitle,
          amount: line.amount,
          taxRate: line.taxRate,
          taxMode: line.taxMode,
          taxAmount: line.taxAmount,
          quantity: line.quantity,
          unit: line.unit || "個",
          unitPrice: line.unitPrice,
          ...payload
        })
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        itemId?: string;
        purchaseActualId?: string;
        reconciliationStatus?: string;
        reconciliationNote?: string;
      };
      if (!response.ok) {
        setMessage(body.error ?? "商品マスタ紐付けを更新できませんでした。");
        return;
      }
      setMessage(successMessage);
      await loadVouchers();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => scrollToVoucherRow(voucher.id));
      });
      setAccountingDrafts((current) => {
        const draft = current[voucher.id];
        if (!draft) {
          const next = { ...current };
          delete next[voucher.id];
          return next;
        }
        const linkedProduct = typeof payload.productId === "string"
          ? productOptions.find((product) => product.id === payload.productId)
          : null;
        const inferredLinePatch: Partial<VoucherAccountingLine> = options.linePatch ?? (
          payload.action === "link_product_to_item" && linkedProduct
            ? {
              matchedProductId: linkedProduct.id,
              matchedProductName: linkedProduct.name,
              matchStatus: "matched",
              purchaseActualId: typeof body.purchaseActualId === "string" ? body.purchaseActualId : line.purchaseActualId,
              reconciliationStatus: typeof body.reconciliationStatus === "string" ? body.reconciliationStatus : line.reconciliationStatus,
              reconciliationNote: typeof body.reconciliationNote === "string" ? body.reconciliationNote : line.reconciliationNote
            }
            : payload.action === "create_product_from_item"
              ? {
                matchedProductName: String(payload.productName ?? ""),
                matchStatus: "matched",
                purchaseActualId: typeof body.purchaseActualId === "string" ? body.purchaseActualId : line.purchaseActualId,
                reconciliationStatus: typeof body.reconciliationStatus === "string" ? body.reconciliationStatus : line.reconciliationStatus,
                reconciliationNote: typeof body.reconciliationNote === "string" ? body.reconciliationNote : line.reconciliationNote
              }
              : {}
        );
        return {
          ...current,
          [voucher.id]: {
            ...draft,
            lines: draft.lines.map((draftLine) => draftLine.id === line.id ? {
              ...draftLine,
              ocrItemId: body.itemId || draftLine.ocrItemId,
              ...inferredLinePatch
            } : draftLine)
          }
        };
      });
    } catch {
      setMessage("商品マスタ紐付けを更新できませんでした。通信状態を確認してください。");
    } finally {
      setPendingProductLineIds((current) => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
    }
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

  function scrollToVoucherRow(voucherId: string) {
    const row = voucherRowRefs.current[voucherId];
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  function openVoucherPreview(voucher: VoucherRecord, shouldLocate = true) {
    setPreviewVoucher(voucher);
    if (!shouldLocate) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => scrollToVoucherRow(voucher.id));
    });
  }

  function toggleVoucherExpanded(voucher: VoucherRecord) {
    const nextExpanded = !expandedVoucherIds[voucher.id];
    setExpandedVoucherIds((current) => ({ ...current, [voucher.id]: nextExpanded }));
    if (nextExpanded && voucher.sourceType === "voucher") {
      openVoucherPreview(voucher);
    }
  }

  async function confirmVoucherAccounting(voucher: VoucherRecord) {
    if (pendingActions[voucher.id]) return;
    setPendingAction(voucher.id, "confirm");
    const draft = normalizeVoucherAccountingDraft(accountingDrafts[voucher.id] ?? buildVoucherAccountingDraft(voucher));
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
          lines: draft.lines.map((line) => {
            const normalizedLine = normalizeAccountingLineTax(line, draft.taxMode);
            return {
              accountTitle: voucher.usageType === "shiire" ? "仕入高" : normalizedLine.accountTitle,
              subAccountTitle: normalizedLine.subAccountTitle,
              amount: normalizedLine.amount,
              taxRate: normalizedLine.taxRate,
              taxMode: draft.taxMode,
              taxAmount: normalizedLine.taxAmount,
              quantity: normalizedLine.quantity,
              unit: normalizedLine.unit,
              unitPrice: normalizedLine.unitPrice,
              ocrItemId: normalizedLine.ocrItemId,
              note: normalizedLine.note
            };
          }),
          vendorName: vendorName || draft.vendorName,
          companyName: draft.companyName,
          brandName: draft.brandName,
          locationName: draft.locationName,
          transactionDate: draft.transactionDate,
          transactionTime: draft.transactionTime,
          receiptTotal: draft.receiptTotal,
          receiptTaxTotal: draft.receiptTaxTotal,
          receiptTaxLines: draft.receiptTaxLines.map((line) => ({
            taxRate: line.taxRate,
            taxAmount: line.taxAmount
          })),
          note: draft.note
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "証憑を登録できませんでした。");
        return;
      }
      setMessage(voucher.usageType === "keihi" ? "経費として登録しました。" : "仕入として確認しました。商品候補にも反映されます。");
      await refreshVoucherViews();
      clearVoucherWorkspaceEntry(voucher.id);
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
      setConfirmedAccountingLines((current) => current.filter((line) => line.voucherId !== voucher.id));
      clearVoucherWorkspaceEntry(voucher.id);
      setMessage("証憑を削除しました。");
    } catch {
      setMessage("証憑を削除できませんでした。通信状態を確認してください。");
    } finally {
      clearPendingAction(voucher.id);
    }
  }

  function downloadTaxAccountantCsv() {
    const params = new URLSearchParams({ export: "tax_accountant_csv" });
    if (exportStartDate) params.set("from", exportStartDate);
    if (exportEndDate) params.set("to", exportEndDate);
    if (selectedStoreId) params.set("storeId", selectedStoreId);
    window.location.href = `/api/vouchers?${params.toString()}`;
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

  function clearVoucherWorkspaceEntry(voucherId: string) {
    setAccountingDrafts((current) => {
      const next = { ...current };
      delete next[voucherId];
      return next;
    });
    setExpandedVoucherIds((current) => {
      const next = { ...current };
      delete next[voucherId];
      return next;
    });
    setPreviewVoucher((current) => current?.id === voucherId ? null : current);
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
            <label className="store-context-selector is-os is-compact">
              <span>証憑の店舗</span>
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

        <section className="panel voucher-export-panel">
          <div className="panel-title">
            <FileText size={22} />
            <div>
              <h3>税理士向けCSV出力</h3>
              <p>確定済みの証憑会計明細を、確認しやすいCSV形式で出力します。</p>
            </div>
          </div>
          <div className="voucher-export-controls">
            <label>
              <span>開始日</span>
              <input type="date" value={exportStartDate} onChange={(event) => setExportStartDate(event.target.value)} />
            </label>
            <label>
              <span>終了日</span>
              <input type="date" value={exportEndDate} onChange={(event) => setExportEndDate(event.target.value)} />
            </label>
            <button className="secondary-button" type="button" onClick={downloadTaxAccountantCsv}>
              <FileText size={16} />
              CSVをダウンロード
            </button>
          </div>
          <div className="voucher-confirmed-lines">
            <div className="voucher-confirmed-lines-head">
              <strong>確定済み明細</strong>
              <span>{isLoadingConfirmedLines ? "読み込み中..." : `${confirmedAccountingLines.length}行`}</span>
            </div>
            {!isLoadingConfirmedLines && !confirmedAccountingLines.length ? (
              <p className="empty-state">選択期間の確定済み明細はありません。</p>
            ) : null}
            {confirmedAccountingLines.length ? (
              <div className="voucher-confirmed-line-list">
                {confirmedAccountingLines.map((line) => {
                  const key = getConfirmedLineKey(line);
                  const summaryDraft = confirmedSummaryDrafts[key] ?? line.note ?? "";
                  const isSavingSummary = Boolean(savingConfirmedSummaryKeys[key]);
                  const isEditingSummary = Boolean(editingConfirmedSummaryKeys[key]);
                  const reconciliationStatus = getConfirmedLineReconciliationStatus(line);
                  const purchaseActualCandidate = getConfirmedLinePurchaseActualCandidate(line);
                  const canCreatePurchaseActual = line.usageType === "shiire" && Boolean(purchaseActualCandidate);
                  const isCreatingPurchaseActual = Boolean(creatingConfirmedPurchaseActualKeys[key]);
                  return (
                  <div className="voucher-confirmed-line-row" key={key}>
                    <div className="voucher-confirmed-line-meta">
                      <strong>{line.purchaseDate || "日付未設定"} {line.purchaseTime}</strong>
                      <span>{line.storeName} / {line.vendorName}</span>
                    </div>
                    <div className="voucher-confirmed-line-account">
                      <strong>{line.accountTitle}{line.subAccountTitle ? ` / ${line.subAccountTitle}` : ""}</strong>
                      <span>{line.taxRate || "税率不明"} / {line.taxMode || "税区分不明"} / 消費税 {formatMoney(line.taxAmount)}</span>
                      {reconciliationStatus ? (
                        <span className={`status-pill ${getReceiptReconciliationTone(reconciliationStatus)}`}>
                          {getReceiptReconciliationLabel(reconciliationStatus)}
                        </span>
                      ) : null}
                    </div>
                    <div className="voucher-confirmed-line-amount">
                      <strong>{formatMoney(line.taxIncludedAmount ?? calculateAccountingTaxIncludedAmount(line.amount, line.taxAmount, line.taxMode))}</strong>
                      <div className={`voucher-confirmed-summary-edit ${isEditingSummary ? "is-editing" : ""}`}>
                        {isEditingSummary ? (
                          <>
                            <input
                              value={summaryDraft}
                              onChange={(event) => setConfirmedSummaryDrafts((current) => ({ ...current, [key]: event.target.value }))}
                              placeholder="摘要"
                              aria-label="摘要"
                              disabled={isSavingSummary}
                            />
                            <button className="secondary-button" type="button" onClick={() => saveConfirmedSummaryNote(line)} disabled={isSavingSummary || summaryDraft.trim() === (line.note ?? "").trim()}>
                              {isSavingSummary ? "保存中" : "保存"}
                            </button>
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => {
                                setConfirmedSummaryDrafts((current) => ({ ...current, [key]: line.note ?? "" }));
                                setEditingConfirmedSummaryKeys((current) => {
                                  const next = { ...current };
                                  delete next[key];
                                  return next;
                                });
                              }}
                              disabled={isSavingSummary}
                            >
                              キャンセル
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="voucher-confirmed-summary-text">{line.note || "摘要なし"}</span>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => {
                                setConfirmedSummaryDrafts((current) => ({ ...current, [key]: line.note ?? "" }));
                                setEditingConfirmedSummaryKeys((current) => ({ ...current, [key]: true }));
                              }}
                            >
                              変更
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => openVoucherPreview(buildPreviewVoucherFromConfirmedLine(line))}
                      disabled={!line.voucherId}
                    >
                      証憑
                    </button>
                    {canCreatePurchaseActual ? (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => createPurchaseActualFromConfirmedLine(line)}
                        disabled={isCreatingPurchaseActual}
                      >
                        {isCreatingPurchaseActual ? "作成中" : "購入実績を作成"}
                      </button>
                    ) : null}
                  </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel voucher-list-panel">
          <div className="panel-title">
            <ReceiptText size={22} />
            <div>
              <h3>証憑一覧</h3>
              <p>OCR結果の発生日・商取引先・金額を確認し、用途と立替状態を管理します。</p>
            </div>
          </div>
          <form
            className="voucher-list-search"
            onSubmit={(event) => {
              event.preventDefault();
              setVoucherSearchTerm(voucherSearchInput.trim());
            }}
          >
            <label>
              <Search size={15} />
              <input
                value={voucherSearchInput}
                onChange={(event) => setVoucherSearchInput(event.target.value)}
                placeholder="商品名・摘要で証憑を検索"
                aria-label="証憑の商品検索"
              />
            </label>
            <label className="voucher-filter-control">
              <span>開始日</span>
              <input
                type="date"
                value={voucherFilterStartDate}
                onChange={(event) => setVoucherFilterStartDate(event.target.value)}
                aria-label="証憑一覧の開始日"
              />
            </label>
            <label className="voucher-filter-control">
              <span>終了日</span>
              <input
                type="date"
                value={voucherFilterEndDate}
                onChange={(event) => setVoucherFilterEndDate(event.target.value)}
                aria-label="証憑一覧の終了日"
              />
            </label>
            <label className="voucher-filter-control">
              <span>状態</span>
              <select
                value={voucherReviewStatusFilter}
                onChange={(event) => setVoucherReviewStatusFilter(event.target.value as VoucherReviewStatusFilter)}
                aria-label="証憑一覧の確認状態"
              >
                <option value="all">すべて</option>
                <option value="unconfirmed">未確認</option>
                <option value="confirmed">確定済み</option>
              </select>
            </label>
            <label className="voucher-filter-control">
              <span>並び順</span>
              <select
                value={voucherDateSort}
                onChange={(event) => setVoucherDateSort(event.target.value as VoucherDateSort)}
                aria-label="証憑一覧の日付並び順"
              >
                <option value="desc">日付が新しい順</option>
                <option value="asc">日付が古い順</option>
              </select>
            </label>
            <button className="secondary-button" type="submit">検索</button>
            {voucherSearchTerm || voucherFilterStartDate || voucherFilterEndDate || voucherReviewStatusFilter !== "all" || voucherDateSort !== "desc" ? (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setVoucherSearchInput("");
                  setVoucherSearchTerm("");
                  setVoucherFilterStartDate("");
                  setVoucherFilterEndDate("");
                  setVoucherReviewStatusFilter("all");
                  setVoucherDateSort("desc");
                }}
              >
                クリア
              </button>
            ) : null}
            <button className="text-button" type="button" onClick={() => setVoucherReviewStatusFilter("unconfirmed")}>
              未確認のみ
            </button>
            <span className="voucher-filter-count">
              {isLoading
                ? "読み込み中..."
                : voucherSearchTerm || voucherFilterStartDate || voucherFilterEndDate || voucherReviewStatusFilter !== "all"
                  ? `検索結果 ${filteredVouchers.length} / ${sortedVouchers.length}件`
                  : `${sortedVouchers.length}件`}
            </span>
          </form>
          {isLoading ? <p className="empty-state">読み込み中...</p> : null}
          {!isLoading && !sortedVouchers.length ? <p className="empty-state">登録済みの証憑はありません。</p> : null}
          {!isLoading && sortedVouchers.length && !filteredVouchers.length ? (
            <p className="empty-state">検索条件に一致する証憑はありません。</p>
          ) : null}
          <div className="voucher-list">
            {filteredVouchers.map((voucher) => {
              const isConfirmed = voucher.status === "confirmed";
              const isPendingReview = voucher.status !== "confirmed" && voucher.status !== "failed";
              const isExpanded = Boolean(expandedVoucherIds[voucher.id]);
              const pendingAction = pendingActions[voucher.id];
              const isVoucherBusy = Boolean(pendingAction);
              const isRecentDuplicate = Boolean(recentDuplicateVoucherIds[voucher.id]);
              const isPreviewSelected = previewVoucher?.id === voucher.id;
              return (
                <article
                  className={`voucher-row ${!isExpanded ? "is-collapsed" : ""} ${isPendingReview && !isExpanded ? "needs-review" : ""} ${isRecentDuplicate ? "is-duplicate-hit" : ""} ${isPreviewSelected ? "is-preview-selected" : ""}`}
                  key={voucher.id}
                  ref={(node) => {
                    voucherRowRefs.current[voucher.id] = node;
                  }}
                >
                  <div className="voucher-row-main">
                    <div className="voucher-row-heading">
                      <span className={`status-pill ${voucher.status === "failed" ? "is-danger" : isConfirmed ? "is-active" : "is-warning"}`}>
                        {voucher.status === "failed" ? "OCR失敗" : isConfirmed ? "確定済み" : "確認待ち"}
                      </span>
                      {isRecentDuplicate ? <span className="voucher-duplicate-alert">重複アップロードあり</span> : null}
                      {isPendingReview && !isExpanded ? <span className="voucher-review-alert">未確認明細あり</span> : null}
                      <strong>{buildVoucherTitle(voucher)}</strong>
                    </div>
                    <p>
                      {voucher.storeName || "店舗未設定"} / {voucher.purchaseDate || "日付未読取"} {voucher.purchaseTime || ""} / {voucher.itemCount}行 / 税 {formatMoney(voucher.tax)}
                    </p>
                    <p className={`voucher-supplier-link ${voucher.linkedSupplierName ? "is-linked" : "is-unlinked"}`}>
                      {voucher.linkedSupplierName
                        ? `発注先: ${voucher.linkedSupplierName}${voucher.linkedSupplierLocationName ? ` / ${voucher.linkedSupplierLocationName}` : ""}`
                        : "発注先未紐付け"}
                    </p>
                    {isPendingReview && !isExpanded ? <p className="voucher-review-note">展開して用途・税率・金額・商品紐付けを確認してください。</p> : null}
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
                  <button
                    className={`voucher-expand-button ${isExpanded ? "is-open" : ""} ${isPendingReview && !isExpanded ? "needs-review" : ""}`}
                    type="button"
                    onClick={() => toggleVoucherExpanded(voucher)}
                    aria-expanded={isExpanded}
                  >
                    <ChevronDown size={16} />
                    {isExpanded ? "閉じる" : isPendingReview ? "明細を確認" : "詳細"}
                  </button>
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
                        <button className="text-button voucher-preview-open" type="button" onClick={() => openVoucherPreview(voucher)}>証憑を見る</button>
                        <a className="text-button voucher-preview-link" href={buildVoucherPreviewUrl(voucher)} target="_blank" rel="noreferrer">証憑を見る</a>
                        {voucher.canDelete ? (
                          <button className="danger-button" type="button" onClick={() => void deleteVoucher(voucher)} disabled={isVoucherBusy}>
                            {pendingAction === "delete" ? "削除中..." : "削除"}
                          </button>
                        ) : null}
                      </div>
                      {voucher.sourceType === "voucher" && voucher.status !== "confirmed" && voucher.status !== "failed" ? (
                        (() => {
                          const normalizedDraft = normalizeVoucherAccountingDraft(accountingDrafts[voucher.id] ?? buildVoucherAccountingDraft(voucher));
                          return (
                            <VoucherAccountingEditor
                              voucher={voucher}
                              draft={normalizedDraft}
                              validation={validateVoucherAccounting(voucher, normalizedDraft)}
                              isSaving={pendingAction === "confirm"}
                              onDraftChange={(next) => updateAccountingDraft(voucher.id, next)}
                              onLineChange={(lineId, next) => updateAccountingLine(voucher.id, lineId, next)}
                              onReceiptTaxLinesChange={(taxLines) => updateAccountingDraftTaxLines(voucher.id, taxLines)}
                              onAddLine={() => addAccountingLine(voucher.id)}
                              onInsertLine={(lineId, position) => addAccountingLine(voucher.id, { lineId, position })}
                              onRemoveLine={(lineId) => removeAccountingLine(voucher.id, lineId)}
                              productOptions={productOptions}
                              lineProductSelections={lineProductSelections}
                              lineProductCategorySelections={lineProductCategorySelections}
                              lineProductSubcategorySelections={lineProductSubcategorySelections}
                              pendingProductLineIds={pendingProductLineIds}
                              onProductSelectionChange={(lineId, productId) => setLineProductSelections((current) => ({ ...current, [lineId]: productId }))}
                              onProductCategoryChange={(lineId, category) => {
                                setLineProductCategorySelections((current) => ({ ...current, [lineId]: category }));
                                setLineProductSubcategorySelections((current) => ({ ...current, [lineId]: "" }));
                                setLineProductSelections((current) => ({ ...current, [lineId]: "" }));
                              }}
                              onProductSubcategoryChange={(lineId, subcategory) => {
                                setLineProductSubcategorySelections((current) => ({ ...current, [lineId]: subcategory }));
                                setLineProductSelections((current) => ({ ...current, [lineId]: "" }));
                              }}
                              onBindProduct={(line) => void bindAccountingLineProduct(voucher, line)}
                              onCreateProduct={(line) => void createProductFromAccountingLine(voucher, line)}
                              onIgnoreProduct={(line, ignored) => void ignoreAccountingLineProduct(voucher, line, ignored)}
                              onCreatePurchaseActual={(line) => void createPurchaseActualFromReceiptLine(voucher, line)}
                              onConfirm={() => void confirmVoucherAccounting(voucher)}
                            />
                          );
                        })()
                      ) : null}
                      {voucher.accountingLines?.length ? (
                        <VoucherAccountingSummary lines={voucher.accountingLines} />
                      ) : null}
                      {isConfirmed && voucher.sourceType === "voucher" && voucher.accountingLines?.length ? (
                        <ConfirmedVoucherDetailEditor
                          voucher={voucher}
                          details={voucher.accountingLines.map((line, index) => buildConfirmedDetailFromAccountingLine(line, index))}
                          savingLineKeys={savingConfirmedLineKeys}
                          isSavingBasic={Boolean(savingConfirmedBasicIds[voucher.id])}
                          getDraft={(detail) => getConfirmedLineDraft(voucher, detail)}
                          onLineChange={(detail, next) => updateConfirmedLineDraft(voucher, detail, next)}
                          onSaveBasic={(basicDraft) => void saveConfirmedVoucherBasic(voucher, basicDraft)}
                          onSave={(detail, basicDraft) => void saveConfirmedLineDetail(voucher, detail, basicDraft)}
                          productOptions={productOptions}
                          lineProductSelections={lineProductSelections}
                          lineProductCategorySelections={lineProductCategorySelections}
                          lineProductSubcategorySelections={lineProductSubcategorySelections}
                          pendingProductLineIds={pendingProductLineIds}
                          onProductSelectionChange={(lineId, productId) => setLineProductSelections((current) => ({ ...current, [lineId]: productId }))}
                          onProductCategoryChange={(lineId, category) => {
                            setLineProductCategorySelections((current) => ({ ...current, [lineId]: category }));
                            setLineProductSubcategorySelections((current) => ({ ...current, [lineId]: "" }));
                            setLineProductSelections((current) => ({ ...current, [lineId]: "" }));
                          }}
                          onProductSubcategoryChange={(lineId, subcategory) => {
                            setLineProductSubcategorySelections((current) => ({ ...current, [lineId]: subcategory }));
                            setLineProductSelections((current) => ({ ...current, [lineId]: "" }));
                          }}
                          onBindProduct={(line) => void bindAccountingLineProduct(voucher, line)}
                          onCreateProduct={(line) => void createProductFromAccountingLine(voucher, line)}
                          onCreatePurchaseActual={(line) => void createPurchaseActualFromReceiptLine(voucher, line)}
                        />
                      ) : null}
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </section>
      {previewVoucher ? (
        <VoucherPreviewPanel
          voucher={previewVoucher}
          onLocate={() => scrollToVoucherRow(previewVoucher.id)}
          onClose={() => setPreviewVoucher(null)}
        />
      ) : null}
      {referencePriceDialog ? (
        <ProductReferencePriceDialogView
          dialog={referencePriceDialog}
          isPending={Boolean(pendingProductLineIds[referencePriceDialog.line.id])}
          onCancel={() => setReferencePriceDialog(null)}
          onConfirm={(updateReferencePrice) => void confirmAccountingLineProductBinding(updateReferencePrice)}
        />
      ) : null}
      {createProductDialog ? (
        <ProductCreateDialogView
          dialog={createProductDialog}
          productOptions={productOptions}
          isPending={Boolean(pendingProductLineIds[createProductDialog.line.id])}
          onCancel={() => setCreateProductDialog(null)}
          onConfirm={(next) => void confirmCreateProductFromAccountingLine(next)}
        />
      ) : null}
    </main>
  );
}

function buildVoucherTitle(voucher: VoucherRecord) {
  return buildVendorNameFromParts(voucher.companyName, voucher.brandName, voucher.locationName, voucher.vendorName) || voucher.uploadedFileName || "証憑";
}

function buildVendorNameFromParts(companyName: string, brandName: string, locationName: string, fallback = "") {
  return [brandName || companyName, locationName]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ") || fallback.trim();
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function VoucherUploadProgressView({ progress }: { progress: VoucherUploadProgress }) {
  const completedUnits = progress.completed + Math.max(0, Math.min(0.99, progress.currentProgress ?? 0));
  const percentage = progress.total > 0 ? Math.round(Math.min(completedUnits / progress.total, 1) * 100) : 0;
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
      <div className="voucher-upload-progress-notice">
        <strong>処理中です</strong>
        <span>完了するまでこのページを離れないでください。</span>
      </div>
    </div>
  );
}

function ProductReferencePriceDialogView({
  dialog,
  isPending,
  onCancel,
  onConfirm
}: {
  dialog: ProductReferencePriceDialog;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (updateReferencePrice: boolean) => void;
}) {
  const currentReferencePrice = Number(dialog.product.referencePrice ?? 0);
  const hasReferencePrice = Number.isFinite(currentReferencePrice) && currentReferencePrice > 0;
  const difference = hasReferencePrice ? Math.round(dialog.receiptUnitPrice - currentReferencePrice) : 0;
  const differenceRate = hasReferencePrice && currentReferencePrice > 0
    ? Math.round((dialog.receiptUnitPrice - currentReferencePrice) / currentReferencePrice * 1000) / 10
    : 0;

  return (
    <div className="voucher-reference-price-backdrop" role="presentation">
      <section className="voucher-reference-price-dialog" role="dialog" aria-modal="true" aria-labelledby="voucher-reference-price-title">
        <div className="voucher-reference-price-head">
          <div>
            <span>商品マスタ紐付け</span>
            <h3 id="voucher-reference-price-title">参考価格を更新しますか？</h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="閉じる" disabled={isPending}>
            <X size={18} />
          </button>
        </div>
        <div className="voucher-reference-price-product">
          <strong>{dialog.product.name}</strong>
          <span>{getProductCategory(dialog.product)} / {getProductSubcategory(dialog.product)} / {dialog.product.unit}</span>
        </div>
        <div className="voucher-reference-price-grid">
          <div>
            <span>現在の参考価格</span>
            <strong>{hasReferencePrice ? formatMoney(currentReferencePrice) : "未設定"}</strong>
          </div>
          <div>
            <span>今回の税込単価</span>
            <strong>{formatMoney(dialog.receiptUnitPrice)}</strong>
          </div>
          <div>
            <span>差額</span>
            <strong>{hasReferencePrice ? `${formatMoney(difference)} / ${differenceRate > 0 ? "+" : ""}${differenceRate}%` : "-"}</strong>
          </div>
        </div>
        <p>
          {hasReferencePrice
            ? "商品主表の参考価格は自動では上書きしません。今回の税込単価を新しい参考価格にする場合だけ更新してください。"
            : "この商品は参考価格が未設定です。今回の税込単価を参考価格として設定できます。"}
        </p>
        <div className="voucher-reference-price-actions">
          <button className="secondary-button" type="button" onClick={() => onConfirm(false)} disabled={isPending}>
            紐付けのみ
          </button>
          <button className="primary-button" type="button" onClick={() => onConfirm(true)} disabled={isPending}>
            紐付けて参考価格を更新
          </button>
          <button className="text-button" type="button" onClick={onCancel} disabled={isPending}>
            キャンセル
          </button>
        </div>
      </section>
    </div>
  );
}

function normalizeProductCreateDraft(dialog: ProductCreateDialog, productOptions: ProductOption[]): ProductCreateDialog {
  const categoryOptions = getProductCategoryOptions(productOptions);
  const category = categoryOptions.includes(dialog.category) ? dialog.category : categoryOptions[0] ?? "";
  const subcategoryOptions = getProductSubcategoryOptions(productOptions, category);
  const subcategory = subcategoryOptions.includes(dialog.subcategory) ? dialog.subcategory : subcategoryOptions[0] ?? "";
  return { ...dialog, category, subcategory };
}

function ProductCreateDialogView({
  dialog,
  productOptions,
  isPending,
  onCancel,
  onConfirm
}: {
  dialog: ProductCreateDialog;
  productOptions: ProductOption[];
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (next: ProductCreateDialog) => void;
}) {
  const [draft, setDraft] = useState<ProductCreateDialog>(() => normalizeProductCreateDraft(dialog, productOptions));
  const categoryOptions = getProductCategoryOptions(productOptions);
  const subcategoryOptions = getProductSubcategoryOptions(productOptions, draft.category);

  useEffect(() => {
    setDraft(normalizeProductCreateDraft(dialog, productOptions));
  }, [dialog, productOptions]);

  return (
    <div className="voucher-reference-price-backdrop" role="presentation">
      <section className="voucher-reference-price-dialog voucher-product-create-dialog" role="dialog" aria-modal="true" aria-labelledby="voucher-product-create-title">
        <div className="voucher-reference-price-head">
          <div>
            <span>商品マスタ新規追加</span>
            <h3 id="voucher-product-create-title">商品情報を確認してください</h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="閉じる" disabled={isPending}>
            <X size={18} />
          </button>
        </div>
        <p>レシート明細から商品を作成します。商品主表に残す基本情報を確認してから追加してください。</p>
        <div className="voucher-product-create-form">
          <label>
            <span>商品名</span>
            <input value={draft.productName} onChange={(event) => setDraft((current) => ({ ...current, productName: event.target.value }))} disabled={isPending} />
          </label>
          <label>
            <span>大分類</span>
            <select
              value={draft.category}
              onChange={(event) => {
                const nextCategory = event.target.value;
                const nextSubcategories = getProductSubcategoryOptions(productOptions, nextCategory);
                setDraft((current) => ({
                  ...current,
                  category: nextCategory,
                  subcategory: nextSubcategories[0] ?? ""
                }));
              }}
              disabled={isPending || !categoryOptions.length}
            >
              <option value="">大分類を選択</option>
              {categoryOptions.map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
          </label>
          <label>
            <span>小分類</span>
            <select
              value={draft.subcategory}
              onChange={(event) => setDraft((current) => ({ ...current, subcategory: event.target.value }))}
              disabled={isPending || !draft.category || !subcategoryOptions.length}
            >
              <option value="">小分類を選択</option>
              {subcategoryOptions.map((subcategory) => <option value={subcategory} key={subcategory}>{subcategory}</option>)}
            </select>
          </label>
          <label>
            <span>単位</span>
            <input value={draft.unit} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} disabled={isPending} />
          </label>
          <label>
            <span>参考価格（税込）</span>
            <input type="number" min="0" step="0.01" value={draft.referencePrice} onChange={(event) => setDraft((current) => ({ ...current, referencePrice: Number(event.target.value) }))} disabled={isPending} />
          </label>
        </div>
        <div className="voucher-reference-price-grid">
          <div>
            <span>レシート金額</span>
            <strong>{formatMoney(Number(dialog.line.amount || 0))}</strong>
          </div>
          <div>
            <span>数量</span>
            <strong>{dialog.line.quantity || "-"} {dialog.line.unit}</strong>
          </div>
          <div>
            <span>今回の税込単価</span>
            <strong>{formatMoney(calculateTaxIncludedUnitPrice(dialog.line))}</strong>
          </div>
        </div>
        <div className="voucher-reference-price-actions">
          <button className="primary-button" type="button" onClick={() => onConfirm(draft)} disabled={isPending}>
            商品を追加して紐付け
          </button>
          <button className="text-button" type="button" onClick={onCancel} disabled={isPending}>
            キャンセル
          </button>
        </div>
      </section>
    </div>
  );
}

function buildPreviewVoucherFromConfirmedLine(line: ConfirmedAccountingLine): VoucherRecord {
  return {
    id: line.voucherId,
    sourceType: "voucher",
    storeId: "",
    storeName: line.storeName,
    receiptPhotoUrl: "",
    uploadedFileName: "",
    usageType: line.usageType === "keihi" ? "keihi" : line.usageType === "shiire" ? "shiire" : "unclassified",
    paymentType: line.paymentType === "reimbursement" ? "reimbursement" : "company",
    reimbursementStatus: line.reimbursementStatus === "pending" || line.reimbursementStatus === "paid" || line.reimbursementStatus === "rejected" ? line.reimbursementStatus : "none",
    status: "confirmed",
    vendorName: line.vendorName,
    companyName: "",
    brandName: line.vendorName,
    locationName: "",
    linkedSupplierName: "",
    linkedSupplierLocationName: "",
    supplierMatchStatus: "unmatched",
    purchaseDate: line.purchaseDate,
    purchaseTime: line.purchaseTime,
    total: Math.round(Number(line.taxIncludedAmount ?? calculateAccountingTaxIncludedAmount(line.amount, line.taxAmount, line.taxMode) ?? 0)),
    tax: Math.round(Number(line.taxAmount ?? 0)),
    accountingLines: [],
    receiptTaxLines: [],
    itemCount: Number(line.lineCount ?? 0),
    createdByName: "",
    createdLabel: "",
    canDelete: false,
    items: []
  };
}

function VoucherPreviewPanel({ voucher, onLocate, onClose }: { voucher: VoucherRecord; onLocate: () => void; onClose: () => void }) {
  useModalHistory(true, onClose, "vouchers-preview");

  const title = buildVoucherTitle(voucher);
  const previewUrl = buildVoucherPreviewUrl(voucher);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  const gestureStartZoomRef = useRef(1);
  const touchDistanceRef = useRef(0);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewMeta, setPreviewMeta] = useState({
    loading: true,
    error: "",
    contentType: "",
    kind: "",
    objectUrl: ""
  });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setPreviewMeta({ loading: true, error: "", contentType: "", kind: "", objectUrl: "" });
    fetch(previewUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("証憑ファイルが見つかりません。アップロード元のファイル情報を確認してください。");
          }
          const message = await response.text();
          if (response.status === 404) {
            throw new Error("証憑ファイルが見つかりません。アップロード元のファイル情報を確認してください。");
          }
          throw new Error(message || `HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        return {
          buffer,
          contentType: inferVoucherPreviewContentType(
            new Uint8Array(buffer.slice(0, 16)),
            response.headers.get("content-type") ?? "",
            voucher.uploadedFileName
          )
        };
      })
      .then(async ({ buffer, contentType }) => {
        if (cancelled) return;
        if (contentType === "application/pdf") {
          const pdfImageUrl = await renderVoucherPdfFirstPage(buffer);
          if (cancelled) return;
          setPreviewMeta({
            loading: false,
            error: "",
            contentType,
            kind: "image",
            objectUrl: pdfImageUrl
          });
          return;
        }

        const blob = new Blob([buffer], { type: contentType || "application/octet-stream" });
        objectUrl = URL.createObjectURL(blob);
        setPreviewMeta({
          loading: false,
          error: "",
          contentType,
          kind: contentType.startsWith("image/") ? "image" : "document",
          objectUrl
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewMeta({
          loading: false,
          error: error instanceof Error ? error.message : "証憑を読み込めませんでした。",
          contentType: "",
          kind: "",
          objectUrl: ""
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewUrl, voucher.uploadedFileName]);

  useEffect(() => {
    setPreviewZoom(1);
  }, [previewUrl]);

  useEffect(() => {
    const node = previewBodyRef.current;
    if (!node) return;

    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartZoomRef.current = previewZoom;
    };
    const handleGestureChange = (event: Event) => {
      const gestureEvent = event as Event & { scale?: number };
      if (!gestureEvent.scale) return;
      event.preventDefault();
      setPreviewZoom(clampVoucherPreviewZoom(gestureStartZoomRef.current * gestureEvent.scale));
    };

    node.addEventListener("gesturestart", handleGestureStart);
    node.addEventListener("gesturechange", handleGestureChange);
    return () => {
      node.removeEventListener("gesturestart", handleGestureStart);
      node.removeEventListener("gesturechange", handleGestureChange);
    };
  }, [previewZoom]);

  const handlePreviewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setPreviewZoom((current) => clampVoucherPreviewZoom(current + direction * 0.14));
  };

  const handlePreviewTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    touchDistanceRef.current = getTouchDistance(event.touches);
    gestureStartZoomRef.current = previewZoom;
  };

  const handlePreviewTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || touchDistanceRef.current <= 0) return;
    event.preventDefault();
    const distance = getTouchDistance(event.touches);
    setPreviewZoom(clampVoucherPreviewZoom(gestureStartZoomRef.current * (distance / touchDistanceRef.current)));
  };

  const handlePreviewTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) touchDistanceRef.current = 0;
  };

  const previewSurfaceStyle = { width: `${previewZoom * 100}%` };
  const canOpenPreviewObject = !previewMeta.loading && !previewMeta.error && Boolean(previewMeta.objectUrl);

  return (
    <aside className="voucher-preview-panel" aria-label="証憑プレビュー">
      <div className="voucher-preview-panel-head">
        <div>
          <span>証憑プレビュー</span>
          <strong>{title}</strong>
        </div>
        <button className="voucher-preview-locate-button" type="button" onClick={onLocate}>
          明細へ戻る
        </button>
        {canOpenPreviewObject ? (
          <a className="voucher-preview-open-link" href={previewUrl} target="_blank" rel="noreferrer">開く</a>
        ) : null}
        <button type="button" onClick={onClose} aria-label="プレビューを閉じる">
          <X size={18} />
        </button>
      </div>
      <div
        ref={previewBodyRef}
        className="voucher-preview-panel-body"
        onWheel={handlePreviewWheel}
        onTouchStart={handlePreviewTouchStart}
        onTouchMove={handlePreviewTouchMove}
        onTouchEnd={handlePreviewTouchEnd}
      >
        {previewMeta.loading ? (
          <div className="voucher-preview-status">読み込み中...</div>
        ) : previewMeta.error ? (
          <div className="voucher-preview-status is-error">
            <strong>証憑を読み込めません</strong>
            <span>{previewMeta.error}</span>
          </div>
        ) : previewMeta.kind === "image" ? (
          <img src={previewMeta.objectUrl} alt={title} style={previewSurfaceStyle} />
        ) : (
          <iframe src={previewMeta.objectUrl} title={title} style={previewSurfaceStyle} />
        )}
      </div>
    </aside>
  );
}

function buildVoucherPreviewUrl(voucher: VoucherRecord) {
  return `/api/vouchers/${encodeURIComponent(voucher.id)}/preview`;
}

function clampVoucherPreviewZoom(value: number) {
  return Math.min(4, Math.max(0.6, value));
}

function getTouchDistance(touches: React.TouchList) {
  const first = touches.item(0);
  const second = touches.item(1);
  if (!first || !second) return 0;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function readVoucherWorkspaceSnapshot(): VoucherWorkspaceSnapshot | null {
  try {
    cleanupLegacyVoucherWorkspaceSnapshots();
    const raw = window.sessionStorage.getItem(voucherWorkspaceStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VoucherWorkspaceSnapshot>;
    const savedAt = Number(parsed.savedAt || 0);
    if (!savedAt || Date.now() - savedAt > voucherWorkspaceSnapshotMaxAgeMs) {
      window.sessionStorage.removeItem(voucherWorkspaceStorageKey);
      return null;
    }
    return {
      selectedStoreId: typeof parsed.selectedStoreId === "string" ? parsed.selectedStoreId : "",
      usageType: isVoucherUsageType(parsed.usageType) ? parsed.usageType : "unclassified",
      paymentType: isVoucherPaymentType(parsed.paymentType) ? parsed.paymentType : "company",
      exportStartDate: typeof parsed.exportStartDate === "string" ? parsed.exportStartDate : getCurrentMonthStartDate(),
      exportEndDate: typeof parsed.exportEndDate === "string" ? parsed.exportEndDate : getCurrentDate(),
      accountingDrafts: isPlainRecord(parsed.accountingDrafts) ? parsed.accountingDrafts as Record<string, VoucherAccountingDraft> : {},
      expandedVoucherIds: isPlainRecord(parsed.expandedVoucherIds) ? parsed.expandedVoucherIds as Record<string, boolean> : {},
      previewVoucherId: typeof parsed.previewVoucherId === "string" ? parsed.previewVoucherId : "",
      lineProductSelections: isPlainRecord(parsed.lineProductSelections) ? parsed.lineProductSelections as Record<string, string> : {},
      lineProductCategorySelections: isPlainRecord(parsed.lineProductCategorySelections) ? parsed.lineProductCategorySelections as Record<string, string> : {},
      lineProductSubcategorySelections: isPlainRecord(parsed.lineProductSubcategorySelections) ? parsed.lineProductSubcategorySelections as Record<string, string> : {},
      savedAt
    };
  } catch {
    try {
      window.sessionStorage.removeItem(voucherWorkspaceStorageKey);
    } catch {
      // Ignore storage cleanup failures.
    }
    return null;
  }
}

function writeVoucherWorkspaceSnapshot(snapshot: VoucherWorkspaceSnapshot) {
  try {
    window.sessionStorage.setItem(voucherWorkspaceStorageKey, JSON.stringify(snapshot));
  } catch {
    // Storage quota or private mode should not break the voucher workflow.
  }
}

function cleanupLegacyVoucherWorkspaceSnapshots() {
  try {
    for (const key of legacyVoucherWorkspaceStorageKeys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}

function filterVoucherRecord<T>(record: Record<string, T>, validVoucherIds: Set<string>) {
  return Object.fromEntries(Object.entries(record).filter(([voucherId]) => validVoucherIds.has(voucherId))) as Record<string, T>;
}

function isVoucherUsageType(value: unknown): value is VoucherUsageType {
  return value === "unclassified" || value === "shiire" || value === "keihi";
}

function isVoucherPaymentType(value: unknown): value is VoucherPaymentType {
  return value === "company" || value === "reimbursement";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferVoucherPreviewContentType(bytes: Uint8Array, contentType: string, filename: string) {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  const normalized = contentType.toLowerCase();
  if (normalized.startsWith("image/") || normalized === "application/pdf") return normalized;
  if (/\.(gif)$/i.test(filename)) return "image/gif";
  if (/\.(jpe?g)$/i.test(filename)) return "image/jpeg";
  if (/\.(png)$/i.test(filename)) return "image/png";
  if (/\.(webp)$/i.test(filename)) return "image/webp";
  if (/\.(pdf)$/i.test(filename)) return "application/pdf";
  return normalized;
}

async function renderVoucherPdfFirstPage(buffer: ArrayBuffer) {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  pdf.destroy();
  return canvas.toDataURL("image/png");
}

function VoucherAccountingEditor({
  voucher,
  draft,
  validation,
  isSaving,
  onDraftChange,
  onLineChange,
  onReceiptTaxLinesChange,
  onAddLine,
  onInsertLine,
  onRemoveLine,
  productOptions,
  lineProductSelections,
  lineProductCategorySelections,
  lineProductSubcategorySelections,
  pendingProductLineIds,
  onProductSelectionChange,
  onProductCategoryChange,
  onProductSubcategoryChange,
  onBindProduct,
  onCreateProduct,
  onIgnoreProduct,
  onCreatePurchaseActual,
  onConfirm
}: {
  voucher: VoucherRecord;
  draft: VoucherAccountingDraft;
  validation: VoucherAccountingValidation;
  isSaving: boolean;
  onDraftChange: (next: Partial<VoucherAccountingDraft>) => void;
  onLineChange: (lineId: string, next: Partial<VoucherAccountingLine>) => void;
  onReceiptTaxLinesChange: (taxLines: ReceiptTaxLine[]) => void;
  onAddLine: () => void;
  onInsertLine: (lineId: string, position: "before" | "after") => void;
  onRemoveLine: (lineId: string) => void;
  productOptions: ProductOption[];
  lineProductSelections: Record<string, string>;
  lineProductCategorySelections: Record<string, string>;
  lineProductSubcategorySelections: Record<string, string>;
  pendingProductLineIds: Record<string, boolean>;
  onProductSelectionChange: (lineId: string, productId: string) => void;
  onProductCategoryChange: (lineId: string, category: string) => void;
  onProductSubcategoryChange: (lineId: string, subcategory: string) => void;
  onBindProduct: (line: VoucherAccountingLine) => void;
  onCreateProduct: (line: VoucherAccountingLine) => void;
  onIgnoreProduct: (line: VoucherAccountingLine, ignored: boolean) => void;
  onCreatePurchaseActual: (line: VoucherAccountingLine) => void;
  onConfirm: () => void;
}) {
  const isShiire = voucher.usageType === "shiire";
  const productCategoryOptions = getProductCategoryOptions(productOptions);
  const [expandedLineIds, setExpandedLineIds] = useState<Record<string, boolean>>({});
  const allLinesConfirmed = draft.lines.length > 0 && draft.lines.every((line) => line.confirmed);
  function toggleLineExpanded(lineId: string) {
    setExpandedLineIds((current) => ({ ...current, [lineId]: !current[lineId] }));
  }
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
      <label>
        <span>レシート総額</span>
        <input type="number" min="0" step="1" value={draft.receiptTotal} onChange={(event) => onDraftChange({ receiptTotal: event.target.value })} disabled={isSaving} />
      </label>
      <ReceiptTaxLinesEditor taxLines={draft.receiptTaxLines} disabled={isSaving} onChange={onReceiptTaxLinesChange} />
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
        {draft.lines.map((line) => {
          const {
            suggestedProduct,
            selectedProductId,
            selectedCategory,
            selectedSubcategory
          } = getEffectiveProductBindingState({
            lineId: line.id,
            line,
            productOptions,
            lineProductSelections,
            lineProductCategorySelections,
            lineProductSubcategorySelections
          });
          const productSubcategoryOptions = getProductSubcategoryOptions(productOptions, selectedCategory);
          const filteredProductOptions = getFilteredProductOptions(productOptions, selectedCategory, selectedSubcategory);
          const isProductPending = Boolean(pendingProductLineIds[line.id]);
          const isProductIgnored = line.matchStatus === "ignored";
          const isReceiptReconciled = line.reconciliationStatus === "auto_matched" || line.reconciliationStatus === "manual_matched";
          const isLineExpanded = Boolean(expandedLineIds[line.id]);
          const lineTitle = line.note || line.subAccountTitle || `明細 ${draft.lines.indexOf(line) + 1}`;
          const quantityLabel = line.quantity ? `${line.quantity}${line.unit ? ` ${line.unit}` : ""}` : "数量未確認";
          return (
          <div className={`receipt-expense-line ${line.confirmed ? "is-confirmed" : "needs-confirmation"} ${isLineExpanded ? "is-open" : ""}`} key={line.id}>
            <div className="receipt-expense-line-head">
              <button className="receipt-expense-line-summary" type="button" onClick={() => toggleLineExpanded(line.id)} aria-expanded={isLineExpanded}>
                <ChevronDown size={16} />
                <strong>{lineTitle}</strong>
                <span>{formatMoney(Number(line.amount || 0))}</span>
                <span>{line.taxRate || "税率未確認"} / {line.taxMode}</span>
                <span>{quantityLabel}</span>
                {isShiire ? (
                  <span>{isProductIgnored ? "商品マスタ対象外" : line.matchedProductName ? `紐付済み: ${line.matchedProductName}` : suggestedProduct ? `提案: ${suggestedProduct.name}` : "商品未確認"}</span>
                ) : null}
              </button>
              <button className="receipt-line-confirm-check" type="button" onClick={() => onLineChange(line.id, { confirmed: !line.confirmed })} disabled={isSaving} aria-pressed={line.confirmed}>
                <span>{line.confirmed ? "確認済み" : "未確認"}</span>
              </button>
            </div>
            <div className="receipt-expense-line-body">
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
              <button className="text-button danger-button receipt-line-delete-button" type="button" onClick={() => onRemoveLine(line.id)} disabled={isSaving || draft.lines.length <= 1}>
                <Trash2 size={16} />
                削除
              </button>
              <div className="receipt-line-insert-actions">
                <button className="text-button" type="button" onClick={() => onInsertLine(line.id, "before")} disabled={isSaving}>
                  <Plus size={14} />
                  上に追加
                </button>
                <button className="text-button" type="button" onClick={() => onInsertLine(line.id, "after")} disabled={isSaving}>
                  <Plus size={14} />
                  下に追加
                </button>
              </div>
              <label>
                <span>数量</span>
                <input type="number" min="0" step="1" value={line.quantity} onChange={(event) => onLineChange(line.id, { quantity: event.target.value })} disabled={isSaving} />
              </label>
              <label>
                <span>単位</span>
                <input value={line.unit} onChange={(event) => onLineChange(line.id, { unit: event.target.value })} placeholder="例: 個、袋、本" disabled={isSaving} />
              </label>
              <label>
                <span>単価</span>
                <input type="number" min="0" step="1" value={line.unitPrice} onChange={(event) => onLineChange(line.id, { unitPrice: event.target.value })} disabled={isSaving} />
              </label>
              {isShiire ? (
                <div className="voucher-product-binding">
                  <label>
                    <span>大分類</span>
                    <select value={selectedCategory} onChange={(event) => onProductCategoryChange(line.id, event.target.value)} disabled={isSaving || isProductPending || isProductIgnored}>
                      <option value="">大分類を選択</option>
                      {productCategoryOptions.map((category) => (
                        <option value={category} key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>小分類</span>
                    <select value={selectedSubcategory} onChange={(event) => onProductSubcategoryChange(line.id, event.target.value)} disabled={isSaving || isProductPending || isProductIgnored || !selectedCategory}>
                      <option value="">小分類を選択</option>
                      {productSubcategoryOptions.map((subcategory) => (
                        <option value={subcategory} key={subcategory}>{subcategory}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>商品</span>
                    <select value={selectedProductId} onChange={(event) => onProductSelectionChange(line.id, event.target.value)} disabled={isSaving || isProductPending || isProductIgnored || !selectedCategory || !selectedSubcategory}>
                      <option value="">候補を選択</option>
                      {filteredProductOptions.map((product) => (
                        <option value={product.id} key={product.id}>{formatProductOptionLabel(product)}</option>
                      ))}
                    </select>
                  </label>
                  <div className="voucher-product-binding-actions">
                    {isProductIgnored ? <small>商品マスタ対象外</small> : line.matchedProductName ? <small>紐付済み: {line.matchedProductName}</small> : suggestedProduct ? <small>提案: {suggestedProduct.name}</small> : <small>一致候補なし</small>}
                    <span className={`status-pill ${getReceiptReconciliationTone(line.reconciliationStatus)}`}>
                      {getReceiptReconciliationLabel(line.reconciliationStatus)}
                    </span>
                    <button className="text-button" type="button" onClick={() => onIgnoreProduct(line, !isProductIgnored)} disabled={isSaving || isProductPending || !line.note.trim()}>
                      {isProductIgnored ? "対象に戻す" : "商品マスタ対象外"}
                    </button>
                    <button className="secondary-button" type="button" onClick={() => onBindProduct(line)} disabled={isSaving || isProductPending || isProductIgnored || !line.note.trim() || !selectedProductId}>
                      <Link2 size={15} />
                      紐付け
                    </button>
                    <button className="primary-button" type="button" onClick={() => onCreateProduct(line)} disabled={isSaving || isProductPending || isProductIgnored || !line.note.trim()}>
                      <CheckCircle size={15} />
                      新規追加
                    </button>
                    <button className="secondary-button" type="button" onClick={() => onCreatePurchaseActual(line)} disabled={isSaving || isProductPending || isProductIgnored || isReceiptReconciled || !line.ocrItemId || !line.matchedProductId}>
                      <PackageCheck size={15} />
                      購入実績を作成
                    </button>
                    {line.reconciliationNote ? <small>{line.reconciliationNote}</small> : null}
                  </div>
                </div>
              ) : null}
              </div>
          </div>
          );
        })}
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
              差額 {formatMoney(validation.difference)}。2円以内の丸め差は許容されます。税区分・税率・金額、またはレシート総額を確認してください。
            </small>
          ) : null}
          {!allLinesConfirmed ? (
            <small>未確認の明細が {draft.lines.filter((line) => !line.confirmed).length} 行あります。各明細を展開して確認済みにしてください。</small>
          ) : null}
        </div>
      </div>
      <button className="primary-button" type="button" onClick={onConfirm} disabled={isSaving || voucher.usageType === "unclassified" || !allLinesConfirmed}>
        {isSaving ? "登録中..." : voucher.usageType === "unclassified" ? "用途を選択してください" : !allLinesConfirmed ? "明細を確認してください" : voucher.usageType === "keihi" ? "この内容で経費登録" : "この内容で仕入確認"}
      </button>
    </div>
  );
}

function ReceiptTaxLinesEditor({
  taxLines,
  disabled,
  onChange
}: {
  taxLines: ReceiptTaxLine[];
  disabled: boolean;
  onChange: (taxLines: ReceiptTaxLine[]) => void;
}) {
  const normalizedTaxLines = normalizeReceiptTaxLines(taxLines, [], "0");
  function updateLine(lineId: string, next: Partial<ReceiptTaxLine>) {
    onChange(normalizedTaxLines.map((line) => line.id === lineId ? { ...line, ...next } : line));
  }
  function addLine() {
    onChange([
      ...normalizedTaxLines,
      { id: `receipt-tax-${Date.now()}`, taxRate: "10%", taxAmount: "0" }
    ]);
  }
  function removeLine(lineId: string) {
    if (normalizedTaxLines.length <= 1) return;
    onChange(normalizedTaxLines.filter((line) => line.id !== lineId));
  }
  return (
    <div className="receipt-tax-lines-field">
      <span>レシート税率・消費税</span>
      <div className="receipt-tax-lines">
        {normalizedTaxLines.map((line) => (
          <div className="receipt-tax-line" key={line.id}>
            <select aria-label="レシート税率" value={line.taxRate} onChange={(event) => updateLine(line.id, { taxRate: event.target.value })} disabled={disabled}>
              {taxRateOptions.filter(Boolean).map((option) => <option value={option} key={option}>{option}</option>)}
            </select>
            <input aria-label="レシート消費税" type="text" inputMode="decimal" value={line.taxAmount} onChange={(event) => updateLine(line.id, { taxAmount: normalizeMoneyInputText(event.target.value) })} disabled={disabled} />
            <button className="icon-button" type="button" onClick={() => removeLine(line.id)} disabled={disabled || normalizedTaxLines.length <= 1} aria-label="税率行を削除">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button className="text-button receipt-tax-line-add" type="button" onClick={addLine} disabled={disabled}>
        <Plus size={14} />
        税率行を追加
      </button>
    </div>
  );
}

function buildVoucherAccountingDraft(voucher?: VoucherRecord): VoucherAccountingDraft {
  const lines = buildVoucherAccountingLines(voucher);
  const taxMode = inferReceiptTaxMode(lines);
  const normalizedLines = lines.map((line) => {
    return normalizeAccountingLineTax(line, taxMode, { force: taxMode !== "不明" });
  });
  const receiptTaxTotal = Math.round(Number(voucher?.tax ?? 0)) || calculateVoucherLinesTaxTotal(normalizedLines);
  const receiptTaxLines = normalizeReceiptTaxLines(voucher?.receiptTaxLines, normalizedLines, receiptTaxTotal);
  const adjustedLines = applyVoucherAccountingLinesTaxBreakdown(normalizedLines, receiptTaxLines);
  return {
    note: "",
    vendorName: voucher?.vendorName || "",
    companyName: voucher?.companyName || "",
    brandName: voucher?.brandName || "",
    locationName: voucher?.locationName || "",
    transactionDate: voucher?.purchaseDate || getCurrentDate(),
    transactionTime: voucher?.purchaseTime || "",
    receiptTotal: String(Math.round(Number(voucher?.total ?? 0)) || ""),
    receiptTaxTotal: String(receiptTaxTotal || 0),
    receiptTaxLines,
    taxMode,
    lines: adjustedLines
  };
}

function normalizeStoredAccountingDrafts(drafts: Record<string, VoucherAccountingDraft>) {
  return Object.fromEntries(
    Object.entries(drafts).map(([voucherId, draft]) => [voucherId, normalizeVoucherAccountingDraft(draft)])
  );
}

function normalizeVoucherAccountingDraft(draft: VoucherAccountingDraft): VoucherAccountingDraft {
  const taxMode = normalizeDraftTaxMode(draft.taxMode);
  const normalizedLines = draft.lines.map((line) => normalizeAccountingLineTax(line, taxMode, { forceUnitPrice: true, autoFixStaleTax: false }));
  const receiptTaxTotal = "receiptTaxTotal" in draft
    ? normalizeMoneyInputText(draft.receiptTaxTotal)
    : String(calculateVoucherLinesTaxTotal(normalizedLines));
  const receiptTaxLines = normalizeReceiptTaxLines(draft.receiptTaxLines, normalizedLines, receiptTaxTotal);
  const adjustedLines = applyVoucherAccountingLinesTaxBreakdown(normalizedLines, receiptTaxLines);
  return {
    ...draft,
    receiptTaxTotal: String(calculateReceiptTaxLinesTotal(receiptTaxLines)),
    receiptTaxLines,
    taxMode,
    lines: adjustedLines
  };
}

function buildVoucherAccountingLines(voucher?: VoucherRecord): VoucherAccountingLine[] {
  const isShiire = voucher?.usageType === "shiire";

  const lines = (voucher?.items ?? []).flatMap((item, index) => {
    const amount = Math.round(Number(item.amount ?? 0));
    if (!amount) return [];
    const accountTitle = isShiire ? "仕入高" : item.accountTitle || getDefaultAccountTitle(item.category);
    const subAccountTitle = getDefaultSubAccountTitle(voucher?.usageType ?? "unclassified", item.category, item.accountTitle);
    const taxRate = normalizeDraftTaxRate(item.taxRate) || getDefaultTaxRateForSubAccountTitle(subAccountTitle);
    const taxMode = normalizeDraftTaxMode(item.taxMode);
    return [{
      id: `ocr-${index}-${item.id}`,
      ocrItemId: item.id,
      matchedProductId: item.matchedProductId,
      matchedProductName: item.matchedProductName,
      matchStatus: item.matchStatus,
      purchaseActualId: item.purchaseActualId,
      reconciliationStatus: item.reconciliationStatus,
      reconciliationNote: item.reconciliationNote,
      confirmed: false,
      accountTitle,
      subAccountTitle,
      amount: String(amount || ""),
      taxRate,
      taxMode,
      taxAmount: String(calculateDraftTaxAmount(amount, taxRate, taxMode)),
      quantity: getDefaultQuantityText(item.quantity),
      unit: item.unit || "個",
      unitPrice: getDefaultUnitPriceText(item.unitPrice, amount, item.quantity, taxRate, taxMode, calculateDraftTaxAmount(amount, taxRate, taxMode)),
      note: item.rawName || ""
    }];
  });
  if (lines.length) return lines;

  const amount = Math.round(voucher?.total ?? 0);
  const subAccountTitle = isShiire ? "食材" : "";
  const taxRate = getDefaultTaxRateForSubAccountTitle(subAccountTitle);
  return [{
    id: "manual-0",
    ocrItemId: "",
    matchedProductId: "",
    matchedProductName: "",
    matchStatus: "",
    purchaseActualId: "",
    reconciliationStatus: "unmatched",
    reconciliationNote: "",
    confirmed: false,
    accountTitle: isShiire ? "仕入高" : "雑費",
    subAccountTitle,
    amount: String(amount || ""),
    taxRate,
    taxMode: "不明",
    taxAmount: String(Math.round(voucher?.tax ?? 0)),
    quantity: "1",
    unit: "個",
    unitPrice: amount > 0 ? String(amount) : "",
    note: ""
  }];
}

function buildNewAccountingLine(
  index: number,
  taxMode = "不明",
  sourceLine?: VoucherAccountingLine,
  usageType: VoucherUsageType = "unclassified"
): VoucherAccountingLine {
  const isShiire = usageType === "shiire";
  const subAccountTitle = sourceLine?.subAccountTitle || (isShiire ? "食材" : "");
  const taxRate = sourceLine?.taxRate || getDefaultTaxRateForSubAccountTitle(subAccountTitle);
  return {
    id: `manual-${Date.now()}-${index}`,
    ocrItemId: "",
    matchedProductId: "",
    matchedProductName: "",
    matchStatus: "",
    purchaseActualId: sourceLine?.purchaseActualId ?? "",
    reconciliationStatus: sourceLine?.reconciliationStatus ?? "unmatched",
    reconciliationNote: sourceLine?.reconciliationNote ?? "",
    confirmed: false,
    accountTitle: sourceLine?.accountTitle || (isShiire ? "仕入高" : "雑費"),
    subAccountTitle,
    amount: "",
    taxRate,
    taxMode: sourceLine?.taxMode || taxMode,
    taxAmount: "0",
    quantity: "1",
    unit: sourceLine?.unit || "個",
    unitPrice: "",
    note: ""
  };
}

function validateVoucherAccounting(voucher: VoucherRecord, draft: VoucherAccountingDraft): VoucherAccountingValidation {
  const lineAmountTotal = draft.lines.reduce((sum, line) => sum + Math.round(Number(line.amount || 0)), 0);
  const taxTotal = Math.round(Number(draft.receiptTaxTotal || voucher.tax || 0));
  const expectedTotal = draft.taxMode === "外税" ? lineAmountTotal + taxTotal : lineAmountTotal;
  const receiptTotal = Math.round(Number(draft.receiptTotal || voucher.total || 0));
  const difference = expectedTotal - receiptTotal;
  const taxIncomplete = !draft.taxMode || draft.taxMode === "不明" || draft.lines.some((line) => !line.taxRate);
  return {
    ok: Math.abs(difference) <= 2 && !taxIncomplete,
    taxIncomplete,
    receiptTotal,
    lineAmountTotal,
    taxTotal,
    expectedTotal,
    difference
  };
}

function calculateVoucherLinesTaxTotal(lines: Array<{ taxAmount: string | number }>) {
  return lines.reduce((sum, line) => sum + Math.round(Number(line.taxAmount || 0)), 0);
}

function calculateReceiptTaxLinesTotal(lines: ReceiptTaxLine[]) {
  return lines.reduce((sum, line) => sum + Math.round(Number(line.taxAmount || 0)), 0);
}

function buildDefaultReceiptTaxLines(taxTotal: number, lines: VoucherAccountingLine[]): ReceiptTaxLine[] {
  const normalizedTaxTotal = Math.max(0, Math.round(Number(taxTotal || 0)));
  const taxableRates = Array.from(new Set(lines
    .map((line) => normalizeDraftTaxRate(line.taxRate))
    .filter((rate) => rate === "8%" || rate === "10%")));
  return [{
    id: `receipt-tax-${Date.now()}-0`,
    taxRate: normalizedTaxTotal === 0 ? "非課税" : taxableRates.length === 1 ? taxableRates[0] : "8%",
    taxAmount: String(normalizedTaxTotal)
  }];
}

function normalizeReceiptTaxLines(lines: ReceiptTaxLine[] | undefined, accountingLines: VoucherAccountingLine[], fallbackTaxTotal: string | number): ReceiptTaxLine[] {
  const inputLines = Array.isArray(lines) && lines.length
    ? lines
    : buildDefaultReceiptTaxLines(Math.round(Number(fallbackTaxTotal || 0)), accountingLines);
  return inputLines.map((line, index) => ({
    id: line.id || `receipt-tax-${Date.now()}-${index}`,
    taxRate: normalizeDraftTaxRate(line.taxRate) || "8%",
    taxAmount: normalizeMoneyInputText(line.taxAmount)
  }));
}

function applyVoucherAccountingLinesTaxBreakdown(lines: VoucherAccountingLine[], taxLines: ReceiptTaxLine[]) {
  const nextLines = lines.map((line) => ({ ...line }));
  const taxableTaxLines = taxLines
    .map((line) => ({
      taxRate: normalizeDraftTaxRate(line.taxRate),
      taxAmount: Math.max(0, Math.round(Number(line.taxAmount || 0)))
    }))
    .filter((line) => (line.taxRate === "8%" || line.taxRate === "10%") && line.taxAmount > 0);
  const singleTaxableRate = taxableTaxLines.length === 1 ? taxableTaxLines[0]?.taxRate ?? "" : "";

  for (const taxLine of taxLines) {
    const taxRate = normalizeDraftTaxRate(taxLine.taxRate);
    if (!taxRate) continue;
    const targetTaxTotal = Math.max(0, Math.round(Number(taxLine.taxAmount || 0)));
    let shouldApplyFallbackRate = false;
    let targetIndexes = nextLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => normalizeDraftTaxRate(line.taxRate) === taxRate)
      .map(({ index }) => index)
      .reverse();
    if (!targetIndexes.length && singleTaxableRate === taxRate) {
      targetIndexes = nextLines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => normalizeDraftTaxMode(line.taxMode) !== "対象外")
        .map(({ index }) => index)
        .reverse();
      shouldApplyFallbackRate = Boolean(targetIndexes.length);
    }
    if (!targetIndexes.length) continue;

    const currentTaxTotal = targetIndexes.reduce((sum, index) => sum + Math.round(Number(nextLines[index]?.taxAmount || 0)), 0);
    let remainingDelta = targetTaxTotal - currentTaxTotal;
    if (!remainingDelta && !shouldApplyFallbackRate) continue;
    for (const index of targetIndexes) {
      const line = nextLines[index];
      if (!line) continue;
      if (shouldApplyFallbackRate) line.taxRate = taxRate;
      if (!remainingDelta) continue;
      const currentTaxAmount = Math.max(0, Math.round(Number(line.taxAmount || 0)));
      if (remainingDelta > 0) {
        line.taxAmount = String(currentTaxAmount + remainingDelta);
        remainingDelta = 0;
        continue;
      }
      const reduction = Math.min(currentTaxAmount, Math.abs(remainingDelta));
      line.taxAmount = String(currentTaxAmount - reduction);
      remainingDelta += reduction;
    }
  }

  return nextLines;
}

function adjustVoucherAccountingLinesTaxTotal(lines: VoucherAccountingLine[], taxTotalValue: string) {
  const targetTaxTotal = Math.max(0, Math.round(Number(taxTotalValue || 0)));
  if (!Number.isFinite(targetTaxTotal)) return lines;
  let remainingDelta = targetTaxTotal - calculateVoucherLinesTaxTotal(lines);
  if (!remainingDelta) return lines;

  const nextLines = lines.map((line) => ({ ...line }));
  const candidates = nextLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => (
      normalizeDraftTaxMode(line.taxMode) !== "対象外"
      && Boolean(normalizeDraftTaxRate(line.taxRate))
    ));
  const targetIndexes = candidates.length ? candidates.map((candidate) => candidate.index).reverse() : nextLines.map((_, index) => index).reverse();

  for (const index of targetIndexes) {
    if (!remainingDelta) break;
    const line = nextLines[index];
    if (!line) continue;
    const currentTaxAmount = Math.max(0, Math.round(Number(line.taxAmount || 0)));
    if (remainingDelta > 0) {
      line.taxAmount = String(currentTaxAmount + remainingDelta);
      remainingDelta = 0;
      break;
    }
    const reduction = Math.min(currentTaxAmount, Math.abs(remainingDelta));
    line.taxAmount = String(currentTaxAmount - reduction);
    remainingDelta += reduction;
  }

  return nextLines;
}

function inferReceiptTaxMode(lines: VoucherAccountingLine[]) {
  const modes = lines
    .map((line) => normalizeDraftTaxMode(line.taxMode))
    .filter((mode) => mode === "内税" || mode === "外税" || mode === "対象外");
  if (!modes.length) return "不明";
  const uniqueModes = new Set(modes);
  if (uniqueModes.size === 1) return modes[0] ?? "不明";
  return "不明";
}

function VoucherAccountingSummary({ lines }: { lines: VoucherAccountingSummaryLine[] }) {
  const groupedLines = groupAccountingSummaryLines(lines);
  return (
    <div className="voucher-accounting-summary">
      <span>会計集計</span>
      {groupedLines.map((line, index) => (
        <div className="voucher-accounting-summary-row" key={`${line.accountTitle}-${line.subAccountTitle}-${line.taxRate}-${line.taxMode}-${index}`}>
          <strong>{line.accountTitle}{line.subAccountTitle ? ` / ${line.subAccountTitle}` : ""}</strong>
          <small>{line.taxRate || "税率不明"} / {line.taxMode || "税区分不明"} / 消費税 {formatMoney(line.taxAmount)}</small>
          <b>{formatMoney(calculateAccountingTaxIncludedAmount(line.amount, line.taxAmount, line.taxMode))}</b>
        </div>
      ))}
    </div>
  );
}

function ConfirmedVoucherDetailEditor({
  voucher,
  details,
  savingLineKeys,
  isSavingBasic,
  getDraft,
  onLineChange,
  onSaveBasic,
  onSave,
  productOptions,
  lineProductSelections,
  lineProductCategorySelections,
  lineProductSubcategorySelections,
  pendingProductLineIds,
  onProductSelectionChange,
  onProductCategoryChange,
  onProductSubcategoryChange,
  onBindProduct,
  onCreateProduct,
  onCreatePurchaseActual
}: {
  voucher: VoucherRecord;
  details: ConfirmedAccountingLineDetail[];
  savingLineKeys: Record<string, boolean>;
  isSavingBasic: boolean;
  getDraft: (detail: ConfirmedAccountingLineDetail) => ConfirmedAccountingLineDetail;
  onLineChange: (detail: ConfirmedAccountingLineDetail, next: Partial<ConfirmedAccountingLineDetail>) => void;
  onSaveBasic: (basicDraft: ConfirmedVoucherBasicDraft) => void;
  onSave: (detail: ConfirmedAccountingLineDetail, basicDraft: ConfirmedVoucherBasicDraft) => void;
  productOptions: ProductOption[];
  lineProductSelections: Record<string, string>;
  lineProductCategorySelections: Record<string, string>;
  lineProductSubcategorySelections: Record<string, string>;
  pendingProductLineIds: Record<string, boolean>;
  onProductSelectionChange: (lineId: string, productId: string) => void;
  onProductCategoryChange: (lineId: string, category: string) => void;
  onProductSubcategoryChange: (lineId: string, subcategory: string) => void;
  onBindProduct: (line: VoucherAccountingLine) => void;
  onCreateProduct: (line: VoucherAccountingLine) => void;
  onCreatePurchaseActual: (line: VoucherAccountingLine) => void;
}) {
  const [expandedDetailKeys, setExpandedDetailKeys] = useState<Record<string, boolean>>({});
  const [productBindingDetailKeys, setProductBindingDetailKeys] = useState<Record<string, boolean>>({});
  const productCategoryOptions = getProductCategoryOptions(productOptions);
  const initialReceiptTaxTotal = Math.round(Number(voucher.tax ?? 0));
  const initialAccountingLines = details.map((detail) => buildVoucherAccountingLineFromConfirmedDetail(detail, `${voucher.id}-${detail.lineNo}`));
  const detailsResetKey = details.map((detail) => [
    detail.lineNo,
    detail.accountTitle,
    detail.subAccountTitle,
    detail.amount,
    detail.taxRate,
    detail.taxMode,
    detail.taxAmount
  ].join(":")).join("|");
  const receiptTaxLinesResetKey = JSON.stringify(voucher.receiptTaxLines ?? []);
  const [basicDraft, setBasicDraft] = useState<ConfirmedVoucherBasicDraft>(() => ({
    companyName: voucher.companyName,
    brandName: voucher.brandName,
    locationName: voucher.locationName,
    receiptTaxTotal: String(initialReceiptTaxTotal),
    receiptTaxLines: normalizeReceiptTaxLines(voucher.receiptTaxLines, initialAccountingLines, initialReceiptTaxTotal)
  }));
  useEffect(() => {
    const receiptTaxTotal = Math.round(Number(voucher.tax ?? 0));
    const accountingLines = details.map((detail) => buildVoucherAccountingLineFromConfirmedDetail(detail, `${voucher.id}-${detail.lineNo}`));
    setBasicDraft({
      companyName: voucher.companyName,
      brandName: voucher.brandName,
      locationName: voucher.locationName,
      receiptTaxTotal: String(receiptTaxTotal),
      receiptTaxLines: normalizeReceiptTaxLines(voucher.receiptTaxLines, accountingLines, receiptTaxTotal)
    });
  }, [voucher.id, voucher.companyName, voucher.brandName, voucher.locationName, voucher.tax, receiptTaxLinesResetKey, detailsResetKey]);
  function toggleDetailExpanded(detailKey: string) {
    setExpandedDetailKeys((current) => ({ ...current, [detailKey]: !current[detailKey] }));
  }
  function toggleProductBinding(detailKey: string) {
    setProductBindingDetailKeys((current) => ({ ...current, [detailKey]: !current[detailKey] }));
  }
  return (
    <div className="voucher-confirmed-detail-list is-voucher-editor">
      <div className="voucher-confirmed-detail-title">
        <strong>確定済み原明細</strong>
        <span>保存すると会計集計とCSV出力に反映されます。</span>
      </div>
      <div className="voucher-confirmed-basic-grid">
        <label>
          <span>会社名</span>
          <input value={basicDraft.companyName} onChange={(event) => setBasicDraft((current) => ({ ...current, companyName: event.target.value }))} />
        </label>
        <label>
          <span>ブランド名</span>
          <input value={basicDraft.brandName} onChange={(event) => setBasicDraft((current) => ({ ...current, brandName: event.target.value }))} />
        </label>
        <label>
          <span>店舗名</span>
          <input value={basicDraft.locationName} onChange={(event) => setBasicDraft((current) => ({ ...current, locationName: event.target.value }))} />
        </label>
        <ReceiptTaxLinesEditor taxLines={basicDraft.receiptTaxLines} disabled={isSavingBasic} onChange={(taxLines) => setBasicDraft((current) => ({ ...current, receiptTaxLines: taxLines, receiptTaxTotal: String(calculateReceiptTaxLinesTotal(taxLines)) }))} />
        <div className="voucher-confirmed-basic-actions">
          <button className="secondary-button" type="button" disabled={isSavingBasic} onClick={() => onSaveBasic(basicDraft)}>
            {isSavingBasic ? "保存中..." : "基本情報を保存"}
          </button>
        </div>
      </div>
      {details.map((detail) => {
        const detailKey = getConfirmedVoucherDetailKey(voucher.id, detail);
        const draft = getDraft(detail);
        const isSaving = Boolean(savingLineKeys[detailKey]);
        const isExpanded = Boolean(expandedDetailKeys[detailKey]);
        const accountingLine = buildVoucherAccountingLineFromConfirmedDetail(draft, detailKey);
        const isProductPending = Boolean(pendingProductLineIds[detailKey]);
        const showProductBinding = voucher.usageType === "shiire" && Boolean(accountingLine.ocrItemId);
        const isReceiptReconciled = accountingLine.reconciliationStatus === "auto_matched" || accountingLine.reconciliationStatus === "manual_matched";
        const {
          suggestedProduct,
          selectedProductId,
          selectedCategory,
          selectedSubcategory
        } = getEffectiveProductBindingState({
          lineId: detailKey,
          line: accountingLine,
          productOptions,
          lineProductSelections,
          lineProductCategorySelections,
          lineProductSubcategorySelections
        });
        const productSubcategoryOptions = getProductSubcategoryOptions(productOptions, selectedCategory);
        const filteredProductOptions = getFilteredProductOptions(productOptions, selectedCategory, selectedSubcategory);
        const isBindingExpanded = Boolean(productBindingDetailKeys[detailKey]);
        const quantityLabel = detail.quantity ? `${detail.quantity} ${detail.unit || "個"}` : "数量未確認";
        return (
          <div className={`voucher-confirmed-detail-row ${isExpanded ? "is-open" : ""}`} key={detailKey}>
            <div className="voucher-confirmed-detail-heading-row">
              <button className="voucher-confirmed-detail-heading" type="button" onClick={() => toggleDetailExpanded(detailKey)} aria-expanded={isExpanded}>
                <ChevronDown size={16} />
                <strong>原明細 {detail.lineNo}</strong>
                <span>{detail.note || "摘要なし"}</span>
                <span>{formatMoney(detail.amount)} / {detail.taxRate || "税率不明"} / {detail.taxMode || "税区分不明"}</span>
                <span>{quantityLabel}</span>
                {showProductBinding ? (
                  <span className={`status-pill ${getReceiptReconciliationTone(accountingLine.reconciliationStatus)}`}>
                    {getReceiptReconciliationLabel(accountingLine.reconciliationStatus)}
                  </span>
                ) : null}
              </button>
              {showProductBinding ? (
                <button
                  className={`voucher-confirmed-product-mini ${isBindingExpanded ? "is-active" : ""}`}
                  type="button"
                  onClick={() => toggleProductBinding(detailKey)}
                  disabled={isProductPending}
                  aria-label="商品マスタ紐付けを変更"
                  title="商品マスタ紐付けを変更"
                >
                  <Link2 size={15} />
                </button>
              ) : null}
            </div>
            <div className="voucher-confirmed-detail-grid">
              <label>
                <span>勘定科目</span>
                <select value={draft.accountTitle} onChange={(event) => onLineChange(detail, { accountTitle: event.target.value })}>
                  {(voucher.usageType === "shiire" ? ["仕入高"] : expenseAccountTitleOptions).map((option) => (
                    <option value={option} key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>補助科目</span>
                <input value={draft.subAccountTitle} onChange={(event) => onLineChange(detail, { subAccountTitle: event.target.value })} />
              </label>
              <label>
                <span>金額</span>
                <input type="number" inputMode="numeric" value={draft.amount} onChange={(event) => onLineChange(detail, { amount: Number(event.target.value) })} />
              </label>
              <label>
                <span>税率</span>
                <select value={draft.taxRate} onChange={(event) => onLineChange(detail, { taxRate: event.target.value })}>
                  {taxRateOptions.map((option) => <option value={option} key={option}>{option || "不明"}</option>)}
                </select>
              </label>
              <label>
                <span>税区分</span>
                <select value={draft.taxMode} onChange={(event) => onLineChange(detail, { taxMode: event.target.value })}>
                  {taxModeOptions.map((option) => <option value={option} key={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span>消費税</span>
                <input type="number" inputMode="numeric" value={draft.taxAmount} onChange={(event) => onLineChange(detail, { taxAmount: Number(event.target.value) })} />
              </label>
              <label>
                <span>数量</span>
                <input type="number" inputMode="decimal" step="1" value={draft.quantity} onChange={(event) => onLineChange(detail, { quantity: event.target.value })} />
              </label>
              <label>
                <span>単位</span>
                <input value={draft.unit} onChange={(event) => onLineChange(detail, { unit: event.target.value })} />
              </label>
              <label>
                <span>単価</span>
                <input type="number" inputMode="decimal" value={draft.unitPrice} onChange={(event) => onLineChange(detail, { unitPrice: event.target.value })} />
              </label>
              <label className="voucher-confirmed-detail-note">
                <span>摘要</span>
                <input value={draft.note} onChange={(event) => onLineChange(detail, { note: event.target.value })} />
              </label>
              {showProductBinding && isBindingExpanded ? (
                <div className="voucher-confirmed-product-binding">
                  <label>
                    <span>大分類</span>
                    <select value={selectedCategory} onChange={(event) => onProductCategoryChange(detailKey, event.target.value)} disabled={isProductPending}>
                      <option value="">選択</option>
                      {productCategoryOptions.map((category) => (
                        <option value={category} key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>小分類</span>
                    <select value={selectedSubcategory} onChange={(event) => onProductSubcategoryChange(detailKey, event.target.value)} disabled={isProductPending || !selectedCategory}>
                      <option value="">選択</option>
                      {productSubcategoryOptions.map((subcategory) => (
                        <option value={subcategory} key={subcategory}>{subcategory}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>商品</span>
                    <select value={selectedProductId} onChange={(event) => onProductSelectionChange(detailKey, event.target.value)} disabled={isProductPending || !selectedCategory || !selectedSubcategory}>
                      <option value="">商品を選択</option>
                      {filteredProductOptions.map((product) => (
                        <option value={product.id} key={product.id}>{formatProductOptionLabel(product)}</option>
                      ))}
                    </select>
                  </label>
                  <button className="secondary-button" type="button" onClick={() => onBindProduct(accountingLine)} disabled={isProductPending || !selectedProductId}>
                    {isProductPending ? "更新中..." : "変更"}
                  </button>
                  <button className="text-button" type="button" onClick={() => onCreateProduct(accountingLine)} disabled={isProductPending}>
                    新規
                  </button>
                  <button className="secondary-button" type="button" onClick={() => onCreatePurchaseActual(accountingLine)} disabled={isSaving || isProductPending || isReceiptReconciled || !accountingLine.ocrItemId || !accountingLine.matchedProductId}>
                    <PackageCheck size={15} />
                    購入実績を作成
                  </button>
                  <div className="voucher-confirmed-reconciliation-status">
                    <span className={`status-pill ${getReceiptReconciliationTone(accountingLine.reconciliationStatus)}`}>
                      {getReceiptReconciliationLabel(accountingLine.reconciliationStatus)}
                    </span>
                    {accountingLine.matchedProductName ? <small>紐付済み: {accountingLine.matchedProductName}</small> : null}
                    {accountingLine.reconciliationNote ? <small>{accountingLine.reconciliationNote}</small> : null}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="voucher-confirmed-detail-actions">
              <button className="secondary-button" type="button" disabled={isSaving} onClick={() => onSave(detail, basicDraft)}>
                {isSaving ? "保存中..." : "この明細を保存"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function groupAccountingSummaryLines(lines: VoucherAccountingSummaryLine[]) {
  const grouped = new Map<string, VoucherAccountingSummaryLine>();
  for (const line of lines) {
    const key = [line.accountTitle, line.subAccountTitle, line.taxRate, line.taxMode].join("\u001f");
    const current = grouped.get(key);
    if (current) {
      grouped.set(key, {
        ...current,
        amount: current.amount + line.amount,
        taxAmount: current.taxAmount + line.taxAmount,
        note: [current.note, line.note].filter(Boolean).join(" / ")
      });
    } else {
      grouped.set(key, { ...line });
    }
  }
  return Array.from(grouped.values());
}

function getProductCategory(product: ProductOption) {
  return product.category || "未分類";
}

function getProductSubcategory(product: ProductOption) {
  return product.subcategory || "未分類";
}

function formatProductOptionLabel(product: ProductOption) {
  const familyName = String(product.productFamilyName ?? "").trim();
  const variantName = String(product.variantName ?? "").trim();
  const packageQuantity = String(product.packageQuantity ?? "").trim();
  const packageQuantityUnit = String(product.packageQuantityUnit ?? product.unit ?? "").trim();
  const specLabel = variantName || (packageQuantity ? `${packageQuantity}${packageQuantityUnit ? ` ${packageQuantityUnit}` : ""}` : "");
  const supplierLabel = String(product.mainSupplier ?? "").trim();
  return [
    familyName || product.name,
    specLabel && specLabel !== product.name ? specLabel : "",
    supplierLabel ? `メイン: ${supplierLabel}` : "",
    getProductSubcategory(product)
  ].filter(Boolean).join(" / ");
}

function getReceiptReconciliationLabel(status: string) {
  if (status === "auto_matched") return "購入実績照合済み";
  if (status === "manual_matched") return "購入実績作成済み";
  if (status === "ignored") return "照合対象外";
  return "購入実績未照合";
}

function getReceiptReconciliationTone(status: string) {
  if (status === "auto_matched" || status === "manual_matched") return "tone-done";
  if (status === "ignored") return "tone-muted";
  return "tone-warning";
}

function getConfirmedLineReconciliationStatus(line: ConfirmedAccountingLine) {
  const details = (line.details ?? []).filter((detail) => detail.ocrItemId);
  if (!details.length) return "";
  const isMatched = (detail: ConfirmedAccountingLineDetail) => detail.reconciliationStatus === "auto_matched" || detail.reconciliationStatus === "manual_matched";
  if (details.every(isMatched)) return "auto_matched";
  if (details.every((detail) => detail.reconciliationStatus === "ignored")) return "ignored";
  return "unmatched";
}

function getConfirmedLinePurchaseActualCandidate(line: ConfirmedAccountingLine) {
  return (line.details ?? []).find((detail) =>
    detail.ocrItemId &&
    detail.matchedProductId &&
    !detail.purchaseActualId &&
    detail.reconciliationStatus !== "auto_matched" &&
    detail.reconciliationStatus !== "manual_matched" &&
    detail.reconciliationStatus !== "ignored"
  );
}

function getProductCategoryOptions(productOptions: ProductOption[]) {
  return Array.from(new Set(productOptions.map((product) => getProductCategory(product))))
    .sort((first, second) => first.localeCompare(second, "ja"));
}

function getProductSubcategoryOptions(productOptions: ProductOption[], category: string) {
  if (!category) return [];
  return Array.from(new Set(
    productOptions
      .filter((product) => getProductCategory(product) === category)
      .map((product) => getProductSubcategory(product))
  )).sort((first, second) => first.localeCompare(second, "ja"));
}

function getFilteredProductOptions(productOptions: ProductOption[], category: string, subcategory: string) {
  return productOptions.filter((product) => {
    return (!category || getProductCategory(product) === category)
      && (!subcategory || getProductSubcategory(product) === subcategory);
  });
}

function getEffectiveProductBindingState({
  lineId,
  line,
  productOptions,
  lineProductSelections,
  lineProductCategorySelections,
  lineProductSubcategorySelections
}: {
  lineId: string;
  line: VoucherAccountingLine;
  productOptions: ProductOption[];
  lineProductSelections: Record<string, string>;
  lineProductCategorySelections: Record<string, string>;
  lineProductSubcategorySelections: Record<string, string>;
}) {
  const suggestedProduct = getSuggestedProduct(line, productOptions);
  const fallbackProductId = line.matchedProductId || suggestedProduct?.id || "";
  const fallbackProduct = fallbackProductId
    ? productOptions.find((product) => product.id === fallbackProductId) ?? null
    : null;
  const manualProductId = String(lineProductSelections[lineId] ?? "").trim();
  const manualCategory = String(lineProductCategorySelections[lineId] ?? "").trim();
  const manualSubcategory = String(lineProductSubcategorySelections[lineId] ?? "").trim();
  const fallbackMatchesManualFilter = fallbackProduct
    && (!manualCategory || getProductCategory(fallbackProduct) === manualCategory)
    && (!manualSubcategory || getProductSubcategory(fallbackProduct) === manualSubcategory);
  const selectedProductId = manualProductId || (fallbackMatchesManualFilter ? fallbackProductId : "");
  const selectedProduct = selectedProductId
    ? productOptions.find((product) => product.id === selectedProductId) ?? null
    : null;
  const selectedCategory = selectedProduct
    ? getProductCategory(selectedProduct)
    : manualCategory || (suggestedProduct ? getProductCategory(suggestedProduct) : "");
  const selectedSubcategory = selectedProduct
    ? getProductSubcategory(selectedProduct)
    : manualSubcategory || (suggestedProduct ? getProductSubcategory(suggestedProduct) : "");
  return {
    suggestedProduct,
    selectedProductId,
    selectedProduct,
    selectedCategory,
    selectedSubcategory
  };
}

function getSuggestedProduct(line: VoucherAccountingLine, productOptions: ProductOption[]) {
  if (line.matchedProductId) return productOptions.find((product) => product.id === line.matchedProductId) ?? null;
  const normalizedLineName = normalizeProductSearchText(line.note);
  if (!normalizedLineName) return null;
  const matchedProducts = productOptions.filter((product) => {
    const normalizedProductName = normalizeProductSearchText(product.name);
    return normalizedProductName === normalizedLineName
      || normalizedLineName.includes(normalizedProductName)
      || normalizedProductName.includes(normalizedLineName);
  });
  if (!matchedProducts.length) return null;
  const normalizedSubAccount = normalizeProductSearchText(line.subAccountTitle);
  return matchedProducts.find((product) => (
    normalizeProductSearchText(getProductCategory(product)) === normalizedSubAccount
    || normalizeProductSearchText(getProductSubcategory(product)) === normalizedSubAccount
  )) ?? matchedProducts[0] ?? null;
}

function normalizeProductSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（）()[\]【】「」『』・,，.。]/g, "")
    .trim();
}

function getCurrentDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getCurrentMonthStartDate() {
  const currentDate = getCurrentDate();
  return `${currentDate.slice(0, 7)}-01`;
}

function getDefaultAccountTitle(category: string) {
  if (category === "清掃用品" || category === "消耗品" || category === "包材") return "消耗品費";
  if (category === "設備") return "修繕費";
  if (category === "税金") return "租税公課";
  if (category === "給与社保") return "法定福利費";
  if (category === "家賃") return "地代家賃";
  if (category === "水道光熱") return "水道光熱費";
  if (category === "通信") return "通信費";
  if (category === "広告") return "広告宣伝費";
  if (category === "交通") return "旅費交通費";
  if (category === "車両") return "車両費";
  if (category === "保険") return "保険料";
  if (category === "手数料") return "支払手数料";
  if (category === "研修") return "図書研修費";
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

function getDefaultTaxRateForSubAccountTitle(subAccountTitle: string) {
  return subAccountTitle === "食材" ? "8%" : "";
}

function normalizeDraftTaxRate(value: string) {
  const text = String(value ?? "").replace("%", "").trim();
  if (text === "8" || text === "8.0") return "8%";
  if (text === "10" || text === "10.0") return "10%";
  if (text === "非課税" || text === "不課税" || text === "対象外") return text;
  if (text === "0") return "非課税";
  return "";
}

function normalizeDraftTaxMode(value: string) {
  return value === "内税" || value === "外税" || value === "対象外" ? value : "不明";
}

function calculateDraftTaxAmount(amount: number, taxRate: string, taxMode: string) {
  const rate = taxRate === "8%" ? 8 : taxRate === "10%" ? 10 : 0;
  if (!rate || amount <= 0) return 0;
  if (taxMode === "外税") return Math.round(amount * rate / 100);
  if (taxMode === "内税") return Math.round(amount * rate / (100 + rate));
  return 0;
}

const TAX_AMOUNT_AUTO_FIX_TOLERANCE = 2;

function normalizeAccountingLineTax(
  line: VoucherAccountingLine,
  taxMode = line.taxMode,
  options: { force?: boolean; forceUnitPrice?: boolean; preserveUnitPrice?: boolean; autoFixStaleTax?: boolean } = {}
): VoucherAccountingLine {
  const amount = Math.round(Number(line.amount || 0));
  const taxRate = line.taxRate || getDefaultTaxRateForSubAccountTitle(line.subAccountTitle);
  const normalizedTaxMode = normalizeDraftTaxMode(taxMode);
  const expectedTaxAmount = calculateDraftTaxAmount(amount, taxRate, normalizedTaxMode);
  const currentTaxAmount = Math.round(Number(line.taxAmount || 0));
  const shouldAutoFixStaleTax = options.autoFixStaleTax === true;
  const hasStaleTaxAmount = expectedTaxAmount > 0
    && shouldAutoFixStaleTax
    && (!Number.isFinite(currentTaxAmount) || Math.abs(currentTaxAmount - expectedTaxAmount) > TAX_AMOUNT_AUTO_FIX_TOLERANCE);
  const nextTaxAmount = options.force || hasStaleTaxAmount ? expectedTaxAmount : Math.max(0, currentTaxAmount);
  return {
    ...line,
    taxRate,
    taxMode: normalizedTaxMode,
    taxAmount: String(nextTaxAmount),
    unitPrice: normalizeDraftUnitPrice(line.unitPrice, amount, line.quantity, taxRate, normalizedTaxMode, nextTaxAmount, {
      force: options.forceUnitPrice,
      preserve: options.preserveUnitPrice
    })
  };
}

function normalizeConfirmedLineDetail(
  detail: ConfirmedAccountingLineDetail,
  options: { forceTax?: boolean; forceUnitPrice?: boolean; preserveUnitPrice?: boolean; autoFixStaleTax?: boolean } = {}
): ConfirmedAccountingLineDetail {
  const amount = Math.round(Number(detail.amount || 0));
  const taxRate = detail.taxRate || getDefaultTaxRateForSubAccountTitle(detail.subAccountTitle);
  const normalizedTaxMode = normalizeDraftTaxMode(detail.taxMode);
  const expectedTaxAmount = calculateDraftTaxAmount(amount, taxRate, normalizedTaxMode);
  const currentTaxAmount = Math.round(Number(detail.taxAmount || 0));
  const shouldAutoFixStaleTax = options.autoFixStaleTax === true;
  const hasStaleTaxAmount = expectedTaxAmount > 0
    && shouldAutoFixStaleTax
    && (!Number.isFinite(currentTaxAmount) || Math.abs(currentTaxAmount - expectedTaxAmount) > TAX_AMOUNT_AUTO_FIX_TOLERANCE);
  const nextTaxAmount = options.forceTax || hasStaleTaxAmount ? expectedTaxAmount : Math.max(0, currentTaxAmount);
  return {
    ...detail,
    taxRate,
    taxMode: normalizedTaxMode,
    taxAmount: nextTaxAmount,
    unitPrice: normalizeDraftUnitPrice(detail.unitPrice, detail.amount, detail.quantity, taxRate, normalizedTaxMode, nextTaxAmount, {
      force: options.forceUnitPrice,
      preserve: options.preserveUnitPrice
    })
  };
}

function shouldAutoCalculateTaxAmount(
  next: Partial<{ amount: string | number; taxRate: string; taxMode: string; taxAmount: string | number; confirmed: boolean }>,
  line: { amount: string | number; taxRate: string; taxMode: string; taxAmount: string | number }
) {
  if ("taxAmount" in next) return false;
  const changedTaxBasis = "amount" in next || "taxRate" in next || "taxMode" in next;
  if (changedTaxBasis) return true;
  if (next.confirmed !== true) return false;
  return calculateDraftTaxAmount(Number(line.amount || 0), line.taxRate, line.taxMode) !== Number(line.taxAmount || 0);
}

function calculateDraftUnitPrice(amountValue: string, quantityValue: string, taxRate = "", taxMode = "", taxAmountValue: string | number = "") {
  const amount = Number(amountValue);
  const quantity = Number(quantityValue);
  if (!Number.isFinite(amount) || !Number.isFinite(quantity) || amount <= 0 || quantity <= 0) return "";
  const normalizedTaxMode = normalizeDraftTaxMode(taxMode);
  const taxAmount = Number(taxAmountValue);
  const rate = getTaxRateNumber(taxRate);
  const fallbackTaxAmount = normalizedTaxMode === "外税" && rate > 0 ? Math.round(amount * rate / 100) : 0;
  const unitPrice = normalizedTaxMode === "外税"
    ? (amount + (Number.isFinite(taxAmount) && taxAmount > 0 ? taxAmount : fallbackTaxAmount)) / quantity
    : amount / quantity;
  return Number.isInteger(unitPrice) ? String(unitPrice) : unitPrice.toFixed(2);
}

function normalizeDraftUnitPrice(
  value: string | number | null | undefined,
  amount: string | number,
  quantity: string | number | null | undefined,
  taxRate = "",
  taxMode = "",
  taxAmount: string | number = "",
  options: { force?: boolean; preserve?: boolean } = {}
) {
  const current = Number(value);
  if (options.preserve && Number.isFinite(current) && current > 0) return String(value);
  if (!options.force && Number.isFinite(current) && current > 0) return String(value);
  return calculateDraftUnitPrice(String(amount || ""), getDefaultQuantityText(quantity), taxRate, taxMode, taxAmount);
}

function getDefaultQuantityText(value: string | number | null | undefined) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? String(quantity) : "1";
}

function getDefaultUnitPriceText(
  value: string | number | null | undefined,
  amount: number,
  quantity: string | number | null | undefined,
  taxRate = "",
  taxMode = "",
  taxAmount: string | number = ""
) {
  return normalizeDraftUnitPrice(value, amount, quantity, taxRate, taxMode, taxAmount, { force: normalizeDraftTaxMode(taxMode) === "外税" });
}

function normalizeMoneyInputText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\d]/g, "");
}

function calculateTaxIncludedUnitPrice(line: VoucherAccountingLine) {
  const amount = Number(line.amount);
  const quantity = Number(line.quantity);
  if (!Number.isFinite(amount) || !Number.isFinite(quantity) || amount <= 0 || quantity <= 0) return 0;
  const taxAmount = Number(line.taxAmount);
  const rate = getTaxRateNumber(line.taxRate);
  const fallbackTaxAmount = line.taxMode === "外税" && rate > 0 ? Math.round(amount * rate / 100) : 0;
  const total = line.taxMode === "外税" ? amount + (Number.isFinite(taxAmount) && taxAmount > 0 ? taxAmount : fallbackTaxAmount) : amount;
  const unitPrice = total / quantity;
  return Number.isFinite(unitPrice) && unitPrice > 0 ? Math.round(unitPrice * 100) / 100 : 0;
}

function getTaxRateNumber(taxRate: string) {
  if (taxRate === "8%") return 8;
  if (taxRate === "10%") return 10;
  return 0;
}

function calculateAccountingTaxIncludedAmount(amount: number, taxAmount: number, taxMode: string) {
  const roundedAmount = Math.round(Number(amount || 0));
  const roundedTaxAmount = Math.round(Number(taxAmount || 0));
  if (taxMode === "外税") return roundedAmount + Math.max(0, roundedTaxAmount);
  return roundedAmount;
}

function getConfirmedLineKey(line: ConfirmedAccountingLine) {
  return [
    line.voucherId,
    line.lineNo,
    line.summaryKey || buildConfirmedSummaryKey(line)
  ].join("|");
}

function normalizeSearchText(value: string) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function compareVoucherPurchaseDate(left: VoucherRecord, right: VoucherRecord, sort: VoucherDateSort) {
  const leftKey = `${left.purchaseDate || "0000-00-00"} ${left.purchaseTime || "00:00"}`;
  const rightKey = `${right.purchaseDate || "0000-00-00"} ${right.purchaseTime || "00:00"}`;
  const result = leftKey.localeCompare(rightKey);
  return sort === "asc" ? result : -result;
}

function compareVoucherReviewPriority(left: VoucherRecord, right: VoucherRecord, sort: VoucherDateSort) {
  const leftNeedsReview = isVoucherPendingReview(left);
  const rightNeedsReview = isVoucherPendingReview(right);
  if (leftNeedsReview !== rightNeedsReview) return leftNeedsReview ? -1 : 1;
  return compareVoucherPurchaseDate(left, right, sort);
}

function isVoucherPendingReview(voucher: VoucherRecord) {
  return voucher.status !== "confirmed" && voucher.status !== "failed";
}

function voucherMatchesProductSearch(voucher: VoucherRecord, term: string) {
  const fields = [
    buildVoucherTitle(voucher),
    voucher.vendorName,
    voucher.companyName,
    voucher.brandName,
    voucher.locationName,
    voucher.storeName,
    voucher.uploadedFileName,
    ...(voucher.accountingLines ?? []).flatMap((line) => [
      line.accountTitle,
      line.subAccountTitle,
      line.taxRate,
      line.taxMode
    ]),
    ...(voucher.items ?? []).flatMap((item) => [
      item.rawName,
      item.category,
      item.accountTitle,
      item.taxRate,
      item.taxMode,
      item.unit,
      item.matchStatus,
      item.matchedProductName
    ])
  ];
  return fields.some((value) => normalizeSearchText(String(value ?? "")).includes(term));
}

function buildConfirmedSummaryKey(line: Pick<ConfirmedAccountingLine, "accountTitle" | "subAccountTitle" | "taxRate" | "taxMode">) {
  return [
    line.accountTitle,
    line.subAccountTitle,
    line.taxRate,
    line.taxMode
  ].join("\u001f");
}

function getConfirmedDetailKey(group: ConfirmedAccountingLine, detail: ConfirmedAccountingLineDetail) {
  return `${getConfirmedLineKey(group)}:${detail.lineNo}`;
}

function getConfirmedVoucherDetailKey(voucherId: string, detail: ConfirmedAccountingLineDetail) {
  return `${voucherId}:${detail.lineNo}`;
}

function buildConfirmedDetailFromAccountingLine(line: VoucherAccountingSummaryLine, index: number): ConfirmedAccountingLineDetail {
  return {
    voucherId: "",
    lineNo: Number(line.lineNo ?? index + 1),
    accountTitle: line.accountTitle,
    subAccountTitle: line.subAccountTitle,
    amount: line.amount,
    taxRate: line.taxRate,
    taxMode: line.taxMode,
    taxAmount: line.taxAmount,
    quantity: getDefaultQuantityText(line.quantity),
    unit: line.unit || "個",
    unitPrice: getDefaultUnitPriceText(line.unitPrice, line.amount, line.quantity, line.taxRate, line.taxMode, line.taxAmount),
    ocrItemId: line.ocrItemId ?? "",
    matchedProductId: line.matchedProductId ?? "",
    matchedProductName: line.matchedProductName ?? "",
    matchStatus: line.matchStatus ?? "",
    purchaseActualId: line.purchaseActualId ?? "",
    reconciliationStatus: line.reconciliationStatus ?? "unmatched",
    reconciliationNote: line.reconciliationNote ?? "",
    note: line.note
  };
}

function buildVoucherAccountingLineFromConfirmedDetail(detail: ConfirmedAccountingLineDetail, id: string): VoucherAccountingLine {
  return {
    id,
    ocrItemId: detail.ocrItemId,
    matchedProductId: detail.matchedProductId,
    matchedProductName: detail.matchedProductName,
    matchStatus: detail.matchStatus,
    purchaseActualId: detail.purchaseActualId,
    reconciliationStatus: detail.reconciliationStatus,
    reconciliationNote: detail.reconciliationNote,
    confirmed: true,
    accountTitle: detail.accountTitle,
    subAccountTitle: detail.subAccountTitle,
    amount: String(detail.amount || ""),
    taxRate: detail.taxRate,
    taxMode: detail.taxMode,
    taxAmount: String(detail.taxAmount || 0),
    quantity: detail.quantity || "1",
    unit: detail.unit || "個",
    unitPrice: detail.unitPrice || calculateDraftUnitPrice(String(detail.amount || ""), detail.quantity || "1", detail.taxRate, detail.taxMode, detail.taxAmount),
    note: detail.note || detail.subAccountTitle || `原明細 ${detail.lineNo}`
  };
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
        results?: Array<{
          ok?: boolean;
          duplicate?: boolean;
          existingOcrResultId?: string;
          existingOcrResultIds?: string[];
          ocrError?: string;
          error?: string;
          createdCount?: number;
          duplicateCount?: number;
          detectedCount?: number;
        }>;
      };
      const result = body.results?.[0];
      if (response.ok && result?.ok) {
        return {
          ok: true,
          duplicate: Boolean(result.duplicate),
          existingOcrResultId: String(result.existingOcrResultId ?? ""),
          existingOcrResultIds: Array.isArray(result.existingOcrResultIds)
            ? result.existingOcrResultIds.map((id) => String(id)).filter(Boolean)
            : String(result.existingOcrResultId ?? "") ? [String(result.existingOcrResultId)] : [],
          ocrError: result.ocrError || "",
          createdCount: Number(result.createdCount ?? 0),
          duplicateCount: Number(result.duplicateCount ?? 0),
          detectedCount: Number(result.detectedCount ?? 0)
        };
      }
      lastError = body.error || result?.error || "証憑をアップロードできませんでした。";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "通信に失敗しました。";
    }
    await sleep(1200 * (attempt + 1));
  }
  return {
    ok: false,
    duplicate: false,
    existingOcrResultId: "",
    existingOcrResultIds: [],
    ocrError: lastError || "証憑をアップロードできませんでした。",
    createdCount: 0,
    duplicateCount: 0,
    detectedCount: 0
  };
}

async function splitPdfIntoPageFiles(file: File) {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  if (pageCount <= 0) throw new Error("PDFページを読み取れませんでした。");

  const baseName = (file.name || "receipt.pdf").replace(/\.pdf$/i, "");
  const pageFiles: File[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const page = await pdf.getPage(index + 1);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDFページを画像化できませんでした。");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    pageFiles.push(await canvasToPngFile(canvas, `${baseName}-page-${String(index + 1).padStart(3, "0")}.png`));
  }
  pdf.destroy();
  return pageFiles;
}

function canvasToPngFile(canvas: HTMLCanvasElement, fileName: string) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("PDFページを画像化できませんでした。"));
        return;
      }
      resolve(new File([blob], fileName, { type: "image/png" }));
    }, "image/png");
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
