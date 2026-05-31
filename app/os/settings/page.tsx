"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Save, Search, Settings, Store, Truck, UserCog } from "lucide-react";
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
  { label: "発注管理", href: "/os/procurement", icon: ClipboardList },
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

export default function OsSettingsPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [settings, setSettings] = useState<StoreModuleSettings>(defaultStoreModuleSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      const response = await fetch("/api/settings?module=store", { cache: "no-store" });
      if (response.ok) {
        const body = await response.json() as { settings?: StoreModuleSettings };
        if (body.settings) setSettings(body.settings);
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
            {saving ? "保存中..." : "設定を保存"}
          </button>
        </header>

        <section className="settings-grid">
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
