"use client";

import { usePosDailySummary } from "./usePosDailySummary";
import { createReadError } from "../../../components/useReadRequest";
import PosDailySummary from "./PosDailySummary";
import { summarizePosProducts, type PosProductSummary } from "../../../lib/pos-daily-summary";
import PosInvoiceIssuer from './PosInvoiceIssuer';
import { invoiceRecipientStem } from '../../../lib/pos-invoice';
import { isPosOptionAllowed, reconcilePosOptionDependencies } from '../../../lib/pos-option-dependencies';
import { evaluatePosDiscounts, isPosCampaignActive, posCampaignDate, type PosCampaignFields } from "../../../lib/pos-discount-campaigns";

import refundStyles from "./refund-options.module.css";

import { PosDebugBanner, PosDebugResultPreview, type PosDebugResult } from "./PosDebugMode";
import { PosDebugDisplayPanel } from "./PosDebugDisplayPanel";
import { usePosDebugDisplay } from "./usePosDebugDisplay";
import { useCustomerDisplayPublisher } from "./useCustomerDisplayPublisher";
import type { PosCustomerDisplayWeighingDraft } from "../../../lib/pos-customer-display";

import cashFeedbackStyles from "./cash-feedback.module.css";
import checkoutStyles from "./checkout-feedback.module.css";
import menuRefreshStyles from "./PosMenuRefreshNotice.module.css";
import { PosMenuRefreshNotice } from "./PosMenuRefreshNotice";
import { usePosMenuRefresh, type PosMenuVersions } from "./usePosMenuRefresh";
import { PosPrintDocumentsPanel } from "./PosPrintDocumentsPanel";
import { usePosPrintDocuments } from "./usePosPrintDocuments";
import { POS_PRINT_DOCUMENT_VERSION, type PosPrintMode } from "../../../lib/pos-print-document-contract";
import { getPosItemFulfillmentMode, isPosImmediateItem, type PosItemFulfillmentMode } from "../../../lib/pos-item-fulfillment";
import { PosFulfillmentPanel } from "./PosFulfillmentPanel";
import { normalizePosFulfillmentWorkspaceSettings, type PosFulfillmentWorkspaceSettings } from "../../../lib/pos-fulfillment-settings";

import { defaultPosScaleTareSettings, normalizePosScaleTareSettings, type PosScaleTareSettings, type PosScaleTarePresetId, type PosWeightMeasurement } from '../../../lib/pos-scale-tare';
import { normalizePosScaleFilterSettings } from '../../../lib/pos-scale-filter';
import { useStoreRelay } from '../components/useStoreRelay';
import { StoreRelayPanel } from '../components/StoreRelayPanel';
import { StoreRelayScale, scaleSnapshotBlocksConfirmation, type ScaleConfirmationValidity } from '../components/StoreRelayScale';
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { useStoreDialog } from "../components/useStoreDialog";
import { lockBodyScroll } from "../../../lib/body-scroll-lock";
import { expandPosBowls, isPosBowl, isDineInBowlOptionGroup, offlineServingTickets, type PosServingTicket } from "../../../lib/pos-serving-policy";
import { resolvePosItemPricingMode } from "../../../lib/pos-item-pricing";
import { dineInGroupAppliesToItem, dineInOptionAppliesToItem } from '../../../lib/store-dine-in-menu-policy';
import { getPosOptionSelectionType, getPosOptionSelectionRules, isStoreDineInSelection } from "../../../lib/dine-in-option-selection";
import { runPosPrintJobs, type PosPrintJob } from "../../../lib/pos-print-jobs";
import { posPickupTicketCopy } from "../../../lib/pos-pickup-ticket-copy";
import { isPosSellableItem } from "../../../lib/pos-catalog-policy";

import { posOptionGiftCatalog } from "../../../lib/pos-option-gifts";
import { evaluatePosBowlBenefits, posBowlQuote, type PosBowlChoice } from "../../../lib/pos-bowl-benefits";
import { PosBowlBenefitPicker } from "./PosBowlBenefitPicker";
import { Banknote, Camera, CreditCard, Gift, Minus, Plus, ReceiptText, RefreshCw, ScanLine, Search, ShoppingCart, Trash2, UserRound, X } from "lucide-react";
import jsQR from "jsqr";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { normalizeDecimalInput, normalizeIntegerInput } from "../../../lib/number-input";
import { addOfflinePosOrder, savePosCheckoutRecovery, listPosCheckoutRecovery, removePosCheckoutRecovery, type PosCheckoutRecovery, savePosPrintJob, savePosPrintBatch, listPosPrintJobs, getOfflinePosSnapshot, listOfflinePosOrders, removeOfflinePosOrder, saveOfflinePosSnapshot, updateOfflinePosOrderError, type OfflinePosOrder } from "../../../lib/offline-pos";
import { getCashBreakdownTotal, normalizeCashBreakdown, yenDenominations, type CashBreakdown } from "../../../lib/pos-cash-denominations";
import { createAutoStarBluetoothPrinter, createPhysicalCustomerDisplayPayload, defaultPosPrinterSettings, displayWithAndroidBridge, getKitchenPrinterForBrand, getReceiptPrinter, getPosReceiptCopies, getPosBowlTicketCopies, hasPosPrinterDestination, normalizePosPrinterSettings, printWithAndroidBridge, resolvePosKitchenTicketTemplate, resolvePosReceiptTemplate, type PosPrinterConnection, type PosPrinterSettings, type PosPrintPayload } from "../../../lib/pos-printer";
import { createStoreRefreshCoordinator } from "../../../lib/store-polling-client";
import { bindStoreRealtimeChannels } from "../../../lib/store-realtime-refresh";
import { ModalHistoryScope } from "../../os/components/useModalHistory";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";

type StoreOption = {
  id: string;
  name: string;
};

type BrandOption = {
  id: string;
  name: string;
};

type PosMenuCategory = {
  id: string;
  brandId: string;
  name: string;
  sortOrder: number;
};

type PosMenuItem = {
  id: string;
  sourceItemId?: string;
  optionGroupIds?: string[];
  productionType?: 'bowl' | 'drink' | 'item';
  fulfillmentMode?: PosItemFulfillmentMode;
  brandId: string;
  brandName: string;
  name: string;
  displayNames?: Record<string, string>;
  itemKind: string;
  category: string;
  imageUrl: string;
  basePrice: number | null;
  priceOverride: number | null;
  posPricingMode: string;
  posPricingOverride?: 'fixed' | 'weight';
  posWeightUnit: string;
  posWeightUnitPrice: number | null;
  isAvailable: boolean;
  variableSchema: Record<string, unknown>;
};

type PosMenuOption = {
  id: string;
  linkedItemId?: string;
  linkedSourceItemId?: string;
  sourceName?: string;
  optionKey: string;
  applicableCategories: string[];
  name: string;
  displayNames?: Record<string, string>;
  priceDelta: number | null;
  sortOrder: number;
};

type PosOptionGroup = {
  sourceGroupId?: string;
  localKind?: string;
  explicitItemLinks?: true;
  itemOptionExclusions?: Record<string, string[]>;
  posEnabled?: boolean;
  sourceName?: string;
  id: string;
  brandId: string;
  menuCatalogItemId: string;
  applicableCategories: string[];
  groupKey: string;
  name: string;
  displayNames?: Record<string, string>;
  selectionType: string;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
  options: PosMenuOption[];
};

type PosSelectedOption = PosMenuOption & {
  groupId: string;
  groupKey: string;
  groupName: string;
  groupDisplayNames?: Record<string, string>;
};

type PosCartItem = PosMenuItem & {
  bowlBenefit?: PosBowlChoice;
  scaleCaptureId?: string;
  weightMeasurement?: PosWeightMeasurement;
  cartKey: string;
  preparationNote?: string;
  quantity: number;
  measuredQuantity: number | null;
  measuredUnit: string;
  measuredUnitPrice: number | null;
  selectedOptions: PosSelectedOption[];
  optionTotal: number;
};

type PosSummary = {
  products?: PosProductSummary[];
  pendingSync?: boolean;
  orderCount: number;
  total: number;
  average: number;
  latestOrders: Array<{
    id: string;
    pickupCode: string;
    amount: number;
    paymentMethod: string;
    createdTime: string;
  }>;
};

const emptyPosSummary: PosSummary = { orderCount: 0, total: 0, average: 0, latestOrders: [] };

type PosTableCheckoutRequest = {
  id: string;
  tableSessionKey: string;
  tableLabel: string;
  checkoutRequestType: string;
  checkoutRequestedAt: string;
  totalAmount: number;
  orderCount: number;
  pickupCodes: string[];
  itemSummary: string[];
  orders: Array<{
    id: string;
    pickupCode: string;
    amount: number;
    status: string;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      amount: number;
      optionLabel: string;
      toppings: string[];
    }>;
  }>;
};

type PosTransactionItem = {
  remainingPaidAmount?: number;
  refundOptions?: Array<{key:string;groupName:string;label:string;quantity:number;paidAmount:number;refunded:boolean}>;
  id: string;
  pickupCode?: string;
  handedOffAt?: string;
  name: string;
  size: string;
  temperature: string;
  sweetness: string;
  ice: string;
  option: string;
  toppings: string[];
  quantity: number;
  measuredQuantity: number | null;
  measuredUnit: string;
  measuredUnitPrice: number | null;
  amount: number;
  grossAmount: number;
  discountAmount: number;
  couponDiscountAmount: number;
  paidAmount: number;
  couponId: string;
  refundStatus: string;
  refundedQuantity: number;
  refundedAmount: number;
  refundReason: string;
  externalRefundConfirmedAt: string;
  refundedAt: string;
};

type PosTransaction = {
  id: string;
  printDocumentVersion?: number;
  pickupCode: string;
  servingPickupCodes?: string[];
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  amount: number;
  orderType?: string;
  note?: string;
  cashierName: string;
  cashTenderedAmount: number | null;
  cashChangeAmount: number | null;
  refundReason?: string;
  createdLabel: string;
  createdTime?: string;
  refundStatus: string;
  refundedAt: string;
  cashSessionStatus: string;
  items?: PosTransactionItem[];
};

type PosAccess = {
  stores: StoreOption[];
  canUseAllStoreView: boolean;
};

type PosDiscountPreset = PosCampaignFields & {
  key: string;
  name: string;
  displayNames?: Record<string, string>;
  discountType: "percent" | "amount";
  discountValue: number;
  targetScope: "all" | "category" | "item_kind" | "brand";
  targetValue: string;
  enabled: boolean;
  stampEligible: boolean;
  allowCouponCombination: boolean;
};

type PosSettings = {
  dineInEnabled: boolean;
  takeoutEnabled: boolean;
  dineInTaxRate: number;
  takeoutTaxRate: number;
  externalPaymentTerminalBrand: string;
  priceTaxMode: string;
  discountPresets: PosDiscountPreset[];
  printerSettings: PosPrinterSettings;
  scaleTareSettings: PosScaleTareSettings;
  fulfillmentWorkspace: PosFulfillmentWorkspaceSettings;
};

type PosMenuSnapshot = PosMenuVersions & Record<string, unknown> & {
  brands: BrandOption[];
  items: PosMenuItem[];
  categories: PosMenuCategory[];
  optionGroups: PosOptionGroup[];
  dineInMenu: { items: PosMenuItem[]; categories: PosMenuCategory[]; optionGroups: PosOptionGroup[] } | null;
  posSettings: Partial<PosSettings>;
};

function normalizeRuntimePosSettings(value: Partial<PosSettings> | undefined): PosSettings {
  return {
    dineInEnabled: value?.dineInEnabled !== false,
    takeoutEnabled: value?.takeoutEnabled !== false,
    dineInTaxRate: Number(value?.dineInTaxRate ?? 10),
    takeoutTaxRate: Number(value?.takeoutTaxRate ?? 8),
    externalPaymentTerminalBrand: value?.externalPaymentTerminalBrand ?? "PayCAS",
    priceTaxMode: value?.priceTaxMode ?? "tax_included",
    discountPresets: Array.isArray(value?.discountPresets) ? value.discountPresets : [],
    printerSettings: normalizePosPrinterSettings(value?.printerSettings ?? defaultPosPrinterSettings),
    scaleTareSettings: normalizePosScaleTareSettings(value?.scaleTareSettings),
    fulfillmentWorkspace: normalizePosFulfillmentWorkspaceSettings(value?.fulfillmentWorkspace)
  };
}

function validPosMenuSnapshot(value: PosMenuSnapshot): boolean {
  const catalog = (data: unknown) => {
    const source = data as Partial<PosMenuSnapshot> | null;
    return Boolean(source && Array.isArray(source.items) && Array.isArray(source.categories) && Array.isArray(source.optionGroups));
  };
  return catalog(value) && Array.isArray(value.brands) && Boolean(value.posSettings && typeof value.posSettings === "object" && !Array.isArray(value.posSettings))
    && (value.dineInMenu === null || catalog(value.dineInMenu));
}

type PosCashSession = {
  id: string;
  businessDate: string;
  registerName: string;
  status: string;
  openingAmount: number;
  openingCashBreakdown: CashBreakdown;
  expectedCashAmount: number;
  countedCashAmount: number | null;
  countedCashBreakdown: CashBreakdown;
  differenceAmount: number | null;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  openedByName: string;
  openedAt: string;
  closedAt: string;
};

type PosCashMovement = {
  id: string;
  movementType: string;
  amount: number;
  reason: string;
  createdByName: string;
  createdTime: string;
};

type PosCashResponsibleEmployee = {
  id: string;
  name: string;
  role: string;
  punchedAt: string;
  attendanceStatus: "working" | "on_break" | "scheduled" | "clocked_out" | "manager";
  scheduledStart: string;
  scheduledEnd: string;
};

function getCashResponsibleEmployeeLabel(employee: PosCashResponsibleEmployee) {
  const schedule = employee.scheduledStart && employee.scheduledEnd
    ? ` ${employee.scheduledStart}-${employee.scheduledEnd}`
    : "";
  if (employee.attendanceStatus === "working") return `${employee.name}（出勤中${schedule}）`;
  if (employee.attendanceStatus === "on_break") return `${employee.name}（休憩中${schedule}）`;
  if (employee.attendanceStatus === "clocked_out") return `${employee.name}（本日シフト・退勤済み${schedule}）`;
  if (employee.attendanceStatus === "manager") return `${employee.name}（責任者）`;
  return `${employee.name}（本日シフト${schedule}）`;
}

type PosMember = {
  id: string;
  memberNumber: string;
  publicToken: string;
  displayName: string;
  lastName: string;
  firstName: string;
  fullName: string;
  phone: string;
  email: string;
  preferredLanguage: string;
  pointBalance: number;
  lifetimeSpendAmount: number;
  lifetimeVisitCount: number;
  currentTierKey: string;
};

type PosCoupon = {
  id: string;
  brandId: string;
  brandName: string;
  couponCode: string;
  name: string;
  displayNames?: Record<string, string>;
  discountType: string;
  discountValue: number;
  maxDiscountAmount: number | null;
  expiresAt: string;
  issuedSource: string;
};

type PosPreviousClosedSession = {
  id: string;
  businessDate: string;
  countedCashAmount: number;
  closedByName: string;
  closedAt: string;
};

type PosBusinessState = {
  businessDate: string;
  openLabel: string;
  closeLabel: string;
  status: string;
  statusLabel: string;
  detailLabel: string;
  tone: "active" | "warning" | "off";
};

type PosReconciliation = {
  businessDate: string;
  businessState: PosBusinessState | null;
  activeSession: PosCashSession | null;
  previousClosedSession: PosPreviousClosedSession | null;
  sessions: PosCashSession[];
  movements: PosCashMovement[];
  activeCashResponsibleEmployees: PosCashResponsibleEmployee[];
};

const paymentOptions = [
  { value: "cash", label: "現金", icon: Banknote },
  { value: "card", label: "カード", icon: CreditCard },
  { value: "other", label: "その他", icon: ShoppingCart }
];

function getCouponDiscountAmount(coupon: PosCoupon | undefined, amount: number, exchangeEligibleAmounts: number[] = []) {
  if (!coupon) return 0;
  const subtotal = Math.max(0, Math.round(amount || 0));
  if (isExchangeCoupon(coupon)) {
    const eligibleAmounts = exchangeEligibleAmounts.map((value) => Math.max(0, Math.round(Number(value) || 0))).filter((value) => value > 0);
    return eligibleAmounts.length ? Math.min(subtotal, Math.max(...eligibleAmounts)) : 0;
  }
  const value = Math.max(0, Math.round(Number(coupon.discountValue) || 0));
  const maxAmount = coupon.maxDiscountAmount == null ? null : Math.max(0, Math.round(Number(coupon.maxDiscountAmount) || 0));
  const rawDiscount = coupon.discountType === "percent" ? Math.floor(subtotal * value / 100) : value;
  return Math.min(subtotal, maxAmount == null ? rawDiscount : Math.min(rawDiscount, maxAmount));
}

function getCouponValueLabel(coupon: PosCoupon) {
  if (isExchangeCoupon(coupon)) return "1杯交換";
  return coupon.discountType === "percent" ? `${coupon.discountValue}%` : formatYen(coupon.discountValue);
}

function getCouponScopeLabel(coupon: { brandName?: string }) {
  return coupon.brandName ? `${coupon.brandName} 適用` : "全店舗適用";
}

function isExchangeCoupon(coupon: { issuedSource?: string; name?: string }) {
  return coupon.issuedSource === "stamp_campaign" || Boolean(coupon.name?.includes("無料券"));
}

function getCouponPosStatusLabel(coupon: PosCoupon, discount: number, subtotal: number) {
  if (isExchangeCoupon(coupon) && discount > 0) return "交換適用";
  if (discount > 0) return `-${formatYen(discount)}`;
  if (subtotal <= 0) return "商品追加後に適用";
  return "対象外";
}

function getCouponDaysUntilExpiry(coupon: Pick<PosCoupon, "expiresAt">) {
  if (!coupon.expiresAt) return null;
  const expiresAt = new Date(coupon.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return null;
  const now = new Date();
  return Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000);
}

function isCouponExpiringSoon(coupon: Pick<PosCoupon, "expiresAt">) {
  const days = getCouponDaysUntilExpiry(coupon);
  return days !== null && days >= 0 && days < 14;
}

function getCouponExpiryLabel(coupon: Pick<PosCoupon, "expiresAt">) {
  const days = getCouponDaysUntilExpiry(coupon);
  if (days === null) return "";
  if (days <= 0) return "本日まで";
  if (days === 1) return "明日まで";
  return `あと${days}日`;
}

function getDiscountEligibleAmount(preset: PosDiscountPreset, cart: PosCartItem[], subtotal: number) {
  if (preset.targetScope === "all") return subtotal;
  return cart.reduce((sum, item) => {
    if (preset.targetScope === "category" && item.category !== preset.targetValue) return sum;
    if (preset.targetScope === "item_kind" && item.itemKind !== preset.targetValue) return sum;
    if (preset.targetScope === "brand" && item.brandId !== preset.targetValue) return sum;
    return sum + getCartItemAmount(item);
  }, 0);
}

function getPosDiscountAmount(preset: PosDiscountPreset | undefined, cart: PosCartItem[], subtotal: number) {
  if (!preset) return 0;
  const eligibleAmount = Math.max(0, Math.round(getDiscountEligibleAmount(preset, cart, subtotal)));
  if (eligibleAmount <= 0) return 0;
  const rawDiscount = preset.discountType === "percent"
    ? Math.floor(eligibleAmount * preset.discountValue / 100)
    : preset.discountValue;
  return Math.min(eligibleAmount, Math.max(0, Math.round(rawDiscount)));
}

function getOrderTaxRate(settings: PosSettings, orderType: string) {
  return orderType === "eat_in" ? Number(settings.dineInTaxRate ?? 10) : Number(settings.takeoutTaxRate ?? 8);
}

function isPrintablePrinter(printer: PosPrinterConnection) {
  return hasPosPrinterDestination(printer);
}

function getTaxSummary(params: {
  subtotal: number;
  discountAmount: number;
  couponDiscountAmount: number;
  taxRate: number;
  priceTaxMode: string;
}) {
  const taxableAmount = Math.max(0, Math.round(params.subtotal - params.discountAmount - params.couponDiscountAmount));
  const taxRate = Math.max(0, Number(params.taxRate) || 0);
  if (params.priceTaxMode === "tax_excluded") {
    const taxAmount = Math.floor(taxableAmount * taxRate / 100);
    return { taxableAmount, taxAmount, payableAmount: taxableAmount + taxAmount };
  }
  const taxAmount = taxRate > 0 ? taxableAmount - Math.floor(taxableAmount / (1 + taxRate / 100)) : 0;
  return { taxableAmount, taxAmount, payableAmount: taxableAmount };
}

function getDiscountTargetLabel(preset: PosDiscountPreset) {
  if (preset.targetScope === "all") return "全商品";
  if (preset.targetScope === "category") return `カテゴリ: ${preset.targetValue}`;
  if (preset.targetScope === "item_kind") return `商品種別: ${preset.targetValue}`;
  if (preset.targetScope === "brand") return "ブランド指定";
  return "対象指定";
}

const orderTypeOptions = [
  { value: "eat_in", label: "店内" },
  { value: "takeout", label: "持ち帰り" }
];

const denominationCountOptions = [
  { value: "", label: "0" },
  ...Array.from({ length: 999 }, (_, index) => {
    const value = String(index + 1);
    return { value, label: value };
  })
];

function isDineInWeightMalatangOptionGroup(group: Pick<PosOptionGroup, "groupKey" | "name" | "posEnabled">) {
  return isDineInBowlOptionGroup(group);
}

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function formatDateTime(value: string) {
  if (!value) return "";
  // PostgreSQL text timestamps are normalized to ISO for Safari as well as Chromium.
  const iso=value.trim().replace(" ","T").replace(/([+-]\d{2})$/,"$1:00").replace(/(\.\d{3})\d+(?=Z$|[+-]\d{2}:\d{2}$)/,"$1");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function createCashBreakdownInput() {
  return yenDenominations.reduce((result, denomination) => {
    result[String(denomination)] = "";
    return result;
  }, {} as Record<string, string>);
}

function formatDenominationLabel(value: number) {
  return value >= 1000 ? `¥${value.toLocaleString("ja-JP")}` : `¥${value}`;
}

function getPaymentLabel(value: string) {
  return paymentOptions.find((option) => option.value === value)?.label ?? value;
}

function getOrderTypeLabel(value = "") {
  return orderTypeOptions.find((option) => option.value === value)?.label ?? value;
}

function getTransactionStatusLabel(transaction: Pick<PosTransaction, "status" | "paymentStatus" | "refundStatus">) {
  if (transaction.status === "cancelled" || transaction.paymentStatus === "refunded") return "返金済み";
  if (transaction.paymentStatus === "partial_refunded" || transaction.refundStatus === "partial") return "一部返金";
  return "会計済み";
}

function getItemPrice(item: Pick<PosMenuItem, "basePrice" | "priceOverride">) {
  return Math.round(Number(item.priceOverride ?? item.basePrice ?? 0));
}

function getCartItemAmount(item: Pick<PosCartItem, "measuredQuantity" | "measuredUnitPrice" | "optionTotal" | "quantity" | "basePrice" | "priceOverride">) {
  const unitAmount = item.measuredQuantity
    ? Math.round(item.measuredQuantity * Number(item.measuredUnitPrice ?? 0)) + item.optionTotal
    : getItemPrice(item) + item.optionTotal;
  return unitAmount * item.quantity;
}

function getAllowedRuleKey(groupKey: string) {
  const ruleKeys: Record<string, string> = {
    size: "allowedSizes",
    temperature: "temperatures",
    sweetness: "allowedSweetness",
    ice: "allowedIce",
    option: "allowedOptions",
    topping: "allowedToppings"
  };
  return ruleKeys[groupKey] ?? `allowed_${groupKey}`;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function getSchemaNumber(schema: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = schema?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function getNestedSchemaNumber(schema: Record<string, unknown> | undefined, parentKey: string, keys: string[]) {
  const parent = schema?.[parentKey];
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return null;
  return getSchemaNumber(parent as Record<string, unknown>, keys);
}

type PosItemPricing = Pick<PosMenuItem, "itemKind" | "posPricingMode" | "posPricingOverride" | "posWeightUnit" | "posWeightUnitPrice" | "variableSchema">;

function getWeightPricingConfig(item: PosItemPricing, orderType: string) {
  if (orderType !== "eat_in" || resolvePosItemPricingMode(item) !== "weight") return null;
  const schema = item.variableSchema ?? {};
  const nested = typeof schema.posWeightPricing === "object" && schema.posWeightPricing !== null
    ? schema.posWeightPricing as Record<string, unknown>
    : {};
  const unit = item.posWeightUnit || String(schema.weightUnit ?? schema.measuredUnit ?? nested.unit ?? "g").trim() || "g";
  const unitPrice = Number(item.posWeightUnitPrice ?? 0) > 0
    ? Number(item.posWeightUnitPrice)
    : getSchemaNumber(schema, ["pricePerGram", "weightUnitPrice", "measuredUnitPrice"]) ??
    getNestedSchemaNumber(schema, "posWeightPricing", ["pricePerGram", "unitPrice", "weightUnitPrice"]);
  return { unit, unitPrice };
}

function formatWeightPrice(item: PosItemPricing, orderType: string) {
  const config = getWeightPricingConfig(item, orderType);
  if (!config) return "";
  return config.unitPrice && config.unitPrice > 0
    ? `${formatYen(config.unitPrice)}/${config.unit}`
    : `重量単価未設定`;
}

function getOptionPrice(option: Pick<PosMenuOption, "priceDelta">) {
  return Math.round(Number(option.priceDelta ?? 0));
}

function getEffectiveSelectionType(group: PosOptionGroup) {
  return getPosOptionSelectionType(group);
}

function getOptionGroupLimit(group: PosOptionGroup) {
  return getPosOptionSelectionRules(group).max;
}

function getDefaultOptionId(group: PosOptionGroup, categoryName: string) {
  const categoryDefaults = group.ruleJson?.defaultOptionKeysByCategory;
  const categoryDefaultOptionKey = categoryDefaults && typeof categoryDefaults === "object" && !Array.isArray(categoryDefaults)
    ? String((categoryDefaults as Record<string, unknown>)[categoryName] ?? "").trim()
    : "";
  const defaultOptionKey = categoryDefaultOptionKey || String(group.ruleJson?.defaultOptionKey ?? "").trim();
  const configuredOption = defaultOptionKey
    ? group.options.find((option) => option.optionKey === defaultOptionKey || option.name === defaultOptionKey || option.id === defaultOptionKey)
    : null;
  if (configuredOption) return configuredOption.id;
  if (group.groupKey === "size") {
    const regularOption = group.options.find((option) => option.optionKey.toLowerCase() === "regular");
    if (regularOption) return regularOption.id;
  }
  return group.options[0]?.id ?? "";
}

function getCustomerDisplayLanguage(member: PosMember | null) {
  const language = String(member?.preferredLanguage || "").trim();
  return member && ["zh", "zh-Hant", "en", "ko", "vi", "ne"].includes(language) ? language : "ja";
}

function getLocalizedDisplayName(name: string, displayNames: Record<string, string> | undefined, language: string) {
  if (language === "ja") return name;
  return String(displayNames?.[language] || displayNames?.en || name || "").trim();
}

function getPhysicalCustomerDisplayLines(state: Record<string, unknown>, settings: PosPrinterSettings["customerDisplay"]) {
  const status = String(state.status ?? "idle");
  const subtotal = Math.max(0, Math.round(Number(state.subtotal ?? 0)));
  const tendered = Math.max(0, Math.round(Number(state.cashTenderedAmount ?? 0)));
  const change = Math.max(0, Math.round(Number(state.cashChangeAmount ?? 0)));
  const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
  const items = Array.isArray(state.items) ? state.items as Array<Record<string, unknown>> : [];
  const latestItem = items.at(-1);
  const itemName = String(latestItem?.name ?? "").trim();
  const itemQuantity = Math.max(1, Math.round(Number(latestItem?.quantity ?? 1)));

  if (status === "advertising" || status === "idle") {
    return {
      line1: settings.standbyLine1 || String(state.storeName || "いらっしゃいませ"),
      line2: settings.standbyLine2
    };
  }
  if (status === "complete") {
    return {
      line1: settings.thankYouLine,
      line2: String(state.paymentMethod) === "cash" ? `${settings.changeLabel} ${yen(change)}` : `${settings.totalLabel} ${yen(subtotal)}`
    };
  }
  if (status === "cash_change") {
    return { line1: `${settings.tenderedLabel} ${yen(tendered)}`, line2: `${settings.changeLabel} ${yen(change)}` };
  }
  if (status === "external_wait") {
    return { line1: `${String(state.paymentLabel || "決済")} お支払い`, line2: `${settings.totalLabel} ${yen(subtotal)}` };
  }
  return {
    line1: settings.showItemName && itemName ? `${itemName}${itemQuantity > 1 ? ` x${itemQuantity}` : ""}` : settings.orderPrompt,
    line2: `${settings.totalLabel} ${yen(subtotal)}`
  };
}

function getCategories(items: PosMenuItem[], categories: PosMenuCategory[], brandId: string) {
  const counts = new Map<string, number>();
  const masters = new Map<string, PosMenuCategory>();
  for (const item of items) {
    if (brandId && item.brandId !== brandId) continue;
    counts.set(item.category || "未分類", (counts.get(item.category || "未分類") ?? 0) + 1);
  }
  for (const category of categories) {
    if (brandId && category.brandId !== brandId) continue;
    masters.set(category.name, category);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count, sortOrder: masters.get(name)?.sortOrder ?? 9999 }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
}

/** A route chooses the mode once. Full navigation keeps live async work out of test sessions. */
export default function StorePosWorkspace({ debugMode: initialDebugMode = false }: {
  debugMode?: boolean;
}) {
  const [debugMode] = useState(initialDebugMode);
  const [debugSession, setDebugSession] = useState({ storeId: "", id: "" });
  const [debugResult, setDebugResult] = useState<PosDebugResult | null>(null);
  const [debugLoadError, setDebugLoadError] = useState("");
  const debugSequenceRef = useRef(0);
  const [debugEntryReady, setDebugEntryReady] = useState(false);
  const [offlineSyncBusy, setOfflineSyncBusy] = useState(false);
  const offlineSyncBusyRef = useRef(false);
  const { t } = useOsTranslation();
  const memberScannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const memberScannerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const memberScannerStreamRef = useRef<MediaStream | null>(null);
  const memberScannerActiveRef = useRef(false);
  const memberLookupLoadingRef = useRef(false);
  const customerDisplayMemberScanIdRef = useRef("");
  const selectedStoreIdRef = useRef("");
  const checkoutSectionRef = useRef<HTMLDivElement | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandMenu, setBrandMenu] = useState<{categories:PosMenuCategory[];items:PosMenuItem[];optionGroups:PosOptionGroup[]}>({categories:[],items:[],optionGroups:[]});
  const [dineInMenu, setDineInMenu] = useState<typeof brandMenu | null>(null);
  const [posMenuRevision,setPosMenuRevision] = useState('');
  const [dineInMenuRevision,setDineInMenuRevision] = useState('');
  const [tableCheckoutRequests, setTableCheckoutRequests] = useState<PosTableCheckoutRequest[]>([]);
  const [selectedTableCheckoutKey, setSelectedTableCheckoutKey] = useState("");
  const [tableCheckoutAdjustingKey, setTableCheckoutAdjustingKey] = useState("");
  const [checkoutRecovery, setCheckoutRecovery] = useState<PosCheckoutRecovery[]>([]);
  const [reprintOrderId] = useState(() => debugMode || typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("ticketOrderId") || "");
  const [printJobs, setPrintJobs] = useState<PosPrintJob[]>([]);
  const [printBusy, setPrintBusy] = useState(false);
  const uncertainCheckoutRef = useRef<{ signature: string; id: string; createdAt: string } | null>(null);
  const [posSettings, setPosSettings] = useState<PosSettings>({ dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: "PayCAS", priceTaxMode: "tax_included", discountPresets: [], printerSettings: defaultPosPrinterSettings, scaleTareSettings: defaultPosScaleTareSettings(), fulfillmentWorkspace: normalizePosFulfillmentWorkspaceSettings(null) });
  const [selectedStoreId, setSelectedStoreId] = useState(() => debugMode
    ? typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("storeId") || ""
    : getStoredStoreSelection());
  const { summary, setSummary, refresh: refreshSummary, refreshing: summaryRefreshing, error: summaryError } = usePosDailySummary<PosSummary>(selectedStoreId, !debugMode, emptyPosSummary);
  const [posSettingsStoreId, setPosSettingsStoreId] = useState("");
  const debugSessionId = debugSession.storeId === selectedStoreId ? debugSession.id : "";
  const debugDisplay = usePosDebugDisplay({ storeId: debugMode ? selectedStoreId : "", sessionId: debugSessionId, role: "pos" });
  useEffect(() => {
    if (!debugMode || !selectedStoreId) return;
    setDebugSession({ storeId: selectedStoreId, id: window.crypto.randomUUID() });
  }, [debugMode, selectedStoreId]);
  const showPrintQueue = !debugMode && posSettingsStoreId === selectedStoreId && posSettings.printerSettings.showPrintQueue;
  const relay=useStoreRelay(debugMode ? "" : selectedStoreId);
  const [scaleCapture,setScaleCapture]=useState<{id:string;quantity:number;itemId:string;measurement?:PosWeightMeasurement}|null>(null);
  const [scaleManualMode,setScaleManualMode]=useState(false);
  const [tarePresetId,setTarePresetId]=useState<PosScaleTarePresetId | ''>('small');
  const [scaleValidity,setScaleValidity]=useState<ScaleConfirmationValidity|null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [configuringItem, setConfiguringItem] = useState<PosMenuItem | null>(null);
  const [weighingPreviewId, setWeighingPreviewId] = useState("");
  const [optionQuery, setOptionQuery] = useState("");
  const [optionGroupId, setOptionGroupId] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const cartDialogRef = useStoreDialog(cartOpen, () => setCartOpen(false), "(max-width: 900px)");
  const optionDialogRef = useStoreDialog(Boolean(configuringItem), () => setConfiguringItem(null));
  const [optionDraft, setOptionDraft] = useState<Record<string, string[]>>({});
  const [weightDraft, setWeightDraft] = useState("");
  const [orderType, setOrderType] = useState("eat_in");
  const {items,categories,optionGroups} = orderType === 'eat_in' && dineInMenu ? dineInMenu : brandMenu;
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashTenderedAmount, setCashTenderedAmount] = useState("");
  const [memberLookupInput, setMemberLookupInput] = useState("");
  const [selectedMember, setSelectedMember] = useState<PosMember | null>(null);
  const [memberCoupons, setMemberCoupons] = useState<PosCoupon[]>([]);
  const [selectedCouponId, setSelectedCouponId] = useState("");
  const [customerSelectedCouponId, setCustomerSelectedCouponId] = useState("");
  const [discountPresetKey, setDiscountPresetKey] = useState("");
  const [discountNow, setDiscountNow] = useState(() => Date.now());
  const discountClockOffsetRef = useRef(0);
  const hasCampaignRules = posSettings.discountPresets.some(preset => preset.enabled && preset.applicationMode === "campaign");
  useEffect(() => {
    if (!hasCampaignRules) return;
    const update = () => {
      const next = Date.now() + discountClockOffsetRef.current;
      // These rules change by Japan calendar date; ordinary ticks must not redraw the whole POS.
      setDiscountNow(current => posCampaignDate(current) === posCampaignDate(next) ? current : next);
    };
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [hasCampaignRules]);
  const [memberLookupLoading, setMemberLookupLoading] = useState(false);
  const [memberScannerOpen, setMemberScannerOpen] = useState(false);
  const [memberScannerMessage, setMemberScannerMessage] = useState("");
  const [customerDisplayScannerLoading, setCustomerDisplayScannerLoading] = useState(false);
  const [customerDisplayScanPending, setCustomerDisplayScanPending] = useState(false);
  const [note, setNote] = useState("");
  const [receiptRequested, setReceiptRequested] = useState(false);
  const [invoiceRecipient, setInvoiceRecipient] = useState('');
  const [invoicePurpose, setInvoicePurpose] = useState('飲食代');
  function resetReceiptChoice() { setReceiptRequested(false); setInvoiceRecipient(''); setInvoicePurpose('飲食代'); }
  useEffect(() => { setReceiptRequested(false); setInvoiceRecipient(''); setInvoicePurpose('飲食代'); }, [selectedStoreId]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [printModeChoice, setPrintModeChoice] = useState<PosPrintMode | null>(null);
  const [requestedPrintOrder, setRequestedPrintOrder] = useState<{ id: string; request: number } | null>(null);
  const [lastPaidPrintOrderId, setLastPaidPrintOrderId] = useState("");
  useEffect(() => { setCheckoutNotice(null); setPrintModeChoice(null); setRequestedPrintOrder(null); setLastPaidPrintOrderId(""); }, [selectedStoreId]);
  const reconciliationGeneration = useRef(0);
  const posRealtimeCleanup = useRef<(() => void) | null>(null);
  const denyPosAuthorityRef = useRef<() => void>(() => {});
  const reconciliationReader = useRef<{ storeId: string; reader: ReturnType<typeof createStoreRefreshCoordinator> } | null>(null);
  const [reconciliation, setReconciliationState] = useState<PosReconciliation>({ businessDate: "", businessState: null, activeSession: null, previousClosedSession: null, sessions: [], movements: [], activeCashResponsibleEmployees: [] });
  function setReconciliation(value: SetStateAction<PosReconciliation>) {
    reconciliationGeneration.current++;
    setReconciliationState(value);
  }
  const [cashOpeningBreakdown, setCashOpeningBreakdown] = useState(() => createCashBreakdownInput());
  const [cashOpeningReason, setCashOpeningReason] = useState("");
  const [cashOpeningNote, setCashOpeningNote] = useState("");
  const [cashOpeningPickupNumber, setCashOpeningPickupNumber] = useState("001");
  const [cashMovementType, setCashMovementType] = useState("cash_out");
  const [cashMovementAmount, setCashMovementAmount] = useState("");
  const [cashMovementReason, setCashMovementReason] = useState("");
  const [cashCountedBreakdown, setCashCountedBreakdown] = useState(() => createCashBreakdownInput());
  const [cashZeroConfirmed, setCashZeroConfirmed] = useState(false);
  const [cashClosingNote, setCashClosingNote] = useState("");
  const [cashClosingResponsibleEmployeeId, setCashClosingResponsibleEmployeeId] = useState("");
  const [cashSaving, setCashSaving] = useState(false);
  const [cashActionError, setCashActionError] = useState("");
  const [cashDialog, setCashDialog] = useState<"open" | "movement" | "close" | null>(null);
  useEffect(() => { setCashOpeningPickupNumber("001"); }, [cashDialog, selectedStoreId]);
  useEffect(() => {
    setCashActionError("");
    setCashZeroConfirmed(false);
    setCashCountedBreakdown(createCashBreakdownInput());
    setCashClosingNote("");
  }, [cashDialog, selectedStoreId, reconciliation.activeSession?.id]);
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [transactions, setTransactions] = useState<PosTransaction[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<PosTransaction | null>(null);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [selectedRefundOptions, setSelectedRefundOptions] = useState<Array<{itemId:string;key:string}>>([]);
  const [refundError, setRefundError] = useState("");
  const pendingRefund = useRef<{signature:string;id:string}|null>(null);
  const [refundSaving, setRefundSaving] = useState(false);
  const [refundingTransactionId, setRefundingTransactionId] = useState("");
  const [selectedRefundItemIds, setSelectedRefundItemIds] = useState<string[]>([]);
  const [externalRefundConfirmed, setExternalRefundConfirmed] = useState(false);
  const [completedDisplayState, setCompletedDisplayState] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if(!debugMode&&selectedStoreId)void relay.refresh().catch(()=>{}); }, [debugMode, selectedStoreId, reconciliation.activeSession?.id, relay.refresh]);

  const [customerDisplayMode, setCustomerDisplayMode] = useState<"business" | "advertising">("business");
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlinePendingCount, setOfflinePendingCount] = useState(0);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [offlineSyncError, setOfflineSyncError] = useState("");

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  useEffect(() => {
    if (!debugMode) return;
    // Browser back/forward caches must not restore an earlier test cart or result.
    const discardRestoredTest = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", discardRestoredTest);
    return () => window.removeEventListener("pageshow", discardRestoredTest);
  }, [debugMode]);

  async function loadReconciliation(storeId = selectedStoreId) {
    if (debugMode || !storeId || reconciliationReader.current?.storeId !== storeId) return;
    await reconciliationReader.current.reader.refresh({ force: true });
  }

  async function readReconciliation(storeId: string, signal: AbortSignal) {
    const revision = reconciliationGeneration.current;
    const params = new URLSearchParams({ storeId, ts: String(Date.now()) });
    const response = await fetch(`/api/store/pos/reconciliation?${params.toString()}`, { cache: "no-store", signal });
    if (!response.ok) throw createReadError(response);
    const body = await response.json();
    if (signal.aborted || selectedStoreIdRef.current !== storeId || reconciliationGeneration.current !== revision) return;
    if (body.selectedStoreId !== storeId) throw new Error("reconciliation scope mismatch");
    const nextReconciliation = {
      businessDate: body.businessDate ?? "", businessState: body.businessState ?? null,
      activeSession: body.activeSession ?? null, previousClosedSession: body.previousClosedSession ?? null,
      sessions: body.sessions ?? [], movements: body.movements ?? [],
      activeCashResponsibleEmployees: body.activeCashResponsibleEmployees ?? []
    };
    setReconciliation(nextReconciliation);
    const acceptedRevision = reconciliationGeneration.current;
    setCashClosingResponsibleEmployeeId(current => {
      const employees = (body.activeCashResponsibleEmployees ?? []) as PosCashResponsibleEmployee[];
      return employees.some(employee => employee.id === current) ? current : employees[0]?.id ?? "";
    });
    const snapshot = await getOfflinePosSnapshot(storeId).catch(() => undefined);
    if (snapshot && !signal.aborted && selectedStoreIdRef.current === storeId && reconciliationGeneration.current === acceptedRevision) {
      await saveOfflinePosSnapshot({ ...snapshot, savedAt: new Date().toISOString(), reconciliation: nextReconciliation }).catch(() => undefined);
    }
  }

  async function load(nextStoreId = selectedStoreId, refreshMenu = true) {
    setLoading(true);
    const fetchPosData = (storeId: string) => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (debugMode) params.set("debug", "1");
      params.set("ts", String(Date.now()));
      return fetch(`/api/store/pos?${params.toString()}`, { cache: "no-store" });
    };
    let body: Record<string, any>;
    let loadedOnline = true;
    try {
      let response = await fetchPosData(nextStoreId);
      if (response.status === 403 && nextStoreId) response = await fetchPosData("");
      if (!response.ok) throw new Error("POS データを読み込めませんでした。");
      body = await response.json();
      if (debugMode && (body.debugMode !== true || !body.access || !validPosMenuSnapshot(body as PosMenuSnapshot))) {
        throw new Error("Invalid test menu projection");
      }
    } catch {
      if (debugMode) {
        setDebugLoadError("テスト用メニューを読み込めません。接続を確認して再試行してください。");
        setBrands([]); setBrandMenu({ categories: [], items: [], optionGroups: [] }); setDineInMenu(null);
        setPosSettingsStoreId(""); setCart([]); setConfiguringItem(null); setDebugResult(null);
        setLoading(false);
        return;
      }
      const snapshot = await getOfflinePosSnapshot(nextStoreId || getStoredStoreSelection()).catch(() => undefined);
      const snapshotAge = snapshot ? Date.now() - new Date(snapshot.savedAt).getTime() : Number.POSITIVE_INFINITY;
      if (!snapshot || !Number.isFinite(snapshotAge) || snapshotAge > 24 * 60 * 60 * 1000) {
        setMessage("オフライン用のメニューがありません。オンラインで一度 POS を開いてください。");
        setLoading(false);
        return;
      }
      body = snapshot.data;
      loadedOnline = false;
      setOfflineMode(true);
      if (snapshot.reconciliation) setReconciliation(snapshot.reconciliation as unknown as PosReconciliation);
    }
    const nextAccess = body.access as PosAccess;
    const nextBrands = body.brands as BrandOption[];
    const normalizeFulfillment = (item: PosMenuItem): PosMenuItem => ({ ...item, fulfillmentMode: getPosItemFulfillmentMode(item) });
    const nextItems = ((body.items ?? []) as PosMenuItem[]).filter(isPosSellableItem).map(normalizeFulfillment);
    const nextCategories = (body.categories ?? []) as PosMenuCategory[];
    const responseStoreId = body.selectedStoreId || nextAccess.stores?.[0]?.id || "";
    const nextBrandId = nextBrands.some((brand) => brand.id === selectedBrandId)
      ? selectedBrandId
      : nextBrands[0]?.id || "";
    const shouldApplyMenu = refreshMenu || responseStoreId !== selectedStoreIdRef.current;
    setStores(nextAccess.stores ?? []);
    if (shouldApplyMenu) {
      setBrands(nextBrands ?? []);
      setBrandMenu({categories:nextCategories,items:nextItems,optionGroups:(body.optionGroups ?? []) as PosOptionGroup[]});
      setDineInMenu(body.dineInMenu ? {
        categories:body.dineInMenu.categories ?? [],
        items:((body.dineInMenu.items ?? []) as PosMenuItem[]).filter(isPosSellableItem).map(normalizeFulfillment),
        optionGroups:body.dineInMenu.optionGroups ?? []
      } : null);
      setPosMenuRevision(String(body.posMenuRevision || ''));
      setDineInMenuRevision(String(body.dineInMenuRevision || ''));
    }
    const nextTableCheckoutRequests = (debugMode ? [] : body.tableCheckoutRequests ?? []) as PosTableCheckoutRequest[];
    setTableCheckoutRequests(nextTableCheckoutRequests);
    setSelectedTableCheckoutKey((current) => nextTableCheckoutRequests.some((request) => request.tableSessionKey === current) ? current : "");
    if (!debugMode) setSummary((body.todaySummary ?? { orderCount: 0, total: 0, average: 0, latestOrders: [] }) as PosSummary, responseStoreId);
    if (shouldApplyMenu) {
      const nextPosSettings = normalizeRuntimePosSettings(body.posSettings);
      const serverNow = Date.parse(String(body.serverTime || ""));
      if (Number.isFinite(serverNow)) discountClockOffsetRef.current = serverNow - Date.now();
      setDiscountNow(Date.now() + discountClockOffsetRef.current);
      setPosSettings(nextPosSettings);
      setPosSettingsStoreId(responseStoreId);
      setOrderType((current) => {
        if (current === "eat_in" && !nextPosSettings.dineInEnabled) return "takeout";
        if (current === "takeout" && !nextPosSettings.takeoutEnabled) return "eat_in";
        return current;
      });
    }
    setSelectedStoreId(responseStoreId);
    if (responseStoreId && !debugMode) setStoredStoreSelection(responseStoreId);
    if (loadedOnline && !debugMode) {
      if (shouldApplyMenu) {
        const previousSnapshot = await getOfflinePosSnapshot(responseStoreId).catch(() => undefined);
        await saveOfflinePosSnapshot({
          storeId: responseStoreId,
          savedAt: new Date().toISOString(),
          data: body,
          reconciliation: previousSnapshot?.reconciliation ?? null
        }).catch(() => undefined);
      }
      await loadReconciliation(responseStoreId);
      setOfflineMode(false);
    }
    if (shouldApplyMenu) {
      setSelectedBrandId(nextBrandId);
      setSelectedCategory(null);
      setQuery("");
    }
    setMessage("");
    if (debugMode) setDebugLoadError("");
    setLoading(false);
  }

  async function refreshOfflinePendingCount() {
    if (debugMode) return [];
    const pending = await listOfflinePosOrders().catch(() => []);
    setOfflinePendingCount(pending.length);
    return pending;
  }

  async function syncOfflineOrders() {
    if (debugMode || !navigator.onLine || offlineSyncBusyRef.current) return;
    offlineSyncBusyRef.current = true;
    setOfflineSyncBusy(true);
    try {
    setOfflineSyncError("");
    const pending = await refreshOfflinePendingCount();
    const hadPendingOrders = pending.length > 0;
    for (const order of pending) {
      try {
        const response = await fetch("/api/store/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(order.request)
        });
        const body = await response.json().catch(() => ({})) as { error?: string; orderId?: string; servingTickets?: PosServingTicket[] };
        if (!response.ok) throw new Error(body.error || "同期できませんでした。");
        if (body.orderId) {
          for (const job of (await listPosPrintJobs()).filter((job) => job.clientOrderId === order.clientOrderId)) {
            await savePosPrintJob({ ...job, orderId: body.orderId, offline: false,
              itemId: body.servingTickets?.find((ticket) => ticket.pickupCode === job.payload.order?.pickupCode)?.itemId || job.itemId });
          }
          await refreshPrintJobs();
        }
        await removeOfflinePosOrder(order.clientOrderId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "同期できませんでした。";
        setOfflineSyncError(errorMessage);
        await updateOfflinePosOrderError(order, errorMessage).catch(() => undefined);
        break;
      }
    }
    const remaining = await refreshOfflinePendingCount();
    if (remaining.length === 0) {
      setOfflineMode(false);
      if (hadPendingOrders) void load(selectedStoreIdRef.current, false);
    }
    } finally {
      offlineSyncBusyRef.current = false;
      setOfflineSyncBusy(false);
    }
  }

  useEffect(() => {
    if (debugMode || !selectedStoreId) return;
    let active = true;
    const denyAuthority = () => {
      if (!active || selectedStoreIdRef.current !== selectedStoreId) return;
      posRealtimeCleanup.current?.(); reader.stop();
      setSelectedMember(null); setMemberCoupons([]); setSelectedCouponId(""); setCustomerSelectedCouponId(""); setCustomerDisplayScanPending(false);
      setReconciliation({ businessDate: "", businessState: null, activeSession: null, previousClosedSession: null, sessions: [], movements: [], activeCashResponsibleEmployees: [] });
    };
    denyPosAuthorityRef.current = denyAuthority;
    const reader = createStoreRefreshCoordinator(signal => readReconciliation(selectedStoreId, signal), {
      healthyIntervalMs: 5 * 60_000, fallbackIntervalMs: 60_000,
      onUnauthorized: denyAuthority
    });
    reconciliationReader.current = { storeId: selectedStoreId, reader };
    reader.start({ immediate: true });
    return () => {
      active = false; reconciliationGeneration.current++; reader.stop();
      if (reconciliationReader.current?.reader === reader) reconciliationReader.current = null;
    };
    // This reader captures only the selected scope; live edits are fenced by its revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId, debugMode]);

  useEffect(() => {
    void load(selectedStoreId);
    if (debugMode) return;
    void Promise.all([refreshPrintJobs(), refreshOfflinePendingCount()]).then(() => {
      setDebugEntryReady(true);
      void syncOfflineOrders();
    }).catch(() => { setDebugEntryReady(false); });
    setBrowserOnline(navigator.onLine);
    const handleOnline = () => {
      setBrowserOnline(true);
      void syncOfflineOrders();
    };
    const handleOffline = () => {
      setBrowserOnline(false);
      setOfflineMode(true);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    memberLookupLoadingRef.current = memberLookupLoading;
  }, [memberLookupLoading]);

  useEffect(() => {
    if (!offlineMode) return;
    setPaymentMethod("cash");
    setDiscountPresetKey("");
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setSelectedTableCheckoutKey("");
    setMemberScannerOpen(false);
    setCustomerDisplayScanPending(false);
    setTransactionDialogOpen(false);
    setCashDialog(null);
    clearSelectedMember();
  }, [offlineMode]);

  useEffect(() => {
    if (!discountPresetKey) return;
    if (posSettings.discountPresets.some((preset) => preset.enabled && preset.key === discountPresetKey)) return;
    setDiscountPresetKey("");
  }, [discountPresetKey, posSettings.discountPresets]);

  useEffect(() => {
    // Product options and the mobile cart acquire their own lock in useStoreDialog.
    const hasDialog = transactionDialogOpen || Boolean(cashDialog) || memberScannerOpen;
    if (!hasDialog) return;
    return lockBodyScroll();
  }, [cashDialog, memberScannerOpen, transactionDialogOpen]);

  useEffect(() => {
    if (debugMode || !memberScannerOpen) return;
    let cancelled = false;
    let frameId = 0;

    async function startScanner() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMemberScannerMessage("カメラを利用できません。会員番号または電話番号を入力してください。");
        return;
      }

      try {
        setMemberScannerMessage("会員証の QR をカメラにかざしてください。");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        memberScannerStreamRef.current = stream;
        const video = memberScannerVideoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        memberScannerActiveRef.current = true;
        const scan = () => {
          if (cancelled || !memberScannerActiveRef.current) return;
          try {
            const canvas = memberScannerCanvasRef.current;
            const context = canvas?.getContext("2d", { willReadFrequently: true });
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!canvas || !context || !width || !height) {
              frameId = window.requestAnimationFrame(scan);
              return;
            }
            canvas.width = width;
            canvas.height = height;
            context.drawImage(video, 0, 0, width, height);
            const imageData = context.getImageData(0, 0, width, height);
            const result = jsQR(imageData.data, width, height);
            const code = result?.data?.trim();
            if (code) {
              memberScannerActiveRef.current = false;
              setMemberScannerMessage("会員 QR を読み取りました。");
              setMemberScannerOpen(false);
              void lookupMember(code);
              return;
            }
          } catch {
            setMemberScannerMessage("QR を読み取れません。角度を変えてもう一度かざしてください。");
          }
          frameId = window.requestAnimationFrame(scan);
        };
        frameId = window.requestAnimationFrame(scan);
      } catch {
        setMemberScannerMessage("カメラを起動できません。権限を確認するか、会員番号または電話番号を入力してください。");
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      memberScannerActiveRef.current = false;
      if (frameId) window.cancelAnimationFrame(frameId);
      memberScannerStreamRef.current?.getTracks().forEach((track) => track.stop());
      memberScannerStreamRef.current = null;
      if (memberScannerVideoRef.current) memberScannerVideoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberScannerOpen]);

  // Count the same catalog rows as product tiles, before keyword filtering.
  // Management categories remain saved even while they have no displayed products.
  const categorySummaries = useMemo(() => getCategories(items, categories, selectedBrandId), [categories, items, selectedBrandId]);
  const activeCategory = selectedCategory && categorySummaries.some(category => category.name === selectedCategory) ? selectedCategory : null;
  useEffect(() => {
    if (selectedCategory && !activeCategory) setSelectedCategory(null);
  }, [selectedCategory, activeCategory]);
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedBrandId && item.brandId !== selectedBrandId) return false;
      if (activeCategory && (item.category || "未分類") !== activeCategory) return false;
      if (normalizedQuery && !item.name.toLowerCase().includes(normalizedQuery)) return false;
      return true;
    });
  }, [items, query, selectedBrandId, activeCategory]);
  const visibleOrderTypeOptions = useMemo(
    () => orderTypeOptions.filter((option) => (
      (option.value !== "eat_in" || posSettings.dineInEnabled) &&
      (option.value !== "takeout" || posSettings.takeoutEnabled)
    )),
    [posSettings.dineInEnabled, posSettings.takeoutEnabled]
  );

  const subtotal = cart.reduce((sum, item) => sum + getCartItemAmount(item), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const selectedTableCheckout = tableCheckoutRequests.find((request) => request.tableSessionKey === selectedTableCheckoutKey) ?? null;
  const tableCheckoutAmount = Number(selectedTableCheckout?.totalAmount ?? 0);
  const enabledDiscountPresets = posSettings.discountPresets.filter((preset) => preset.enabled && preset.applicationMode !== "campaign");
  const discountEvaluation = evaluatePosDiscounts(posSettings.discountPresets, discountPresetKey,
    cart.map(item => ({ ...item, amount: getCartItemAmount(item) })), subtotal, discountNow);
  const giftCatalog = [...items.filter(item=>!isPosBowl(item)).map(item=>({id:item.id,sourceItemId:item.sourceItemId,brandId:item.brandId,category:item.category,name:item.name,displayNames:item.displayNames,
    price:getItemPrice(item),available:item.isAvailable!==false,fixed:!getWeightPricingConfig(item,orderType),requiresOptions:getItemOptionGroups(item).some(group=>getPosOptionSelectionRules(group).min>0)})),...posOptionGiftCatalog(optionGroups)];
  const bowlEvaluation = evaluatePosBowlBenefits(posSettings.discountPresets,discountPresetKey,cart.map(item=>({...item,amount:getCartItemAmount(item),isBowl:isPosBowl(item),choice:item.bowlBenefit})),giftCatalog,discountNow);
  const hasBowlChoice = bowlEvaluation.applications.length > 0 || cart.some(item=>item.bowlBenefit);
  const selectedDiscountPreset = bowlEvaluation.preset;
  const posDiscountAmount = bowlEvaluation.amount;
  const discountQuote = hasBowlChoice ? posBowlQuote(bowlEvaluation) : { version: 1 as const, appliedKey: discountEvaluation.appliedKey, amount: posDiscountAmount };
  const selectedCoupon = memberCoupons.find((coupon) => coupon.id === selectedCouponId);
  const couponBlockedByDiscount = bowlEvaluation.usedRules.some(rule=>!rule.allowCouponCombination);
  const couponDiscountAmount = couponBlockedByDiscount ? 0 : getCouponDiscountAmount(selectedCoupon, subtotal, getExchangeEligibleBodyAmounts(selectedCoupon));
  const taxRate = getOrderTaxRate(posSettings, orderType);
  const taxSummary = getTaxSummary({
    subtotal,
    discountAmount: posDiscountAmount,
    couponDiscountAmount,
    taxRate,
    priceTaxMode: posSettings.priceTaxMode
  });
  const payableAmount = taxSummary.payableAmount;
  const activeCheckoutAmount = selectedTableCheckout ? tableCheckoutAmount : payableAmount;
  const getMenuDisplayPrice = (item: PosMenuItem) => {
    const price = getItemPrice(item);
    return posSettings.priceTaxMode === "tax_excluded" ? price + Math.floor(price * taxRate / 100) : price;
  };
  const recommendedCoupon = useMemo(() => {
    if (couponBlockedByDiscount || !memberCoupons.length || subtotal <= 0) return undefined;
    const usableCoupons = memberCoupons
      .map((coupon) => ({
        coupon,
        discount: getCouponDiscountAmount(coupon, subtotal, getExchangeEligibleBodyAmounts(coupon)),
        daysUntilExpiry: getCouponDaysUntilExpiry(coupon),
        expiringSoon: isCouponExpiringSoon(coupon)
      }))
      .filter((entry) => entry.discount > 0);
    if (!usableCoupons.length) return undefined;
    return usableCoupons.sort((left, right) => {
      if (left.expiringSoon !== right.expiringSoon) return left.expiringSoon ? -1 : 1;
      if (left.expiringSoon && right.expiringSoon) return (left.daysUntilExpiry ?? 9999) - (right.daysUntilExpiry ?? 9999);
      return right.discount - left.discount;
    })[0]?.coupon;
  }, [cart, couponBlockedByDiscount, memberCoupons, subtotal]);
  const recommendedCouponDiscountAmount = getCouponDiscountAmount(recommendedCoupon, subtotal, getExchangeEligibleBodyAmounts(recommendedCoupon));
  const selectedCouponDiscountAmount = getCouponDiscountAmount(selectedCoupon, subtotal, getExchangeEligibleBodyAmounts(selectedCoupon));
  const recommendedCouponExpiryLabel = recommendedCoupon ? getCouponExpiryLabel(recommendedCoupon) : "";
  const recommendedCouponExpiringSoon = recommendedCoupon ? isCouponExpiringSoon(recommendedCoupon) : false;
  const shouldShowRecommendedCoupon = Boolean(
    recommendedCoupon &&
    recommendedCoupon.id !== selectedCouponId &&
    (recommendedCouponExpiringSoon || recommendedCouponDiscountAmount > selectedCouponDiscountAmount)
  );
  const nativePrintAvailable = !debugMode && typeof window !== "undefined" && Boolean(window.Foundr1Printer?.print)
    && hasPosPrinterDestination(getReceiptPrinter(posSettings.printerSettings));
  const relayPrintAvailable = !debugMode && Boolean(browserOnline && !offlineMode && relay.owner && relay.station?.print_enabled && relay.station.device_online);
  const canAutoPrint = posSettings.printerSettings.enabled && (nativePrintAvailable || relayPrintAvailable);
  const intendedPrinterSettings = { ...posSettings.printerSettings, enabled: true };
  const hasIntendedPrintDocuments = getPosReceiptCopies(intendedPrinterSettings) > 0
    || (cart.some(isPosBowl) && (["kitchen", "finishing", "pickup"] as const).some(kind => getPosBowlTicketCopies(intendedPrinterSettings, kind) > 0))
    || (cart.some(item => !isPosBowl(item) && !isPosImmediateItem(item)) && intendedPrinterSettings.kitchenEnabled);
  const defaultPrintMode: PosPrintMode = !hasIntendedPrintDocuments ? "none" : canAutoPrint ? "auto" : "deferred";
  const printMode: PosPrintMode = printModeChoice === "auto" && !canAutoPrint ? "deferred" : printModeChoice ?? defaultPrintMode;
  const printDocuments = usePosPrintDocuments({ storeId: debugMode ? "" : selectedStoreId, directAvailable: nativePrintAvailable, relayOwner: relay.owner });
  const canUseRegister = debugMode ? Boolean(selectedStoreId && !loading && posSettingsStoreId === selectedStoreId) : Boolean(reconciliation.activeSession);
  const offlineCheckoutOnly = !debugMode && (offlineMode || !browserOnline);
  const publishLiveCustomerDisplay = useCustomerDisplayPublisher({
    storeId: selectedStoreId, owner: relay.owner,
    enabled: !debugMode && canUseRegister && !offlineCheckoutOnly && posSettingsStoreId === selectedStoreId && (!relay.required || Boolean(relay.owner))
  });
  const cashTenderedValue = Number(cashTenderedAmount || 0);
  const cashChangeAmount = paymentMethod === "cash" && cashTenderedAmount.trim() ? cashTenderedValue - activeCheckoutAmount : null;
  const canCheckout = Boolean(
    (cart.length > 0 || selectedTableCheckout) &&
    !saving &&
    bowlEvaluation.errors.length===0 &&
    canUseRegister &&
    (!offlineCheckoutOnly || (!selectedTableCheckout && !selectedMember && !selectedCouponId && !discountPresetKey && !posDiscountAmount && !hasBowlChoice && paymentMethod === "cash")) &&
    (paymentMethod !== "cash" || (cashTenderedAmount.trim() !== "" && cashTenderedValue >= activeCheckoutAmount))
  );
  const hasCurrentTransaction = Boolean(
    cart.length > 0 ||
    Boolean(configuringItem) ||
    selectedTableCheckout ||
    selectedMember ||
    memberLookupInput.trim() ||
    cashTenderedAmount.trim() ||
    note.trim() ||
    discountPresetKey ||
    selectedCouponId
  );
  const hasPendingCheckout = checkoutRecovery.some((record) => record.storeId === selectedStoreId);
  const menuRefreshBlocked = saving || printBusy || printDocuments.busy || cashSaving || refundSaving || loading || offlineCheckoutOnly
    || offlinePendingCount > 0 || hasPendingCheckout || Boolean(selectedTableCheckout) || Boolean(uncertainCheckoutRef.current)
    || memberLookupLoading || customerDisplayScanPending;
  const hasMenuDraft = hasCurrentTransaction || Boolean(configuringItem);
  const menuRefresh = usePosMenuRefresh<PosMenuSnapshot>({
    debugMode,
    storeId: selectedStoreId,
    enabled: Boolean(selectedStoreId && posSettingsStoreId === selectedStoreId && !loading && !offlineCheckoutOnly),
    posMenuRevision, dineInMenuRevision,
    validateSnapshot: snapshot => validPosMenuSnapshot(snapshot) && (!debugMode || snapshot.debugMode === true),
    prepareManualApply: () => {
      if (menuRefreshBlocked) return false;
      if (hasMenuDraft) {
        if (!window.confirm(t("最新のメニューに更新します。未会計の商品・選択内容をクリアして、商品を選び直しますか？"))) return false;
        cancelCurrentTransaction();
        setConfiguringItem(null); setOptionDraft({}); setWeightDraft(""); setOptionQuery(""); setOptionGroupId("");
        setScaleCapture(null); setScaleValidity(null); setCartOpen(false);
      }
      return true;
    },
    apply: snapshot => {
      const brandCatalog = { items: snapshot.items.filter(isPosSellableItem).map(item => ({ ...item, fulfillmentMode: getPosItemFulfillmentMode(item) })), categories: snapshot.categories, optionGroups: snapshot.optionGroups };
      const localCatalog = snapshot.dineInMenu ? { ...snapshot.dineInMenu, items: snapshot.dineInMenu.items.filter(isPosSellableItem).map(item => ({ ...item, fulfillmentMode: getPosItemFulfillmentMode(item) })) } : null;
      setBrands(snapshot.brands); setBrandMenu(brandCatalog); setDineInMenu(localCatalog);
      setPosMenuRevision(snapshot.posMenuRevision); setDineInMenuRevision(snapshot.dineInMenuRevision);
      const nextSettings = normalizeRuntimePosSettings(snapshot.posSettings);
      setPosSettings(nextSettings); setPosSettingsStoreId(snapshot.selectedStoreId);
      setOrderType(current => current === "eat_in" && !nextSettings.dineInEnabled ? "takeout" : current === "takeout" && !nextSettings.takeoutEnabled ? "eat_in" : current);
      setSelectedBrandId(current => snapshot.brands.some(brand => brand.id === current) ? current : snapshot.brands[0]?.id || "");
      const nextCatalog = orderType === "eat_in" && localCatalog ? localCatalog : brandCatalog;
      setSelectedCategory(current => current && nextCatalog.categories.some(category => category.name === current) ? current : null);
      if (!debugMode) void saveOfflinePosSnapshot({ storeId: snapshot.selectedStoreId, savedAt: new Date().toISOString(), data: snapshot, reconciliation: { ...reconciliation } }).catch(() => undefined);
      setMessage("メニューを更新しました。");
    }
  });
  const menuBlocksCurrentOrder = !selectedTableCheckout && !hasPendingCheckout && !uncertainCheckoutRef.current
    && (menuRefresh.posChanged || menuRefresh.dineInChanged);
  const canRefundSelectedTransaction = Boolean(
    selectedTransaction &&
    selectedTransaction.status !== "cancelled" &&
    selectedTransaction.paymentStatus !== "refunded" &&
    selectedTransaction.cashSessionStatus === "open"
  );
  const getRefundItemState = (item: PosTransactionItem) => {
    const hasCouponBenefit = Boolean(item.couponId) || Number(item.couponDiscountAmount) > 0;
    const storedPaidAmount = Number(item.paidAmount ?? 0);
    const paidAmount = item.remainingPaidAmount ?? (storedPaidAmount > 0 ? storedPaidAmount : hasCouponBenefit ? 0 : Number(item.amount ?? 0));
    const isRefunded = item.refundStatus === "refunded";
    const canRefund = !isRefunded && (paidAmount > 0 || hasCouponBenefit);
    return { canRefund, hasCouponBenefit, isRefunded, paidAmount };
  };
  const refundableRefundItems = (selectedTransaction?.items ?? []).filter((item) => getRefundItemState(item).canRefund);
  const selectedRefundItems = refundableRefundItems.filter((item) => selectedRefundItemIds.includes(item.id));
  const selectedRefundOptionRows = (selectedTransaction?.items ?? []).flatMap(item => (item.refundOptions ?? []).filter(option => !option.refunded && selectedRefundOptions.some(selected => selected.itemId === item.id && selected.key === option.key)).map(option => ({...option,itemId:item.id})));
  const selectedRefundCount = selectedRefundItems.length + selectedRefundOptionRows.length;
  const selectedRefundPaidAmount = selectedRefundItems.reduce((sum, item) => sum + getRefundItemState(item).paidAmount, 0) + selectedRefundOptionRows.reduce((sum, option) => sum + option.paidAmount, 0);
  const selectedRefundCouponCount = selectedRefundItems.filter((item) => getRefundItemState(item).hasCouponBenefit).length;
  const canRefundSelectedItem = Boolean(canRefundSelectedTransaction && selectedRefundCount);
  const selectedItemRefundNeedsExternalConfirmation = Boolean(
    selectedTransaction &&
    selectedTransaction.paymentMethod !== "cash" &&
    selectedRefundPaidAmount > 0
  );

  useEffect(() => {
    setSelectedRefundItemIds([]);
    setSelectedRefundOptions([]);
    setRefundError("");
  }, [selectedTransaction]);

  const openingBreakdownTotal = getCashBreakdownTotal(cashOpeningBreakdown);
  const countedBreakdownTotal = getCashBreakdownTotal(cashCountedBreakdown);
  const openingHandoverDifference = reconciliation.previousClosedSession
    ? openingBreakdownTotal - Number(reconciliation.previousClosedSession.countedCashAmount ?? 0)
    : null;
  const hasOpeningHandoverDifference = openingHandoverDifference !== null && openingHandoverDifference !== 0;
  const openingPickupNumberValid = /^[0-9]{1,3}$/.test(cashOpeningPickupNumber) && Number(cashOpeningPickupNumber) >= 1 && Number(cashOpeningPickupNumber) <= 999;
  const openingPickupNumberError = openingPickupNumberValid ? "" : "開始する呼び出し番号を001〜999の整数で入力してください。";
  const cashOpenBlockedReason = !hasOpeningHandoverDifference || Boolean(cashOpeningNote.trim()) ? "" : "前回レジ締め金額と開始金額が異なります。引継ぎ差額理由を選ぶか入力すると、開始できます。";
  const canOpenRegister = openingPickupNumberValid && !cashOpenBlockedReason;
  const hasCountedCashInput = cashZeroConfirmed || Object.values(cashCountedBreakdown).some((value) => value.trim() !== "");
  const closingDifference = !hasCountedCashInput || !reconciliation.activeSession
    ? null
    : countedBreakdownTotal - reconciliation.activeSession.expectedCashAmount;
  const canCloseRegister = Boolean(
    reconciliation.activeSession &&
    hasCountedCashInput &&
    cashClosingResponsibleEmployeeId &&
    (closingDifference === 0 || cashClosingNote.trim())
  );
  const cashCloseBlockedReason = offlinePendingCount > 0
    ? "未同期のオフライン注文があります。同期完了後にレジ締めしてください。"
    : !hasCountedCashInput
      ? "現金の枚数を入力するか、現金0円を確認してください。"
      : !cashClosingResponsibleEmployeeId
        ? "締め責任者を選択してください。"
        : closingDifference !== 0 && !cashClosingNote.trim()
          ? "差額があるため理由を入力してください。"
          : "";

  function updateCashBreakdown(
    setter: Dispatch<SetStateAction<Record<string, string>>>,
    denomination: number,
    value: string
  ) {
    const normalized = normalizeIntegerInput(value);
    setter((current) => ({ ...current, [String(denomination)]: normalized }));
  }

  async function lookupMember(scannedCode?: string) {
    if (debugMode) return;
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は会員証・クーポンを利用できません。");
      return;
    }
    const code = (scannedCode ?? memberLookupInput).trim();
    if (!selectedStoreId || !code || memberLookupLoading) return;
    setMemberLookupLoading(true);
    setMessage("");
    setMemberLookupInput(code);
    setCustomerDisplayMode("business");
    try {
      const params = new URLSearchParams({ storeId: selectedStoreId, code });
      const response = await fetch(`/api/store/pos/member?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "会員を確認できませんでした。");
      const scannedLanguage = String(body.selectedLanguage || "").trim();
      const member = body.member as PosMember;
      setSelectedMember(scannedLanguage ? { ...member, preferredLanguage: scannedLanguage } : member);
      const coupons = Array.isArray(body.coupons) ? body.coupons as PosCoupon[] : [];
      setMemberCoupons(coupons);
      const scannedCouponId = typeof body.selectedCouponId === "string" ? body.selectedCouponId : "";
      const matchedScannedCouponId = coupons.some((coupon) => coupon.id === scannedCouponId) ? scannedCouponId : "";
      setSelectedCouponId(matchedScannedCouponId);
      setCustomerSelectedCouponId(matchedScannedCouponId);
      setMessage("会員を会計に紐づけました。");
    } catch (error) {
      setSelectedMember(null);
      setMemberCoupons([]);
      setSelectedCouponId("");
      setCustomerSelectedCouponId("");
      setMessage(error instanceof Error ? error.message : "会員を確認できませんでした。");
    } finally {
      setMemberLookupLoading(false);
    }
  }

  async function openCustomerDisplayMemberScanner() {
    if (debugMode) return;
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は客席表示の会員 QR 読取を利用できません。");
      return;
    }
    if (!selectedStoreId || customerDisplayScannerLoading) return;
    setCustomerDisplayScannerLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/pos/customer-display/member-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId, action: "open_scanner" })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "客席表示に会員 QR 読取を開始できませんでした。");
      setCustomerDisplayScanPending(true);
      setMessage("客席表示で会員 QR 読取を開始しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "客席表示に会員 QR 読取を開始できませんでした。");
    } finally {
      setCustomerDisplayScannerLoading(false);
    }
  }

  useEffect(() => {
    if (debugMode || !selectedStoreId || offlineCheckoutOnly) return;
    let active = true;
    let pusher: ReturnType<typeof import("../../../lib/shared-pusher-client")["acquireSharedPusher"]> | undefined;
    let cleanupRealtime: (() => void) | undefined;
    const request = new AbortController();
    const timeout = window.setTimeout(() => request.abort(), 12_000);
    const handleScanRequest = (scanRequest?: { id?: string; code?: string } | null) => {
      if (!active || selectedStoreIdRef.current !== selectedStoreId) return;
      const requestId = String(scanRequest?.id ?? "").trim();
      const code = String(scanRequest?.code ?? "").trim();
      if (!requestId || !code || requestId === customerDisplayMemberScanIdRef.current) return;
      customerDisplayMemberScanIdRef.current = requestId;
      setCustomerDisplayScanPending(false);
      void lookupMember(code);
    };
    const scanReader = createStoreRefreshCoordinator(async signal => {
      if (memberLookupLoadingRef.current) return;
      const params = new URLSearchParams({ storeId: selectedStoreId });
      if (customerDisplayMemberScanIdRef.current) params.set("since", customerDisplayMemberScanIdRef.current);
      const response = await fetch(`/api/store/pos/customer-display/member-scan?${params.toString()}`, { cache: "no-store", signal });
      if (!response.ok) throw createReadError(response);
      const body = await response.json() as { scanRequest?: { id?: string; code?: string } | null };
      if (!signal.aborted) handleScanRequest(body.scanRequest);
    }, {
      // A two-minute QR handoff is a finite operation, not an idle page poll.
      healthyIntervalMs: customerDisplayScanPending ? 3000 : 5 * 60_000,
      fallbackIntervalMs: customerDisplayScanPending ? 3000 : 60_000,
      maxFailureIntervalMs: customerDisplayScanPending ? 30_000 : 5 * 60_000,
      onUnauthorized: () => { if (active) denyPosAuthorityRef.current(); }
    });
    scanReader.start({ immediate: true });
    void fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(selectedStoreId)}`, { cache: "no-store", signal: request.signal })
      .then(response => response.ok ? response.json() : null).then(async config => {
        if (!active || !config?.key || !config?.cluster || !Array.isArray(config.channels) || !config.channels.length) return;
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        const refreshReconciliation = () => { if (active && reconciliationReader.current?.storeId === selectedStoreId) void reconciliationReader.current.reader.refresh(); };
        cleanupRealtime = bindStoreRealtimeChannels(pusher, {
          channels: config.channels, events: [], onEvent: () => {},
          onUnauthorized: () => { if (active) denyPosAuthorityRef.current(); },
          onHealthChange: healthy => {
            scanReader.setRealtimeHealthy(healthy);
            if (reconciliationReader.current?.storeId === selectedStoreId) reconciliationReader.current.reader.setRealtimeHealthy(healthy);
            if (healthy) {
              void scanReader.refresh({ force: true });
              if (reconciliationReader.current?.storeId === selectedStoreId) void reconciliationReader.current.reader.refresh({ force: true });
            }
          }
        });
        for (const name of config.channels as string[]) {
          const channel = pusher.subscribe(name);
          channel.bind("pos.customer-display.updated", (payload: { state?: { memberScanRequest?: { id?: string; code?: string } | null } }) => handleScanRequest(payload?.state?.memberScanRequest));
          channel.bind("pos.reconciliation.updated", refreshReconciliation);
          channel.bind("order.created", refreshReconciliation);
          channel.bind("order.updated", refreshReconciliation);
        }
      }).catch(() => { /* Scoped fallback remains active. */ }).finally(() => window.clearTimeout(timeout));
    const cleanup = () => {
      active = false; scanReader.stop(); request.abort(); window.clearTimeout(timeout);
      cleanupRealtime?.(); pusher?.disconnect();
      if (reconciliationReader.current?.storeId === selectedStoreId) reconciliationReader.current.reader.setRealtimeHealthy(false);
    };
    posRealtimeCleanup.current = cleanup;
    return () => { cleanup(); if (posRealtimeCleanup.current === cleanup) posRealtimeCleanup.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerDisplayScanPending, offlineCheckoutOnly, selectedStoreId, debugMode]);

  useEffect(() => {
    if (!customerDisplayScanPending) return;
    const timer = window.setTimeout(() => setCustomerDisplayScanPending(false), 2 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [customerDisplayScanPending]);

  function clearSelectedMember() {
    setSelectedMember(null);
    setMemberCoupons([]);
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setMemberLookupInput("");
    setCustomerDisplayMode("business");
  }

  function getItemOptionGroups(item: PosMenuItem) {
    const scopedItem = { ...item, posPricingMode: getWeightPricingConfig(item, orderType) ? 'weight' : 'fixed' };
    return optionGroups
      .filter(group => (!item.optionGroupIds || item.optionGroupIds.includes(group.id))
        && dineInGroupAppliesToItem(group, scopedItem))
      .map(group => ({ ...group, options: group.options.filter(option => dineInOptionAppliesToItem(option, group, scopedItem)) }))
      .filter(group => group.options.length)
      .sort((a, b) => item.sourceItemId && item.optionGroupIds
        ? item.optionGroupIds.indexOf(a.id) - item.optionGroupIds.indexOf(b.id)
        : a.sortOrder - b.sortOrder);
  }

  function getAvailableItemOptionGroups(item: PosMenuItem, selection = optionDraft) {
    return getItemOptionGroups(item).map(group => ({ ...group,
      options: group.options.filter(option => isPosOptionAllowed(group, option.id, selection)) }));
  }

  function updateOptionDraft(update: (current: Record<string, string[]>) => Record<string, string[]>) {
    setOptionDraft(current => reconcilePosOptionDependencies(configuringItem ? getItemOptionGroups(configuringItem) : [], update(current), current));
  }

  function getOptionLabel(options: PosSelectedOption[]) {
    if (!options.length) return "";
    const counts = new Map<string, { option: PosSelectedOption; count: number }>();
    for (const option of options) {
      const key = `${option.groupId}:${option.id}`;
      const current = counts.get(key) ?? { option, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
    return Array.from(counts.values())
      .map(({ option, count }) => `${option.groupName}: ${option.name}${count > 1 ? ` x${count}` : ""}`)
      .join(" / ");
  }

  // Printed tickets retain group headings; customer-facing screens explicitly omit them.
  function getCustomerDisplayOptionLabel(options: PosSelectedOption[], language: string, includeGroupName = true) {
    if (!options.length) return "";
    const counts = new Map<string, { option: PosSelectedOption; count: number }>();
    for (const option of options) {
      const key = `${option.groupId}:${option.id}`;
      const current = counts.get(key) ?? { option, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
    return Array.from(counts.values())
      .map(({ option, count }) => {
        const groupName = getLocalizedDisplayName(option.groupName, option.groupDisplayNames, language);
        const optionName = getLocalizedDisplayName(option.name, option.displayNames, language);
        return `${includeGroupName ? `${groupName}: ` : ""}${optionName}${count > 1 ? ` x${count}` : ""}`;
      })
      .join(" / ");
  }

  function getPaymentDisplayLabel(value: string) {
    if (value === "cash") return "現金";
    if (value === "card") return posSettings.externalPaymentTerminalBrand || "外部決済端末";
    if (value === "other") return "その他";
    return value || "-";
  }

  function getMemberDisplayName(member: PosMember | null, language = getCustomerDisplayLanguage(member)) {
    if (!member) return "";
    const directLastName = String(member.lastName || "").trim();
    if (directLastName) return language === "ja" ? `${directLastName}様` : directLastName;
    const fullName = String(member.fullName || member.displayName || "").trim();
    const spacedLastName = fullName.split(/\s+/).filter(Boolean)[0] ?? "";
    if (spacedLastName) return language === "ja" ? `${spacedLastName}様` : spacedLastName;
    const fallback = String(member.email || member.memberNumber || "").trim();
    return fallback ? language === "ja" ? `${fallback}様` : fallback : "";
  }

  function getDisplayCouponState(coupon: PosCoupon | undefined, discountAmount: number, fallbackName = "", language = "ja") {
    const amount = Math.max(0, Math.round(Number(discountAmount) || 0));
    const rawCouponName = coupon?.name || coupon?.couponCode || fallbackName.trim();
    const couponName = coupon ? getLocalizedDisplayName(rawCouponName, coupon.displayNames, language) : rawCouponName;
    if (!couponName || amount <= 0) return { couponName: "", couponDiscountAmount: 0 };
    return {
      couponName,
      couponDiscountAmount: amount
    };
  }

  function getCustomerDisplayItems(language: string) {
    return cart.map((item,index) => ({
      name: getLocalizedDisplayName(item.name, item.displayNames, language),
      optionLabel: [getCustomerDisplayOptionLabel(item.selectedOptions, language, false), ...bowlEvaluation.applications.filter(a=>a.index===index&&a.gift).map(a=>`${getLocalizedDisplayName(a.gift!.name,a.gift!.displayNames,language)} ¥0`)].filter(Boolean).join(" / "),
      quantity: item.quantity,
      measuredQuantity: item.measuredQuantity,
      measuredUnit: item.measuredUnit,
      measuredUnitPrice: item.measuredUnitPrice,
      weightLabel: getWeightLineLabel(item),
      unitPrice: getLineUnitPrice(item),
      amount: getLineUnitPrice(item) * item.quantity
    }));
  }

  function getDisplayDiscountState(discountPreset: typeof selectedDiscountPreset, discountAmount: number, fallbackName = "", language = "ja") {
    const amount = Math.max(0, Math.round(Number(discountAmount) || 0));
    const rawDiscountName = discountPreset?.name || fallbackName.trim();
    const discountName = discountPreset ? getLocalizedDisplayName(rawDiscountName, discountPreset.displayNames, language) : rawDiscountName;
    if (!discountName || amount <= 0) return { discountName: "", discountAmount: 0 };
    return {
      discountName,
      discountAmount: amount
    };
  }

  function getDisplayTaxState(taxAmount: number, rate: number, priceTaxMode = posSettings.priceTaxMode) {
    const amount = Math.max(0, Math.round(Number(taxAmount) || 0));
    const normalizedRate = Math.max(0, Number(rate) || 0);
    const prefix = priceTaxMode === "tax_excluded" ? "消費税" : "内消費税";
    return {
      taxLabel: normalizedRate ? `${prefix} ${normalizedRate}%` : prefix,
      taxAmount: amount
    };
  }

  function absolutizeReceiptTemplateMedia(template: PosPrinterSettings["receiptTemplate"]) {
    const toAbsolute = (value: string) => {
      const url = String(value || "").trim();
      if (!url || /^https?:\/\//i.test(url)) return url;
      return new URL(url, window.location.origin).toString();
    };
    return {
      ...template,
      logoUrl: toAbsolute(template.logoUrl),
      promotionImageUrl: toAbsolute(template.promotionImageUrl)
    };
  }

  function getStoreReceiptPrinter() {
    const printer = getReceiptPrinter(posSettings.printerSettings);
    return isPrintablePrinter(printer) ? printer : createAutoStarBluetoothPrinter(printer);
  }

  function createReceiptPrintPayload(body: Record<string, unknown>, cartSnapshot: PosCartItem[], printer = getStoreReceiptPrinter()): PosPrintPayload {
    const isInvoice = Boolean(body.receiptRequested ?? receiptRequested);
    const brandIds = Array.from(new Set(cartSnapshot.map((item) => item.brandId).filter(Boolean)));
    const receiptTemplate = resolvePosReceiptTemplate(posSettings.printerSettings, brandIds.length === 1 ? brandIds[0] : null, isInvoice ? "invoice" : "receipt");
    return {
      version: 1,
      jobType: "receipt",
      printer,
      storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "Foundr1 OS",
      printedAt: new Date().toISOString(),
      receiptTemplate: absolutizeReceiptTemplateMedia(receiptTemplate),
      order: {
        pickupCode: String(body.pickupCode || ""),
        orderType: String(body.orderType || orderType),
        paymentMethod: String(body.paymentMethod || paymentMethod),
        paymentLabel: getPaymentDisplayLabel(String(body.paymentMethod || paymentMethod)),
        note: body.offline ? `[オフライン未同期] ${String(body.note ?? note)}`.trim() : String(body.note ?? note),
        receiptRequested: isInvoice,
        receiptTitle: isInvoice ? receiptTemplate.invoiceTitle : receiptTemplate.receiptTitle,
        receiptRecipientName: isInvoice ? invoiceRecipientStem(body.receiptRecipientName ?? (invoiceRecipient || receiptTemplate.invoiceRecipientName)) : "",
        receiptPurposeText: isInvoice ? String(body.receiptPurposeText ?? (invoicePurpose || receiptTemplate.invoicePurposeText)) : "",
        subtotalAmount: Number(body.subtotalAmount ?? subtotal),
        discountAmount: Number(body.discountAmount ?? posDiscountAmount) || 0,
        couponDiscountAmount: Number(body.couponDiscountAmount ?? couponDiscountAmount) || 0,
        taxAmount: Number(body.taxAmount ?? taxSummary.taxAmount) || 0,
        taxRate: Number(body.taxRate ?? taxRate) || 0,
        totalAmount: Number(body.amount ?? payableAmount) || 0,
        cashTenderedAmount: (body.paymentMethod || paymentMethod) === "cash" ? Number(body.cashTenderedAmount ?? cashTenderedValue) : null,
        cashChangeAmount: (body.paymentMethod || paymentMethod) === "cash" ? Number(body.cashChangeAmount ?? cashTenderedValue - payableAmount) : null,
        items: cartSnapshot.map((item, index) => ({
          name: `${!isPosImmediateItem(item) ? (body.servingTickets as PosServingTicket[] | undefined)?.find((ticket) => ticket.itemIndex === index)?.pickupCode || "" : ""} ${getLocalizedDisplayName(item.name, item.displayNames, "ja")}`.trim(),
          quantity: item.quantity,
          unitPrice: getLineUnitPrice(item),
          amount: getLineUnitPrice(item) * item.quantity,
          options: [getWeightLineLabel(item), ...getCustomerDisplayOptionLabel(item.selectedOptions, "ja").split(" / ")].filter(Boolean)
        }))
      }
    };
  }

  function createKitchenPrintPayload(body: Record<string, unknown>, cartItems: PosCartItem[], printer: PosPrinterConnection, brandName: string, brandId?: string): PosPrintPayload {
    const kitchenTotal = cartItems.reduce((sum, item) => sum + getLineUnitPrice(item) * item.quantity, 0);
    return {
      version: 1,
      jobType: "kitchen",
      printer,
      storeName: `${stores.find((store) => store.id === selectedStoreId)?.name ?? "Foundr1 OS"} / ${brandName}`,
      printedAt: new Date().toISOString(),
      receiptTemplate: absolutizeReceiptTemplateMedia(posSettings.printerSettings.receiptTemplate),
      kitchenTicketTemplate: resolvePosKitchenTicketTemplate(posSettings.printerSettings, brandId),
      order: {
        pickupCode: String(body.pickupCode || ""),
        orderType: String(body.orderType || orderType),
        paymentMethod: "kitchen",
        paymentLabel: "厨房",
        note: body.offline ? `[オフライン未同期] ${String(body.note ?? note)}`.trim() : String(body.note ?? note),
        subtotalAmount: kitchenTotal,
        discountAmount: 0,
        couponDiscountAmount: 0,
        taxAmount: 0,
        taxRate: 0,
        totalAmount: kitchenTotal,
        items: cartItems.map((item) => ({
          name: getLocalizedDisplayName(item.name, item.displayNames, "ja"),
          quantity: item.quantity,
          unitPrice: getLineUnitPrice(item),
          amount: getLineUnitPrice(item) * item.quantity,
          options: [getWeightLineLabel(item), ...getCustomerDisplayOptionLabel(item.selectedOptions, "ja").split(" / ")].filter(Boolean)
        }))
      }
    };
  }

  async function printReceiptAfterCheckout(body: Record<string, unknown>, cartSnapshot: PosCartItem[]) {
    if (debugMode) return "";
    const printerSettings = posSettings.printerSettings;
    const printer = getStoreReceiptPrinter();
    if (!printerSettings.enabled || !printerSettings.receiptEnabled || !isPrintablePrinter(printer)) return "";
    const result = await printWithAndroidBridge(createReceiptPrintPayload(body, cartSnapshot, printer));
    return result.ok ? " / レシート印刷送信済み" : ` / レシート印刷未送信: ${result.error}`;
  }

  async function printKitchenAfterCheckout(body: Record<string, unknown>, cartSnapshot: PosCartItem[]) {
    if (debugMode) return "";
    const printerSettings = posSettings.printerSettings;
    if (!printerSettings.enabled || !printerSettings.kitchenEnabled) return "";
    const brandGroups = cartSnapshot.filter(item => !isPosImmediateItem(item)).reduce((groups, item) => {
      const key = item.brandId || "default";
      groups[key] = groups[key] ?? { brandName: item.brandName || "厨房", items: [] };
      groups[key].items.push(item);
      return groups;
    }, {} as Record<string, { brandName: string; items: PosCartItem[] }>);
    let sentCount = 0;
    const errors: string[] = [];
    for (const [brandId, group] of Object.entries(brandGroups)) {
      const printer = getKitchenPrinterForBrand(printerSettings, brandId === "default" ? null : brandId);
      if (!isPrintablePrinter(printer)) continue;
      const payload = createKitchenPrintPayload(body, group.items, printer, group.brandName, brandId === "default" ? undefined : brandId);
      for (let copy = 1; copy <= printerSettings.kitchenCopies; copy += 1) {
        const result = await printWithAndroidBridge(payload);
        if (result.ok) {
          sentCount += 1;
        } else {
          errors.push(`${group.brandName} ${copy}/${printerSettings.kitchenCopies}枚目: ${result.error || "送信失敗"}`);
          break;
        }
      }
    }
    if (errors.length) return ` / 厨房印刷未送信: ${errors.join(", ")}`;
    return sentCount ? ` / 厨房印刷 ${sentCount}枚送信済み` : "";
  }

  const hasPendingDocuments = printJobs.some((job) => job.storeId === selectedStoreId && job.state !== "sent");
  useEffect(() => {
    if ((hasPendingCheckout || (showPrintQueue && hasPendingDocuments) || reprintOrderId) && window.matchMedia("(max-width: 900px)").matches) setCartOpen(true);
  }, [hasPendingCheckout, hasPendingDocuments, reprintOrderId, showPrintQueue]);

  async function refreshPrintJobs() {
    if (debugMode) return;
    setPrintJobs(await listPosPrintJobs());
    setCheckoutRecovery(await listPosCheckoutRecovery());
  }

  async function recoverCheckout(record: PosCheckoutRecovery) {
    if (debugMode) return;
    if (record.storeId !== selectedStoreId || saving || printBusy) return;
    setSaving(true);
    try {
      const response = await fetch("/api/store/pos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record.request) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "会計結果を確認できません。");
      if (body.printDocuments?.version === POS_PRINT_DOCUMENT_VERSION) {
        setLastPaidPrintOrderId(body.printDocuments.orderId);
        void printDocuments.refresh();
        showCheckoutNotice("success", `${t("会計済み・印刷状況を確認してください。")} ${checkoutNumberLabel(body)}`);
      } else {
        await printCheckoutDocuments({ ...record.request, ...body }, record.cart as PosCartItem[]);
      }
      await removePosCheckoutRecovery(record.storeId);
      uncertainCheckoutRef.current = null;
      setCart([]);
      await refreshPrintJobs();
      setMessage("元の会計を確認しました。伝票の送信状況と現物を確認してください。");
      await load(record.storeId, false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "会計を確認できません。"); }
    finally { setSaving(false); }
  }

  async function abandonCheckout(record: PosCheckoutRecovery) {
    if (debugMode) return;
    if (!window.confirm(t("未保存の場合だけ、この会計リクエストを無効にします。支払い済みの場合は責任者と精算を確認してください。"))) return;
    setSaving(true);
    try {
      const response = await fetch("/api/store/pos/checkout-recovery", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: record.storeId, requestId: record.request.offlineClientOrderId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "会計を確認できません。");
      await removePosCheckoutRecovery(record.storeId);
      uncertainCheckoutRef.current = null;
      if (!cart.length) setCart(record.cart as PosCartItem[]);
      await refreshPrintJobs();
      setMessage("未保存の会計リクエストを無効にしました。支払いと内容を確認してから会計してください。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "会計を確認できません。"); }
    finally { setSaving(false); }
  }

  async function retryPrintJob(job: PosPrintJob) {
    if (debugMode) return;
    if (!window.confirm(`${job.label}：${t("現物を確認しましたか。同じ番号で再印刷します。")}`)) return;
    setPrintBusy(true);
    try {
      if (job.state === "pending" && (await listPosPrintJobs()).some((earlier) => earlier.storeId === job.storeId &&
        earlier.orderId === job.orderId && (earlier.sequence ?? 0) < (job.sequence ?? 0) && earlier.state !== "sent")) {
        throw new Error("先の伝票の現物と送信状態を確認してから、順番に印刷してください。");
      }
      let resolvedOrderId = job.orderId;
      let resolvedItemId = job.itemId;
      if ((!job.offline || navigator.onLine) && job.kind !== "receipt") {
        const params = new URLSearchParams({ storeId: job.storeId, ...(job.offline && job.clientOrderId ? { clientOrderId: job.clientOrderId } : { orderId: job.orderId }) });
        const response = await fetch(`/api/store/pos/transactions?${params.toString()}`, { cache: "no-store" });
        const current = await response.json().catch(() => ({}));
        const order = current.selectedTransaction;
        const item = order?.items?.find((item: PosTransactionItem) => job.itemId ? item.id === job.itemId : item.pickupCode === job.payload.order?.pickupCode);
        if (!response.ok || !order || ["cancelled", "completed", "refund_pending"].includes(order.status)
          || ((job.itemId || job.kind === "pickup" || job.kind === "finishing") && (!item || item.refundStatus === "refunded" || item.handedOffAt))) {
          throw new Error("現在の注文状態を確認できない、または受渡・返金済みのため再印刷できません。");
        }
        resolvedOrderId = order.id || job.orderId;
        resolvedItemId = item?.id || job.itemId;
      }
      const retry: PosPrintJob = { ...job, orderId: resolvedOrderId, itemId: resolvedItemId, state: "pending", error: "", payload: { ...job.payload, printer: { ...job.payload.printer, openCashDrawer: false } } };
      await savePosPrintJob(retry);
      await runPosPrintJobs([retry], savePosPrintJob, printWithAndroidBridge);
      await refreshPrintJobs();
    } catch (error) { setMessage(error instanceof Error ? error.message : "再印刷できません。"); }
    finally { setPrintBusy(false); }
  }

  async function printCheckoutDocuments(body: Record<string, unknown>, cartSnapshot: PosCartItem[]) {
    if (debugMode) return "";
    if (body.relayPrinting) { void relay.refresh(); return " / 中継印刷タスクを保存しました。"; }
    const tickets = ((Array.isArray(body.servingTickets) ? body.servingTickets : []) as PosServingTicket[])
      .filter(ticket => !cartSnapshot[ticket.itemIndex] || !isPosImmediateItem(cartSnapshot[ticket.itemIndex]));
    if (body.reprintAllowed === false) return " / 保存済みの会計です。現在の受渡・返金状態を確認してください。";
    const immediateOnly = cartSnapshot.length > 0 && cartSnapshot.every(isPosImmediateItem);
    if (!tickets.length && !immediateOnly) return `${await printKitchenAfterCheckout(body, cartSnapshot)}${await printReceiptAfterCheckout(body, cartSnapshot)}`;
    const existing = (await listPosPrintJobs()).filter((job) => job.storeId === selectedStoreId &&
      (job.orderId === String(body.orderId) || Boolean(body.offlineClientOrderId && job.clientOrderId === String(body.offlineClientOrderId))));
    if (!posSettings.printerSettings.enabled) {
      if (!existing.length) return "";
      // A recovered checkout keeps its saved documents even if printing was disabled later.
      await runPosPrintJobs(existing, savePosPrintJob, printWithAndroidBridge);
      await refreshPrintJobs();
      return existing.every((job) => job.state === "sent") ? " / 伝票送信済み" : " / 未送信の伝票があります。送信状況を確認してください。";
    }
    // A saved two-ticket batch keeps its original positions and identities after an upgrade.
    const includeFinishing = !existing.length || existing.some((job) => job.kind === "finishing");
    const jobs: PosPrintJob[] = [];
    const batchCreatedAt = new Date().toISOString();
    function add(label: string, payload: PosPrintPayload, kind: "kitchen" | "finishing" | "pickup" | "receipt" = "kitchen", itemId?: string) {
      jobs.push({ kind, itemId, offline: Boolean(body.offline), createdAt: batchCreatedAt, sequence: jobs.length, id: `${body.offlineClientOrderId || body.orderId}:${jobs.length}`, clientOrderId: String(body.offlineClientOrderId || ""), storeId: selectedStoreId, orderId: String(body.orderId), label, payload, state: "pending", error: "" });
    }
    for (const ticket of tickets) {
      const item = cartSnapshot[ticket.itemIndex];
      if (!item) throw new Error("料理と伝票の対応を確認できません。");
      const kitchen = createKitchenPrintPayload({ ...body, pickupCode: ticket.pickupCode }, [item], getStoreReceiptPrinter(), item.brandName, item.brandId);
      if (item.preparationNote && kitchen.order) kitchen.order.note = [item.preparationNote, kitchen.order.note].filter(Boolean).join(" / ");
      kitchen.printer = { ...kitchen.printer, openCashDrawer: false };
      kitchen.kitchenTicketTemplate = { ...kitchen.kitchenTicketTemplate!, title: "厨房伝票", showTitle: true, showPickupCode: true, showItems: true, showOptions: true, showNote: true, largeText: true,
        blockStyles: { ...kitchen.kitchenTicketTemplate!.blockStyles, pickup: { ...kitchen.kitchenTicketTemplate!.blockStyles.pickup, textSize: "xlarge", bold: true } } };
      add(`${ticket.pickupCode} 厨房伝票`, kitchen, "kitchen", ticket.itemId);
      if (includeFinishing) add(`${ticket.pickupCode} 出品伝票`, {
        ...kitchen,
        kitchenTicketTemplate: { ...kitchen.kitchenTicketTemplate!, title: "出品伝票", showTitle: true, showAmounts: false,
          customMessage: "厨房伝票と番号を照合し、味付け・追加・メモを確認してください。" }
      }, "finishing", ticket.itemId);
      const customerLanguage = String(body.memberLanguage || "ja");
      const customerCopy = posPickupTicketCopy[customerLanguage] || posPickupTicketCopy.ja;
      add(`${ticket.pickupCode} お客様番号札`, { ...kitchen,
        order: { ...kitchen.order!, note: "", items: [{ name: getLocalizedDisplayName(item.name, item.displayNames, customerLanguage), quantity: 1, amount: 0,
          options: [getWeightLineLabel(item), ...getCustomerDisplayOptionLabel(item.selectedOptions, customerLanguage).split(" / ")].filter(Boolean) }] },
        printer: { ...getStoreReceiptPrinter(), openCashDrawer: false },
        kitchenTicketTemplate: { ...kitchen.kitchenTicketTemplate!, language: "ja", title: customerCopy.title, showTitle: true, showAmounts: false, showNote: false, showOrderType: false,
          customMessage: customerCopy.message, showTimestamp: true }
      }, "pickup", ticket.itemId);
    }
    // Other brands still get their own kitchen document in a mixed checkout.
    const otherItems = cartSnapshot.filter((item, index) => !tickets.some((ticket) => ticket.itemIndex === index) && !isPosImmediateItem(item));
    for (const brandId of posSettings.printerSettings.kitchenEnabled ? new Set(otherItems.map((item) => item.brandId)) : []) {
      const items = otherItems.filter((item) => item.brandId === brandId);
      const otherPrinter = getKitchenPrinterForBrand(posSettings.printerSettings, brandId);
      if (hasPosPrinterDestination(otherPrinter)) add(`${body.pickupCode} 厨房伝票`, createKitchenPrintPayload(body, items, otherPrinter, items[0].brandName, brandId));
    }
    if (!immediateOnly || posSettings.printerSettings.receiptEnabled) add(`${checkoutNumberLabel(body)} レシート`, createReceiptPrintPayload(body, cartSnapshot), "receipt");
    if (!jobs.length) return "";
    // Store the full batch before sending the first document; reuse saved jobs on a repeated response.
    for (let index = 0; index < jobs.length; index += 1) {
      jobs[index] = existing.find((job) => job.id === jobs[index].id) || jobs[index];
    }
    await savePosPrintBatch(jobs);
    await runPosPrintJobs(jobs, savePosPrintJob, printWithAndroidBridge);
    await refreshPrintJobs();
    return jobs.every((job) => job.state === "sent") ? " / 伝票送信済み" : " / 未送信の伝票があります。送信状況を確認してください。";
  }

  async function publishCustomerDisplayState(state: Record<string, unknown>) {
    if (debugMode) {
      await debugDisplay.publish(state);
      return;
    }
    if (!selectedStoreId) return;
    if (!offlineCheckoutOnly) publishLiveCustomerDisplay(state);
    const physicalDisplay = posSettings.printerSettings.customerDisplay;
    const receiptPrinter = getReceiptPrinter(posSettings.printerSettings);
    if (physicalDisplay.enabled && receiptPrinter.deviceType === "star_printer") {
      const lines = getPhysicalCustomerDisplayLines(state, physicalDisplay);
      await displayWithAndroidBridge(createPhysicalCustomerDisplayPayload(
        posSettings.printerSettings,
        lines.line1,
        lines.line2
      ));
    }
  }

  function getAdvertisingDisplayState() {
    return {
      status: "advertising",
      storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "",
      orderType: "",
      paymentMethod: "cash",
      paymentLabel: "現金",
      externalPaymentTerminalBrand: posSettings.externalPaymentTerminalBrand,
      pickupCode: "",
      preferredLanguage: "",
      memberDisplayName: "",
      memberMessage: "",
      discountName: "",
      discountAmount: 0,
      couponName: "",
      couponDiscountAmount: 0,
      subtotal: 0,
      taxLabel: "",
      taxAmount: 0,
      cashTenderedAmount: null,
      cashChangeAmount: null,
      items: []
    };
  }

  function cancelCurrentTransaction() {
    if (!hasCurrentTransaction || saving) return;
    setCheckoutNotice(null);
    setCart([]);
    setSelectedTableCheckoutKey("");
    setCashTenderedAmount("");
    setMemberLookupInput("");
    setSelectedMember(null);
    setMemberCoupons([]);
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setDiscountPresetKey("");
    setPaymentMethod("cash");
    setNote("");
    resetReceiptChoice();
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
    setCompletedDisplayState(null);
    setCustomerDisplayMode("advertising");
    setMessage("現在の会計を中止しました。");
    void publishCustomerDisplayState(getAdvertisingDisplayState());
  }

  function selectTableCheckout(request: PosTableCheckoutRequest) {
    if (debugMode) return;
    if (offlineCheckoutOnly) {
      setMessage("オフライン中はテーブル会計を処理できません。");
      return;
    }
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    setCheckoutNotice(null);
    setSelectedTableCheckoutKey((current) => current === request.tableSessionKey ? "" : request.tableSessionKey);
    setCart([]);
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
    setSelectedMember(null);
    setMemberCoupons([]);
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setDiscountPresetKey("");
    setNote("");
    resetReceiptChoice();
    setCashTenderedAmount("");
    setCustomerDisplayMode("business");
  }

  async function adjustTableCheckout(input: {
    action: "cancel_order" | "cancel_item" | "set_item_quantity";
    orderId: string;
    itemId?: string;
    quantity?: number;
  }) {
    if (debugMode) return;
    if (offlineCheckoutOnly) {
      setMessage("オフライン中はテーブル注文を修正できません。");
      return;
    }
    if (!selectedStoreId || !selectedTableCheckout || tableCheckoutAdjustingKey) return;
    const key = `${input.action}:${input.orderId}:${input.itemId ?? ""}`;
    setTableCheckoutAdjustingKey(key);
    setMessage("");
    try {
      const response = await fetch("/api/store/pos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          tableSessionKey: selectedTableCheckout.tableSessionKey,
          action: input.action,
          orderId: input.orderId,
          itemId: input.itemId,
          quantity: input.quantity
        })
      });
      const body = await response.json().catch(() => ({})) as { tableCheckoutRequests?: PosTableCheckoutRequest[]; todaySummary?: PosSummary; error?: string };
      if (!response.ok) throw new Error(body.error || "テーブル注文を修正できませんでした。");
      const nextRequests = body.tableCheckoutRequests ?? [];
      setTableCheckoutRequests(nextRequests);
      setSelectedTableCheckoutKey((current) => nextRequests.some((request) => request.tableSessionKey === current) ? current : "");
      if (body.todaySummary) setSummary(body.todaySummary);
      setCashTenderedAmount("");
      setMessage("テーブル注文を修正しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "テーブル注文を修正できませんでした。");
    } finally {
      setTableCheckoutAdjustingKey("");
    }
  }

  function getLineBasePrice(item: PosCartItem) {
    if (item.measuredQuantity && item.measuredUnitPrice) return Math.round(item.measuredQuantity * item.measuredUnitPrice);
    return getItemPrice(item);
  }

  function getLineUnitPrice(item: PosCartItem) {
    return getLineBasePrice(item) + item.optionTotal;
  }

  function getExchangeEligibleBodyAmount(item: PosCartItem) {
    if (item.measuredQuantity) return 0;
    const sizeReduction = item.selectedOptions
      .filter((option) => option.groupKey === "size")
      .reduce((sum, option) => sum + Math.min(0, getOptionPrice(option)), 0);
    return Math.max(0, getItemPrice(item) + sizeReduction);
  }

  function getExchangeEligibleBodyAmounts(coupon?: PosCoupon) {
    if (!coupon || !isExchangeCoupon(coupon)) return [];
    return cart.flatMap((item) => {
      if (coupon.brandId && item.brandId !== coupon.brandId) return [];
      const bodyAmount = getExchangeEligibleBodyAmount(item);
      return Array.from({ length: item.quantity }, () => bodyAmount).filter((amount) => amount > 0);
    });
  }

  function getWeightLineLabel(item: Pick<PosCartItem, "measuredQuantity" | "measuredUnit" | "measuredUnitPrice">) {
    if (!item.measuredQuantity || !item.measuredUnitPrice) return "";
    return `${item.measuredQuantity.toLocaleString("ja-JP", { maximumFractionDigits: 3 })}${item.measuredUnit || "g"} x ${formatYen(item.measuredUnitPrice)}/${item.measuredUnit || "g"}`;
  }

  function getCartKey(item: PosMenuItem, options: PosSelectedOption[], measuredQuantity: number | null = null, measuredUnitPrice: number | null = null) {
    const optionKey = options.map((option) => `${option.groupId}:${option.id}`).sort().join("|");
    const weightKey = measuredQuantity ? `::${measuredQuantity}:${measuredUnitPrice ?? ""}` : "";
    return `${item.id}::${optionKey}${weightKey}`;
  }

  function addItem(item: PosMenuItem, selectedOptions: PosSelectedOption[] = [], weightInput = "") {
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    setSelectedTableCheckoutKey("");
    const weightPricing = getWeightPricingConfig(item, orderType);
    const measuredQuantity = weightPricing ? Number(weightInput) : 0;
    if (weightPricing) {
      if (!weightPricing.unitPrice || weightPricing.unitPrice <= 0) {
        setMessage(`${item.name} の重量単価が設定されていません。`);
        return;
      }
      if (!Number.isFinite(measuredQuantity) || measuredQuantity <= 0) {
        setMessage(`${item.name} は重量を入力してください。`);
        return;
      }
    }
    const optionTotal = selectedOptions.reduce((sum, option) => sum + getOptionPrice(option), 0);
    const measuredQuantityValue = weightPricing ? Math.round(Number(measuredQuantity) * 1000) / 1000 : null;
    const cartKey = isPosBowl(item) ? window.crypto.randomUUID() : getCartKey(item, selectedOptions, measuredQuantityValue, weightPricing?.unitPrice ?? null);
    setCheckoutNotice(null);
    setCustomerDisplayMode("business");
    setCart((current) => {
      const existing = isPosBowl(item) ? undefined : current.find((entry) => entry.cartKey === cartKey);
      if (existing) {
        return current.map((entry) => entry.cartKey === cartKey ? { ...entry, quantity: entry.quantity + 1 } : entry);
      }
      return [...current, {
        ...item,
        cartKey,
        quantity: 1,
        measuredQuantity: measuredQuantityValue,
        scaleCaptureId: scaleCapture && scaleCapture.itemId===item.id && scaleCapture.quantity===measuredQuantityValue ? scaleCapture.id : undefined,
        weightMeasurement: weightPricing ? (scaleCapture && scaleCapture.itemId===item.id && scaleCapture.quantity===measuredQuantityValue ? scaleCapture.measurement : {mode:'manual_net'}) : undefined,
        measuredUnit: weightPricing?.unit ?? "",
        measuredUnitPrice: weightPricing?.unitPrice ?? null,
        selectedOptions,
        optionTotal
      }];
    });
  }

  function beginItemSelection(item: PosMenuItem) {
    if (saving || printBusy || checkoutRecovery.some((record) => record.storeId === selectedStoreId)) return;
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    setCustomerDisplayMode("business");
    const groups = getItemOptionGroups(item);
    if (!groups.length && !getWeightPricingConfig(item, orderType)) {
      addItem(item);
      return;
    }
    const nextDraft: Record<string, string[]> = {};
    for (const group of groups) {
      const categoryDefaults = group.ruleJson?.defaultOptionKeysByCategory;
      const categoryDefault = categoryDefaults && typeof categoryDefaults === 'object' && !Array.isArray(categoryDefaults)
        ? String((categoryDefaults as Record<string, unknown>)[item.category || '未分類'] ?? '').trim() : '';
      const configuredDefault = categoryDefault || String(group.ruleJson?.defaultOptionKey ?? '').trim();
      const hasExplicitDefault = Boolean(configuredDefault && group.options.some(option => [option.id, option.name, option.optionKey].includes(configuredDefault)));
      if (getEffectiveSelectionType(group) === "single" && group.options.length
        && (!isStoreDineInSelection(group) || getPosOptionSelectionRules(group).min > 0 || hasExplicitDefault)) {
        nextDraft[group.id] = [getDefaultOptionId(group, item.category || "未分類")];
      } else {
        nextDraft[group.id] = [];
      }
    }
    setScaleCapture(null);
    setScaleValidity(null);
    setScaleManualMode(debugMode);
    setTarePresetId('small');
    setWeighingPreviewId(window.crypto.randomUUID());
    setConfiguringItem(item);
    setOptionQuery("");
    setOptionGroupId("");
    setWeightDraft("");
    setOptionDraft(reconcilePosOptionDependencies(groups, nextDraft));
  }

  function toggleOption(group: PosOptionGroup, optionId: string) {
    updateOptionDraft((current) => {
      const selected = current[group.id] ?? [];
      const selectionType = getEffectiveSelectionType(group);
      if (selectionType === "single") {
        const optional = isStoreDineInSelection(group) && getPosOptionSelectionRules(group).min === 0;
        return { ...current, [group.id]: optional && selected.includes(optionId) ? [] : [optionId] };
      }
      if (selectionType === "quantity") {
        const limit = getOptionGroupLimit(group);
        if (selected.length >= limit) {
          setMessage(`${group.name} は最大${limit}点までです。`);
          return current;
        }
        if (isStoreDineInSelection(group) && selected.filter(id => id === optionId).length >= getPosOptionSelectionRules(group).perOptionMax) {
          setMessage(`${group.name} は同じ選択肢を最大${getPosOptionSelectionRules(group).perOptionMax}点までです。`);
          return current;
        }
        return { ...current, [group.id]: [...selected, optionId] };
      }
      if (!selected.includes(optionId) && selected.length >= getOptionGroupLimit(group)) {
        setMessage(`${group.name} は最大${getOptionGroupLimit(group)}点までです。`);
        return current;
      }
      return selected.includes(optionId)
        ? { ...current, [group.id]: selected.filter((id) => id !== optionId) }
        : { ...current, [group.id]: [...selected, optionId] };
    });
  }

  function decrementOption(group: PosOptionGroup, optionId: string) {
    updateOptionDraft((current) => {
      const selected = current[group.id] ?? [];
      const index = selected.lastIndexOf(optionId);
      if (index < 0) return current;
      return {
        ...current,
        [group.id]: selected.filter((_, selectedIndex) => selectedIndex !== index)
      };
    });
  }

  function addConfiguredItem() {
    if (!configuringItem || !canAddConfiguredItem) return;
    const selectedOptions = getAvailableItemOptionGroups(configuringItem).flatMap((group) => {
      const selectedIds = optionDraft[group.id] ?? [];
      const optionsById = new Map(group.options.map((option) => [option.id, option]));
      return selectedIds
        .map((optionId) => optionsById.get(optionId))
        .filter(Boolean)
        .map((option) => ({ ...option, groupId: group.id, groupKey: group.groupKey, groupName: group.name, groupDisplayNames: group.displayNames })) as PosSelectedOption[];
    });
    addItem(configuringItem, selectedOptions, weightDraft);
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
  }

  function changeQuantity(cartKey: string, amount: number) {
    if (amount > 0 && menuBlocksCurrentOrder) return;
    setCheckoutNotice(null);
    const entry = cart.find((item) => item.cartKey === cartKey);
    if (entry && isPosBowl(entry) && amount > 0) {
      setCart((current) => [...current, { ...entry, bowlBenefit:undefined, cartKey: window.crypto.randomUUID(), quantity: 1 }]);
      return;
    }
    setCustomerDisplayMode("business");
    setCart((current) => current
      .map((item) => item.cartKey === cartKey ? { ...item, quantity: item.quantity + amount } : item)
      .filter((item) => item.quantity > 0));
  }

  function changeOrderType(nextOrderType: string) {
    if (saving || printBusy || checkoutRecovery.some((record) => record.storeId === selectedStoreId)) return;
    if (nextOrderType === orderType) return;
    setCheckoutNotice(null);
    const needsCartReset = cart.some((item) => (
      Boolean(dineInMenu) || Boolean(item.sourceItemId) ||
      Boolean(item.measuredQuantity) ||
      Boolean(getWeightPricingConfig(item, orderType)) ||
      Boolean(getWeightPricingConfig(item, nextOrderType))
    ));
    setOrderType(nextOrderType);
    setCustomerDisplayMode("business");
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
    if (needsCartReset) {
      setCart([]);
      setMessage("注文区分を変更したため、会計内容をクリアしました。商品を選び直してください。");
    }
  }

  function showCheckoutNotice(kind: "error" | "success", text: string) {
    setCheckoutNotice({ kind, text });
    setMessage(text);
  }

  function checkoutNumberLabel(body: Record<string, unknown>) {
    return `${body.hasPreparation === false ? `${t("会計番号")} ` : ""}${String(body.pickupCode || "")}`;
  }

  async function checkout() {
    if (!selectedStoreId || (!cart.length && !selectedTableCheckout) || saving) return;
    if (menuBlocksCurrentOrder) { showCheckoutNotice("error", "メニューが更新されました。更新して商品を選び直してください。"); return; }
    setCheckoutNotice(null);
    setLastPaidPrintOrderId("");
    if (checkoutRecovery.some((record) => record.storeId === selectedStoreId)) {
      showCheckoutNotice("error", "未確認の会計があります。元の会計結果を確認してください。");
      return;
    }
    if (!canUseRegister) {
      showCheckoutNotice("error", "POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    if (debugMode) {
      if (!canCheckout) {
        showCheckoutNotice("error", t("現金会計はお預かり金額を合計以上で入力してください。"));
        return;
      }
      debugSequenceRef.current += 1;
      const testNumber = `TEST-${String(debugSequenceRef.current).padStart(4, "0")}`;
      setDebugResult({
        number: testNumber,
        storeName: stores.find(store => store.id === selectedStoreId)?.name || "",
        orderType: getOrderTypeLabel(orderType), paymentLabel: getPaymentDisplayLabel(paymentMethod),
        subtotal, discount: posDiscountAmount, tax: taxSummary.taxAmount, taxRate,
        taxIncluded: posSettings.priceTaxMode === "tax_included", total: payableAmount,
        tendered: paymentMethod === "cash" ? cashTenderedValue : null,
        change: paymentMethod === "cash" ? cashChangeAmount : null, note,
        items: expandPosBowls(cart).map(item => ({
          key: item.cartKey, name: item.name, quantity: item.quantity,
          amount: getCartItemAmount(item), weight: getWeightLineLabel(item),
          options: getOptionLabel(item.selectedOptions), note: item.preparationNote || ""
        }))
      });
      setCompletedDisplayState({
        status: "complete", storeName: stores.find(store => store.id === selectedStoreId)?.name || "",
        orderType, paymentMethod, paymentLabel: getPaymentDisplayLabel(paymentMethod),
        externalPaymentTerminalBrand: posSettings.externalPaymentTerminalBrand, pickupCode: testNumber,
        numberKind: cart.some(item => !isPosImmediateItem(item)) ? "pickup" : "accounting",
        preferredLanguage: "ja", memberDisplayName: "", memberMessage: "",
        ...getDisplayDiscountState(selectedDiscountPreset, posDiscountAmount, "", "ja"),
        ...getDisplayCouponState(undefined, 0), ...getDisplayTaxState(taxSummary.taxAmount, taxRate),
        subtotal: payableAmount, cashTenderedAmount: paymentMethod === "cash" ? cashTenderedValue : null,
        cashChangeAmount: paymentMethod === "cash" ? cashChangeAmount : null, items: getCustomerDisplayItems("ja")
      });
      setCart([]); setCashTenderedAmount(""); setNote(""); setDiscountPresetKey("");
      resetReceiptChoice(); setPaymentMethod("cash"); setConfiguringItem(null);
      setOptionDraft({}); setWeightDraft(""); setScaleCapture(null); setScaleValidity(null);
      showCheckoutNotice("success", t("テスト会計が完了しました。保存・決済・印刷は行っていません。"));
      return;
    }
    if (relay.required && (!relay.owner || !relay.station || (relay.station.print_enabled && ((!relay.station.device_online && (selectedTableCheckout || offlineCheckoutOnly || printMode === "auto")) || offlineCheckoutOnly)))) { showCheckoutNotice("error", "レジ操作権と中継端末の接続を確認してください。"); return; }
    if ((offlineCheckoutOnly || selectedTableCheckout) && posSettings.printerSettings.enabled && !relay.station?.print_enabled && cart.some(isPosBowl) && (!posSettings.printerSettings.receiptEnabled
      || !hasPosPrinterDestination(getStoreReceiptPrinter())
      || !window.Foundr1Printer?.print)) {
      showCheckoutNotice("error", "厨房伝票・出品伝票・お客様番号札・レシートを印刷できる端末とプリンター設定を確認してください。");
      return;
    }
    if (offlineCheckoutOnly && (paymentMethod !== "cash" || selectedMember || selectedCouponId || discountPresetKey || posDiscountAmount > 0 || hasBowlChoice || selectedTableCheckout)) {
      showCheckoutNotice("error", "オフライン会計は、会員・クーポン・割引・テーブル会計を使わない現金注文のみ対応しています。");
      return;
    }
    if (paymentMethod === "cash" && (cashTenderedAmount.trim() === "" || cashTenderedValue < activeCheckoutAmount)) {
      showCheckoutNotice("error", "現金会計はお預かり金額を合計以上で入力してください。");
      return;
    }
    if(bowlEvaluation.errors.length){showCheckoutNotice("error",bowlEvaluation.errors[0]);return;}
    setSaving(true);
    setMessage("");
    let savedPayment: { pickupCode: string; amount: number; numberLabel: string } | null = null;
    try {
      const cartSnapshot = expandPosBowls(cart);
      const useServerPrintDocuments = navigator.onLine && !selectedTableCheckout;
      const signature = JSON.stringify({ store: selectedStoreId, cart: cartSnapshot, orderType, paymentMethod, cashTenderedValue, note, receiptRequested, invoiceRecipient, invoicePurpose, selectedMember, selectedCouponId, discountPresetKey, discountQuote, table: selectedTableCheckout?.tableSessionKey, ...(useServerPrintDocuments ? { printMode } : {}) });
      if (uncertainCheckoutRef.current && uncertainCheckoutRef.current.signature !== signature) {
        throw new Error("前の会計結果を確認できていません。内容を元に戻して再確認してください。");
      }
      const attempt = uncertainCheckoutRef.current || { signature, id: window.crypto.randomUUID(), createdAt: new Date().toISOString() };
      uncertainCheckoutRef.current = attempt;
      const offlineClientOrderId = attempt.id;
      const offlineCreatedAt = attempt.createdAt;
      const offlinePickupCode = `${navigator.onLine ? "D" : "O"}${offlineClientOrderId.replaceAll("-", "").slice(0, navigator.onLine ? 8 : 20).toUpperCase()}`;
      const checkoutRequest = {
          ...(useServerPrintDocuments ? { printDocumentVersion: POS_PRINT_DOCUMENT_VERSION, printMode } : {}),
          posMenuRevision,
          dineInMenuRevision,
          bowlTicketVersion: 1,
          posFulfillmentPolicyVersion: 1,
          dineInAssociationVersion: 1,
          offlineClientOrderId,
          offlineCreatedAt,
          offlinePickupCode,
          offlineExpectedAmount: activeCheckoutAmount,
          storeId: selectedStoreId,
          orderType,
          paymentMethod,
          relayOwner: relay.required ? relay.owner || undefined : undefined,
          cashTenderedAmount: paymentMethod === "cash" ? cashTenderedValue : null,
          tableSessionKey: selectedTableCheckout?.tableSessionKey || undefined,
          memberToken: selectedMember?.publicToken || undefined,
          memberId: selectedMember?.id || undefined,
          memberEmail: selectedMember?.email || undefined,
          memberPhone: selectedMember?.phone || undefined,
          memberName: selectedMember?.displayName || undefined,
          memberLanguage: selectedMember?.preferredLanguage || undefined,
          couponId: couponBlockedByDiscount ? undefined : selectedCouponId || undefined,
          discountPresetKey: discountPresetKey || undefined,
          discountQuote: selectedTableCheckout ? undefined : discountQuote,
          receiptRequested,
          receiptRecipientName: receiptRequested ? invoiceRecipient : undefined,
          receiptPurposeText: receiptRequested ? invoicePurpose : undefined,
          note,
          items: selectedTableCheckout ? [] : cartSnapshot.map((item) => ({
            scaleCaptureId: item.scaleCaptureId,
            weightMeasurement: item.weightMeasurement,
            bowlBenefit: item.bowlBenefit,
            menuCatalogItemId: item.id,
            fulfillmentMode: getPosItemFulfillmentMode(item),
            quantity: item.quantity,
            measuredQuantity: item.measuredQuantity,
            measuredUnit: item.measuredUnit,
            preparationNote: item.preparationNote || "",
            selectedOptions: Object.values(item.selectedOptions.reduce((groups, option) => {
              groups[option.groupId] = groups[option.groupId] ?? { groupId: option.groupId, optionIds: [] };
              groups[option.groupId].optionIds.push(option.id);
              return groups;
            }, {} as Record<string, { groupId: string; optionIds: string[] }>))
          }))
      };
      if (useServerPrintDocuments || relay.required || cartSnapshot.some(isPosBowl)) {
        await savePosCheckoutRecovery({ storeId: selectedStoreId, request: checkoutRequest, cart: cartSnapshot });
        await refreshPrintJobs();
      }
      let body: Record<string, any>;
      let fallbackEligible = true;
      const attemptedOnline = navigator.onLine;
      try {
        if (!navigator.onLine) throw new Error("offline");
        const response = await fetch("/api/store/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(checkoutRequest)
        });
        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (["POS_DISCOUNT_CHANGED", "POS_BOWL_BENEFIT_CHANGED"].includes(responseBody.code) && responseBody.storeId === selectedStoreId && Array.isArray(responseBody.discountPresets)) {
            setPosSettings(current => ({ ...current, discountPresets: responseBody.discountPresets }));
            const serverNow = Date.parse(String(responseBody.serverTime || ""));
            if (Number.isFinite(serverNow)) discountClockOffsetRef.current = serverNow - Date.now();
            setDiscountNow(Date.now() + discountClockOffsetRef.current);
          }
          fallbackEligible = response.status >= 500;
          if (response.status < 500 && !responseBody.checkoutSaved) {
            uncertainCheckoutRef.current = null;
            await removePosCheckoutRecovery(selectedStoreId);
            await refreshPrintJobs();
          }
          throw new Error(responseBody.error || "checkout failed");
        }
        body = responseBody;
      } catch (error) {
        if (useServerPrintDocuments) {
          if (!fallbackEligible) throw error;
          throw new Error("会計結果を確認できません。同じ内容で再確認してください。新しい会計やオフライン会計は作成しないでください。");
        }
        if (relay.required) throw error;
        if (!fallbackEligible && navigator.onLine) throw error;
        if (cartSnapshot.some(isPosBowl) && attemptedOnline) {
          throw new Error("会計結果を確認できません。同じ内容で再確認してください。新しい会計やオフライン会計は作成しないでください。");
        }
        setOfflineMode(true);
        if (paymentMethod !== "cash" || selectedMember || selectedCouponId || discountPresetKey || posDiscountAmount > 0 || hasBowlChoice || selectedTableCheckout) {
          throw new Error("オフライン会計は、会員・クーポン・割引・テーブル会計を使わない現金注文のみ対応しています。");
        }
        if (!reconciliation.activeSession) {
          throw new Error("オフライン会計を始める前に、オンラインでレジを開店してください。");
        }
        const offlineRequest = { ...checkoutRequest, offlineQueued: true };
        body = {
          ok: true,
          offline: true,
          orderId: offlineClientOrderId,
          pickupCode: offlinePickupCode,
          servingTickets: offlineServingTickets(cartSnapshot, offlinePickupCode),
          posFulfillmentPolicyVersion: 1,
          hasPreparation: cartSnapshot.some(item => !isPosImmediateItem(item)),
          amount: activeCheckoutAmount,
          subtotalAmount: activeCheckoutAmount,
          taxableAmount: activeCheckoutAmount,
          taxAmount: taxSummary.taxAmount,
          taxRate,
          priceTaxMode: posSettings.priceTaxMode,
          discountAmount: 0,
          couponDiscountAmount: 0,
          cashTenderedAmount: cashTenderedValue,
          cashChangeAmount: cashTenderedValue - activeCheckoutAmount,
          receiptRequested,
          receiptRecipientName: receiptRequested ? invoiceRecipient : undefined,
          receiptPurposeText: receiptRequested ? invoicePurpose : undefined,
          todaySummary: {
            ...summary,
            pendingSync: true,
            products: summary.products ? (() => {
              const additions = summarizePosProducts([{ id: offlineClientOrderId, amount: activeCheckoutAmount,
                items: cartSnapshot.map(item => ({ id: item.cartKey, catalogId: item.sourceItemId || item.id,
                  localId: item.sourceItemId ? item.id : undefined, name: item.name, isBowl: isPosBowl(item),
                  quantity: item.quantity, refundedQuantity: 0, refundedAmount: 0,
                  paidAmount: getCartItemAmount(item) })) }]);
              const merged = new Map(summary.products.map(p => [p.key, { ...p }]));
              for (const item of additions) {
                const old = merged.get(item.key);
                const quantity = item.quantity + (old?.quantity || 0), total = item.total + (old?.total || 0);
                merged.set(item.key, { ...item, quantity, total, average: Math.round(total / quantity) });
              }
              return [...merged.values()];
            })() : undefined,
            orderCount: summary.orderCount + 1,
            total: summary.total + activeCheckoutAmount,
            average: Math.round((summary.total + activeCheckoutAmount) / (summary.orderCount + 1))
          }
        };
        const offlineOrder: OfflinePosOrder = {
          clientOrderId: offlineClientOrderId,
          storeId: selectedStoreId,
          createdAt: offlineCreatedAt,
          request: offlineRequest,
          localResponse: body,
          lastError: ""
        };
        await addOfflinePosOrder(offlineOrder);
        if (cartSnapshot.some(isPosBowl)) await savePosCheckoutRecovery({ storeId: selectedStoreId, request: offlineRequest, cart: cartSnapshot });
        setOfflineMode(true);
        await refreshOfflinePendingCount();
      }
      // A saved payment is final even if printing or a later refresh cannot be confirmed.
      const serverPrintDocuments = body.printDocuments?.version === POS_PRINT_DOCUMENT_VERSION ? body.printDocuments : null;
      if (serverPrintDocuments) {
        savedPayment = { pickupCode: String(body.pickupCode || ""), amount: Number(body.amount || 0), numberLabel: checkoutNumberLabel(body) };
        setLastPaidPrintOrderId(serverPrintDocuments.orderId);
      }
      const bowlPrintMessage = serverPrintDocuments || selectedTableCheckout ? "" : await printCheckoutDocuments({ ...checkoutRequest, ...body }, cartSnapshot);
      if (!serverPrintDocuments) await removePosCheckoutRecovery(selectedStoreId);
      uncertainCheckoutRef.current = null;
      if (!serverPrintDocuments) await refreshPrintJobs();
      const receiptPrintMessage = bowlPrintMessage;
      const kitchenPrintMessage = "";
      setCart([]);
      setSelectedTableCheckoutKey("");
      setTableCheckoutRequests((current) => current.filter((request) => request.tableSessionKey !== selectedTableCheckout?.tableSessionKey));
      setNote("");
      resetReceiptChoice();
      setCashTenderedAmount("");
      setDiscountPresetKey("");
      clearSelectedMember();
      setSummary(body.todaySummary as PosSummary);
      if (!body.offline && transactionDialogOpen) void loadTransactions();
      if (!body.offline) {
        void loadReconciliation(selectedStoreId);
        void load(selectedStoreId, false);
      }
      const discountLabel = body.discountAmount ? ` / ${body.discountName || selectedDiscountPreset?.name || "割引"} -${formatYen(body.discountAmount)}` : "";
      const couponLabel = body.couponDiscountAmount ? ` / クーポン -${formatYen(body.couponDiscountAmount)}` : "";
      const changeLabel = paymentMethod === "cash" ? ` / お釣り ${formatYen(body.cashChangeAmount ?? cashTenderedValue - body.amount)}` : "";
      const receiptRequestLabel = receiptRequested ? " / 領収書" : "";
      const customerDisplayLanguage = getCustomerDisplayLanguage(selectedMember);
      const savedPrintLabel = serverPrintDocuments?.pendingCount ? "会計済み・印刷待ち" : "会計を保存しました";
      showCheckoutNotice("success", `${t(body.offline ? "オフライン会計を端末に保存しました" : savedPrintLabel)}。${checkoutNumberLabel(body)} / ${formatYen(body.amount)}${discountLabel}${couponLabel}${changeLabel}${receiptRequestLabel}${receiptPrintMessage}${kitchenPrintMessage}`);
      setCompletedDisplayState({
        status: "complete",
        storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "",
        orderType,
        paymentMethod,
        paymentLabel: getPaymentDisplayLabel(paymentMethod),
        externalPaymentTerminalBrand: posSettings.externalPaymentTerminalBrand,
        pickupCode: ((body.servingTickets || []) as PosServingTicket[]).map((ticket) => ticket.pickupCode).join(" / ") || body.pickupCode,
        numberKind: body.hasPreparation === false ? "accounting" : "pickup",
        preferredLanguage: selectedMember ? customerDisplayLanguage : "",
        memberDisplayName: getMemberDisplayName(selectedMember, customerDisplayLanguage),
        memberMessage: selectedMember ? "いつもご利用いただきありがとうございます。" : "",
        ...getDisplayDiscountState(selectedDiscountPreset, body.discountAmount, body.discountName || "割引", customerDisplayLanguage),
        ...getDisplayCouponState(selectedCoupon, body.couponDiscountAmount, body.couponName || body.couponCode || "クーポン", customerDisplayLanguage),
        subtotal: body.amount,
        ...getDisplayTaxState(body.taxAmount, body.taxRate, body.priceTaxMode),
        cashTenderedAmount: paymentMethod === "cash" ? cashTenderedValue : null,
        cashChangeAmount: paymentMethod === "cash" ? body.cashChangeAmount ?? cashTenderedValue - body.amount : null,
        items: selectedTableCheckout ? [{
          name: `${selectedTableCheckout.tableLabel} QR追加会計`,
          optionLabel: selectedTableCheckout.itemSummary.slice(0, 3).join(" / "),
          quantity: 1,
          measuredQuantity: null,
          measuredUnit: "",
          measuredUnitPrice: null,
          weightLabel: "",
          unitPrice: Number(body.amount ?? selectedTableCheckout.totalAmount),
          amount: Number(body.amount ?? selectedTableCheckout.totalAmount)
        }] : getCustomerDisplayItems(customerDisplayLanguage)
      });
      if (serverPrintDocuments) {
        try {
          await removePosCheckoutRecovery(selectedStoreId);
          await refreshPrintJobs();
          await printDocuments.refresh();
          if (serverPrintDocuments.mode === "auto" && serverPrintDocuments.pendingCount > 0 && !body.relayPrinting) {
            const sent = await printDocuments.sendCurrentOrder(serverPrintDocuments.orderId, offlineClientOrderId);
            showCheckoutNotice("success", sent.ok
              ? `${t("会計済み・伝票送信済み")}。${checkoutNumberLabel(body)} / ${formatYen(body.amount)}`
              : `${t("会計済み・印刷待ち")}。${checkoutNumberLabel(body)} / ${formatYen(body.amount)} / ${t(sent.error || "印刷待ちの伝票を確認してください。")}`);
          }
        } catch (error) {
          showCheckoutNotice("success", `${t("会計済み・印刷状況を確認してください。")} ${checkoutNumberLabel(body)} / ${formatYen(body.amount)} / ${t(error instanceof Error ? error.message : "印刷待ちの伝票を確認してください。")}`);
        }
      }
    } catch (error) {
      showCheckoutNotice(savedPayment ? "success" : "error", savedPayment
        ? `${t("会計済み・印刷状況を確認してください。")} ${savedPayment.numberLabel} / ${formatYen(savedPayment.amount)} / ${t(error instanceof Error ? error.message : "印刷待ちの伝票を確認してください。")}`
        : error instanceof Error ? error.message : "会計を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  const configuringWeightPricing = configuringItem ? getWeightPricingConfig(configuringItem, orderType) : null;
  const configuringWeightQuantity = Number(weightDraft);
  const configuringWeightBasePrice = configuringWeightPricing?.unitPrice && Number.isFinite(configuringWeightQuantity) && configuringWeightQuantity > 0
    ? Math.round(configuringWeightQuantity * configuringWeightPricing.unitPrice)
    : 0;
  const selectedOptionPreviewTotal = configuringItem
    ? getAvailableItemOptionGroups(configuringItem).reduce((sum, group) => {
        const optionsById = new Map(group.options.map((option) => [option.id, option]));
        return sum + (optionDraft[group.id] ?? []).reduce((groupSum, optionId) => groupSum + getOptionPrice(optionsById.get(optionId) ?? { priceDelta: 0 }), 0);
      }, 0)
    : 0;
  const scaleTareSettings = normalizePosScaleTareSettings(relay.station?.scale_tare_settings ?? relay.stations[0]?.scale_tare_settings ?? posSettings.scaleTareSettings);
  const scaleFilterSettings = normalizePosScaleFilterSettings(relay.station?.scale_filter_settings ?? relay.stations[0]?.scale_filter_settings);
  const tareEnabled = scaleTareSettings.enabled && Boolean(configuringWeightPricing && ['g', 'kg'].includes(configuringWeightPricing.unit));
  const requiresScaleConfirmation = !debugMode && (tareEnabled || relay.stations.some(station => station.enabled && station.scale_enabled));
  const currentScaleScope = `${selectedStoreId}:${configuringItem?.id || ''}${tareEnabled ? `:tare:${scaleTareSettings.revision}:${tarePresetId}` : ''}:filter:${scaleFilterSettings.enabled}:${scaleFilterSettings.revision}:${scaleFilterSettings.toleranceGrams}:${scaleFilterSettings.settleMs}`;
  const confirmedScaleGrams = scaleCapture ? scaleCapture.quantity * (configuringWeightPricing?.unit === 'kg' ? 1000 : 1) : null;
  const automaticWeightReady = Boolean(scaleValidity?.ready && scaleValidity.scopeKey === currentScaleScope
    && scaleValidity.stationId === relay.owner?.stationId && scaleValidity.ownerToken === relay.owner?.token
    && scaleValidity.epoch === relay.owner?.epoch && scaleCapture?.itemId === configuringItem?.id
    && scaleValidity.recoveryVersion === relay.recoveryVersion
    && (!tareEnabled || (scaleCapture?.measurement?.mode === 'preset' && scaleCapture.measurement.tarePresetId === tarePresetId
      && scaleCapture.measurement.settingsRevision === scaleTareSettings.revision))
    && !scaleSnapshotBlocksConfirmation(relay.station, confirmedScaleGrams, relay.now(), scaleCapture?.measurement?.filter?.windowId || null));
  const invalidConfiguredGroup = configuringItem ? getAvailableItemOptionGroups(configuringItem).find(group => {
    const selected = optionDraft[group.id] || [], rules = getPosOptionSelectionRules(group);
    return selected.length < rules.min || selected.length > rules.max || (isStoreDineInSelection(group)
      && selected.some(id => selected.filter(value => value === id).length > rules.perOptionMax));
  }) : undefined;
  const canAddConfiguredItem = !invalidConfiguredGroup && !menuBlocksCurrentOrder && (!configuringWeightPricing ||
    Boolean(configuringWeightPricing.unitPrice && configuringWeightPricing.unitPrice > 0 && Number.isFinite(configuringWeightQuantity) && configuringWeightQuantity > 0
      && (!requiresScaleConfirmation || scaleManualMode || automaticWeightReady)));


  useEffect(() => {
    if (!selectedStoreId || !canUseRegister) return;
    if (completedDisplayState) {
      const nextTransactionStarted = cart.length > 0 || Boolean(selectedMember) || memberLookupInput.trim() || Boolean(configuringItem);
      if (nextTransactionStarted) {
        setCompletedDisplayState(null);
        setCustomerDisplayMode("business");
      } else {
        void publishCustomerDisplayState(completedDisplayState);
        const timer = window.setTimeout(() => {
          setCompletedDisplayState(null);
          setCustomerDisplayMode("advertising");
          void publishCustomerDisplayState(getAdvertisingDisplayState());
        }, 10000);
        return () => window.clearTimeout(timer);
      }
    }
    if (customerDisplayMode === "advertising" && cart.length === 0 && !selectedMember && !memberLookupInput.trim() && !configuringItem) return;
    const status = cart.length === 0 && !selectedTableCheckout && !configuringItem
      ? "idle"
      : paymentMethod === "cash"
        ? cashTenderedAmount.trim() && cashChangeAmount !== null && cashChangeAmount >= 0
          ? "cash_change"
          : "editing"
        : "external_wait";
    const timer = window.setTimeout(() => {
      const customerDisplayLanguage = getCustomerDisplayLanguage(selectedMember);
      const weightPricing = configuringWeightPricing;
      const selectedOptions = configuringItem ? getAvailableItemOptionGroups(configuringItem).flatMap(group => {
        const byId = new Map(group.options.map(option => [option.id, option]));
        return (optionDraft[group.id] ?? []).flatMap(id => {
          const option = byId.get(id);
          return option ? [{ ...option, groupId: group.id, groupKey: group.groupKey, groupName: group.name, groupDisplayNames: group.displayNames }] : [];
        });
      }) : [];
      const quantity = Math.round(Number(weightDraft) * 1000) / 1000;
      const manual = debugMode || scaleManualMode || !requiresScaleConfirmation;
      const ready = Boolean(weightDraft.trim() && Number.isFinite(quantity) && quantity > 0 && weightPricing?.unitPrice
        && weightPricing.unitPrice > 0 && (manual || automaticWeightReady));
      const optionsAmount = selectedOptions.reduce((sum, option) => sum + getOptionPrice(option), 0);
      const measurement = !manual ? scaleCapture?.measurement : undefined;
      const weighing: PosCustomerDisplayWeighingDraft | null = weightPricing && configuringItem
        && Number.isFinite(weightPricing.unitPrice) && Number(weightPricing.unitPrice) > 0
        && ['g', 'kg'].includes(weightPricing.unit) ? {
          previewId: weighingPreviewId, itemId: configuringItem.id,
          itemName: getLocalizedDisplayName(configuringItem.name, configuringItem.displayNames, customerDisplayLanguage),
          optionLabel: getCustomerDisplayOptionLabel(selectedOptions, customerDisplayLanguage, false),
          source: ready ? manual ? 'manual' : 'capture' : 'waiting',
          status: ready ? manual ? 'manual' : 'stable' : 'waiting',
          quantity: ready ? quantity : null, unit: weightPricing.unit as 'g' | 'kg',
          unitPrice: Number(weightPricing.unitPrice ?? 0), optionsAmount,
          amount: ready ? Math.round(quantity * Number(weightPricing.unitPrice ?? 0)) + optionsAmount : null,
          priceTaxMode: posSettings.priceTaxMode === "tax_excluded" ? "tax_excluded" : "tax_included",
          ...(ready && !manual && scaleCapture ? { captureId: scaleCapture.id } : {}),
          ...(measurement?.mode === 'preset' ? { grossGrams: measurement.grossGrams, tareGrams: measurement.tareGrams, tarePresetId: measurement.tarePresetId } : {})
        } : null;
      void publishCustomerDisplayState({
        status,
        storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "",
        orderType,
        paymentMethod,
        paymentLabel: getPaymentDisplayLabel(paymentMethod),
        externalPaymentTerminalBrand: posSettings.externalPaymentTerminalBrand,
        pickupCode: "",
        preferredLanguage: selectedMember ? customerDisplayLanguage : "",
        memberDisplayName: getMemberDisplayName(selectedMember, customerDisplayLanguage),
        memberMessage: selectedMember ? "いつもご利用いただきありがとうございます。" : "",
        ...getDisplayDiscountState(selectedDiscountPreset, posDiscountAmount, "", customerDisplayLanguage),
        ...getDisplayCouponState(selectedCoupon, couponDiscountAmount, "", customerDisplayLanguage),
        subtotal: activeCheckoutAmount,
        ...getDisplayTaxState(taxSummary.taxAmount, taxRate),
        cashTenderedAmount: paymentMethod === "cash" && cashTenderedAmount.trim() ? cashTenderedValue : null,
        cashChangeAmount: paymentMethod === "cash" && cashChangeAmount !== null ? cashChangeAmount : null,
        weighing,
        items: selectedTableCheckout ? [{
          name: `${selectedTableCheckout.tableLabel} QR追加会計`,
          optionLabel: selectedTableCheckout.itemSummary.slice(0, 3).join(" / "),
          quantity: 1,
          measuredQuantity: null,
          measuredUnit: "",
          measuredUnitPrice: null,
          weightLabel: "",
          unitPrice: tableCheckoutAmount,
          amount: tableCheckoutAmount
        }] : getCustomerDisplayItems(customerDisplayLanguage)
      });
    }, 180);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, cashTenderedAmount, completedDisplayState, customerDisplayMode, memberLookupInput, orderType, paymentMethod, posSettings.externalPaymentTerminalBrand, posSettings.priceTaxMode, posSettings.printerSettings.customerDisplay.enabled, posSettings.printerSettings.receiptPrinter.connectionType, posSettings.printerSettings.receiptPrinter.deviceType, posSettings.printerSettings.receiptPrinter.identifier, selectedCoupon?.id, selectedCoupon?.name, selectedCoupon?.couponCode, selectedDiscountPreset?.key, selectedDiscountPreset?.name, selectedMember, selectedStoreId, payableAmount, posDiscountAmount, couponDiscountAmount, taxRate, taxSummary.taxAmount, canUseRegister, activeCheckoutAmount, selectedTableCheckout, tableCheckoutAmount, debugMode, debugSessionId, configuringItem, weightDraft, weighingPreviewId, optionDraft, scaleManualMode, requiresScaleConfirmation, automaticWeightReady, scaleCapture, offlineCheckoutOnly, relay.owner?.stationId, relay.owner?.token, relay.owner?.epoch, relay.required, posSettingsStoreId]);

  useEffect(() => {
    if (!selectedStoreId || !canUseRegister) return;
    if (customerDisplayMode !== "business" || completedDisplayState || hasCurrentTransaction) return;
    const timer = window.setTimeout(() => {
      setCustomerDisplayMode("advertising");
      void publishCustomerDisplayState(getAdvertisingDisplayState());
    }, 10000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseRegister, completedDisplayState, customerDisplayMode, hasCurrentTransaction, orderType, paymentMethod, posSettings.printerSettings.customerDisplay.enabled, posSettings.printerSettings.receiptPrinter.connectionType, posSettings.printerSettings.receiptPrinter.deviceType, posSettings.printerSettings.receiptPrinter.identifier, selectedStoreId]);

  async function submitCashAction(action: "open" | "movement" | "close") {
    if (debugMode) return;
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は開店確認・入出金・レジ締めを変更できません。");
      return;
    }
    if (!selectedStoreId || cashSaving) return;
    if (action === "close" && offlinePendingCount > 0) {
      setMessage(`未同期のオフライン注文が ${offlinePendingCount} 件あります。同期完了後にレジ締めしてください。`);
      return;
    }
    if (action === "close" && !canCloseRegister) {
      setMessage(cashCloseBlockedReason);
      return;
    }
    if (action === "open" && !canOpenRegister) {
      setCashActionError(openingPickupNumberError || cashOpenBlockedReason);
      return;
    }
    setCashSaving(true);
    setCashActionError("");
    setMessage("");
    try {
      const payload = action === "open"
        ? { action, storeId: selectedStoreId, openingBreakdown: cashOpeningBreakdown, note: cashOpeningNote, openingPickupNumber: Number(cashOpeningPickupNumber) }
        : action === "movement"
          ? {
              action,
              storeId: selectedStoreId,
              movementType: cashMovementType,
              amount: Number(cashMovementAmount || 0),
              reason: cashMovementReason
            }
          : {
              action,
              storeId: selectedStoreId,
              countedBreakdown: normalizeCashBreakdown(cashCountedBreakdown),
              note: cashClosingNote,
              closingResponsibleEmployeeId: cashClosingResponsibleEmployeeId
            };
      const response = await fetch("/api/store/pos/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "レジ締めを保存できませんでした。");
      setReconciliation({
        businessDate: body.businessDate ?? reconciliation.businessDate,
        businessState: body.businessState ?? reconciliation.businessState,
        activeSession: body.activeSession ?? null,
        previousClosedSession: body.previousClosedSession ?? reconciliation.previousClosedSession,
        sessions: body.sessions ?? [],
        movements: body.movements ?? [],
        activeCashResponsibleEmployees: body.activeCashResponsibleEmployees ?? reconciliation.activeCashResponsibleEmployees
      });
      if (action === "open") {
        setCashOpeningBreakdown(createCashBreakdownInput());
        setCashOpeningReason("");
        setCashOpeningNote("");
        setCashDialog(null);
        setMessage("日次レジ締めを開始しました。");
      } else if (action === "movement") {
        setCashMovementAmount("");
        setCashMovementReason("");
        setCashDialog(null);
        setMessage(cashMovementType === "cash_in" ? "入金を記録しました。" : "出金を記録しました。");
      } else {
        setCashCountedBreakdown(createCashBreakdownInput());
        setCashClosingNote("");
        setCashClosingResponsibleEmployeeId("");
        setCashDialog(null);
        setMessage("日次レジ締めを締めました。");
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "レジ締めを保存できませんでした。";
      setCashActionError(text);
      setMessage(text);
    } finally {
      setCashSaving(false);
    }
  }

  function revealCheckoutSection() {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setCartOpen(true);
      return;
    } else {
      checkoutSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.setTimeout(() => {
      checkoutSectionRef.current?.querySelector<HTMLButtonElement>("button.is-active")?.focus({ preventScroll: true });
    }, 450);
  }

  async function loadTransactions(orderId = selectedTransaction?.id ?? "") {
    if (debugMode) return;
    if (!selectedStoreId) return;
    setTransactionLoading(true);
    try {
      const params = new URLSearchParams({ storeId: selectedStoreId });
      if (orderId) params.set("orderId", orderId);
      const response = await fetch(`/api/store/pos/transactions?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "取引履歴を読み込めませんでした。");
      const nextTransactions = (body.transactions ?? []) as PosTransaction[];
      setTransactions(nextTransactions);
      setSelectedTransaction((body.selectedTransaction ?? null) as PosTransaction | null);
      setRefundReason("");
      setSelectedRefundItemIds([]);
      setExternalRefundConfirmed(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取引履歴を読み込めませんでした。");
    } finally {
      setTransactionLoading(false);
    }
  }

  async function openPrintFromTransaction(orderId: string) {
    const store = selectedStoreId;
    const flag = String(window.history.state?.__foundr1Modal || '');
    // Finish the transaction modal's own history pop before the print drawer
    // creates its history entry. Otherwise that pop immediately closes it.
    if (flag.startsWith('__foundr1Modal:store-pos-transactions:')) {
      await new Promise<void>(resolve => {
        const done = () => { window.clearTimeout(timer); window.removeEventListener('popstate', done); resolve(); };
        const timer = window.setTimeout(done, 1500);
        window.addEventListener('popstate', done, { once: true });
        setTransactionDialogOpen(false);
      });
    } else setTransactionDialogOpen(false);
    if (selectedStoreIdRef.current === store) setRequestedPrintOrder({ id: orderId, request: Date.now() });
  }

  async function openTransactionDialog() {
    if (debugMode) return;
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は取引履歴・返金を利用できません。");
      return;
    }
    setTransactionDialogOpen(true);
    await loadTransactions("");
  }

  async function selectTransaction(orderId: string) {
    if (debugMode) return;
    if (offlineCheckoutOnly) return;
    await loadTransactions(orderId);
  }

  async function refundTransaction(itemIds: string[] = []) {
    if (debugMode) return;
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は返金を利用できません。");
      return;
    }
    if (!selectedStoreId || !selectedTransaction || refundSaving) return;
    if (!itemIds.length && !selectedRefundOptions.length) return;
    const refundingId = selectedTransaction.id;
    setRefundSaving(true);
    setRefundingTransactionId(refundingId);
    setMessage("");
    try {
      const payload = { storeId: selectedStoreId, orderId: refundingId, itemIds, optionSelections: selectedRefundOptions, reason: refundReason, externalRefundConfirmed };
      const signature = JSON.stringify(payload);
      if (pendingRefund.current?.signature !== signature) pendingRefund.current = { signature, id: window.crypto.randomUUID() };
      setRefundError("");
      const response = await fetch("/api/store/pos/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId: pendingRefund.current.id })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "返金を保存できませんでした。");
      setTransactions((body.transactions ?? []) as PosTransaction[]);
      setSelectedTransaction((body.selectedTransaction ?? null) as PosTransaction | null);
      setSummary((current) => ({ ...current, ...(body.todaySummary ?? {}) }));
      setRefundReason("");
      setSelectedRefundItemIds([]);
      setSelectedRefundOptions([]);
      pendingRefund.current = null;
      setExternalRefundConfirmed(false);
      await loadReconciliation(selectedStoreId);
      setMessage(`返品を記録しました。${selectedTransaction.pickupCode} / ${formatYen(body.refundAmount ?? 0)}`);
    } catch (error) {
      setRefundError(error instanceof Error ? error.message : "返金を保存できませんでした。");
    } finally {
      setRefundSaving(false);
      setRefundingTransactionId("");
    }
  }


  function enterDebugMode() {
    if (debugMode) return;
    // Saved print failures and read-only queue refreshes survive this navigation.
    // Block operations in flight and unsaved/uncertain sales, not historical print backlog.
    const blockedReason = !debugEntryReady || loading
      ? "端末の保存内容を確認中です。少し待ってからテストモードを開いてください。"
      : saving || cashSaving || refundSaving
        ? "会計・レジ金額・返品の保存が終わってから、テストモードを開いてください。"
        : printBusy || printDocuments.busy || Number(printDocuments.queue?.summary.sendingDocuments) > 0 || reprintOrderId
          ? "印刷処理が終わってから、テストモードを開いてください。未印刷の伝票が残っているだけならテストできます。"
          : offlineSyncBusy || offlineSyncBusyRef.current || offlinePendingCount > 0
            ? "未同期の売上があります。同期を完了してから、テストモードを開いてください。"
            : hasMenuDraft
              ? "入力中の会計を完了または中止してから、テストモードを開いてください。"
              : hasPendingCheckout || checkoutRecovery.length > 0 || uncertainCheckoutRef.current
                ? "結果未確認の会計があります。会計結果を確認してから、テストモードを開いてください。"
                : memberLookupLoading || customerDisplayScanPending || cashDialog || transactionDialogOpen || memberScannerOpen || tableCheckoutAdjustingKey || menuRefresh.checking
                  ? "開いている操作画面を閉じ、処理が終わってからテストモードを開いてください。"
                  : "";
    if (blockedReason) { setMessage(t(blockedReason)); return; }
    window.location.assign(`/store/pos/debug${selectedStoreId ? `?storeId=${encodeURIComponent(selectedStoreId)}` : ""}`);
  }

  async function exitDebugMode() {
    if (!debugMode || !window.confirm(t("テスト内容をすべて破棄して、通常の POS に戻りますか？"))) return;
    let timer = 0;
    await Promise.race([
      Promise.resolve(debugDisplay.end()).catch(() => undefined),
      new Promise<void>(resolve => { timer = window.setTimeout(resolve, 1500); })
    ]);
    window.clearTimeout(timer);
    window.location.assign("/store/pos");
  }

  return (
    <main className="store-workbench-shell store-pos-page" data-pos-debug={debugMode || undefined}>
      <header className="store-workbench-topbar">
        <a className="brand-block" href={debugMode ? "/store/pos" : "/store"} onClick={debugMode ? event => { event.preventDefault(); exitDebugMode(); } : undefined} aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>POS</h1>
          </div>
        </a>
        {!debugMode ? <StoreNavTabs active="pos" posDebugAction={{ label: t("テストモード"), onSelect: enterDebugMode }} /> : null}
      </header>

      {debugMode ? <PosDebugBanner onExit={exitDebugMode} /> : null}
      {debugMode ? <PosDebugDisplayPanel storeId={selectedStoreId} sessionId={debugSessionId} status={debugDisplay.status} error={debugDisplay.error} onRetry={debugDisplay.retry} /> : null}
      <section className="store-pos-head">
        <div>
          <p className="eyebrow">レジ</p>
          <h2>店頭会計</h2>
        </div>
        <div className="store-pos-head-actions">
          {!debugMode ? <button className="secondary-button" type="button" onClick={() => void openTransactionDialog()} disabled={offlineCheckoutOnly}>取引履歴</button> : null}
          {debugMode && debugLoadError && !loading ? <button type="button" className="secondary-button" data-pos-debug-retry onClick={() => void load(selectedStoreId)}>{t("再試行")}</button> : null}
          <button type="button" className={`secondary-button ${menuRefreshStyles.refresh}`} data-pos-menu-refresh disabled={!selectedStoreId || menuRefreshBlocked || menuRefresh.checking} title={menuRefreshBlocked ? t("会計や処理が完了してから、メニューを更新してください。") : undefined} onClick={() => void menuRefresh.refresh()}><RefreshCw size={15} aria-hidden="true" />{t(menuRefresh.checking ? "更新確認中…" : "メニューを更新")}</button>
          {!debugMode ? <PosDailySummary key={selectedStoreId} storeId={selectedStoreId} summary={summary} onRefresh={() => void refreshSummary()} refreshing={summaryRefreshing} refreshError={summaryError} /> : null}
        </div>
      </section>

      <PosMenuRefreshNotice available={menuRefresh.updateAvailable} error={menuRefresh.error} checking={menuRefresh.checking} blocked={menuRefreshBlocked} hasDraft={hasMenuDraft} onRefresh={() => void menuRefresh.refresh()} />

      {message ? <div className="action-notice store-pos-notice">{message}</div> : null}
      {debugMode && debugLoadError ? <div className="inline-alert is-warning" role="alert">{t(debugLoadError)}</div> : null}
      {!debugMode ? <StoreRelayPanel relay={relay} storeId={selectedStoreId} /> : null}
      {!debugMode ? <PosPrintDocumentsPanel storeId={selectedStoreId} controller={printDocuments} requestedOrder={requestedPrintOrder} canPrint={nativePrintAvailable || relayPrintAvailable} showSummary={showPrintQueue} /> : null}
      {!debugMode ? <PosFulfillmentPanel storeId={selectedStoreId} enabled={posSettings.fulfillmentWorkspace.enabled}
        overdueMinutes={posSettings.fulfillmentWorkspace.overdueMinutes} disabled={offlineCheckoutOnly}
        checkoutRefreshKey={summary.latestOrders[0]?.id ?? ""} /> : null}
      {offlineCheckoutOnly || offlinePendingCount > 0 ? (
        <div className="action-notice store-pos-offline-notice" role="status">
          <strong>{offlineCheckoutOnly ? "オフライン応急モード（現金のみ）" : "オフライン注文を同期中"}</strong>
          <span> 未同期 {offlinePendingCount} 件</span>
          {offlineCheckoutOnly ? <small>会員・クーポン・割引・外部決済・テーブル会計・レジ操作はオンライン復帰後に利用できます。</small> : null}
          {browserOnline && offlinePendingCount > 0 ? <button type="button" onClick={() => void syncOfflineOrders()}>今すぐ同期</button> : null}
          {offlineSyncError ? <small>{offlineSyncError}</small> : null}
        </div>
      ) : null}

      {!debugMode ? <section className={`store-pos-cash-strip ${reconciliation.activeSession ? "is-open" : "is-locked"}`}>
        <div>
          <span>レジ状態</span>
          <strong>{reconciliation.activeSession ? "開店済み" : "未開店"}</strong>
          <small>
            {reconciliation.activeSession ? (
              <>
                <span>開店 {formatDateTime(reconciliation.activeSession.openedAt) || "-"}</span>
                <span>担当 {reconciliation.activeSession.openedByName || "-"}</span>
              </>
            ) : reconciliation.previousClosedSession ? (
              <>
                <span data-pos-last-close>{t("前回レジ締め {date}", {date:formatDateTime(reconciliation.previousClosedSession.closedAt)||reconciliation.previousClosedSession.businessDate})}</span>
                <span>担当 {reconciliation.previousClosedSession.closedByName || "-"}</span>
              </>
            ) : reconciliation.businessState ? (
              `${reconciliation.businessState.statusLabel} / 営業日 ${reconciliation.businessState.businessDate}`
            ) : reconciliation.businessDate || "-"}
          </small>
        </div>
        <div>
          <span>システム上の現金</span>
          <strong>{reconciliation.activeSession ? formatYen(reconciliation.activeSession.expectedCashAmount) : "-"}</strong>
          <small>
            {reconciliation.activeSession ? (
              <>
                <span>開始 {formatYen(reconciliation.activeSession.openingAmount)} / 現金売上 {formatYen(reconciliation.activeSession.cashSales)}</span>
                <span>営業日 {reconciliation.activeSession.businessDate}</span>
              </>
            ) : (
              "開店確認後に POS 会計を開始できます。"
            )}
          </small>
        </div>
        <div className="store-pos-cash-strip-actions">
          {reconciliation.activeSession ? (
            <>
              <button className="secondary-button" type="button" onClick={() => setCashDialog("movement")} disabled={offlineCheckoutOnly}>入出金</button>
              <button className="primary-button" type="button" onClick={() => setCashDialog("close")} disabled={offlineCheckoutOnly}>レジ締め</button>
            </>
          ) : (
            <button className="primary-button" type="button" onClick={() => setCashDialog("open")} disabled={offlineCheckoutOnly}>開店確認</button>
          )}
        </div>
      </section> : null}

      <section className="store-pos-layout">
        <div className="store-pos-menu-panel">
          <aside className="store-pos-filter-panel">
            <div className="store-pos-filter-group">
              <span>ブランド</span>
              <div className="store-pos-filter-list">
                {brands.map((brand) => (
                  <button
                    key={brand.id}
                    className={selectedBrandId === brand.id ? "is-active" : ""}
                    type="button"
                    onClick={() => {
                      setSelectedBrandId(brand.id);
                      setSelectedCategory(null);
                      setQuery("");
                    }}
                  >
                    {brand.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="store-pos-filter-group store-pos-categories">
              <label className="store-pos-category-select">
                <span>分類</span>
                <select value={activeCategory ?? ""} onChange={(event) => setSelectedCategory(event.target.value || null)}>
                  <option value="">すべて</option>
                  {categorySummaries.map((category) => <option key={category.name} value={category.name}>{category.name} ({category.count})</option>)}
                </select>
              </label>
              <span className="store-pos-category-heading">分類</span>
              <div className="store-pos-filter-list">
                <button className={!activeCategory ? "is-active" : ""} type="button" onClick={() => setSelectedCategory(null)}>
                  すべて
                  <small>{items.filter((item) => !selectedBrandId || item.brandId === selectedBrandId).length}</small>
                </button>
                {categorySummaries.map((category) => (
                  <button
                    key={category.name}
                    className={activeCategory === category.name ? "is-active" : ""}
                    type="button"
                    onClick={() => setSelectedCategory(category.name)}
                  >
                    {category.name}
                    <small>{category.count}</small>
                  </button>
                ))}
              </div>
            </div>

            <label className="store-pos-search">
              <span>検索</span>
              <div>
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名" />
              </div>
            </label>
          </aside>

          <section className="store-pos-product-panel">
            <div className="store-pos-product-head">
              <div>
                <p className="eyebrow">Products</p>
                <h3>商品を選択</h3>
              </div>
              <span>{visibleItems.length} 件</span>
            </div>
            {!debugMode && !canUseRegister ? (
              <div className="store-pos-lock-notice">
                開店前のレジ金額を確認すると商品選択を開始できます。
              </div>
            ) : null}

            {loading ? (
              <div className="store-pos-empty">読み込み中...</div>
            ) : visibleItems.length === 0 ? (
              <div className="store-pos-empty">POS で販売できる商品がありません。</div>
            ) : (
              <div className="store-pos-item-grid">
                {visibleItems.map((item) => (
                  <button key={item.id} className="store-pos-item-button" type="button" onClick={() => beginItemSelection(item)} disabled={!canUseRegister || saving || printBusy || menuBlocksCurrentOrder || checkoutRecovery.some((record) => record.storeId === selectedStoreId)}>
                    {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="store-pos-image-empty">F1</span>}
                    <div className="store-pos-item-info">
                      <span>{item.category || item.brandName}</span>
                      <strong>{item.name}</strong>
                      <em>{formatWeightPrice(item, orderType) || `${formatYen(getMenuDisplayPrice(item))}${posSettings.priceTaxMode === "tax_excluded" ? " 税込" : ""}`}</em>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside ref={cartDialogRef} className={`store-pos-cart-panel${cartOpen ? " is-open" : ""}`} role={cartOpen ? "dialog" : undefined} aria-modal={cartOpen || undefined} aria-label="会計内容">
          {cartOpen ? <ModalHistoryScope historyKey="store-pos-cart" onClose={() => setCartOpen(false)}><span /></ModalHistoryScope> : null}
          {debugMode ? <PosDebugBanner compact onExit={exitDebugMode} /> : null}
          <button className="secondary-button store-pos-cart-back" type="button" onClick={() => setCartOpen(false)}>商品選択に戻る</button>
          <div className="store-pos-cart-head">
            <div>
              <p className="eyebrow">Cart</p>
              <h3>会計内容</h3>
            </div>
            <div className="store-pos-cart-head-actions">
              <strong>{cartCount} 点</strong>
            </div>
          </div>

          <PosMenuRefreshNotice available={menuRefresh.updateAvailable} error={menuRefresh.error} checking={menuRefresh.checking} blocked={menuRefreshBlocked} hasDraft={hasMenuDraft} onRefresh={() => void menuRefresh.refresh()} />
          {!debugMode && tableCheckoutRequests.length ? (
            <section className="store-pos-table-checkout-panel" aria-label="テーブル会計待ち">
              <div className="store-pos-table-checkout-head">
                <span>テーブル会計待ち</span>
                <strong>{tableCheckoutRequests.length}件</strong>
              </div>
              {offlineCheckoutOnly ? <small>オフライン中はテーブル会計を処理できません。</small> : null}
              <div className="store-pos-table-checkout-list">
                {tableCheckoutRequests.map((request) => (
                  <button
                    key={request.tableSessionKey}
                    className={selectedTableCheckoutKey === request.tableSessionKey ? "is-active" : ""}
                    type="button"
                    onClick={() => selectTableCheckout(request)}
                    disabled={!canUseRegister || saving || offlineCheckoutOnly}
                  >
                    <span>
                      <strong>{request.tableLabel}</strong>
                      <small>
                        {request.checkoutRequestType === "staff_to_table" ? "テーブル会計依頼" : "レジ会計待ち"}
                        {formatTime(request.checkoutRequestedAt) ? ` / ${formatTime(request.checkoutRequestedAt)}` : ""}
                        {request.orderCount > 1 ? ` / ${request.orderCount}件` : ""}
                      </small>
                      <small>{request.itemSummary.slice(0, 3).join(" / ")}</small>
                    </span>
                    <b>{formatYen(request.totalAmount)}</b>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="store-pos-segmented">
            {visibleOrderTypeOptions.map((option) => (
              <button key={option.value} className={orderType === option.value ? "is-active" : ""} type="button" onClick={() => changeOrderType(option.value)}>
                {option.label}
              </button>
            ))}
          </div>

          {!debugMode && !selectedTableCheckout && cart.some(isPosBowl) ? (
            <div className="inline-alert">1杯ごとに厨房伝票→出品伝票→お客様番号札の順で同じ受付番号を印刷します。最後に会計ごとのレシートを1枚印刷します。</div>
          ) : null}
          {checkoutRecovery.filter((record) => record.storeId === selectedStoreId).map((record) => (
            <div className="inline-alert is-warning" key={record.storeId}>
              <p>未確認の会計があります。新しい会計を作成せず、元の会計結果を確認してください。</p>
              <button className="secondary-button" type="button" disabled={saving || printBusy} onClick={() => void recoverCheckout(record)}>元の会計結果を確認</button>
              <button className="secondary-button" type="button" disabled={saving || printBusy} onClick={() => void abandonCheckout(record)}>未保存の場合だけ無効化</button>
            </div>
          ))}
          {reprintOrderId && !printJobs.some((job) => job.orderId === reprintOrderId) ? <div className="inline-alert is-warning">この端末の印刷記録を確認できません。元のレジ端末で伝票を確認してください。</div> : null}
          {(showPrintQueue || reprintOrderId) && printJobs.some((job) => job.storeId === selectedStoreId) ? (
            <details id="pos-print-documents" className="procedure-reference-disclosure store-pos-print-documents" open={Boolean(reprintOrderId) || printJobs.some((job) => job.storeId === selectedStoreId && job.state !== "sent")}>
              <summary>伝票の送信状況・再印刷</summary>
              <p>送信済みでも実際の印刷を確認してください。結果不明の伝票は現物を確認してから同じ番号で再印刷します。</p>
              {printJobs.filter((job) => job.storeId === selectedStoreId && job.state !== "sent").concat(printJobs.filter((job) => job.storeId === selectedStoreId && job.state === "sent" && (!reprintOrderId || job.orderId === reprintOrderId)).slice(reprintOrderId ? 0 : -10)).map((job) => (
                <div className="store-pos-cart-row" key={job.id}>
                  <span>{job.label} / {job.state === "sent" ? "送信済み" : job.state === "pending" ? "未送信" : "要確認"}{job.error ? ` / ${job.error}` : ""}</span>
                  <button className="secondary-button" type="button" disabled={saving || printBusy} onClick={() => void retryPrintJob(job)}>同じ番号で再印刷</button>
                </div>
              ))}
            </details>
          ) : null}

          <div className="store-pos-cart-list">
            {selectedTableCheckout ? (
              <div className="store-pos-table-checkout-selected">
                <span>QR追加会計</span>
                <strong>{selectedTableCheckout.tableLabel}</strong>
                <p>{selectedTableCheckout.itemSummary.slice(0, 5).join(" / ") || "追加注文"}</p>
                <small>{selectedTableCheckout.orderCount}件 / {selectedTableCheckout.pickupCodes.join(", ")}</small>
                <div className="store-pos-table-adjust-list">
                  {selectedTableCheckout.orders.map((order) => (
                    <section className="store-pos-table-adjust-order" key={order.id}>
                      <div className="store-pos-table-adjust-order-head">
                        <span>{order.pickupCode}</span>
                        <strong>{formatYen(order.amount)}</strong>
                        <button
                          className="danger-text-button"
                          type="button"
                          disabled={Boolean(tableCheckoutAdjustingKey) || saving}
                          onClick={() => void adjustTableCheckout({ action: "cancel_order", orderId: order.id })}
                        >
                          注文取消
                        </button>
                      </div>
                      {order.items.map((item) => (
                        <div className="store-pos-table-adjust-item" key={item.id}>
                          <div>
                            <strong>{item.name}</strong>
                            {item.optionLabel ? <small>{item.optionLabel}</small> : null}
                            {item.toppings.length ? <small>{item.toppings.join(" / ")}</small> : null}
                            <span>{formatYen(item.amount)}</span>
                          </div>
                          <div className="store-pos-quantity">
                            <button
                              type="button"
                              disabled={Boolean(tableCheckoutAdjustingKey) || saving}
                              onClick={() => void adjustTableCheckout({
                                action: item.quantity <= 1 ? "cancel_item" : "set_item_quantity",
                                orderId: order.id,
                                itemId: item.id,
                                quantity: item.quantity - 1
                              })}
                              aria-label="数量を減らす"
                            >
                              <Minus size={16} />
                            </button>
                            <span>{item.quantity}</span>
                            <button
                              type="button"
                              disabled={Boolean(tableCheckoutAdjustingKey) || saving}
                              onClick={() => void adjustTableCheckout({
                                action: "set_item_quantity",
                                orderId: order.id,
                                itemId: item.id,
                                quantity: item.quantity + 1
                              })}
                              aria-label="数量を増やす"
                            >
                              <Plus size={16} />
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(tableCheckoutAdjustingKey) || saving}
                              onClick={() => void adjustTableCheckout({ action: "cancel_item", orderId: order.id, itemId: item.id })}
                              aria-label="削除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </div>
            ) : cart.length === 0 ? (
              <div className="store-pos-empty">商品を選択してください。</div>
            ) : cart.map((item, itemIndex) => (
              <div key={item.cartKey} className="store-pos-cart-row">
                <div>
                  <strong>{item.name}</strong>
                  {getWeightLineLabel(item) ? <small>{getWeightLineLabel(item)}</small> : null}
                  {item.weightMeasurement?.mode === 'preset' ? <small>{t(item.weightMeasurement.tarePresetId === 'small' ? 'ボウル（小）' : 'ボウル（大）')} −{item.weightMeasurement.tareGrams} g · {t('総重量')} {item.weightMeasurement.grossGrams} g</small> : item.weightMeasurement?.mode === 'manual_net' && item.measuredQuantity ? <small>{t('正味重量を手入力')}</small> : null}
                  {item.selectedOptions.length ? <small>{getOptionLabel(item.selectedOptions)}</small> : null}
                  {isPosBowl(item) ? <label className="store-pos-bowl-note"><span>この杯の厨房メモ</span><input value={item.preparationNote || ""} maxLength={300} disabled={saving} onChange={(event) => setCart((current) => current.map((entry) => entry.cartKey === item.cartKey ? { ...entry, preparationNote: event.target.value } : entry))} /></label> : null}
                  {isPosBowl(item)?<PosBowlBenefitPicker rules={posSettings.discountPresets} gifts={giftCatalog} now={discountNow} disabled={saving||offlineCheckoutOnly} line={{...item,amount:getCartItemAmount(item),isBowl:true,choice:item.bowlBenefit}} applied={bowlEvaluation.applications.find(a=>a.index===itemIndex)} onChange={value=>setCart(current=>current.map(entry=>entry.cartKey===item.cartKey?{...entry,bowlBenefit:value}:entry))}/>:null}
                  <span>{formatYen(getLineUnitPrice(item))}{item.measuredQuantity ? "" : ` x ${item.quantity}`}</span>
                </div>
                <div className="store-pos-quantity">
                  {!item.measuredQuantity ? (
                    <>
                      <button type="button" onClick={() => changeQuantity(item.cartKey, -1)} aria-label="数量を減らす"><Minus size={16} /></button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => changeQuantity(item.cartKey, 1)} disabled={menuBlocksCurrentOrder} aria-label="数量を増やす"><Plus size={16} /></button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => changeQuantity(item.cartKey, -99)} aria-label="削除"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>

          {!debugMode ? <div className={selectedMember ? "store-pos-member-panel is-linked" : "store-pos-member-panel"}>
            <div className="store-pos-member-title">
              <div>
                <UserRound size={16} />
                <span>会員</span>
              </div>
              {selectedMember ? (
                <button type="button" onClick={clearSelectedMember} aria-label="会員を解除">
                  <X size={14} />
                </button>
              ) : null}
            </div>
            {offlineCheckoutOnly ? (
              <small className="store-pos-member-empty-coupon">オフライン中は会員証・クーポンを利用できません。</small>
            ) : selectedMember ? (
              <>
                <div className="store-pos-member-card">
                  <strong>{selectedMember.displayName || selectedMember.email || selectedMember.memberNumber}</strong>
                  <span>{selectedMember.memberNumber} / {selectedMember.pointBalance.toLocaleString("ja-JP")} pt</span>
                </div>
                {memberCoupons.length ? (
                  <div className="store-pos-coupon-panel">
                    <div className="store-pos-coupon-head">
                      <span><Gift size={14} /> 利用可能クーポン</span>
                      {shouldShowRecommendedCoupon && recommendedCoupon ? (
                        <button type="button" onClick={() => setSelectedCouponId(recommendedCoupon.id)}>
                          おすすめを適用
                        </button>
                      ) : null}
                    </div>
                    {shouldShowRecommendedCoupon && recommendedCoupon ? (
                      <p className="store-pos-coupon-recommend">
                        {recommendedCouponExpiringSoon && recommendedCouponExpiryLabel
                          ? `${recommendedCoupon.name} は ${recommendedCouponExpiryLabel} です。有効期限が近いため優先利用を案内してください。`
                          : `${recommendedCoupon.name} の方が ${formatYen(Math.max(0, recommendedCouponDiscountAmount - selectedCouponDiscountAmount))} お得です。`}
                      </p>
                    ) : null}
                    <div className="store-pos-coupon-list">
                      {memberCoupons.map((coupon) => {
                        const discount = getCouponDiscountAmount(coupon, subtotal, getExchangeEligibleBodyAmounts(coupon));
                        const isSelected = selectedCouponId === coupon.id;
                        const isRecommended = recommendedCoupon?.id === coupon.id && discount > 0;
                        const isCustomerSelected = customerSelectedCouponId === coupon.id;
                        const isUnavailable = couponBlockedByDiscount || (subtotal > 0 && discount <= 0);
                        const expiryLabel = getCouponExpiryLabel(coupon);
                        const expiringSoon = isCouponExpiringSoon(coupon);
                        const couponBadges = [
                          couponBlockedByDiscount ? "割引中は併用不可" : "",
                          isCustomerSelected ? "客さま選択済み" : "",
                          expiringSoon && expiryLabel ? `期限優先 ${expiryLabel}` : expiryLabel ? `期限 ${expiryLabel}` : "",
                          isRecommended ? "おすすめ" : ""
                        ].filter(Boolean);
                        return (
                          <button
                            key={coupon.id}
                            className={[
                              "store-pos-coupon-choice",
                              isSelected ? "is-selected" : "",
                              isCustomerSelected ? "is-customer-selected" : "",
                              isRecommended ? "is-recommended" : ""
                            ].filter(Boolean).join(" ")}
                            type="button"
                            disabled={isUnavailable}
                            onClick={() => setSelectedCouponId((current) => current === coupon.id ? "" : coupon.id)}
                          >
                            <span>
                              <strong>{coupon.name}</strong>
                              <small>{getCouponScopeLabel(coupon)} / {coupon.couponCode} / {getCouponValueLabel(coupon)}{couponBadges.length ? ` / ${couponBadges.join(" / ")}` : ""}</small>
                            </span>
                            <b>{getCouponPosStatusLabel(coupon, discount, subtotal)}</b>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <small className="store-pos-member-empty-coupon">利用可能クーポンはありません。</small>
                )}
              </>
            ) : (
              <div className="store-pos-member-lookup-wrap">
                <div className="store-pos-member-lookup">
                  <ScanLine size={16} />
                  <input
                    value={memberLookupInput}
                    onChange={(event) => setMemberLookupInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void lookupMember();
                      }
                    }}
                    placeholder="会員番号 / 電話番号 / メール / QR"
                    inputMode="text"
                  />
                  <button className="secondary-button" type="button" onClick={() => void lookupMember()} disabled={!memberLookupInput.trim() || memberLookupLoading}>
                    {memberLookupLoading ? "確認中" : "確認"}
                  </button>
                  <button className="secondary-button store-pos-member-scan-button" type="button" onClick={() => setMemberScannerOpen(true)}>
                    <Camera size={15} />
                    POS背面
                  </button>
                  <button className="secondary-button store-pos-member-scan-button" type="button" onClick={() => void openCustomerDisplayMemberScanner()} disabled={!selectedStoreId || customerDisplayScannerLoading}>
                    <ScanLine size={15} />
                    客席表示前面
                  </button>
                </div>
                <small>POS 本体または客席表示の前面カメラで会員 QR を読み取れます。</small>
              </div>
            )}
          </div> : null}

          <label className="store-pos-note">
            <span>会計全体の厨房メモ（全杯に適用）</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="任意" />
          </label>

          {hasBowlChoice&&bowlEvaluation.errors.length?<p className="store-pos-error" role="alert">{t(bowlEvaluation.errors[0])}</p>:null}
          <div className="store-pos-discount-panel">
            <span>割引</span>
            {enabledDiscountPresets.length ? enabledDiscountPresets.map((preset) => {
              const discount = getPosDiscountAmount(preset, cart, subtotal);
              const isActive = discountPresetKey === preset.key;
              return (
                <button
                  key={preset.key}
                  className={isActive ? "is-active" : ""}
                  type="button"
                  disabled={offlineCheckoutOnly || (subtotal > 0 && discount <= 0)}
                  onClick={() => {
                    setDiscountPresetKey((current) => current === preset.key ? "" : preset.key);
                    if (!preset.allowCouponCombination) setSelectedCouponId("");
                  }}
                >
                  {preset.name}
                  {discount > 0 ? ` -${formatYen(discount)}` : ""}
                </button>
              );
            }) : <small>設定済みの割引はありません。</small>}
            {selectedDiscountPreset?.applicationMode === "campaign" && posDiscountAmount > 0 ? (
              <div className="store-pos-campaign-applied" role="status" data-pos-campaign-applied>
                <span>{hasBowlChoice ? t("適用中の特典") : t("キャンペーン自動適用")}</span>
                <strong>{selectedDiscountPreset.name} -{formatYen(posDiscountAmount)}</strong>
                <small>{t("同じ商品に特典を重ねず、よりお得な方を適用しています。")}</small>
              </div>
            ) : null}
            {!posDiscountAmount && !selectedTableCheckout ? posSettings.discountPresets.filter(preset => preset.campaignBasis!=="bowl_choice" && isPosCampaignActive(preset, discountNow) && (preset.minimumSubtotal ?? 0) > subtotal && getPosDiscountAmount(preset, cart, subtotal) > 0).sort((a,b) => (a.minimumSubtotal ?? 0) - (b.minimumSubtotal ?? 0)).slice(0, 1).map(preset => (
              <small key={preset.key}>キャンペーン「{preset.name}」は商品小計{formatYen(preset.minimumSubtotal ?? 0)}から適用</small>
            )) : null}
            {offlineCheckoutOnly ? (
              <small>オフライン中は割引・キャンペーンを利用できません。適用中の場合は接続を確認してください。</small>
            ) : selectedDiscountPreset ? (
              <small>
                {getDiscountTargetLabel(selectedDiscountPreset)}
                {selectedDiscountPreset.allowCouponCombination ? " / クーポン併用可" : " / クーポン併用不可"}
                {selectedDiscountPreset.stampEligible ? " / スタンプ対象" : " / スタンプ対象外"}
              </small>
            ) : null}
          </div>

          <div className="store-pos-payment-grid" id="store-pos-payment-section" ref={checkoutSectionRef}>
            {paymentOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  className={paymentMethod === option.value ? "is-active" : ""}
                  type="button"
                  disabled={offlineCheckoutOnly && option.value !== "cash"}
                  onClick={() => setPaymentMethod(option.value)}
                  title={offlineCheckoutOnly && option.value !== "cash" ? "オフライン中は現金のみ利用できます" : undefined}
                >
                  <Icon size={18} />
                  {option.value === "card" ? getPaymentDisplayLabel(option.value) : option.label}
                </button>
              );
            })}
          </div>

          {paymentMethod !== "cash" ? (
            <div className="store-pos-external-payment">
              <span>{getPaymentDisplayLabel(paymentMethod)}</span>
              <strong>{debugMode ? t("支払方法のテストです。決済端末では操作しないでください。") : "端末の決済完了画面を確認してから会計を確定してください。"}</strong>
            </div>
          ) : null}

          {paymentMethod === "cash" ? (
            <div className="store-pos-cash-payment">
              <label>
                <span>お預かり</span>
                <input
                  inputMode="numeric"
                  value={cashTenderedAmount}
                  onChange={(event) => setCashTenderedAmount(normalizeIntegerInput(event.target.value))}
                  placeholder="0"
                />
              </label>
              <div className={cashChangeAmount !== null && cashChangeAmount < 0 ? "is-short" : ""}>
                <span>お釣り</span>
                <strong>{cashChangeAmount === null ? "-" : formatYen(Math.max(0, cashChangeAmount))}</strong>
                {cashChangeAmount !== null && cashChangeAmount < 0 ? <small>不足 {formatYen(Math.abs(cashChangeAmount))}</small> : null}
              </div>
            </div>
          ) : null}

          <div className="store-pos-total">
            {selectedTableCheckout ? (
              <>
                <span>QR追加会計</span>
                <strong>{formatYen(tableCheckoutAmount)}</strong>
                <span>対象</span>
                <strong className="is-tax">{selectedTableCheckout.tableLabel}</strong>
              </>
            ) : (
              <>
                <span>{posSettings.priceTaxMode === "tax_excluded" ? "小計" : "合計"}</span>
                <strong>{formatYen(subtotal)}</strong>
                {posDiscountAmount ? (
                  <>
                    <span>{selectedDiscountPreset?.name || "割引"}</span>
                    <strong className="is-discount">-{formatYen(posDiscountAmount)}</strong>
                  </>
                ) : null}
                {couponDiscountAmount ? (
                  <>
                    <span>クーポン</span>
                    <strong className="is-discount">-{formatYen(couponDiscountAmount)}</strong>
                  </>
                ) : null}
                {subtotal > 0 ? (
                  <>
                    <span>{posSettings.priceTaxMode === "tax_excluded" ? `消費税 ${taxRate}%` : `内消費税 ${taxRate}%`}</span>
                    <strong className="is-tax">{formatYen(taxSummary.taxAmount)}</strong>
                  </>
                ) : null}
                {posSettings.priceTaxMode === "tax_excluded" || posDiscountAmount || couponDiscountAmount ? (
                  <>
                    <span>お会計</span>
                    <strong>{formatYen(payableAmount)}</strong>
                  </>
                ) : null}
              </>
            )}
          </div>
          <div className={`store-pos-checkout-actions ${checkoutStyles.actions}`}>
          {!debugMode ? <fieldset className={checkoutStyles.receiptChoice} disabled={saving}>
            <legend><span>{t('お客様用の書類')}</span><strong data-pos-footer-total>{t('合計')} {formatYen(activeCheckoutAmount)}</strong></legend>
            <div className={checkoutStyles.receiptButtons}>
              <button type="button" className={!receiptRequested ? 'secondary-button is-active' : 'secondary-button'} data-pos-receipt-choice="receipt" aria-pressed={!receiptRequested} onClick={() => setReceiptRequested(false)}>{t('レシート')}</button>
              <button type="button" className={receiptRequested ? 'secondary-button is-active' : 'secondary-button'} data-pos-receipt-choice="invoice" aria-pressed={receiptRequested} onClick={() => setReceiptRequested(true)}>{t('領収書')}</button>
            </div>
            {receiptRequested ? <div className={checkoutStyles.invoiceFields}>
              <label>{t('宛名（敬称不要）')}<input data-pos-invoice-recipient value={invoiceRecipient} maxLength={120} placeholder={t('空欄の場合は上様')} onChange={event => setInvoiceRecipient(event.target.value)} /></label>
              <label>{t('但し書き')}<input data-pos-invoice-purpose value={invoicePurpose} maxLength={160} onChange={event => setInvoicePurpose(event.target.value)} /></label>
            </div> : null}
          </fieldset> : null}
            {!debugMode && !selectedTableCheckout && !offlineCheckoutOnly ? <label className={checkoutStyles.printMode}><span>{t("伝票の印刷")}</span><select data-pos-print-mode value={printMode} disabled={saving} onChange={event => setPrintModeChoice(event.target.value as PosPrintMode)}>
              <option value="auto" disabled={!canAutoPrint}>{t("印刷する")}</option><option value="deferred">{t("あとで印刷")}</option><option value="none">{t("印刷しない")}</option>
            </select></label> : null}
            {checkoutNotice ? (
              <div className={`${checkoutStyles.notice} ${checkoutNotice.kind === "error" ? checkoutStyles.error : checkoutStyles.success}`} role={checkoutNotice.kind === "error" ? "alert" : "status"}>
                <span>{t(checkoutNotice.text)}{checkoutNotice.kind === "success" && lastPaidPrintOrderId ? <button type="button" className={checkoutStyles.viewPrint} data-print-paid-open onClick={() => { setCartOpen(false); setRequestedPrintOrder({ id: lastPaidPrintOrderId, request: Date.now() }); }}>{t("伝票を確認")}</button> : null}</span>
                <button type="button" aria-label={t("閉じる")} onClick={() => setCheckoutNotice(null)}><X size={16} /></button>
              </div>
            ) : null}
            <button className="danger-button store-pos-cancel-transaction" type="button" onClick={cancelCurrentTransaction} disabled={!hasCurrentTransaction || saving}>
              会計を中止
            </button>
            <button className="primary-button store-pos-checkout" data-pos-debug-checkout={debugMode || undefined} type="button" onClick={checkout} disabled={!canCheckout || menuBlocksCurrentOrder}>
              {debugMode ? t("テスト会計を確認") : saving ? "保存中..." : !selectedTableCheckout && !offlineCheckoutOnly && printMode === "deferred" ? "会計を確定・あとで印刷" : "会計を確定"}
            </button>
          </div>
          {debugMode && debugResult ? <PosDebugResultPreview result={debugResult} onClear={() => setDebugResult(null)} /> : null}
        </aside>
      </section>

      <>
        <aside className="store-pos-floating-checkout" aria-label="会計ショートカット">
          <div>
            <span>{selectedTableCheckout ? `${selectedTableCheckout.orderCount}件のテーブル会計` : <><span>会計内容</span> · {cartCount}</>}</span>
            <strong>{formatYen(activeCheckoutAmount)}</strong>
          </div>
          <button
            className="primary-button"
            type="button"
            aria-controls="store-pos-payment-section"
            onClick={revealCheckoutSection}
            disabled={saving}
          >
            <ShoppingCart size={18} />
            会計へ
          </button>
        </aside>
      </>

      {!debugMode && memberScannerOpen && !offlineCheckoutOnly ? (
        <ModalHistoryScope historyKey="store-pos-member-scanner" onClose={() => setMemberScannerOpen(false)}>
          <div className="store-pos-scanner-overlay" role="dialog" aria-modal="true" aria-label="会員 QR 読取">
            <div className="store-pos-scanner-dialog">
            <div className="store-pos-scanner-head">
              <div>
                <p className="eyebrow">Member QR</p>
                <h3>会員 QR 読取</h3>
                <span>客さまの会員証 QR をカメラにかざしてください。</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setMemberScannerOpen(false)}>閉じる</button>
            </div>
            <div className="store-pos-scanner-video">
              <video ref={memberScannerVideoRef} playsInline muted />
              <canvas ref={memberScannerCanvasRef} aria-hidden="true" />
              <div className="store-pos-scanner-frame" aria-hidden="true" />
            </div>
            <p className="store-pos-scanner-message">{memberScannerMessage || "カメラを準備しています。"}</p>
            <div className="store-pos-scanner-fallback">
              <ScanLine size={16} />
              <span>読み取れない場合は、会員番号または電話番号を入力してください。</span>
            </div>
            </div>
          </div>
        </ModalHistoryScope>
      ) : null}

      {!debugMode && transactionDialogOpen && !offlineCheckoutOnly ? (
        <ModalHistoryScope historyKey="store-pos-transactions" onClose={() => setTransactionDialogOpen(false)}>
          <div className="store-pos-transaction-overlay" role="dialog" aria-modal="true" aria-label="取引履歴">
            <div className={`store-pos-transaction-dialog ${refundStyles.dialog}`}>
            <div className="store-pos-transaction-head">
              <div>
                <p className="eyebrow">Transactions</p>
                <h3>取引履歴</h3>
                <span>最近 7 日間の POS 会計を確認します。</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setTransactionDialogOpen(false)}>閉じる</button>
            </div>

            <div className="store-pos-transaction-body">
              <aside className="store-pos-transaction-list">
                {transactionLoading && transactions.length === 0 ? (
                  <div className="store-pos-empty">読み込み中...</div>
                ) : transactions.length === 0 ? (
                  <div className="store-pos-empty">取引履歴がありません。</div>
                ) : transactions.map((transaction) => (
                  <button
                    key={transaction.id}
                    className={[
                      selectedTransaction?.id === transaction.id ? "is-active" : "",
                      transaction.status === "cancelled" || transaction.paymentStatus === "refunded" ? "is-refunded" : "",
                      refundingTransactionId === transaction.id ? "is-processing" : ""
                    ].filter(Boolean).join(" ")}
                    type="button"
                    onClick={() => void selectTransaction(transaction.id)}
                  >
                    <div>
                      {transaction.servingPickupCodes?.length ? (
                        <>
                          <strong>{t("受取番号")} {Array.from(new Set(transaction.servingPickupCodes)).join(" / ")}</strong>
                          <span>{t("会計番号")} {transaction.pickupCode}</span>
                        </>
                      ) : <strong>{t("会計番号")} {transaction.pickupCode}</strong>}
                      <span>{transaction.createdLabel} / {getPaymentLabel(transaction.paymentMethod)}</span>
                    </div>
                    <div>
                      <b>{formatYen(transaction.amount)}</b>
                      <small>{refundingTransactionId === transaction.id ? "返金処理中..." : getTransactionStatusLabel(transaction)}</small>
                    </div>
                  </button>
                ))}
              </aside>

              <section className="store-pos-transaction-detail">
                {!selectedTransaction ? (
                  <div className="store-pos-empty">会計を選択してください。</div>
                ) : (
                  <>
                    <div className="store-pos-transaction-scroll">
                      <div className="store-pos-transaction-summary">
                        <div>
                          <span>会計番号</span>
                          <strong>{selectedTransaction.pickupCode}</strong>
                        </div>
                        <div>
                          <span>合計</span>
                          <strong>{formatYen(selectedTransaction.amount)}</strong>
                        </div>
                        <div>
                          <span>状態</span>
                          <strong>{getTransactionStatusLabel(selectedTransaction)}</strong>
                        </div>
                      </div>

                      {selectedTransaction.printDocumentVersion === POS_PRINT_DOCUMENT_VERSION ? <PosInvoiceIssuer key={`${selectedStoreId}:${selectedTransaction.id}`} storeId={selectedStoreId} orderId={selectedTransaction.id} onIssued={async result => {
                        const store = selectedStoreId;
                        const queue = await printDocuments.refresh(result.orderId);
                        if (selectedStoreIdRef.current !== store) return;
                        const invoice = queue?.documents.find(doc => doc.id === result.documentId);
                        if (!result.alreadyIssued && canAutoPrint && invoice) await printDocuments.printDocuments([invoice]);
                        await openPrintFromTransaction(result.orderId);
                      }} /> : null}
                      {selectedTransaction.printDocumentVersion === POS_PRINT_DOCUMENT_VERSION ? <button type="button" className="secondary-button" data-print-history-open onClick={() => { void openPrintFromTransaction(selectedTransaction.id); }}>{t("伝票を確認・再印刷")}</button> : null}

                      <div className="store-pos-transaction-meta">
                        <span>{selectedTransaction.createdLabel}</span>
                        <span>{getPaymentLabel(selectedTransaction.paymentMethod)}</span>
                        {selectedTransaction.orderType ? <span>{getOrderTypeLabel(selectedTransaction.orderType)}</span> : null}
                        <span>担当 {selectedTransaction.cashierName || "-"}</span>
                      </div>

                      {selectedTransaction.paymentMethod === "cash" ? (
                        <div className="store-pos-transaction-cash">
                          <span>お預かり {selectedTransaction.cashTenderedAmount === null ? "-" : formatYen(selectedTransaction.cashTenderedAmount)}</span>
                          <span>お釣り {selectedTransaction.cashChangeAmount === null ? "-" : formatYen(selectedTransaction.cashChangeAmount)}</span>
                        </div>
                      ) : null}

                      <div className="store-pos-transaction-items">
                        {(selectedTransaction.items ?? []).map((item) => {
                          const modifiers = [
                            item.size,
                            item.temperature,
                            item.sweetness,
                            item.ice,
                            item.option,
                            ...(item.toppings ?? [])
                          ].filter(Boolean);
                          const weightLabel = item.measuredQuantity && item.measuredUnitPrice
                            ? `${item.measuredQuantity.toLocaleString("ja-JP", { maximumFractionDigits: 3 })}${item.measuredUnit || "g"} x ${formatYen(item.measuredUnitPrice)}/${item.measuredUnit || "g"}`
                            : "";
                          const { canRefund: canRecordItemReturn, hasCouponBenefit, isRefunded: isItemRefunded, paidAmount } = getRefundItemState(item);
                          const isSelectedForRefund = selectedRefundItemIds.includes(item.id);
                          const selectionDisabled = !canRefundSelectedTransaction || refundSaving || isItemRefunded || !canRecordItemReturn;
                          return (
                            <div key={item.id} className={refundStyles.line}>
                            <button
                              className={[
                                "store-pos-transaction-item-choice",
                                isItemRefunded ? "is-refunded" : "",
                                isSelectedForRefund ? "is-selected" : "",
                                !canRecordItemReturn ? "is-static" : ""
                              ].filter(Boolean).join(" ")}
                              type="button"
                              data-pos-refund-item={item.id}
                              aria-pressed={isSelectedForRefund}
                              onClick={() => {
                                setSelectedRefundItemIds(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current,item.id]);
                                setSelectedRefundOptions(current => current.filter(option => option.itemId !== item.id));
                              }}
                              disabled={selectionDisabled}
                            >
                              <div>
                                <strong>{item.pickupCode ? `${item.pickupCode} / ` : ""}{item.name}</strong>
                                {weightLabel ? <small>{weightLabel}</small> : null}
                                {modifiers.length ? <small>{modifiers.join(" / ")}</small> : null}
                                <span>{weightLabel ? formatYen(item.amount) : `${formatYen(Math.round(item.amount / Math.max(1, item.quantity)))} x ${item.quantity}`}</span>
                                {item.discountAmount || item.couponDiscountAmount ? (
                                  <small>
                                    {item.discountAmount ? `割引 -${formatYen(item.discountAmount)}` : ""}
                                    {item.discountAmount && item.couponDiscountAmount ? " / " : ""}
                                    {item.couponDiscountAmount ? `クーポン -${formatYen(item.couponDiscountAmount)}` : ""}
                                  </small>
                                ) : null}
                                {hasCouponBenefit && !isItemRefunded ? <small>返品記録時にクーポンを自動復元</small> : null}
                                {item.refundedAmount > 0 || isItemRefunded ? <small>{t("返金済み {amount}", { amount: formatYen(item.refundedAmount) })}{item.refundReason ? ` / ${item.refundReason}` : ""}</small> : null}
                              </div>
                              <div className="store-pos-transaction-item-actions">
                                <b>{formatYen(paidAmount)}</b>
                                <small>{isSelectedForRefund ? "商品全体を返品" : canRecordItemReturn ? "商品全体を選択" : "返金対象外"}</small>
                              </div>
                            </button>
                            {(item.refundOptions ?? []).length ? <div className={refundStyles.options}>
                              <small>{t("追加選択肢だけを返品できます。商品本体は残ります。")}</small>
                              {(item.refundOptions ?? []).map(option => {
                                const selected = selectedRefundOptions.some(value => value.itemId === item.id && value.key === option.key);
                                return <button key={option.key} data-pos-refund-option={`${item.id}/${option.key}`} data-refunded={option.refunded} type="button" className={selected ? refundStyles.selected : ""} aria-pressed={selected}
                                  disabled={!canRefundSelectedTransaction || refundSaving || isItemRefunded || option.refunded || option.paidAmount <= 0}
                                  onClick={() => {
                                    setSelectedRefundItemIds(current => current.filter(id => id !== item.id));
                                    setSelectedRefundOptions(current => selected ? current.filter(value => value.itemId !== item.id || value.key !== option.key) : [...current,{itemId:item.id,key:option.key}]);
                                  }}>
                                  <span><strong>{option.label}{option.quantity > 1 ? ` × ${option.quantity}` : ""}</strong><small>{option.groupName}</small></span>
                                  <span><strong>{formatYen(option.paidAmount)}</strong><small>{t(option.refunded ? "返金済み" : selected ? "追加選択肢を返品" : "選択")}</small></span>
                                </button>;
                              })}
                            </div> : null}
                            </div>
                          );
                        })}
                      </div>

                      {selectedTransaction.note ? (
                        <div className="store-pos-transaction-note">
                          <span>メモ</span>
                          <p>{selectedTransaction.note}</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="store-pos-refund-panel">
                      <div>
                        <strong>返金操作</strong>
                        <button className="secondary-button" type="button" disabled={!canRefundSelectedTransaction || refundSaving} onClick={() => { setSelectedRefundItemIds(refundableRefundItems.map(item => item.id)); setSelectedRefundOptions([]); }}>{t("全商品を選択")}</button>
                        <span>
                          {refundSaving && refundingTransactionId === selectedTransaction.id
                            ? "返金を処理しています。画面を閉じずにお待ちください。"
                            : canRefundSelectedTransaction
                            ? selectedTransaction.paymentMethod === "cash"
                              ? "商品全体または追加選択肢を選択してください。"
                              : "外部決済は端末側の返金完了を確認してから記録してください。"
                            : selectedTransaction.cashSessionStatus !== "open"
                              ? "締め済みのレジ会計は管理画面で修正してください。"
                              : "この会計はすでに返金済みです。"}
                        </span>
                      </div>
                      {selectedTransaction.paymentMethod !== "cash" ? (
                        <label className="store-pos-external-refund-check">
                          <input
                            type="checkbox"
                            checked={externalRefundConfirmed}
                            onChange={(event) => setExternalRefundConfirmed(event.target.checked)}
                            disabled={!canRefundSelectedTransaction || refundSaving}
                          />
                          <span>外部決済端末で返金操作を完了しました</span>
                        </label>
                      ) : null}
                      {refundError ? <div role="alert" className={refundStyles.error}>{t(refundError)}</div> : null}
                      {selectedRefundOptionRows.length ? <small>{t("追加選択肢だけの返品ではクーポン・スタンプは取り消しません。旧伝票ではなく厨房画面で最新内容を確認してください。")}</small> : null}
                      {selectedTransaction.refundReason ? <small>返金理由: {selectedTransaction.refundReason}</small> : null}
                      <div className={selectedRefundCount ? "store-pos-selected-refund-item is-selected" : "store-pos-selected-refund-item"}>
                        <span>返品対象</span>
                        <strong>{selectedRefundCount ? t("{count} 件を返品", { count: selectedRefundCount }) : "返品する商品がありません"}</strong>
                        <small>
                          {selectedRefundCount
                            ? `${selectedRefundPaidAmount > 0 ? `${t("返金")} ${formatYen(selectedRefundPaidAmount)}` : t("返金なし")}${selectedRefundCouponCount ? ` / ${t("クーポン {count} 件を復元", { count: selectedRefundCouponCount })}` : ""}`
                            : "返品しない商品だけを残し、返品する商品を選択状態にしてください。"}
                        </small>
                      </div>
                      <label>
                        <span>理由</span>
                        <input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} placeholder="任意" disabled={!canRefundSelectedTransaction || refundSaving} />
                      </label>
                      <button
                        className="danger-button"
                        type="button"
                        data-pos-refund-submit
                        onClick={() => void refundTransaction(selectedRefundItems.map((item) => item.id))}
                        disabled={!canRefundSelectedItem || refundSaving || (selectedItemRefundNeedsExternalConfirmation && !externalRefundConfirmed)}
                      >
                        {refundSaving && refundingTransactionId === selectedTransaction.id
                          ? "返品処理中..."
                          : selectedRefundCount
                            ? selectedRefundPaidAmount > 0
                              ? "選択した内容を返金"
                              : "返品を記録"
                            : "返品する商品がありません"}
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
            </div>
          </div>
        </ModalHistoryScope>
      ) : null}

      {!debugMode && cashDialog && !offlineCheckoutOnly ? (
        <ModalHistoryScope historyKey="store-pos-cash" onClose={() => setCashDialog(null)}>
          <div className="store-pos-cash-overlay" role="dialog" aria-modal="true" aria-label="レジ操作">
            <div className="store-pos-cash-dialog">
            <div className="store-pos-cash-dialog-head">
              <div>
                <p className="eyebrow">Daily Cash</p>
                <h3>{cashDialog === "open" ? "開店確認" : cashDialog === "movement" ? "入出金" : "レジ締め"}</h3>
                <span>{cashDialog === "close" && reconciliation.activeSession
                  ? t("営業日 {date} のレジ締めです。実際の現金を確認してください。", { date: reconciliation.activeSession.businessDate })
                  : reconciliation.businessState?.detailLabel ?? reconciliation.businessDate}</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setCashDialog(null)}>閉じる</button>
            </div>

            {cashActionError ? <p className={cashFeedbackStyles.error} data-cash-action-error role="alert">{t(cashActionError)}</p> : null}

            {cashDialog === "open" ? (
              <div className={`store-pos-cash-start ${cashFeedbackStyles.openForm}`}>
                <ReceiptText size={18} />
                <div>
                  <strong>開店前のレジ金額を確認してください。</strong>
                  <span>面額ごとの枚数を選ぶと開始金額を自動計算します。</span>
                  <span data-pos-opening-number-help style={{ fontWeight: 400 }}>{t("開店確認で指定した呼出番号（初期値001）から開始します。未受渡しの番号は飛ばします。再読込やアプリの再起動ではリセットしません。")}</span>
                </div>
                <label className={cashFeedbackStyles.reason} style={{ flex: "0 1 180px", maxWidth: "100%" }} htmlFor="store-pos-opening-pickup-number">
                  <span style={{ fontWeight: 500 }}>{t("呼出開始番号")}</span>
                  <input id="store-pos-opening-pickup-number" data-pos-opening-pickup-number type="text" inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} autoComplete="off" value={cashOpeningPickupNumber} disabled={cashSaving}
                    onFocus={event => event.currentTarget.select()}
                    onChange={event => setCashOpeningPickupNumber(event.target.value)}
                    onBlur={() => { if (openingPickupNumberValid) setCashOpeningPickupNumber(value => value.padStart(3, "0")); }}
                    aria-invalid={!openingPickupNumberValid} aria-describedby={openingPickupNumberError ? "store-pos-opening-pickup-number-error" : undefined} />
                  {openingPickupNumberError ? <small id="store-pos-opening-pickup-number-error" role="alert" data-pos-opening-pickup-number-error>{t(openingPickupNumberError)}</small> : null}
                </label>
                {reconciliation.previousClosedSession ? (
                  <div className={`store-pos-handover-summary ${hasOpeningHandoverDifference ? "is-warning" : ""}`}>
                    <span>{t("前回レジ締め {date}", { date: formatDateTime(reconciliation.previousClosedSession.closedAt)||reconciliation.previousClosedSession.businessDate })}</span>
                    <strong>{formatYen(reconciliation.previousClosedSession.countedCashAmount)}</strong>
                    <small>
                      {hasOpeningHandoverDifference
                        ? t("引継ぎ差額 {amount}", { amount: formatYen(openingHandoverDifference ?? 0) })
                        : t("前回レジ締め金額と一致しています。")}
                    </small>
                  </div>
                ) : null}
                <div className="store-pos-denomination-panel">
                  <div className="store-pos-denomination-head">
                    <span>開始金額</span>
                    <strong>{formatYen(openingBreakdownTotal)}</strong>
                  </div>
                  <div className="store-pos-denomination-grid">
                    {yenDenominations.map((denomination) => (
                      <label key={denomination}>
                        <span>{formatDenominationLabel(denomination)}</span>
                        <select
                          value={cashOpeningBreakdown[String(denomination)] ?? ""}
                          disabled={cashSaving}
                          onChange={(event) => updateCashBreakdown(setCashOpeningBreakdown, denomination, event.target.value)}
                        >
                          {denominationCountOptions.map((count) => <option key={count.value || "zero"} value={count.value}>{count.label}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
                {hasOpeningHandoverDifference ? (
                  <div className={`store-pos-handover-note ${cashFeedbackStyles.reason}`} lang="ja" data-i18n-ignore>
                    <label htmlFor="store-pos-opening-reason">
                      <span>引継ぎ差額理由 <small>必須</small></span>
                      <select id="store-pos-opening-reason" disabled={cashSaving} value={cashOpeningReason} onChange={(event) => {
                        const reason = event.target.value;
                        setCashOpeningReason(reason);
                        setCashOpeningNote(reason === "other" ? "" : reason);
                      }} required aria-describedby="store-pos-open-blocked-reason">
                        <option value="">理由を選択してください</option>
                        {["釣銭準備金を補充", "前日売上を回収", "両替のため現金を調整"].map(reason => <option key={reason} value={reason}>{reason}</option>)}
                        <option value="other">その他</option>
                      </select>
                    </label>
                    {cashOpeningReason === "other" ? (
                      <label htmlFor="store-pos-opening-note">
                        <span>詳細理由 <small>必須</small></span>
                        <input id="store-pos-opening-note" disabled={cashSaving} value={cashOpeningNote} onChange={(event) => setCashOpeningNote(event.target.value)} placeholder="理由を入力してください" required aria-describedby="store-pos-open-blocked-reason" />
                      </label>
                    ) : null}
                  </div>
                ) : null}
                <p id="store-pos-open-blocked-reason" className={cashFeedbackStyles.blocked} role="status" hidden={!cashOpenBlockedReason}>{t(cashOpenBlockedReason)}</p>
                <button className="primary-button" type="button" onClick={() => submitCashAction("open")} disabled={cashSaving || !canOpenRegister} aria-describedby={openingPickupNumberError ? "store-pos-opening-pickup-number-error" : cashOpenBlockedReason ? "store-pos-open-blocked-reason" : undefined}>
                  {cashSaving ? t("保存中…") : t("開始")}
                </button>
              </div>
            ) : null}

            {cashDialog === "movement" ? (
              <div className="store-pos-cash-actions">
                <label>
                  <span>入出金</span>
                  <select value={cashMovementType} onChange={(event) => setCashMovementType(event.target.value)}>
                    <option value="cash_out">出金</option>
                    <option value="cash_in">入金</option>
                  </select>
                </label>
                <label>
                  <span>金額</span>
                  <input inputMode="numeric" value={cashMovementAmount} onChange={(event) => setCashMovementAmount(normalizeIntegerInput(event.target.value))} placeholder="0" />
                </label>
                <label>
                  <span>理由</span>
                  <input value={cashMovementReason} onChange={(event) => setCashMovementReason(event.target.value)} placeholder="例: 両替、備品購入" />
                </label>
                <button className="secondary-button" type="button" onClick={() => submitCashAction("movement")} disabled={cashSaving}>
                  記録
                </button>
              </div>
            ) : null}

            {cashDialog === "close" && reconciliation.activeSession ? (
              <div className="store-pos-cash-close">
                <div className="store-pos-close-summary">
                  <span>閉店チェック</span>
                  <strong>システム上の現金 {formatYen(reconciliation.activeSession.expectedCashAmount)}</strong>
                  <small>
                    {closingDifference === null
                      ? "実際の現金を入力してください。"
                      : `差額 ${formatYen(closingDifference)}`}
                  </small>
                </div>
                <div className="store-pos-denomination-panel">
                  <div className="store-pos-denomination-head">
                    <span>実際の現金</span>
                    <strong>{formatYen(countedBreakdownTotal)}</strong>
                  </div>
                  <div className="store-pos-denomination-grid">
                    {yenDenominations.map((denomination) => (
                      <label key={denomination}>
                        <span>{formatDenominationLabel(denomination)}</span>
                        <select
                          value={cashCountedBreakdown[String(denomination)] ?? ""}
                          onChange={(event) => {
                            setCashZeroConfirmed(false);
                            updateCashBreakdown(setCashCountedBreakdown, denomination, event.target.value);
                          }}
                        >
                          {denominationCountOptions.map((count) => <option key={count.value || "zero"} value={count.value}>{count.label}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  {countedBreakdownTotal === 0 ? (
                    <label className="store-pos-zero-cash-confirmation">
                      <input type="checkbox" checked={cashZeroConfirmed} onChange={(event) => setCashZeroConfirmed(event.target.checked)} />
                      <span>現金が0円であることを確認しました</span>
                    </label>
                  ) : null}
                </div>
                <label>
                  <span>締め責任者</span>
                  <select value={cashClosingResponsibleEmployeeId} onChange={(event) => setCashClosingResponsibleEmployeeId(event.target.value)}>
                    {reconciliation.activeCashResponsibleEmployees.length === 0 ? (
                      <option value="">締め責任者の候補がいません</option>
                    ) : (
                      reconciliation.activeCashResponsibleEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>{getCashResponsibleEmployeeLabel(employee)}</option>
                      ))
                    )}
                  </select>
                </label>
                <label>
                  <span>差額理由</span>
                  <input value={cashClosingNote} onChange={(event) => setCashClosingNote(event.target.value)} placeholder={closingDifference ? "差額がある場合は必須" : "任意"} />
                </label>
                {cashCloseBlockedReason ? <p className="store-pos-cash-blocked-reason" id="store-pos-cash-blocked-reason" role="status">{cashCloseBlockedReason}</p> : null}
                <button className="primary-button" type="button" onClick={() => submitCashAction("close")} disabled={cashSaving || !canCloseRegister || offlinePendingCount > 0} aria-describedby={cashCloseBlockedReason ? "store-pos-cash-blocked-reason" : undefined}>
                  レジ締め
                </button>
              </div>
            ) : null}
            </div>
          </div>
        </ModalHistoryScope>
      ) : null}

      {configuringItem ? (
        <ModalHistoryScope historyKey="store-pos-item-options" onClose={() => setConfiguringItem(null)}>
          <div ref={optionDialogRef as React.RefObject<HTMLDivElement | null>} className="store-pos-option-overlay" role="dialog" aria-modal="true" aria-label="商品オプション">
            <div className="store-pos-option-panel">
            {debugMode ? <PosDebugBanner compact onExit={exitDebugMode} /> : null}
            <div className="store-pos-option-head">
              <div>
                <p className="eyebrow">Options</p>
                <h3>{configuringItem.name}</h3>
                <span>{configuringWeightPricing ? `重量単価 ${formatWeightPrice(configuringItem, orderType)}` : `基本価格 ${formatYen(getItemPrice(configuringItem))}`}</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setConfiguringItem(null)}>閉じる</button>
            </div>

            <PosMenuRefreshNotice available={menuRefresh.updateAvailable} error={menuRefresh.error} checking={menuRefresh.checking} blocked={menuRefreshBlocked} hasDraft={hasMenuDraft} onRefresh={() => void menuRefresh.refresh()} />
            <div className="store-pos-option-navigation">
              <input aria-label="オプションを検索" placeholder="オプションを検索" value={optionQuery} onChange={(event) => setOptionQuery(event.target.value)} />
              <select aria-label="オプショングループ" value={optionGroupId} onChange={(event) => setOptionGroupId(event.target.value)}>
                <option value="">すべてのグループ</option>
                {getAvailableItemOptionGroups(configuringItem).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </div>
            <div className="store-pos-option-body">
            {configuringWeightPricing ? (
              <>
                {!debugMode ? <StoreRelayScale key={`${selectedStoreId}:${configuringItem.id}`} relay={relay} scopeKey={currentScaleScope}
                  tareSettings={tareEnabled ? scaleTareSettings : undefined} tarePresetId={tarePresetId}
                  onTarePresetChange={id => { if(id === tarePresetId)return; setTarePresetId(id);setScaleCapture(null);setScaleValidity(null);setWeightDraft(''); }}
                  manualMode={scaleManualMode} onManualModeChange={manual => {setScaleManualMode(manual);setScaleCapture(null);setScaleValidity(null);}}
                  onValidityChange={setScaleValidity} onAdopt={(id,grams,measurement)=>{ const quantity=configuringWeightPricing.unit==='kg'?grams/1000:grams; if(configuringWeightPricing.unit!=='g'&&configuringWeightPricing.unit!=='kg'){setMessage("計量単位を確認してください。");return;} setWeightDraft(String(quantity));setScaleCapture({id,quantity,itemId:configuringItem.id,measurement}); }} /> : <p>{t("テスト重量を手入力してください。容器を除いた正味重量で計算します。")}</p>}
              <section className="store-pos-weight-entry">
                <div>
                  <strong>{tareEnabled ? t("食材の正味重量（容器差引済み）") : t("自選食材の重量")}</strong>
                  <span>{configuringWeightPricing.unitPrice ? `${formatYen(configuringWeightPricing.unitPrice)}/${configuringWeightPricing.unit}` : "重量単価未設定"}</span>
                </div>
                <label>
                  <input
                    inputMode="decimal"
                    value={weightDraft}
                    onChange={(event) => { setScaleManualMode(true); setScaleCapture(null); setWeightDraft(normalizeDecimalInput(event.target.value)); }}
                    placeholder="0"
                  />
                  <span>{configuringWeightPricing.unit}</span>
                </label>
                <div>
                  <span>計算</span>
                  <strong>{formatYen(configuringWeightBasePrice + selectedOptionPreviewTotal)}</strong>
                  {selectedOptionPreviewTotal ? <small>追加 {formatYen(selectedOptionPreviewTotal)} を含む</small> : null}
                </div>
              </section>
              </>
            ) : null}

            <div className="store-pos-option-groups">
              {optionQuery.trim() && !getAvailableItemOptionGroups(configuringItem).some((group) => (!optionGroupId || group.id === optionGroupId) && group.options.some((option) => `${group.name} ${option.name}`.toLocaleLowerCase().includes(optionQuery.trim().toLocaleLowerCase()))) ? <p className="empty-state-text">一致するオプションがありません。</p> : null}
              {getAvailableItemOptionGroups(configuringItem).map((group) => {
                if (optionGroupId && group.id !== optionGroupId) return null;
                const matchingOptions = group.options.filter((option) => `${group.name} ${option.name}`.toLocaleLowerCase().includes(optionQuery.trim().toLocaleLowerCase()));
                if (!matchingOptions.length) return null;
                const selectionType = getEffectiveSelectionType(group);
                return (
                  <section className="store-pos-option-group" key={group.id}>
                    <div>
                      <strong>{group.name}</strong>
                      <span>
                        {selectionType === "single"
                          ? "1つ選択"
                          : selectionType === "quantity"
                            ? `数量で選択 / 最大${getOptionGroupLimit(group)}点`
                            : `複数選択可 / 最大${getOptionGroupLimit(group)}点`}
                      </span>
                    </div>
                    <div className="store-pos-option-choice-grid">
                      {matchingOptions.map((option) => {
                        const selectedIds = optionDraft[group.id] ?? [];
                        const count = selectedIds.filter((id) => id === option.id).length;
                        const selected = count > 0;
                        return (
                          <div
                            className={selected ? "store-pos-option-choice is-active" : "store-pos-option-choice"}
                            key={option.id}
                          >
                            <button
                              type="button"
                              aria-pressed={selected}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleOption(group, option.id);
                              }}
                            >
                              <span>{option.name}</span>
                              {getOptionPrice(option) ? <small>{formatYen(getOptionPrice(option))}</small> : <small>+¥0</small>}
                            </button>
                            {selectionType === "quantity" ? (
                              <div className="store-pos-option-stepper">
                                <button
                                  type="button"
                                  disabled={count === 0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    decrementOption(group, option.id);
                                  }}
                                  aria-label="数量を減らす"
                                >
                                  <Minus size={14} />
                                </button>
                                <span>{count}</span>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleOption(group, option.id);
                                  }}
                                  disabled={(optionDraft[group.id] || []).length >= getOptionGroupLimit(group) || count >= getPosOptionSelectionRules(group).perOptionMax}
                                  aria-label="数量を増やす"
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
            </div>
            <div className="store-pos-option-footer">
              <div className="store-pos-option-summary">
                <strong>{formatYen((configuringWeightPricing ? configuringWeightBasePrice : getItemPrice(configuringItem)) + selectedOptionPreviewTotal)}</strong>
                <span>{getAvailableItemOptionGroups(configuringItem).flatMap((group) => (optionDraft[group.id] ?? []).map((id) => group.options.find((option) => option.id === id)?.name)).filter(Boolean).join(" / ") || "未選択"}</span>
                {invalidConfiguredGroup ? <small role="status">{invalidConfiguredGroup.name}: {t("最低 {min} 点から最大 {max} 点まで選択してください。").replace("{min}", String(getPosOptionSelectionRules(invalidConfiguredGroup).min)).replace("{max}", String(getPosOptionSelectionRules(invalidConfiguredGroup).max))}</small> : null}
              </div>
            <button className="primary-button store-pos-option-add" type="button" onClick={addConfiguredItem} disabled={!canAddConfiguredItem}>
              この内容で追加
            </button>
            </div>
            </div>
          </div>
        </ModalHistoryScope>
      ) : null}
    </main>
  );
}
