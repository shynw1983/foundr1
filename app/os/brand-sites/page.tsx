"use client";

import {
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Globe2,
  Languages,
  Lightbulb,
  LogOut,
  ImageUp,
  MenuSquare,
  PackageCheck,
  Plus,
  Save,
  Search,
  Sparkles,
  Store,
  Trash2,
  Truck,
  UserCog,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { ModalHistoryScope } from "../components/useModalHistory";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type Brand = {
  id: string;
  name: string;
};

type BrandSiteSection = {
  id: string;
  brandId: string;
  pageKey: string;
  sectionKey: string;
  sectionType: string;
  title: string;
  subtitle: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
  actionLabel: string;
  actionUrl: string;
  tags: string[];
  fields: Record<string, unknown>;
  titleDisplayNames: Record<string, string>;
  subtitleDisplayNames: Record<string, string>;
  bodyDisplayNames: Record<string, string>;
  actionLabelDisplayNames: Record<string, string>;
  tagDisplayNames: Record<string, Record<string, string>>;
  sortOrder: number;
  isActive: boolean;
};

type BrandSiteTranslationDraftEntry = {
  key: string;
  sectionId: string;
  sectionLabel: string;
  pageKey: string;
  field: "title" | "subtitle" | "body" | "actionLabel" | "tag";
  tagIndex: number | null;
  language: string;
  sourceText: string;
  currentText: string;
  suggestedText: string;
};

type BrandSiteTranslationPreview = {
  entries: BrandSiteTranslationDraftEntry[];
  model: string;
};

type BrandSiteRevision = {
  id: string;
  sectionId: string;
  brandId: string;
  pageKey: string;
  sectionKey: string;
  payload: Partial<BrandSiteSection>;
  status: string;
  submittedByName: string;
  reviewedByName: string;
  reviewNote: string;
  submittedAt: string;
  reviewedAt: string | null;
  updatedAt: string;
};

type OsNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const navItems: OsNavItem[] = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "メニュー管理", href: "/os/menus", icon: MenuSquare },
  { label: "ブランドサイト", href: "/os/brand-sites", icon: Globe2 },
  { label: "手順書管理", href: "/os/procedures", icon: ClipboardCheck },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "会員・ポイント", href: "/os/loyalty", icon: WalletCards },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const languageOptions = [
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "ko", label: "한국어" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "ne", label: "नेपाली" }
];

const pageLabels: Record<string, string> = {
  home: "トップページ",
  menu: "メニュー・予約",
  footer: "フッター",
  legal: "法務ページ"
};

const fieldLabels: Record<BrandSiteTranslationDraftEntry["field"], string> = {
  title: "タイトル",
  subtitle: "補助タイトル",
  body: "本文",
  actionLabel: "ボタン",
  tag: "タグ"
};

function emptySection(brandId = ""): BrandSiteSection {
  return {
    id: "",
    brandId,
    pageKey: "home",
    sectionKey: "",
    sectionType: "content",
    title: "",
    subtitle: "",
    body: "",
    imageUrl: "",
    imageAlt: "",
    actionLabel: "",
    actionUrl: "",
    tags: [],
    fields: {},
    titleDisplayNames: {},
    subtitleDisplayNames: {},
    bodyDisplayNames: {},
    actionLabelDisplayNames: {},
    tagDisplayNames: {},
    sortOrder: 100,
    isActive: true
  };
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function asEditableJson(value: Record<string, unknown>) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function getSectionUsageHint(section: BrandSiteSection) {
  const key = `${section.pageKey}:${section.sectionKey}`.toLowerCase();
  const type = section.sectionType.toLowerCase();
  if (key.includes("hero") || type.includes("hero")) return "サイトの最初に見える主役エリアです。大きな見出し、メイン画像、短い訴求タグ、主要ボタンに使われます。";
  if (key.includes("step") || key.includes("flow") || key.includes("how")) return "予約や注文の流れを説明するエリアです。タグは各ステップ名として使われることがあります。";
  if (key.includes("feature") || key.includes("point") || key.includes("about")) return "ブランド紹介や特徴説明のエリアです。タグは素材、こだわり、店舗特徴などの短い見出しとして使われます。";
  if (key.includes("faq")) return "FAQやヘルプのエリアです。タグは質問カテゴリや入口として使われることがあります。";
  if (key.includes("footer")) return "ページ下部のエリアです。タグはSNS、ページリンク、店舗情報などとして使われることがあります。";
  if (section.pageKey === "menu") return "メニュー・予約ページのエリアです。タグは予約パネル、メニュー分類、操作案内として使われることがあります。";
  return "通常のコンテンツエリアです。タグは前台サイト側の実装に合わせて、短いラベル、リンク、グループ名として表示されます。";
}

function getTagUsageLabel(section: BrandSiteSection, index: number) {
  const key = `${section.pageKey}:${section.sectionKey}`.toLowerCase();
  if (key.includes("step") || key.includes("flow") || key.includes("how")) return `ステップ ${index + 1}`;
  if (key.includes("faq")) return `FAQ分類 ${index + 1}`;
  if (key.includes("footer")) return `フッター項目 ${index + 1}`;
  if (key.includes("hero")) return `ファーストビュー訴求 ${index + 1}`;
  if (section.pageKey === "menu") return `メニュー・予約タグ ${index + 1}`;
  return `タグ ${index + 1}`;
}

function normalizeSection(section: BrandSiteSection, activeBrandId: string): BrandSiteSection {
  return {
    ...emptySection(activeBrandId),
    ...section,
    tags: Array.isArray(section.tags) ? section.tags.map(String) : [],
    fields: section.fields && typeof section.fields === "object" ? section.fields : {},
    titleDisplayNames: section.titleDisplayNames ?? {},
    subtitleDisplayNames: section.subtitleDisplayNames ?? {},
    bodyDisplayNames: section.bodyDisplayNames ?? {},
    actionLabelDisplayNames: section.actionLabelDisplayNames ?? {},
    tagDisplayNames: section.tagDisplayNames ?? {}
  };
}

export default function BrandSitesPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [sections, setSections] = useState<BrandSiteSection[]>([]);
  const [revisions, setRevisions] = useState<BrandSiteRevision[]>([]);
  const [currentRole, setCurrentRole] = useState("");
  const [activeBrandId, setActiveBrandId] = useState("");
  const [activePageKey, setActivePageKey] = useState("home");
  const [activeSectionId, setActiveSectionId] = useState("");
  const [draft, setDraft] = useState<BrandSiteSection>(emptySection());
  const [fieldsText, setFieldsText] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [status, setStatus] = useState("");
  const [translationLanguages, setTranslationLanguages] = useState<string[]>(languageOptions.map((language) => language.value));
  const [translationOverwriteExisting, setTranslationOverwriteExisting] = useState(false);
  const [translationBusy, setTranslationBusy] = useState<"preview" | "apply" | "">("");
  const [translationPreview, setTranslationPreview] = useState<BrandSiteTranslationPreview | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const activeBrand = useMemo(() => brands.find((brand) => brand.id === activeBrandId) ?? null, [activeBrandId, brands]);
  const canPublish = currentRole === "owner";
  const brandSections = useMemo(() => sections.filter((section) => section.brandId === activeBrandId), [activeBrandId, sections]);
  const pendingRevisions = useMemo(() => revisions.filter((revision) => revision.brandId === activeBrandId && revision.status === "pending"), [activeBrandId, revisions]);
  const pageKeys = useMemo(() => uniqueValues(["home", "menu", "footer", ...brandSections.map((section) => section.pageKey)]), [brandSections]);
  const visibleSections = useMemo(
    () => brandSections.filter((section) => section.pageKey === activePageKey).sort((a, b) => a.sortOrder - b.sortOrder || a.sectionKey.localeCompare(b.sectionKey)),
    [activePageKey, brandSections]
  );

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!activeBrandId && brands[0]) setActiveBrandId(brands[0].id);
  }, [activeBrandId, brands]);

  useEffect(() => {
    const nextPage = pageKeys.includes(activePageKey) ? activePageKey : pageKeys[0] || "home";
    if (nextPage !== activePageKey) setActivePageKey(nextPage);
  }, [activePageKey, pageKeys]);

  useEffect(() => {
    const current = visibleSections.find((section) => section.id === activeSectionId) ?? visibleSections[0];
    if (current) {
      setActiveSectionId(current.id);
      const normalized = normalizeSection(current, activeBrandId);
      setDraft(normalized);
      setFieldsText(asEditableJson(normalized.fields));
    } else {
      const blank = emptySection(activeBrandId);
      blank.pageKey = activePageKey;
      blank.sectionKey = "";
      setActiveSectionId("");
      setDraft(blank);
      setFieldsText("{}");
    }
  }, [activeBrandId, activePageKey, activeSectionId, visibleSections]);

  async function loadData() {
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/brand-sites", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { brands?: Brand[]; sections?: BrandSiteSection[]; revisions?: BrandSiteRevision[]; currentRole?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "読み込みに失敗しました。");
      setBrands(body.brands ?? []);
      setSections((body.sections ?? []).map((section) => normalizeSection(section, section.brandId)));
      setRevisions(body.revisions ?? []);
      setCurrentRole(body.currentRole ?? "");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(patch: Partial<BrandSiteSection>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateTranslation(field: "titleDisplayNames" | "subtitleDisplayNames" | "bodyDisplayNames" | "actionLabelDisplayNames", language: string, value: string) {
    setDraft((current) => ({
      ...current,
      [field]: {
        ...(current[field] ?? {}),
        [language]: value
      }
    }));
  }

  function updateTagTranslation(index: number, language: string, value: string) {
    setDraft((current) => ({
      ...current,
      tagDisplayNames: {
        ...(current.tagDisplayNames ?? {}),
        [index]: {
          ...(current.tagDisplayNames?.[String(index)] ?? {}),
          [language]: value
        }
      }
    }));
  }

  function createSection() {
    const blank = emptySection(activeBrandId);
    blank.pageKey = activePageKey;
    blank.sectionKey = `section-${Date.now().toString(36)}`;
    blank.sortOrder = (visibleSections.at(-1)?.sortOrder ?? 0) + 10;
    setActiveSectionId("");
    setDraft(blank);
    setFieldsText("{}");
  }

  function updateTag(index: number, value: string) {
    setDraft((current) => ({
      ...current,
      tags: current.tags.map((tag, tagIndex) => (tagIndex === index ? value : tag))
    }));
  }

  function addTag() {
    setDraft((current) => ({
      ...current,
      tags: [...current.tags, ""]
    }));
  }

  function removeTag(index: number) {
    setDraft((current) => {
      const nextTags = current.tags.filter((_, tagIndex) => tagIndex !== index);
      const nextTagDisplayNames: Record<string, Record<string, string>> = {};
      nextTags.forEach((_, nextIndex) => {
        const sourceIndex = nextIndex >= index ? nextIndex + 1 : nextIndex;
        const sourceRecord = current.tagDisplayNames?.[String(sourceIndex)];
        if (sourceRecord) nextTagDisplayNames[String(nextIndex)] = sourceRecord;
      });
      return { ...current, tags: nextTags, tagDisplayNames: nextTagDisplayNames };
    });
  }

  async function uploadSectionImage(file: File) {
    if (!file) return;
    setImageUploading(true);
    setStatus("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("brandName", activeBrand?.name ?? "brand-site");
      formData.append("sectionKey", draft.sectionKey || draft.title || "section");
      const response = await fetch("/api/brand-sites/photo", {
        method: "POST",
        body: formData
      });
      const body = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "画像をアップロードできませんでした。");
      updateDraft({ imageUrl: body.url });
      setStatus("画像をアップロードしました。保存すると公開内容に反映されます。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "画像をアップロードできませんでした。");
    } finally {
      setImageUploading(false);
    }
  }

  async function saveSection() {
    if (!draft.brandId) {
      setStatus("ブランドを選択してください。");
      return;
    }
    setSaving("save");
    setStatus("");
    let fields: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(fieldsText || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("拡張フィールドは JSON object で入力してください。");
      fields = parsed as Record<string, unknown>;
    } catch (error) {
      setSaving("");
      setStatus(error instanceof Error ? error.message : "拡張フィールドの JSON が不正です。");
      return;
    }

    try {
      const response = await fetch("/api/brand-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, fields })
      });
      const body = await response.json().catch(() => ({})) as { id?: string; reviewRequired?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "保存できませんでした。");
      setStatus(body.reviewRequired ? "審査依頼を作成しました。老板の承認後に公開されます。" : "保存して公開しました。");
      await loadData();
      if (body.id) setActiveSectionId(body.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存できませんでした。");
    } finally {
      setSaving("");
    }
  }

  async function deleteSection() {
    if (!draft.id) return;
    const confirmed = window.confirm("このセクションを削除しますか？");
    if (!confirmed) return;
    setSaving("delete");
    setStatus("");
    try {
      const response = await fetch("/api/brand-sites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "削除できませんでした。");
      setStatus("削除しました。");
      setActiveSectionId("");
      await loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "削除できませんでした。");
    } finally {
      setSaving("");
    }
  }

  async function reviewRevision(id: string, action: "approve" | "reject") {
    setSaving(action);
    setStatus("");
    try {
      const response = await fetch("/api/brand-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reviewRevision", id, reviewAction: action })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "審査を完了できませんでした。");
      setStatus(action === "approve" ? "承認して公開しました。" : "修訂を差し戻しました。");
      await loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "審査を完了できませんでした。");
    } finally {
      setSaving("");
    }
  }

  async function createTranslationPreview() {
    if (!activeBrandId) {
      setStatus("ブランドを選択してください。");
      return;
    }
    if (!translationLanguages.length) {
      setStatus("翻訳先の言語を選択してください。");
      return;
    }
    setTranslationBusy("preview");
    setStatus("");
    try {
      const response = await fetch("/api/brand-sites/auto-translate/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: activeBrandId,
          languages: translationLanguages,
          overwriteExisting: translationOverwriteExisting
        })
      });
      const body = await response.json().catch(() => ({})) as BrandSiteTranslationPreview & { error?: string };
      if (!response.ok) throw new Error(body.error || "翻訳プレビューを作成できませんでした。");
      setTranslationPreview({ entries: body.entries ?? [], model: body.model ?? "" });
      setStatus((body.entries ?? []).length ? `${body.entries.length}件の翻訳候補を作成しました。` : "翻訳が必要な項目はありません。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "翻訳プレビューを作成できませんでした。");
    } finally {
      setTranslationBusy("");
    }
  }

  async function applyTranslationPreview() {
    if (!translationPreview) return;
    const entries = translationPreview.entries.filter((entry) => entry.suggestedText.trim());
    if (!entries.length) return;
    setTranslationBusy("apply");
    setStatus("");
    try {
      const response = await fetch("/api/brand-sites/auto-translate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: activeBrandId, entries })
      });
      const body = await response.json().catch(() => ({})) as { updated?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "翻訳を書き込めませんでした。");
      setTranslationPreview(null);
      setStatus(`${body.updated ?? entries.length}件の翻訳を書き込みました。`);
      await loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "翻訳を書き込めませんでした。");
    } finally {
      setTranslationBusy("");
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>ブランドサイト</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace brand-site-admin-page">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Website content studio</p>
            <h2>ブランドサイト管理</h2>
            <p>前台サイトの画像・文案・タグ・多言語表示を、ブランドごとに構造化して管理します。</p>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={() => void loadData()} disabled={loading}>
              {loading ? "読み込み中" : "再読み込み"}
            </button>
            <button className="primary-button" type="button" onClick={createSection} disabled={!activeBrandId}>
              <Plus size={16} /> セクション追加
            </button>
          </div>
        </div>

        <section className="brand-site-toolbar">
          <label>
            <span>ブランド</span>
            <select value={activeBrandId} onChange={(event) => setActiveBrandId(event.target.value)}>
              {brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
            </select>
          </label>
          <div className="brand-site-page-tabs">
            {pageKeys.map((pageKey) => (
              <button
                type="button"
                className={pageKey === activePageKey ? "is-active" : ""}
                onClick={() => setActivePageKey(pageKey)}
                key={pageKey}
              >
                {pageLabels[pageKey] ?? pageKey}
              </button>
            ))}
          </div>
          {activeBrand ? (
            <a className="secondary-button compact-button" href={`/api/public/brand-sites?brand=${encodeURIComponent(activeBrand.name)}`} target="_blank" rel="noreferrer">
              公開API
            </a>
          ) : null}
        </section>

        {status ? <p className="menu-auto-translation-status">{status}</p> : null}

        <section className="menu-auto-translation-panel brand-site-translation-panel">
          <div>
            <strong><Languages size={17} /> AI翻訳</strong>
            <span>未翻訳のページ文案・タグを、メニュー翻訳と同じくプレビュー確認後に書き込みます。</span>
          </div>
          <div className="menu-auto-translation-body">
            <div className="menu-auto-translation-controls">
              {languageOptions.map((language) => (
                <label key={language.value}>
                  <input
                    type="checkbox"
                    checked={translationLanguages.includes(language.value)}
                    onChange={(event) => setTranslationLanguages((current) => (
                      event.target.checked ? uniqueValues([...current, language.value]) : current.filter((value) => value !== language.value)
                    ))}
                  />
                  {language.label}
                </label>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={translationOverwriteExisting}
                  onChange={(event) => setTranslationOverwriteExisting(event.target.checked)}
                />
                既存翻訳も上書き
              </label>
            </div>
            <button className="primary-button" type="button" onClick={() => void createTranslationPreview()} disabled={!activeBrandId || translationBusy === "preview"}>
              <Sparkles size={16} /> {translationBusy === "preview" ? "作成中" : "翻訳プレビュー"}
            </button>
          </div>
        </section>

        <section className="brand-site-editor-grid">
          <aside className="brand-site-section-list">
            <div className="management-subsection-title">
              <div>
                <h4>{pageLabels[activePageKey] ?? activePageKey}</h4>
                <p>{visibleSections.length} セクション</p>
              </div>
            </div>
            {visibleSections.map((section) => (
              <button
                type="button"
                className={section.id === draft.id ? "is-active" : ""}
                onClick={() => setActiveSectionId(section.id)}
                key={section.id}
              >
                <span>{section.sectionType}</span>
                <strong>{section.title || section.sectionKey}</strong>
                <small>{section.sectionKey}</small>
              </button>
            ))}
            {!visibleSections.length ? <p className="empty-state">このページにはまだセクションがありません。</p> : null}
          </aside>

          <section className="brand-site-editor-panel">
            <div className="brand-site-editor-header">
              <div>
                <p className="eyebrow">{draft.id ? "Edit section" : "New section"}</p>
                <h3>{draft.title || "新しいセクション"}</h3>
              </div>
              <div className="row-actions">
                {draft.id ? (
                  <button className="danger-button" type="button" onClick={() => void deleteSection()} disabled={saving === "delete"}>
                    <Trash2 size={16} /> 削除
                  </button>
                ) : null}
                <button className="primary-button" type="button" onClick={() => void saveSection()} disabled={saving === "save"}>
                  <Save size={16} /> {saving === "save" ? "保存中" : canPublish ? "保存して公開" : "審査依頼"}
                </button>
              </div>
            </div>

            <section className="brand-site-section-guide">
              <div>
                <span>表示位置</span>
                <strong>{pageLabels[draft.pageKey] ?? draft.pageKey} / {draft.sectionKey || "未設定"}</strong>
              </div>
              <p>{getSectionUsageHint(draft)}</p>
            </section>

            <div className="brand-site-form-grid">
              <label>
                <span>ページキー</span>
                <input value={draft.pageKey} onChange={(event) => updateDraft({ pageKey: event.target.value })} />
              </label>
              <label>
                <span>セクションキー</span>
                <input value={draft.sectionKey} onChange={(event) => updateDraft({ sectionKey: event.target.value })} />
              </label>
              <label>
                <span>種類</span>
                <input value={draft.sectionType} onChange={(event) => updateDraft({ sectionType: event.target.value })} />
              </label>
              <label>
                <span>並び順</span>
                <input type="number" value={draft.sortOrder} onChange={(event) => updateDraft({ sortOrder: Number(event.target.value) })} />
              </label>
            </div>

            <div className="brand-site-form-grid">
              <label>
                <span>タイトル</span>
                <input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} />
              </label>
              <label>
                <span>補助タイトル</span>
                <input value={draft.subtitle} onChange={(event) => updateDraft({ subtitle: event.target.value })} />
              </label>
            </div>

            <label className="brand-site-wide-label">
              <span>本文</span>
              <textarea value={draft.body} onChange={(event) => updateDraft({ body: event.target.value })} />
            </label>

            <div className="brand-site-form-grid">
              <div className="brand-site-image-editor">
                <span>画像</span>
                <div className="brand-site-image-upload-row">
                  <label className="secondary-button compact-button">
                    <ImageUp size={16} /> {imageUploading ? "アップロード中" : "画像をアップロード"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      disabled={imageUploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadSectionImage(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {draft.imageUrl ? <small>{draft.imageUrl}</small> : <small>未設定</small>}
                </div>
                {draft.imageUrl ? (
                  <div className="brand-site-image-preview">
                    <img src={draft.imageUrl} alt={draft.imageAlt || ""} />
                  </div>
                ) : null}
              </div>
              <label>
                <span>画像代替テキスト</span>
                <input value={draft.imageAlt} onChange={(event) => updateDraft({ imageAlt: event.target.value })} />
              </label>
              <label>
                <span>ボタン文言</span>
                <input value={draft.actionLabel} onChange={(event) => updateDraft({ actionLabel: event.target.value })} />
              </label>
              <label>
                <span>ボタン URL</span>
                <input value={draft.actionUrl} onChange={(event) => updateDraft({ actionUrl: event.target.value })} />
              </label>
            </div>

            <section className="brand-site-tag-editor">
              <div className="brand-site-tag-editor-header">
                <div>
                  <span>タグ</span>
                  <p>タグは前台サイト側で、訴求、手順、分類、フッター項目などとして表示されます。追加はサイト上で必要な場合だけ行ってください。</p>
                </div>
                <button className="secondary-button compact-button" type="button" onClick={addTag}>
                  <Plus size={15} /> タグ追加
                </button>
              </div>
              <div className="brand-site-tag-rows">
                {draft.tags.map((tag, index) => (
                  <div className="brand-site-tag-row" key={`tag-${index}`}>
                    <small>{getTagUsageLabel(draft, index)}</small>
                    <input value={tag} onChange={(event) => updateTag(index, event.target.value)} placeholder="タグ文言" />
                    <button className="secondary-button compact-button" type="button" onClick={() => removeTag(index)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {!draft.tags.length ? <p className="empty-state">このセクションにはタグがありません。</p> : null}
              </div>
            </section>

            <label className="brand-site-wide-label">
              <span>拡張フィールド JSON</span>
              <textarea className="code-textarea" value={fieldsText} onChange={(event) => setFieldsText(event.target.value)} />
            </label>

            <div className="brand-site-state-row">
              <label>
                <input type="checkbox" checked={draft.isActive} onChange={(event) => updateDraft({ isActive: event.target.checked })} />
                公開中
              </label>
            </div>

            <section className="menu-translation-panel brand-site-field-translations">
              <div>
                <strong><Globe2 size={16} /> 多言語表示</strong>
                <span>空欄の場合は日本語へフォールバックします。</span>
              </div>
              <div className="brand-site-translation-matrix">
                {languageOptions.map((language) => (
                  <article key={language.value}>
                    <h4>{language.label}</h4>
                    <label>
                      <span>タイトル</span>
                      <input value={draft.titleDisplayNames?.[language.value] ?? ""} onChange={(event) => updateTranslation("titleDisplayNames", language.value, event.target.value)} />
                    </label>
                    <label>
                      <span>補助タイトル</span>
                      <input value={draft.subtitleDisplayNames?.[language.value] ?? ""} onChange={(event) => updateTranslation("subtitleDisplayNames", language.value, event.target.value)} />
                    </label>
                    <label>
                      <span>ボタン</span>
                      <input value={draft.actionLabelDisplayNames?.[language.value] ?? ""} onChange={(event) => updateTranslation("actionLabelDisplayNames", language.value, event.target.value)} />
                    </label>
                    <label>
                      <span>本文</span>
                      <textarea value={draft.bodyDisplayNames?.[language.value] ?? ""} onChange={(event) => updateTranslation("bodyDisplayNames", language.value, event.target.value)} />
                    </label>
                    {draft.tags.length ? (
                      <div className="brand-site-tag-translation-list">
                        {draft.tags.map((tag, index) => (
                          <label key={`${tag}-${index}`}>
                            <span>{tag}</span>
                            <input
                              value={draft.tagDisplayNames?.[String(index)]?.[language.value] ?? ""}
                              onChange={(event) => updateTagTranslation(index, language.value, event.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          </section>
        </section>

        <section className="brand-site-review-panel">
          <div className="management-subsection-title">
            <div>
              <h4>审核待ち</h4>
              <p>{canPublish ? "老板が承認すると公開 API に反映されます。" : "经理の変更はここに入り、老板の承認後に公開されます。"}</p>
            </div>
            <span>{pendingRevisions.length} 件</span>
          </div>
          <div className="brand-site-review-list">
            {pendingRevisions.map((revision) => (
              <article key={revision.id}>
                <div>
                  <span>{pageLabels[revision.pageKey] ?? revision.pageKey} / {revision.sectionKey}</span>
                  <strong>{revision.payload?.title || "無題のセクション"}</strong>
                  <small>申請者: {revision.submittedByName || "-"} / {new Date(revision.submittedAt).toLocaleString("ja-JP")}</small>
                </div>
                {canPublish ? (
                  <div className="row-actions">
                    <button className="secondary-button compact-button" type="button" onClick={() => void reviewRevision(revision.id, "reject")} disabled={saving === "reject"}>
                      差し戻し
                    </button>
                    <button className="primary-button compact-button" type="button" onClick={() => void reviewRevision(revision.id, "approve")} disabled={saving === "approve"}>
                      承認して公開
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {!pendingRevisions.length ? <p className="empty-state">現在、审核待ちの変更はありません。</p> : null}
          </div>
        </section>

        {translationPreview ? (
          <ModalHistoryScope historyKey="brand-sites-translation-preview" onClose={() => setTranslationPreview(null)}>
            <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="ブランドサイトAI翻訳プレビュー">
              <section className="edit-modal menu-translation-preview-modal">
              <div className="modal-header">
                <div>
                  <p className="eyebrow">AI translation preview</p>
                  <h3>翻訳プレビュー</h3>
                </div>
                <button type="button" className="secondary-button" onClick={() => setTranslationPreview(null)}>閉じる</button>
              </div>
              <div className="menu-translation-preview-summary">
                <span><Languages size={15} /> {translationPreview.entries.length}件</span>
                <span>Model: {translationPreview.model}</span>
              </div>
              <div className="menu-translation-preview-list">
                {translationPreview.entries.map((entry, index) => (
                  <article className="menu-translation-preview-row" key={entry.key}>
                    <div className="menu-translation-preview-meta">
                      <strong>{entry.sectionLabel}</strong>
                      <span>{fieldLabels[entry.field]} / {languageOptions.find((language) => language.value === entry.language)?.label ?? entry.language}</span>
                    </div>
                    <div className="menu-translation-preview-source">
                      <span>日本語</span>
                      <p>{entry.sourceText}</p>
                      {entry.currentText ? <small>現在: {entry.currentText}</small> : null}
                    </div>
                    <label className="menu-translation-preview-edit">
                      <span>書き込み内容</span>
                      <textarea
                        value={entry.suggestedText}
                        onChange={(event) => setTranslationPreview((current) => {
                          if (!current) return current;
                          return {
                            ...current,
                            entries: current.entries.map((item, itemIndex) => itemIndex === index ? { ...item, suggestedText: event.target.value } : item)
                          };
                        })}
                      />
                    </label>
                  </article>
                ))}
                {!translationPreview.entries.length ? <p className="empty-state">書き込む候補はありません。</p> : null}
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setTranslationPreview(null)}>キャンセル</button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void applyTranslationPreview()}
                  disabled={!canPublish || translationBusy === "apply" || !translationPreview.entries.some((entry) => entry.suggestedText.trim())}
                >
                  <CheckCircle2 size={16} /> {translationBusy === "apply" ? "書き込み中" : "確認して書き込む"}
                </button>
              </div>
              </section>
            </div>
          </ModalHistoryScope>
        ) : null}
      </section>
    </main>
  );
}
