"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Save, Search, Settings, Store, Truck, Upload, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { defaultStoreModuleSettings, type StoreModuleSettings } from "../../../lib/module-setting-defaults";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "システム設定", href: "/os/settings", icon: Settings }
];

type WithholdingTaxTable = {
  id: string;
  taxYear: number;
  tableType: string;
  title: string;
  sourceFileName: string | null;
  effectiveFrom: string;
  isActive: boolean;
  createdAt: string;
  rowCount: number;
};

type SocialInsuranceTable = {
  id: string;
  fiscalYear: number;
  title: string;
  sourceFileName: string | null;
  effectiveFrom: string;
  rowCount: number;
};

type EmploymentInsuranceTable = {
  id: string;
  fiscalYear: number;
  title: string;
  sourceFileName: string | null;
  effectiveFrom: string;
  effectiveTo: string;
  rowCount: number;
};

type PayrollStatutoryAlert = {
  key: string;
  level: "critical" | "warning";
  title: string;
  message: string;
  actionLabel: string;
  dueLabel: string;
};

export default function OsSettingsPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [settings, setSettings] = useState<StoreModuleSettings>(defaultStoreModuleSettings);
  const [taxTables, setTaxTables] = useState<WithholdingTaxTable[]>([]);
  const [socialInsuranceTables, setSocialInsuranceTables] = useState<SocialInsuranceTable[]>([]);
  const [employmentInsuranceTables, setEmploymentInsuranceTables] = useState<EmploymentInsuranceTable[]>([]);
  const [payrollAlerts, setPayrollAlerts] = useState<PayrollStatutoryAlert[]>([]);
  const [taxFile, setTaxFile] = useState<File | null>(null);
  const [socialInsuranceFile, setSocialInsuranceFile] = useState<File | null>(null);
  const [employmentInsuranceFile, setEmploymentInsuranceFile] = useState<File | null>(null);
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [socialInsuranceYear, setSocialInsuranceYear] = useState(String(new Date().getFullYear()));
  const [employmentInsuranceYear, setEmploymentInsuranceYear] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingTaxTable, setUploadingTaxTable] = useState(false);
  const [uploadingSocialInsurance, setUploadingSocialInsurance] = useState(false);
  const [uploadingEmploymentInsurance, setUploadingEmploymentInsurance] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      const [settingsResponse, taxResponse, socialInsuranceResponse, employmentInsuranceResponse, alertResponse] = await Promise.all([
        fetch("/api/settings?module=store", { cache: "no-store" }),
        fetch("/api/settings/withholding-tax", { cache: "no-store" }),
        fetch("/api/settings/social-insurance", { cache: "no-store" }),
        fetch("/api/settings/employment-insurance", { cache: "no-store" }),
        fetch("/api/settings/payroll-statutory-alerts", { cache: "no-store" })
      ]);
      if (settingsResponse.ok) {
        const body = await settingsResponse.json() as { settings?: StoreModuleSettings };
        if (body.settings) setSettings(body.settings);
      }
      if (taxResponse.ok) {
        const body = await taxResponse.json() as { tables?: WithholdingTaxTable[] };
        setTaxTables(body.tables ?? []);
      }
      if (socialInsuranceResponse.ok) {
        const body = await socialInsuranceResponse.json() as { tables?: SocialInsuranceTable[] };
        setSocialInsuranceTables(body.tables ?? []);
      }
      if (employmentInsuranceResponse.ok) {
        const body = await employmentInsuranceResponse.json() as { tables?: EmploymentInsuranceTable[] };
        setEmploymentInsuranceTables(body.tables ?? []);
      }
      if (alertResponse.ok) {
        const body = await alertResponse.json() as { alerts?: PayrollStatutoryAlert[]; canView?: boolean };
        if (body.canView) setPayrollAlerts(body.alerts ?? []);
      }
      setLoading(false);
    }
    void loadSettings();
  }, []);

  async function saveSettings() {
    setSaving(true);
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleKey: "store", settings })
    });
    setSaving(false);
    if (!response.ok) {
      showNotice("設定を保存できませんでした。", "info");
      return;
    }
    const body = await response.json() as { settings?: StoreModuleSettings };
    if (body.settings) setSettings(body.settings);
    showNotice("設定を保存しました。");
  }

  async function fileToBase64(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks: string[] = [];
    const chunkSize = 8192;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
    }
    return window.btoa(chunks.join(""));
  }

  async function uploadWithholdingTaxTable() {
    if (!taxFile) {
      showNotice("源泉税表ファイルを選択してください。", "info");
      return;
    }
    setUploadingTaxTable(true);
    const fileBase64 = await fileToBase64(taxFile);
    const response = await fetch("/api/settings/withholding-tax", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: taxFile.name, fileBase64, taxYear })
    });
    setUploadingTaxTable(false);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(String(body.error ?? "源泉税表を取り込めませんでした。"), "info");
      return;
    }
    setTaxFile(null);
    const taxResponse = await fetch("/api/settings/withholding-tax", { cache: "no-store" });
    if (taxResponse.ok) {
      const taxBody = await taxResponse.json() as { tables?: WithholdingTaxTable[] };
      setTaxTables(taxBody.tables ?? []);
    }
    showNotice(`源泉税表を取り込みました。${body.rowCount ?? 0}行`);
  }

  async function uploadSocialInsuranceTable() {
    if (!socialInsuranceFile) {
      showNotice("社会保険料表ファイルを選択してください。", "info");
      return;
    }
    setUploadingSocialInsurance(true);
    const fileBase64 = await fileToBase64(socialInsuranceFile);
    const response = await fetch("/api/settings/social-insurance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: socialInsuranceFile.name, fileBase64, fiscalYear: socialInsuranceYear })
    });
    setUploadingSocialInsurance(false);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(String(body.error ?? "社会保険料表を取り込めませんでした。"), "info");
      return;
    }
    setSocialInsuranceFile(null);
    const listResponse = await fetch("/api/settings/social-insurance", { cache: "no-store" });
    if (listResponse.ok) {
      const listBody = await listResponse.json() as { tables?: SocialInsuranceTable[] };
      setSocialInsuranceTables(listBody.tables ?? []);
    }
    showNotice(`社会保険料表を取り込みました。${body.rowCount ?? 0}行`);
  }

  async function uploadEmploymentInsuranceTable() {
    if (!employmentInsuranceFile) {
      showNotice("雇用保険料率ファイルを選択してください。", "info");
      return;
    }
    setUploadingEmploymentInsurance(true);
    const fileBase64 = await fileToBase64(employmentInsuranceFile);
    let response = await fetch("/api/settings/employment-insurance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: employmentInsuranceFile.name, fileBase64, fiscalYear: employmentInsuranceYear })
    });
    let body = await response.json().catch(() => ({}));
    if (!response.ok && ["2025", "2026"].includes(String(employmentInsuranceYear).trim())) {
      response = await fetch("/api/settings/employment-insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: employmentInsuranceFile.name, fiscalYear: employmentInsuranceYear })
      });
      body = await response.json().catch(() => ({}));
    }
    setUploadingEmploymentInsurance(false);
    if (!response.ok) {
      showNotice(`${response.status}: ${String(body.error ?? "雇用保険料率を取り込めませんでした。")}`, "info");
      return;
    }
    setEmploymentInsuranceFile(null);
    const listResponse = await fetch("/api/settings/employment-insurance", { cache: "no-store" });
    if (listResponse.ok) {
      const listBody = await listResponse.json() as { tables?: EmploymentInsuranceTable[] };
      setEmploymentInsuranceTables(listBody.tables ?? []);
    }
    showNotice(`雇用保険料率を取り込みました。${body.rowCount ?? 0}行`);
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>システム設定</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Configuration</p>
            <h2>システム設定</h2>
            <span className="source-indicator">{loading ? "読み込み中" : "設定読み込み済み"}</span>
          </div>
          <button className="primary-button" type="button" disabled={saving} onClick={() => void saveSettings()}>
            <Save size={16} />
            {saving ? "保存中" : "設定を保存"}
          </button>
        </header>

        <section className="settings-grid">
          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>給与・税設定</h3>
                <p>源泉徴収税額表をアップロードします。給与計算では従業員ごとの甲乙区分と扶養人数に基づいて源泉所得税を控除します。</p>
              </div>
            </div>
            {payrollAlerts.length ? (
              <div className="statutory-alert-list is-settings">
                {payrollAlerts.map((alert) => (
                  <article className={`statutory-alert-card is-${alert.level}`} key={alert.key}>
                    <div>
                      <span>{alert.dueLabel}</span>
                      <h4>{alert.title}</h4>
                      <p>{alert.message}</p>
                    </div>
                    <strong>{alert.actionLabel}</strong>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="settings-tax-import">
              <label className="settings-field">
                <span>対象年</span>
                <input value={taxYear} inputMode="numeric" onChange={(event) => setTaxYear(event.target.value)} placeholder="例: 2026" />
              </label>
              <label className="settings-field">
                <span>源泉税表ファイル</span>
                <input
                  key={taxFile ? "tax-file-selected" : "tax-file-empty"}
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={(event) => setTaxFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button className="secondary-button" type="button" disabled={!taxFile || uploadingTaxTable} onClick={() => void uploadWithholdingTaxTable()}>
                <Upload size={16} />
                {uploadingTaxTable ? "取り込み中" : "源泉税表を取り込む"}
              </button>
            </div>
            <div className="settings-tax-import">
              <label className="settings-field">
                <span>対象年度</span>
                <input value={socialInsuranceYear} inputMode="numeric" onChange={(event) => setSocialInsuranceYear(event.target.value)} placeholder="例: 2026" />
              </label>
              <label className="settings-field">
                <span>社会保険料表 Excel</span>
                <input
                  key={socialInsuranceFile ? "social-file-selected" : "social-file-empty"}
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={(event) => setSocialInsuranceFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button className="secondary-button" type="button" disabled={!socialInsuranceFile || uploadingSocialInsurance} onClick={() => void uploadSocialInsuranceTable()}>
                <Upload size={16} />
                {uploadingSocialInsurance ? "取り込み中" : "社会保険料表を取り込む"}
              </button>
            </div>
            <div className="settings-tax-import">
              <label className="settings-field">
                <span>対象年度</span>
                <input value={employmentInsuranceYear} inputMode="numeric" onChange={(event) => setEmploymentInsuranceYear(event.target.value)} placeholder="例: 2026" />
              </label>
              <label className="settings-field">
                <span>雇用保険料率 PDF</span>
                <input
                  key={employmentInsuranceFile ? "employment-file-selected" : "employment-file-empty"}
                  type="file"
                  accept=".pdf"
                  onChange={(event) => setEmploymentInsuranceFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button className="secondary-button" type="button" disabled={!employmentInsuranceFile || uploadingEmploymentInsurance} onClick={() => void uploadEmploymentInsuranceTable()}>
                <Upload size={16} />
                {uploadingEmploymentInsurance ? "取り込み中" : "雇用保険料率を取り込む"}
              </button>
            </div>
            <div className="settings-tax-table-list">
              {taxTables.length ? taxTables.map((table) => (
                <article key={table.id}>
                  <strong>{table.taxYear}年 / {table.title}</strong>
                  <span>{table.rowCount}行 / {table.sourceFileName ?? "ファイル名なし"} / {table.isActive ? "有効" : "無効"}</span>
                </article>
              )) : (
                <p className="empty-state-text">源泉税表はまだ登録されていません。</p>
              )}
              {socialInsuranceTables.map((table) => (
                <article key={table.id}>
                  <strong>{table.fiscalYear}年度 / {table.title}</strong>
                  <span>社会保険 {table.rowCount}行 / {table.sourceFileName ?? "ファイル名なし"}</span>
                </article>
              ))}
              {employmentInsuranceTables.map((table) => (
                <article key={table.id}>
                  <strong>{table.fiscalYear}年度 / {table.title}</strong>
                  <span>雇用保険 {table.rowCount}行 / {table.sourceFileName ?? "ファイル名なし"} / {String(table.effectiveFrom).slice(0, 10)}〜{String(table.effectiveTo).slice(0, 10)}</span>
                </article>
              ))}
            </div>
            <div className="statutory-schedule-list" aria-label="給与法定データ更新時期">
              <article>
                <strong>源泉所得税</strong>
                <span>毎年1月支給分から新しい税額表を使用。10月以降に翌年分の確認を開始します。</span>
              </article>
              <article>
                <strong>健康保険・介護保険</strong>
                <span>協会けんぽは例年3月分（4月納付分）から料率改定。2月から確認を開始します。</span>
              </article>
              <article>
                <strong>雇用保険</strong>
                <span>年度単位で4月1日から料率切替。3月から確認を開始します。</span>
              </article>
              <article>
                <strong>住民税</strong>
                <span>6月から翌年5月まで控除。5月から通知書に基づく手入力を促します。</span>
              </article>
              <article>
                <strong>標準報酬月額</strong>
                <span>定時決定後、原則9月から翌年8月まで使用。7月から確認を開始します。</span>
              </article>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>Store ヘッダー</h3>
                <p>店舗現場画面の上部に表示する内容を設定します。現場画面はコンパクトに保つため、初期値はアイコンのみです。</p>
              </div>
            </div>
            <div className="settings-option-list">
              <ToggleRow label="時計を表示" checked={settings.header.showClock} onChange={(checked) => setSettings((current) => ({ ...current, header: { ...current.header, showClock: checked } }))} />
              <ToggleRow label="通知ボタンを表示" checked={settings.header.showNotifications} onChange={(checked) => setSettings((current) => ({ ...current, header: { ...current.header, showNotifications: checked } }))} />
              <ToggleRow label="言語切替を表示" checked={settings.header.showLanguagePicker} onChange={(checked) => setSettings((current) => ({ ...current, header: { ...current.header, showLanguagePicker: checked } }))} />
              <label className="settings-field">
                <span>ユーザー表示</span>
                <select
                  value={settings.header.userDisplay}
                  onChange={(event) => setSettings((current) => ({ ...current, header: { ...current.header, userDisplay: event.target.value as StoreModuleSettings["header"]["userDisplay"] } }))}
                >
                  <option value="avatar">アイコンのみ</option>
                  <option value="name">名前のみ</option>
                  <option value="avatar_name">アイコン + 名前</option>
                </select>
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>Store 販売状態</h3>
                <p>店舗現場で売り切れ、販売再開、メモ入力を扱う対象を設定します。</p>
              </div>
            </div>
            <div className="settings-option-list">
              <ToggleRow label="商品を店舗で管理" checked={settings.availability.targets.items} onChange={(checked) => setSettings((current) => ({ ...current, availability: { ...current.availability, targets: { ...current.availability.targets, items: checked } } }))} />
              <ToggleRow label="オプション・トッピングを店舗で管理" checked={settings.availability.targets.options} onChange={(checked) => setSettings((current) => ({ ...current, availability: { ...current.availability, targets: { ...current.availability.targets, options: checked } } }))} />
              <label className="settings-field">
                <span>オプション表示方式</span>
                <select
                  value={settings.availability.optionDisplayMode}
                  onChange={(event) => setSettings((current) => ({ ...current, availability: { ...current.availability, optionDisplayMode: event.target.value as StoreModuleSettings["availability"]["optionDisplayMode"] } }))}
                  disabled={!settings.availability.targets.options}
                >
                  <option value="separate_category">左側に独立分類として表示</option>
                  <option value="mixed">商品一覧の上に混合表示</option>
                  <option value="hidden">表示しない</option>
                </select>
              </label>
              <ToggleRow label="店舗の価格変更を許可" checked={settings.availability.allowStorePriceEdit} onChange={(checked) => setSettings((current) => ({ ...current, availability: { ...current.availability, allowStorePriceEdit: checked } }))} />
              <ToggleRow label="Web / POS などの販売チャネル停止を許可" checked={settings.availability.allowChannelToggle} onChange={(checked) => setSettings((current) => ({ ...current, availability: { ...current.availability, allowChannelToggle: checked } }))} />
            </div>
          </section>
        </section>
      </section>
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="settings-toggle-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
