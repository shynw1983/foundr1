"use client";

import {
  Boxes,
  ClipboardList,
  ExternalLink,
  FileText,
  Lightbulb,
  LogOut,
  MenuSquare,
  MonitorSmartphone,
  PackageCheck,
  Printer,
  Search,
  Store,
  Trash2,
  Truck,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import QRCodeGenerator from "qrcode";
import { useUnsavedChangesGuard } from "../../../../components/UnsavedChangesGuard";
import { normalizeIntegerInput } from "../../../../lib/number-input";
import { storeTerminalNameOptions, storeTerminalWorkstations } from "../../../../lib/store-terminal-names";
import {
  createTestPrintPayload,
  defaultPosKitchenTicketTemplateSettings,
  defaultPosPrinterSettings,
  getKitchenPrinterForBrand,
  getReceiptPrinter,
  printWithAndroidBridge,
  resolvePosReceiptTemplate,
  type PosKitchenTicketTemplateSettings,
  type PosPrinterConnection,
  type PosPrinterSettings,
  type PosReceiptTemplateBlock,
  type PosReceiptTemplateSettings
} from "../../../../lib/pos-printer";
import { MobileNavMenu } from "../../components/MobileNavMenu";
import { OsNavList } from "../../components/OsNavList";
import { UserBadge } from "../../components/UserBadge";

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "メニュー管理", href: "/os/menus", icon: MenuSquare },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

type StoreOption = {
  id: string;
  name: string;
};

type CustomerDisplayMediaAsset = {
  id: string;
  type: "image" | "video";
  url: string;
  pathname?: string;
  name: string;
  durationSeconds: number;
  fit: "cover" | "contain";
};

type CustomerDisplayMediaSettings = {
  mode: "default" | "slideshow" | "video";
  transition: "fade" | "slide" | "none";
  slideDurationSeconds: number;
  videoMuted: boolean;
  videoLoop: boolean;
  backgroundColor: string;
  assets: CustomerDisplayMediaAsset[];
};

type PosBrandSetting = {
  brandId: string;
  brandName: string;
  posPricingMode: "fixed" | "weight";
  posWeightUnit: string;
  posWeightUnitPrice: number | null;
};

type StoreDeviceSettings = {
  storeId: string;
  storeName: string;
  dineInEnabled: boolean;
  takeoutEnabled: boolean;
  dineInTaxRate: number;
  takeoutTaxRate: number;
  externalPaymentTerminalBrand: string;
  priceTaxMode: string;
  discountPresets: unknown[];
  customerDisplayMediaSettings: CustomerDisplayMediaSettings;
  printerSettings: PosPrinterSettings;
  posBrandSettings: PosBrandSetting[];
};

type StoreTerminalAccount = {
  id: string;
  name: string;
  loginId: string;
  status: string;
  visibleStores?: StoreOption[];
  canManage?: boolean;
};

const defaultCustomerDisplayMediaSettings: CustomerDisplayMediaSettings = {
  mode: "default",
  transition: "fade",
  slideDurationSeconds: 8,
  videoMuted: true,
  videoLoop: true,
  backgroundColor: "#fbfbf8",
  assets: []
};

function isNetworkPrinter(printer: PosPrinterConnection) {
  return printer.deviceType === "escpos_network";
}

function usesPrinterIdentifier(printer: PosPrinterConnection) {
  return printer.deviceType === "escpos_bluetooth" || printer.deviceType === "escpos_usb" || printer.deviceType === "star_printer";
}

function requiresPrinterIdentifier(printer: PosPrinterConnection) {
  if (printer.deviceType === "escpos_bluetooth") return true;
  if (printer.deviceType === "star_printer") return printer.connectionType !== "usb";
  return false;
}

function getPrinterIdentifierHelp(printer: PosPrinterConnection) {
  if (printer.deviceType === "escpos_bluetooth") return "ペアリング名または MAC";
  if (printer.deviceType === "escpos_usb") return "任意: USB名 / vendor:product";
  return "Star printer / MAC / IP";
}

function getPrinterIdentifierError(printer: PosPrinterConnection) {
  if (printer.deviceType === "escpos_bluetooth") return "ESC/POS Bluetooth プリンターの識別子を入力してください。";
  return "Star プリンターの識別子を入力してください。Bluetooth はペアリング名または MAC、LAN は IP / MAC を指定します。";
}

function createEmptySettings(): StoreDeviceSettings {
  return {
    storeId: "",
    storeName: "",
    dineInEnabled: true,
    takeoutEnabled: true,
    dineInTaxRate: 10,
    takeoutTaxRate: 8,
    externalPaymentTerminalBrand: "PayCAS",
    priceTaxMode: "tax_included",
    discountPresets: [],
    customerDisplayMediaSettings: defaultCustomerDisplayMediaSettings,
    printerSettings: defaultPosPrinterSettings,
    posBrandSettings: []
  };
}

function createStoreDeviceSettingsSnapshot(settings: StoreDeviceSettings) {
  return JSON.stringify(settings);
}

export default function StoreDeviceSettingsPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [settings, setSettings] = useState<StoreDeviceSettings>(createEmptySettings);
  const [savedSettingsSnapshot, setSavedSettingsSnapshot] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [hasNativePrintBridge, setHasNativePrintBridge] = useState(false);
  const [testPrinterTarget, setTestPrinterTarget] = useState("kitchen");
  const [receiptPreviewMode, setReceiptPreviewMode] = useState<"receipt" | "invoice">("receipt");
  const [receiptPreviewBrandId, setReceiptPreviewBrandId] = useState("");
  const [testPrinting, setTestPrinting] = useState(false);
  const [uploadingMediaType, setUploadingMediaType] = useState<"" | "image" | "video">("");
  const [terminalAccounts, setTerminalAccounts] = useState<StoreTerminalAccount[]>([]);
  const [terminalLoading, setTerminalLoading] = useState(true);
  const [terminalSavingId, setTerminalSavingId] = useState("");
  const [canManageTerminals, setCanManageTerminals] = useState(false);
  const [terminalMessage, setTerminalMessage] = useState("");

  async function loadTerminalAccounts(storeId: string) {
    if (!storeId) {
      setTerminalAccounts([]);
      setTerminalLoading(false);
      return;
    }
    setTerminalLoading(true);
    const response = await fetch("/api/staff", { cache: "no-store" });
    if (!response.ok) {
      setTerminalAccounts([]);
      setCanManageTerminals(false);
      setTerminalLoading(false);
      return;
    }
    const body = await response.json() as { employees?: Array<StoreTerminalAccount & { role?: string }>; canManageStaff?: boolean };
    setTerminalAccounts((body.employees ?? []).filter((account) => (
      account.role === "store_terminal" && account.visibleStores?.some((store) => store.id === storeId)
    )));
    setCanManageTerminals(body.canManageStaff === true);
    setTerminalLoading(false);
  }

  async function load(storeId = selectedStoreId) {
    setLoading(true);
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    const response = await fetch(`/api/os/pos/settings${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage("表示・設備設定を読み込めませんでした。");
      setLoading(false);
      return;
    }
    const body = await response.json();
    const nextSettings = body.settings ?? createEmptySettings();
    setStores(body.access?.stores ?? []);
    const nextStoreId = body.selectedStoreId ?? nextSettings.storeId ?? "";
    setSelectedStoreId(nextStoreId);
    setCanManage(Boolean(body.access?.canManagePosSettings));
    const nextSettingsState: StoreDeviceSettings = {
      ...createEmptySettings(),
      ...nextSettings,
      discountPresets: Array.isArray(nextSettings.discountPresets) ? nextSettings.discountPresets : [],
      customerDisplayMediaSettings: nextSettings.customerDisplayMediaSettings ?? defaultCustomerDisplayMediaSettings,
      printerSettings: nextSettings.printerSettings ?? defaultPosPrinterSettings,
      posBrandSettings: Array.isArray(nextSettings.posBrandSettings) ? nextSettings.posBrandSettings : []
    };
    setSettings(nextSettingsState);
    setSavedSettingsSnapshot(createStoreDeviceSettingsSnapshot(nextSettingsState));
    setMessage("");
    setLoading(false);
    void loadTerminalAccounts(nextStoreId);
  }

  async function createTerminalAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStoreId || !canManageTerminals) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setTerminalSavingId("new");
    setTerminalMessage("");
    const response = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "store_terminal",
        name: String(formData.get("name") ?? ""),
        loginId: String(formData.get("loginId") ?? ""),
        password: String(formData.get("password") ?? ""),
        status: "active",
        visibleStoreIds: [selectedStoreId],
        workStoreIds: []
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setTerminalMessage(body.error ?? "店舗端末を追加できませんでした。");
      setTerminalSavingId("");
      return;
    }
    form.reset();
    await loadTerminalAccounts(selectedStoreId);
    setTerminalSavingId("");
    setTerminalMessage("店舗端末を追加しました。");
  }

  async function updateTerminalAccount(event: FormEvent<HTMLFormElement>, account: StoreTerminalAccount) {
    event.preventDefault();
    if (!selectedStoreId || !canManageTerminals || account.canManage === false) return;
    const formData = new FormData(event.currentTarget);
    setTerminalSavingId(account.id);
    setTerminalMessage("");
    const response = await fetch(`/api/staff/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "store_terminal",
        name: String(formData.get("name") ?? ""),
        loginId: String(formData.get("loginId") ?? ""),
        password: String(formData.get("password") ?? ""),
        status: String(formData.get("status") ?? "active"),
        visibleStoreIds: [selectedStoreId],
        workStoreIds: []
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setTerminalMessage(body.error ?? "店舗端末を更新できませんでした。");
      setTerminalSavingId("");
      return;
    }
    await loadTerminalAccounts(selectedStoreId);
    setTerminalSavingId("");
    setTerminalMessage("店舗端末を更新しました。");
  }

  function updatePrinterSettings(patch: Partial<PosPrinterSettings>) {
    setSettings((current) => ({
      ...current,
      printerSettings: { ...current.printerSettings, ...patch }
    }));
  }

  function updateReceiptPrinter(patch: Partial<PosPrinterConnection>) {
    setSettings((current) => {
      const receiptPrinter = { ...getReceiptPrinter(current.printerSettings), ...patch };
      return {
        ...current,
        printerSettings: {
          ...current.printerSettings,
          ...receiptPrinter,
          receiptPrinter
        }
      };
    });
  }

  function updateKitchenPrinter(patch: Partial<PosPrinterConnection>) {
    setSettings((current) => ({
      ...current,
      printerSettings: {
        ...current.printerSettings,
        kitchenPrinter: { ...current.printerSettings.kitchenPrinter, ...patch }
      }
    }));
  }

  function updateBrandKitchenPrinter(brand: PosBrandSetting, patch: Partial<PosPrinterConnection>) {
    setSettings((current) => {
      const existingPrinters = current.printerSettings.brandKitchenPrinters.filter((printer) => printer.brandId !== brand.brandId);
      const currentPrinter = current.printerSettings.brandKitchenPrinters.find((printer) => printer.brandId === brand.brandId)?.printer
        ?? current.printerSettings.kitchenPrinter;
      return {
        ...current,
        printerSettings: {
          ...current.printerSettings,
          brandKitchenPrinters: [
            ...existingPrinters,
            {
              brandId: brand.brandId,
              brandName: brand.brandName,
              printer: { ...currentPrinter, ...patch }
            }
          ]
        }
      };
    });
  }

  function updateCustomerDisplayMediaSettings(patch: Partial<CustomerDisplayMediaSettings>) {
    setSettings((current) => ({
      ...current,
      customerDisplayMediaSettings: { ...current.customerDisplayMediaSettings, ...patch }
    }));
  }

  function updateKitchenTicketTemplate(patch: Partial<PosKitchenTicketTemplateSettings>) {
    setSettings((current) => ({
      ...current,
      printerSettings: {
        ...current.printerSettings,
        kitchenTicketTemplate: {
          ...(current.printerSettings.kitchenTicketTemplate ?? defaultPosKitchenTicketTemplateSettings),
          ...patch
        }
      }
    }));
  }

  async function saveSettings(options: { quiet?: boolean } = {}) {
    if (!selectedStoreId || saving) return false;
    setSaving(true);
    if (!options.quiet) setMessage("");
    try {
      const response = await fetch("/api/os/pos/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          dineInEnabled: settings.dineInEnabled,
          takeoutEnabled: settings.takeoutEnabled,
          dineInTaxRate: settings.dineInTaxRate,
          takeoutTaxRate: settings.takeoutTaxRate,
          externalPaymentTerminalBrand: settings.externalPaymentTerminalBrand,
          priceTaxMode: settings.priceTaxMode,
          discountPresets: settings.discountPresets,
          customerDisplayMediaSettings: settings.customerDisplayMediaSettings,
          printerSettings: settings.printerSettings,
          posBrandSettings: settings.posBrandSettings
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "表示・設備設定を保存できませんでした。");
      const nextSettingsState = { ...settings, ...(body.settings ?? {}) };
      setSettings(nextSettingsState);
      setSavedSettingsSnapshot(createStoreDeviceSettingsSnapshot(nextSettingsState));
      if (!options.quiet) setMessage("表示・設備設定を保存しました。");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "表示・設備設定を保存できませんでした。");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function getTestPrinter() {
    if (testPrinterTarget === "receipt") return getReceiptPrinter(settings.printerSettings);
    if (testPrinterTarget.startsWith("brand:")) {
      return getKitchenPrinterForBrand(settings.printerSettings, testPrinterTarget.slice("brand:".length));
    }
    return getKitchenPrinterForBrand(settings.printerSettings);
  }

  async function testPrint() {
    if (testPrinting) return;
    if (!hasNativePrintBridge) {
      setMessage("テスト印刷は iOS / Android アプリで実行してください。ブラウザでは設定の保存のみできます。");
      return;
    }
    const printer = getTestPrinter();
    if (requiresPrinterIdentifier(printer) && !printer.identifier) {
      setMessage(getPrinterIdentifierError(printer));
      return;
    }
    if (isNetworkPrinter(printer) && !printer.host) {
      setMessage("プリンター IP を入力してください。");
      return;
    }
    setTestPrinting(true);
    setMessage("");
    const saved = await saveSettings({ quiet: true });
    if (!saved) {
      setTestPrinting(false);
      return;
    }
    const result = await printWithAndroidBridge(createTestPrintPayload(printer, settings.storeName || "Foundr1 OS"));
    setMessage(result.ok ? "プリンター設定を保存し、テスト印刷を送信しました。" : result.error || "テスト印刷に失敗しました。");
    setTestPrinting(false);
  }

  async function uploadCustomerDisplayMedia(file: File, type: "image" | "video") {
    if (!canManage || uploadingMediaType) return;
    setUploadingMediaType(type);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);
      formData.append("name", file.name);
      const response = await fetch("/api/os/pos/customer-display-media", {
        method: "POST",
        body: formData
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "アップロードできませんでした。");
      const asset: CustomerDisplayMediaAsset = {
        id: `${type}_${Date.now()}`,
        type,
        url: body.url,
        pathname: body.pathname || "",
        name: body.name || file.name,
        durationSeconds: settings.customerDisplayMediaSettings.slideDurationSeconds,
        fit: "cover"
      };
      setSettings((current) => ({
        ...current,
        customerDisplayMediaSettings: {
          ...current.customerDisplayMediaSettings,
          mode: type === "video" ? "video" : "slideshow",
          assets: type === "video"
            ? [asset, ...current.customerDisplayMediaSettings.assets.filter((item) => item.type !== "video")]
            : [...current.customerDisplayMediaSettings.assets, asset].slice(0, 12)
        }
      }));
      setMessage("アップロードしました。保存すると客席表示に反映されます。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "アップロードできませんでした。");
    } finally {
      setUploadingMediaType("");
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    void load(params.get("storeId") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasUnsavedDeviceSettings = Boolean(savedSettingsSnapshot && createStoreDeviceSettingsSnapshot(settings) !== savedSettingsSnapshot);
  const { guardAction, unsavedChangesDialog } = useUnsavedChangesGuard({
    isDirty: hasUnsavedDeviceSettings,
    onSave: () => saveSettings(),
    title: "表示・設備設定に未保存の変更があります",
    message: "店舗を切り替える、または別ページへ移動する前に、現在の表示・設備設定を保存できます。"
  });

  useEffect(() => {
    const detectNativePrintBridge = () => {
      setHasNativePrintBridge(Boolean(window.Foundr1Printer?.print));
    };
    detectNativePrintBridge();
    window.addEventListener("focus", detectNativePrintBridge);
    window.addEventListener("pageshow", detectNativePrintBridge);
    return () => {
      window.removeEventListener("focus", detectNativePrintBridge);
      window.removeEventListener("pageshow", detectNativePrintBridge);
    };
  }, []);

  const receiptPrinter = getReceiptPrinter(settings.printerSettings);

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

      <section className="workspace pos-admin-page">
        <header className="topbar">
          <div>
            <p className="eyebrow">店舗・ブランド</p>
            <h2>表示・設備設定</h2>
            <span className="source-indicator">{loading ? "読み込み中" : "データ同期済み"}</span>
          </div>
          <div className="topbar-actions">
            <a className="secondary-button" href="/store/pos/customer-display" target="_blank" rel="noreferrer">
              <MonitorSmartphone size={16} />
              客席表示を開く
            </a>
            <a className="secondary-button" href="/store/display/kitchen" target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              厨房表示を開く
            </a>
          </div>
        </header>

        {message ? <div className="action-notice">{message}</div> : null}

        <section className="panel pos-admin-toolbar">
          <label className="store-context-selector is-os">
            <span>設定対象店舗</span>
            <strong>{stores.find((store) => store.id === selectedStoreId)?.name ?? "店舗未選択"}</strong>
            <select
              value={selectedStoreId}
              onChange={(event) => {
                const storeId = event.target.value;
                guardAction(() => {
                  setSelectedStoreId(storeId);
                  void load(storeId);
                }, "店舗を切替");
              }}
            >
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
            <small>この店舗の表示・設備設定を編集中</small>
          </label>
          <div className="pos-admin-actions">
            <a href="/os/stores"><Store size={16} />店舗管理</a>
            <a href="/os/pos"><Printer size={16} />POS 設定</a>
            <button className="secondary-button" type="button" onClick={() => void saveSettings()} disabled={!canManage || saving}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </section>

        {hasUnsavedDeviceSettings ? <div className="action-notice is-warning">表示・設備設定に未保存の変更があります。移動前に保存してください。</div> : null}

        <section className="panel store-terminal-settings">
          <div className="panel-title">
            <MonitorSmartphone />
            <div>
              <h3>店舗端末</h3>
              <p>この店舗で使う Store App 端末の設置場所、ログイン ID、有効状態を管理します。</p>
            </div>
          </div>
          {terminalMessage ? <div className="action-notice">{terminalMessage}</div> : null}
          <div className="store-terminal-account-list">
            {terminalLoading ? <p className="pos-admin-discount-empty">店舗端末を読み込んでいます。</p> : terminalAccounts.length ? terminalAccounts.map((account) => (
              <form className="store-terminal-account-row" key={account.id} onSubmit={(event) => void updateTerminalAccount(event, account)}>
                <label>
                  <span>設置場所</span>
                  <select name="name" defaultValue={account.name} disabled={!canManageTerminals || account.canManage === false} required>
                    {storeTerminalWorkstations.map((workstation) => (
                      <optgroup key={workstation.value} label={workstation.label}>
                        {storeTerminalNameOptions.filter((option) => option.value.startsWith(`${workstation.value} `)).map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label>
                  <span>ログイン ID</span>
                  <input name="loginId" defaultValue={account.loginId} disabled={!canManageTerminals || account.canManage === false} required />
                </label>
                <label>
                  <span>新しいパスワード</span>
                  <input name="password" type="password" placeholder="変更時のみ入力" disabled={!canManageTerminals || account.canManage === false} />
                </label>
                <label>
                  <span>状態</span>
                  <select name="status" defaultValue={account.status} disabled={!canManageTerminals || account.canManage === false}>
                    <option value="active">有効</option>
                    <option value="inactive">停止</option>
                  </select>
                </label>
                <button className="secondary-button" type="submit" disabled={!canManageTerminals || account.canManage === false || Boolean(terminalSavingId)}>
                  {terminalSavingId === account.id ? "保存中..." : "保存"}
                </button>
              </form>
            )) : <p className="pos-admin-discount-empty">この店舗にはまだ Store App 端末がありません。</p>}
          </div>
          {canManageTerminals ? (
            <form className="store-terminal-create-form" onSubmit={(event) => void createTerminalAccount(event)}>
              <div className="store-terminal-create-heading">
                <strong>端末を追加</strong>
                <span>名称は設置場所と端末番号から選択します。</span>
              </div>
              <label>
                <span>設置場所</span>
                <select name="name" defaultValue="" required>
                  <option value="">選択してください</option>
                  {storeTerminalWorkstations.map((workstation) => (
                    <optgroup key={workstation.value} label={workstation.label}>
                      {storeTerminalNameOptions.filter((option) => option.value.startsWith(`${workstation.value} `)).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>
                <span>ログイン ID</span>
                <input name="loginId" autoComplete="off" placeholder="例: tenjin-kitchen-1" required />
              </label>
              <label>
                <span>初期パスワード</span>
                <input name="password" type="password" autoComplete="new-password" placeholder="10文字以上" required />
              </label>
              <button className="primary-button" type="submit" disabled={Boolean(terminalSavingId)}>{terminalSavingId === "new" ? "追加中..." : "追加"}</button>
            </form>
          ) : null}
        </section>

        <section className="panel pos-admin-tax-settings">
          <div className="panel-title">
            <MonitorSmartphone />
            <div>
              <h3>客席表示</h3>
              <p>POS 客席表示の待機画面に使う画像、動画、表示方式を店舗ごとに設定します。</p>
            </div>
          </div>
          <div className="pos-admin-display-media-grid">
            <label>
              <span>表示モード</span>
              <select value={settings.customerDisplayMediaSettings.mode} onChange={(event) => updateCustomerDisplayMediaSettings({ mode: event.target.value as CustomerDisplayMediaSettings["mode"] })} disabled={!canManage}>
                <option value="default">標準の待機画面</option>
                <option value="slideshow">画像スライドショー</option>
                <option value="video">動画</option>
              </select>
            </label>
            <label>
              <span>切り替え効果</span>
              <select value={settings.customerDisplayMediaSettings.transition} onChange={(event) => updateCustomerDisplayMediaSettings({ transition: event.target.value as CustomerDisplayMediaSettings["transition"] })} disabled={!canManage}>
                <option value="fade">フェード</option>
                <option value="slide">スライド</option>
                <option value="none">なし</option>
              </select>
            </label>
            <label>
              <span>画像表示秒数</span>
              <input inputMode="numeric" value={String(settings.customerDisplayMediaSettings.slideDurationSeconds)} onChange={(event) => updateCustomerDisplayMediaSettings({ slideDurationSeconds: Number(normalizeIntegerInput(event.target.value)) || 8 })} disabled={!canManage} />
            </label>
            <label>
              <span>背景色</span>
              <input type="color" value={settings.customerDisplayMediaSettings.backgroundColor} onChange={(event) => updateCustomerDisplayMediaSettings({ backgroundColor: event.target.value })} disabled={!canManage} />
            </label>
            <label className="pos-admin-discount-check">
              <input type="checkbox" checked={settings.customerDisplayMediaSettings.videoMuted} onChange={(event) => updateCustomerDisplayMediaSettings({ videoMuted: event.target.checked })} disabled={!canManage} />
              <span>動画をミュート再生</span>
            </label>
            <label className="pos-admin-discount-check">
              <input type="checkbox" checked={settings.customerDisplayMediaSettings.videoLoop} onChange={(event) => updateCustomerDisplayMediaSettings({ videoLoop: event.target.checked })} disabled={!canManage} />
              <span>動画をループ再生</span>
            </label>
          </div>
          <div className="pos-admin-display-upload-row">
            <label className={canManage ? "secondary-button" : "secondary-button is-disabled"}>
              画像をアップロード
              <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={!canManage || Boolean(uploadingMediaType)} onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void uploadCustomerDisplayMedia(file, "image");
              }} />
            </label>
            <label className={canManage ? "secondary-button" : "secondary-button is-disabled"}>
              動画をアップロード
              <input type="file" accept="video/mp4,video/webm,video/quicktime" disabled={!canManage || Boolean(uploadingMediaType)} onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void uploadCustomerDisplayMedia(file, "video");
              }} />
            </label>
          </div>
          <div className="pos-admin-display-asset-list">
            {settings.customerDisplayMediaSettings.assets.length ? settings.customerDisplayMediaSettings.assets.map((asset, index) => (
              <div className="pos-admin-display-asset-row" key={asset.id || index}>
                <div>
                  <strong>{asset.name}</strong>
                  <span>{asset.type === "video" ? "動画" : "画像"} / {asset.fit === "contain" ? "全体表示" : "画面に合わせる"}</span>
                </div>
                <label>
                  <span>表示</span>
                  <select value={asset.fit} onChange={(event) => setSettings((current) => ({
                    ...current,
                    customerDisplayMediaSettings: {
                      ...current.customerDisplayMediaSettings,
                      assets: current.customerDisplayMediaSettings.assets.map((item, itemIndex) => itemIndex === index ? { ...item, fit: event.target.value as CustomerDisplayMediaAsset["fit"] } : item)
                    }
                  }))} disabled={!canManage}>
                    <option value="cover">画面に合わせる</option>
                    <option value="contain">全体表示</option>
                  </select>
                </label>
                {asset.type === "image" ? (
                  <label>
                    <span>秒数</span>
                    <input inputMode="numeric" value={String(asset.durationSeconds)} onChange={(event) => setSettings((current) => ({
                      ...current,
                      customerDisplayMediaSettings: {
                        ...current.customerDisplayMediaSettings,
                        assets: current.customerDisplayMediaSettings.assets.map((item, itemIndex) => itemIndex === index ? { ...item, durationSeconds: Number(normalizeIntegerInput(event.target.value)) || 8 } : item)
                      }
                    }))} disabled={!canManage} />
                  </label>
                ) : null}
                <button className="icon-button" type="button" aria-label="メディアを削除" disabled={!canManage} onClick={() => setSettings((current) => ({
                  ...current,
                  customerDisplayMediaSettings: {
                    ...current.customerDisplayMediaSettings,
                    assets: current.customerDisplayMediaSettings.assets.filter((_, itemIndex) => itemIndex !== index)
                  }
                }))}>
                  <Trash2 size={15} />
                </button>
              </div>
            )) : <p className="pos-admin-discount-empty">画像または動画をアップロードすると、客席表示の待機画面に使用できます。</p>}
          </div>
        </section>

        <section className="panel pos-admin-tax-settings">
          <div className="panel-title">
            <Printer />
            <div>
              <h3>プリンター</h3>
              <p>POS レシートと Web 予約・POS 共通の厨房伝票に使う店舗プリンターを設定します。</p>
            </div>
          </div>
          <div className="pos-admin-printer-actions">
            <select value={testPrinterTarget} onChange={(event) => setTestPrinterTarget(event.target.value)} disabled={!canManage || saving || testPrinting}>
              <option value="kitchen">厨房デフォルト</option>
              <option value="receipt">レシート</option>
              {settings.posBrandSettings.map((brand) => (
                <option key={brand.brandId} value={`brand:${brand.brandId}`}>{brand.brandName} 厨房</option>
              ))}
            </select>
            <button className="secondary-button" type="button" onClick={() => void testPrint()} disabled={!canManage || saving || testPrinting || !hasNativePrintBridge}>
              <Printer size={15} />
              {testPrinting ? "送信中..." : hasNativePrintBridge ? "テスト印刷" : "アプリでテスト"}
            </button>
          </div>
          {!hasNativePrintBridge ? (
            <p className="pos-admin-printer-status">ブラウザではプリンター設定の保存のみできます。テスト印刷は iOS / Android アプリで実行してください。</p>
          ) : null}
          <div className="pos-admin-printer-toggles">
            <label className="pos-admin-discount-check">
              <input type="checkbox" checked={settings.printerSettings.enabled} onChange={(event) => updatePrinterSettings({ enabled: event.target.checked })} disabled={!canManage} />
              <span>店舗印刷を有効にする</span>
            </label>
            <label className="pos-admin-discount-check">
              <input type="checkbox" checked={settings.printerSettings.receiptEnabled} onChange={(event) => updatePrinterSettings({ receiptEnabled: event.target.checked })} disabled={!canManage} />
              <span>会計後にレシート印刷</span>
            </label>
            <label className="pos-admin-discount-check">
              <input type="checkbox" checked={settings.printerSettings.kitchenEnabled} onChange={(event) => updatePrinterSettings({ kitchenEnabled: event.target.checked })} disabled={!canManage} />
              <span>厨房伝票を印刷</span>
            </label>
          </div>
          <PrinterCard title="レシートプリンター" description="店頭会計後のレシート印刷に使用します。" printer={receiptPrinter} disabled={!canManage} onChange={updateReceiptPrinter} />
          <PrinterCard title="厨房デフォルトプリンター" description="Web 予約と POS の厨房伝票に使用します。ブランド別指定がある場合はそちらが優先されます。" printer={settings.printerSettings.kitchenPrinter} disabled={!canManage} onChange={updateKitchenPrinter} />
          {settings.posBrandSettings.length ? (
            <div className="pos-admin-printer-card">
              <div>
                <strong>ブランド別 厨房プリンター</strong>
                <p>空欄のブランドは厨房デフォルトプリンターを使用します。</p>
              </div>
              <div className="pos-admin-printer-brand-list">
                {settings.posBrandSettings.map((brand) => {
                  const printer = settings.printerSettings.brandKitchenPrinters.find((item) => item.brandId === brand.brandId)?.printer
                    ?? settings.printerSettings.kitchenPrinter;
                  return (
                    <div className="pos-admin-printer-brand-row" key={brand.brandId}>
                      <strong>{brand.brandName}</strong>
                      <PrinterFields printer={printer} disabled={!canManage} compact onChange={(patch) => updateBrandKitchenPrinter(brand, patch)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="pos-admin-printer-card">
            <div className="store-device-receipt-preview-heading">
              <div>
                <strong>レシート・領収書プレビュー</strong>
                <p>現在保存されているテンプレートを、レシートプリンターの用紙幅で確認します。内容の編集は POS 設定から行えます。</p>
              </div>
              <div className="store-device-receipt-preview-controls">
                <select value={receiptPreviewBrandId} onChange={(event) => setReceiptPreviewBrandId(event.target.value)}>
                  <option value="">店舗共通</option>
                  {settings.posBrandSettings.map((brand) => <option value={brand.brandId} key={brand.brandId}>{brand.brandName}</option>)}
                </select>
                <select value={receiptPreviewMode} onChange={(event) => setReceiptPreviewMode(event.target.value as "receipt" | "invoice")}>
                  <option value="receipt">レシート</option>
                  <option value="invoice">領収書</option>
                </select>
                <a className="secondary-button" href="/os/pos">テンプレートを編集</a>
              </div>
            </div>
            <ReceiptTicketPreview
              storeName={settings.storeName || "店舗名"}
              paperWidth={receiptPrinter.paperWidth}
              documentType={receiptPreviewMode}
              template={resolvePosReceiptTemplate(settings.printerSettings, receiptPreviewBrandId, receiptPreviewMode)}
            />
          </div>
          <div className="pos-admin-printer-card">
            <div>
              <strong>厨房伝票テンプレート</strong>
              <p>Web 予約と POS から厨房へ出す内部伝票の表示内容を設定します。お客様向けレシートとは別管理です。</p>
            </div>
            <div className="pos-admin-receipt-template-workspace store-kitchen-ticket-template-workspace">
              <div className="pos-admin-receipt-template-editor">
                <div className="pos-admin-printer-grid">
                  <label>
                    <span>印刷枚数</span>
                    <select
                      value={settings.printerSettings.kitchenCopies}
                      onChange={(event) => updatePrinterSettings({ kitchenCopies: Number(event.target.value) })}
                      disabled={!canManage}
                    >
                      {[1, 2, 3, 4, 5].map((copies) => <option key={copies} value={copies}>{copies}枚</option>)}
                    </select>
                  </label>
                  <label>
                    <span>タイトル</span>
                    <input value={settings.printerSettings.kitchenTicketTemplate.title} onChange={(event) => updateKitchenTicketTemplate({ title: event.target.value })} disabled={!canManage} />
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.largeText} onChange={(event) => updateKitchenTicketTemplate({ largeText: event.target.checked })} disabled={!canManage} />
                    <span>大きめの文字で印刷</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.showTitle} onChange={(event) => updateKitchenTicketTemplate({ showTitle: event.target.checked })} disabled={!canManage} />
                    <span>タイトルを表示</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.showStoreName} onChange={(event) => updateKitchenTicketTemplate({ showStoreName: event.target.checked })} disabled={!canManage} />
                    <span>店舗名・ブランド名を表示</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.showPickupCode} onChange={(event) => updateKitchenTicketTemplate({ showPickupCode: event.target.checked })} disabled={!canManage} />
                    <span>受取番号を表示</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.showOrderType} onChange={(event) => updateKitchenTicketTemplate({ showOrderType: event.target.checked })} disabled={!canManage} />
                    <span>注文区分を表示</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.showItems} onChange={(event) => updateKitchenTicketTemplate({ showItems: event.target.checked })} disabled={!canManage} />
                    <span>商品を表示</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.showOptions} onChange={(event) => updateKitchenTicketTemplate({ showOptions: event.target.checked })} disabled={!canManage} />
                    <span>サイズ・甘さ・氷などを表示</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.showNote} onChange={(event) => updateKitchenTicketTemplate({ showNote: event.target.checked })} disabled={!canManage} />
                    <span>備考を表示</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.showTimestamp} onChange={(event) => updateKitchenTicketTemplate({ showTimestamp: event.target.checked })} disabled={!canManage} />
                    <span>印刷日時を表示</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input type="checkbox" checked={settings.printerSettings.kitchenTicketTemplate.showAmounts} onChange={(event) => updateKitchenTicketTemplate({ showAmounts: event.target.checked })} disabled={!canManage} />
                    <span>金額を表示</span>
                  </label>
                </div>
              </div>
              <KitchenTicketPreview storeName={settings.storeName || "店舗名"} template={settings.printerSettings.kitchenTicketTemplate} />
            </div>
          </div>
        </section>
        {unsavedChangesDialog}
      </section>
    </main>
  );
}

function KitchenTicketPreview({
  storeName,
  template
}: {
  storeName: string;
  template: PosKitchenTicketTemplateSettings;
}) {
  return (
    <aside className="pos-admin-receipt-preview-panel" aria-label="厨房伝票プレビュー">
      <div className="pos-admin-receipt-preview-heading">
        <strong>厨房伝票プレビュー</strong>
        <span>{template.largeText ? "大きめ" : "通常"}</span>
      </div>
      <div className="pos-admin-receipt-paper store-kitchen-ticket-preview">
        {template.showTitle ? <h5>{template.title || defaultPosKitchenTicketTemplateSettings.title}</h5> : null}
        {template.showStoreName ? <p>{storeName} / ドリンク</p> : null}
        <div className="pos-admin-receipt-paper-rule" />
        {template.showPickupCode ? <div className="pos-admin-receipt-paper-line is-strong"><span>No. F1-1234</span><span /></div> : null}
        {template.showOrderType ? <p>持ち帰り / 厨房</p> : null}
        {template.showItems ? (
          <>
            <div className="pos-admin-receipt-paper-rule" />
            <div className="pos-admin-receipt-paper-line">
              <span>チョコミントタピオカフラッペ x1</span>
              {template.showAmounts ? <span>¥650</span> : <span />}
            </div>
            {template.showOptions ? (
              <>
                <p className="is-sub">  サイズ：R レギュラー 500ml</p>
                <p className="is-sub">  温度：ICE</p>
                <p className="is-sub">  甘さ：ふつう</p>
                <p className="is-sub">  氷：なし</p>
              </>
            ) : null}
            <div className="pos-admin-receipt-paper-line">
              <span>国産米トッポッキ x1</span>
              {template.showAmounts ? <span>¥378</span> : <span />}
            </div>
          </>
        ) : null}
        {template.showAmounts ? (
          <>
            <div className="pos-admin-receipt-paper-rule" />
            <div className="pos-admin-receipt-paper-line is-total"><span>合計</span><span>¥1,028</span></div>
          </>
        ) : null}
        {template.showNote ? (
          <>
            <div className="pos-admin-receipt-paper-rule" />
            <p>備考: ストロー不要</p>
          </>
        ) : null}
        <div className="pos-admin-receipt-paper-rule" />
        {template.showTimestamp ? <p>2026-06-15 12:34:56</p> : null}
      </div>
    </aside>
  );
}

function receiptPreviewLines(value: string) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function ReceiptPreviewQr({ template }: { template: PosReceiptTemplateSettings }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    if (!template.qrCodeUrl.trim()) {
      setSrc("");
      return () => { active = false; };
    }
    void QRCodeGenerator.toDataURL(template.qrCodeUrl.trim(), { errorCorrectionLevel: "M", margin: 1, width: 320 })
      .then((value) => { if (active) setSrc(value); })
      .catch(() => { if (active) setSrc(""); });
    return () => { active = false; };
  }, [template.qrCodeUrl]);
  return (
    <div className={`pos-admin-receipt-paper-qr is-${template.qrCodeAlignment} is-${template.qrCodeSize}`}>
      {src ? <img src={src} alt="" /> : <div>QR</div>}
      {template.qrCodeLabel ? <p>{template.qrCodeLabel}</p> : null}
    </div>
  );
}

function ReceiptTicketPreview({
  storeName,
  paperWidth,
  documentType,
  template
}: {
  storeName: string;
  paperWidth: PosPrinterConnection["paperWidth"];
  documentType: "receipt" | "invoice";
  template: PosReceiptTemplateSettings;
}) {
  function renderBlock(block: PosReceiptTemplateBlock) {
    if (block === "logo") return template.showLogo ? (
      template.logoUrl
        ? <img className={`pos-admin-receipt-paper-logo is-${template.logoAlignment}`} style={{ width: `${template.logoWidthPercent}%`, marginBottom: `${template.logoBottomSpacing}px` }} src={template.logoUrl} alt="" />
        : <div className={`pos-admin-receipt-paper-logo-placeholder is-${template.logoAlignment}`} style={{ width: `${template.logoWidthPercent}%`, marginBottom: `${template.logoBottomSpacing}px` }}>LOGO</div>
    ) : null;
    if (block === "business") return <h5 className={`is-${template.businessNameAlignment} is-size-${template.businessNameTextSize}`}>{template.businessName || storeName}</h5>;
    if (block === "contact") return (
      <div className="pos-admin-receipt-preview-block">
        {receiptPreviewLines(template.companyInfo).map((line, index) => <p className={`is-${template.contactInfoAlignment}`} key={`company-${index}`}>{line}</p>)}
        {receiptPreviewLines(template.address).map((line, index) => <p className={`is-${template.contactInfoAlignment}`} key={`address-${index}`}>{line}</p>)}
        {template.taxRegistrationNumber ? <p className={`is-${template.contactInfoAlignment}`}>登録番号: {template.taxRegistrationNumber}</p> : null}
        {template.phone ? <p className={`is-${template.contactInfoAlignment}`}>TEL: {template.phone}</p> : null}
        {template.website ? <p className={`is-${template.contactInfoAlignment}`}>{template.website}</p> : null}
      </div>
    );
    if (block === "message") return <div className={`pos-admin-receipt-preview-block is-message is-size-${template.messageTextSize}`}>{receiptPreviewLines(template.headerMessage).map((line, index) => <p className={`is-${template.messageAlignment}`} key={index}>{line}</p>)}</div>;
    if (block === "promotion") return (
      <div className={`pos-admin-receipt-preview-block is-message is-size-${template.messageTextSize}`}>
        {template.promotionImageUrl ? <img className={`pos-admin-receipt-paper-promo is-${template.promotionImageAlignment}`} style={{ width: `${template.promotionImageWidthPercent}%` }} src={template.promotionImageUrl} alt="" /> : null}
        {receiptPreviewLines(template.promotionMessage).map((line, index) => <p className={`is-${template.messageAlignment}`} key={index}>{line}</p>)}
      </div>
    );
    if (block === "qr") return template.qrCodeEnabled ? <ReceiptPreviewQr template={template} /> : null;
    if (block === "footer") return (
      <div className={`pos-admin-receipt-preview-block is-message is-size-${template.messageTextSize}`}>
        {receiptPreviewLines(template.footerMessage).map((line, index) => <p className={`is-${template.messageAlignment}`} key={index}>{line}</p>)}
        {template.showTimestamp ? <p>2026-07-18 12:34:56</p> : null}
      </div>
    );
    return (
      <div className="pos-admin-receipt-preview-block is-receipt-content">
        <div className="pos-admin-receipt-paper-rule" />
        <h5 className={`is-size-${template.titleTextSize}`}>{documentType === "invoice" ? template.invoiceTitle : template.receiptTitle}</h5>
        {documentType === "invoice" ? <><div className="pos-admin-receipt-paper-line is-strong"><span>{template.invoiceRecipientName}</span><span>様</span></div><p>但し {template.invoicePurposeText}として</p><div className="pos-admin-receipt-paper-rule" /></> : null}
        <div className="pos-admin-receipt-paper-line is-strong"><span>No. F1-1234</span><span /></div>
        <p>店内 / 現金</p>
        <div className="pos-admin-receipt-paper-rule" />
        <div className="pos-admin-receipt-paper-line"><span>ドリンク x1</span><span>¥650</span></div>
        <p className="is-sub">  サイズ: R / 甘さ: ふつう</p>
        <div className="pos-admin-receipt-paper-line"><span>トッポッキ x1</span><span>¥378</span></div>
        <div className="pos-admin-receipt-paper-rule" />
        <div className="pos-admin-receipt-paper-line"><span>小計</span><span>¥1,028</span></div>
        {template.showTaxSummary ? <div className="pos-admin-receipt-paper-line"><span>内消費税 10%</span><span>¥93</span></div> : null}
        <div className="pos-admin-receipt-paper-line is-total"><span>合計</span><span>¥1,028</span></div>
        <div className="pos-admin-receipt-paper-line"><span>お預かり</span><span>¥2,000</span></div>
        <div className="pos-admin-receipt-paper-line"><span>お釣り</span><span>¥972</span></div>
        <div className="pos-admin-receipt-paper-rule" />
      </div>
    );
  }
  return (
    <aside className="pos-admin-receipt-preview-panel store-device-receipt-preview" aria-label="レシート・領収書プレビュー">
      <div className="pos-admin-receipt-preview-heading"><strong>{documentType === "invoice" ? "領収書" : "レシート"}プレビュー</strong><span>{paperWidth}</span></div>
      <div className={`pos-admin-receipt-paper is-${template.density}`}>
        {template.blockOrder.map((block) => <div className="pos-admin-receipt-paper-block" key={block}>{renderBlock(block)}</div>)}
      </div>
    </aside>
  );
}

function PrinterCard({
  title,
  description,
  printer,
  disabled,
  onChange
}: {
  title: string;
  description: string;
  printer: PosPrinterConnection;
  disabled: boolean;
  onChange: (patch: Partial<PosPrinterConnection>) => void;
}) {
  return (
    <div className="pos-admin-printer-card">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="pos-admin-printer-grid">
        <PrinterFields printer={printer} disabled={disabled} onChange={onChange} />
        <label className="pos-admin-discount-check">
          <input type="checkbox" checked={printer.cutPaper} onChange={(event) => onChange({ cutPaper: event.target.checked })} disabled={disabled} />
          <span>印刷後にカット</span>
        </label>
      </div>
    </div>
  );
}

function PrinterFields({
  printer,
  disabled,
  compact = false,
  onChange
}: {
  printer: PosPrinterConnection;
  disabled: boolean;
  compact?: boolean;
  onChange: (patch: Partial<PosPrinterConnection>) => void;
}) {
  return (
    <>
      <label>
        <span>{compact ? "機器" : "機器タイプ"}</span>
        <select value={printer.deviceType} onChange={(event) => onChange({ deviceType: event.target.value as PosPrinterConnection["deviceType"] })} disabled={disabled}>
          <option value="escpos_network">ESC/POS Wi-Fi / LAN</option>
          <option value="escpos_bluetooth">ESC/POS Bluetooth</option>
          <option value="escpos_usb">ESC/POS USB</option>
          <option value="star_printer">Star プリンター</option>
        </select>
      </label>
      {printer.deviceType === "star_printer" ? (
        <>
          <label>
            <span>接続</span>
            <select value={printer.connectionType} onChange={(event) => onChange({ connectionType: event.target.value as PosPrinterConnection["connectionType"] })} disabled={disabled}>
              <option value="bluetooth">Bluetooth</option>
              <option value="bluetooth_le">Bluetooth LE</option>
              <option value="usb">USB</option>
              <option value="lan">LAN</option>
            </select>
          </label>
          <label>
            <span>識別子</span>
            <input value={printer.identifier} onChange={(event) => onChange({ identifier: event.target.value.trim() })} placeholder="Star printer / MAC / IP" disabled={disabled || printer.connectionType === "usb"} />
          </label>
        </>
      ) : null}
      {usesPrinterIdentifier(printer) && printer.deviceType !== "star_printer" ? (
        <label>
          <span>識別子</span>
          <input value={printer.identifier} onChange={(event) => onChange({ identifier: event.target.value.trim() })} placeholder={getPrinterIdentifierHelp(printer)} disabled={disabled} />
        </label>
      ) : null}
      <label>
        <span>{compact ? "IP" : "プリンター IP"}</span>
        <input value={printer.host} onChange={(event) => onChange({ host: event.target.value.trim(), identifier: event.target.value.trim() })} placeholder="192.168.0.34" disabled={disabled || !isNetworkPrinter(printer)} />
      </label>
      <label>
        <span>ポート</span>
        <input inputMode="numeric" value={String(printer.port)} onChange={(event) => onChange({ port: Number(normalizeIntegerInput(event.target.value)) || 9100 })} disabled={disabled || !isNetworkPrinter(printer)} />
      </label>
      <label>
        <span>用紙幅</span>
        <select value={printer.paperWidth} onChange={(event) => onChange({ paperWidth: event.target.value as PosPrinterConnection["paperWidth"] })} disabled={disabled}>
          <option value="80mm">80mm</option>
          <option value="58mm">58mm</option>
        </select>
      </label>
      {!compact ? (
        <label>
          <span>文字コード</span>
          <select value={printer.characterEncoding} onChange={(event) => onChange({ characterEncoding: event.target.value as PosPrinterConnection["characterEncoding"] })} disabled={disabled}>
            <option value="shift_jis">Shift_JIS</option>
            <option value="utf8">UTF-8</option>
          </select>
        </label>
      ) : null}
    </>
  );
}
