"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, LogOut, MessageSquareWarning, PackageCheck, Search, Store, Truck, UserCog } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { suppliers as initialSuppliers } from "../../../lib/mock-data";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type Supplier = typeof initialSuppliers[number] & { id?: string };
type FieldNote = {
  id: string;
  noteType: string;
  title: string;
  supplierName: string;
  supplierLocation: string;
  productName: string;
  observedPrice?: number;
  photoUrl: string;
  note: string;
  status: string;
  recordedBy: string;
  createdLabel: string;
  comments: FieldNoteComment[];
  canEdit: boolean;
  canDelete: boolean;
  canChangeStatus: boolean;
};
type FieldNoteComment = {
  id: string;
  comment: string;
  createdBy: string;
  createdLabel: string;
};

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
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const noteTypeLabels: Record<string, string> = {
  idea: "アイデア",
  new_product: "新商品",
  supplier_visit: "発注先訪問",
  price_hint: "価格情報"
};
const noteStatusLabels: Record<string, string> = {
  open: "未確認",
  reviewing: "検討中",
  comparison: "比較対象",
  adopted: "採用",
  rejected: "見送り"
};
const noteStatusOptions = Object.entries(noteStatusLabels);

export default function FieldNotesPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [notes, setNotes] = useState<FieldNote[]>([]);
  const [query, setQuery] = useState("");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [photoFileName, setPhotoFileName] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    const [dashboardResponse, notesResponse] = await Promise.all([
      fetch("/api/dashboard"),
      fetch("/api/field-notes")
    ]);

    if (dashboardResponse.ok) {
      const data = await dashboardResponse.json() as { suppliers?: Supplier[] };
      setSuppliers(data.suppliers ?? []);
    }

    if (notesResponse.ok) {
      const data = await notesResponse.json() as { notes?: FieldNote[] };
      setNotes(data.notes ?? []);
    }

    setDataSource("neon");
  }

  const filteredNotes = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return notes;

    return notes.filter((note) =>
      [
        noteTypeLabels[note.noteType] ?? note.noteType,
        note.title,
        note.supplierName,
        note.supplierLocation,
        note.productName,
        note.note,
        note.recordedBy
      ].join(" ").toLowerCase().includes(keyword)
    );
  }, [notes, query]);

  async function createNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await fetch("/api/field-notes", {
      method: "POST",
      body: new FormData(form)
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "現場記録を保存できませんでした。");
      return;
    }

    form.reset();
    setPhotoFileName("");
    showNotice("現場記録を保存しました。");
    await loadData();
  }

  async function updateNoteStatus(noteId: string, status: string) {
    const response = await fetch("/api/field-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: noteId, action: "status", status })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "状態を保存できませんでした。");
      return;
    }

    showNotice("状態を更新しました。");
    await loadData();
  }

  async function addComment(noteId: string) {
    const comment = (commentDrafts[noteId] ?? "").trim();
    if (!comment) return;

    const response = await fetch("/api/field-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: noteId, action: "comment", comment })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "コメントを保存できませんでした。");
      return;
    }

    setCommentDrafts((drafts) => ({ ...drafts, [noteId]: "" }));
    showNotice("コメントを追加しました。");
    await loadData();
  }

  async function editNote(note: FieldNote) {
    const title = window.prompt("タイトル", note.title);
    if (title === null) return;
    const productName = window.prompt("商品名", note.productName);
    if (productName === null) return;
    const supplierName = window.prompt("発注先名", note.supplierName);
    if (supplierName === null) return;
    const supplierLocation = window.prompt("場所・売場", note.supplierLocation);
    if (supplierLocation === null) return;
    const observedPrice = window.prompt("見かけた価格", note.observedPrice ? String(note.observedPrice) : "");
    if (observedPrice === null) return;
    const noteText = window.prompt("メモ", note.note);
    if (noteText === null) return;

    const response = await fetch("/api/field-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: note.id,
        action: "edit",
        title,
        productName,
        supplierName,
        supplierLocation,
        observedPrice,
        note: noteText
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "現場記録を更新できませんでした。");
      return;
    }

    showNotice("現場記録を更新しました。");
    await loadData();
  }

  async function deleteNote(note: FieldNote) {
    if (!window.confirm(`${note.title} を削除しますか？`)) return;

    const response = await fetch("/api/field-notes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: note.id })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "現場記録を削除できませんでした。");
      return;
    }

    showNotice("現場記録を削除しました。");
    await loadData();
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

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">現場で見つけたヒントを残す</p>
            <h2>現場記録</h2>
            <span className="source-indicator">{dataSource === "neon" ? "データ同期済み" : "読み込み中"}</span>
          </div>
          <label className="search-box">
            <Search size={17} />
            <input value={query} placeholder="記録・発注先・商品を検索" onChange={(event) => setQuery(event.target.value)} />
          </label>
        </header>

        <section className="workspace-grid recommendations-grid">
          <form className="panel recommendation-form" onSubmit={createNote}>
            <div className="panel-title">
              <div>
                <h3>現場記録を追加</h3>
                <p>新しいアイデア、良い商品、発注先で見た情報を写真付きで保存</p>
              </div>
            </div>
            <div className="edit-fields">
              <label>
                <span>記録タイプ</span>
                <select name="noteType" defaultValue="idea">
                  <option value="idea">アイデア</option>
                  <option value="new_product">新商品</option>
                  <option value="supplier_visit">発注先訪問</option>
                  <option value="price_hint">価格情報</option>
                </select>
              </label>
              <label>
                <span>タイトル</span>
                <input name="title" placeholder="例: 春雨の新しい代替候補" required />
              </label>
              <label>
                <span>既存発注先</span>
                <select name="supplierId" defaultValue="">
                  <option value="">新規または未選択</option>
                  {suppliers.map((supplier) => (
                    <option value={supplier.id ?? ""} key={supplier.name}>{supplier.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>新規発注先名</span>
                <input name="supplierName" placeholder="例: 商店街の乾物店" />
              </label>
              <label>
                <span>場所・売場</span>
                <input name="supplierLocation" placeholder="例: 冷凍食品売場、福岡市中央区" />
              </label>
              <label>
                <span>商品名</span>
                <input name="productName" placeholder="例: 緑豆春雨 500g" />
              </label>
              <label>
                <span>見かけた価格</span>
                <input name="observedPrice" inputMode="decimal" placeholder="例: 298" />
              </label>
              <div className="modern-file-field">
                <span>写真</span>
                <label className="modern-file-button">
                  <input
                    name="photo"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => setPhotoFileName(event.target.files?.[0]?.name ?? "")}
                  />
                  <strong>写真を選択</strong>
                  <small>{photoFileName || "カメラまたは写真ライブラリから追加"}</small>
                </label>
              </div>
              <label>
                <span>メモ</span>
                <textarea name="note" placeholder="味、規格、使えそうな用途、気づいた点" />
              </label>
              <button className="primary-button" type="submit">記録を保存</button>
            </div>
          </form>

          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>現場記録一覧</h3>
                <p>後で商品比較や仕入れ先検討につなげるための記録</p>
              </div>
            </div>
            <div className="recommendation-list">
              {filteredNotes.length === 0 ? <div className="empty-state">現場記録はありません</div> : null}
              {filteredNotes.map((note) => (
                <article className="recommendation-card" key={note.id}>
                  {note.photoUrl ? (
                    <span className="recommendation-photo"><img src={note.photoUrl} alt={`${note.title} の写真`} /></span>
                  ) : null}
                  <div>
                    <div className="recommendation-title">
                      <strong>{note.title}</strong>
                      <span>{noteTypeLabels[note.noteType] ?? note.noteType}</span>
                    </div>
                    <div className="field-note-controls">
                      <label>
                        <span>状態</span>
                        <select value={note.status} disabled={!note.canChangeStatus} onChange={(event) => updateNoteStatus(note.id, event.target.value)}>
                          {noteStatusOptions.map(([status, label]) => (
                            <option value={status} key={status}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <div className="field-note-actions">
                        {note.canEdit ? <button type="button" className="secondary-button" onClick={() => editNote(note)}>編集</button> : null}
                        {note.canDelete ? <button type="button" className="danger-button" onClick={() => deleteNote(note)}>削除</button> : null}
                      </div>
                    </div>
                    <p>{[note.productName, note.supplierName, note.supplierLocation].filter(Boolean).join(" · ") || "詳細未設定"}</p>
                    {note.observedPrice ? <small>見かけた価格 ¥{formatNumber(note.observedPrice)}</small> : null}
                    {note.note ? <small>{note.note}</small> : null}
                    {note.comments.length ? (
                      <div className="field-note-comments">
                        {note.comments.map((comment) => (
                          <small key={comment.id}>
                            {comment.comment}
                            <em>{comment.createdLabel}{comment.createdBy ? ` · ${comment.createdBy}` : ""}</em>
                          </small>
                        ))}
                      </div>
                    ) : null}
                    <div className="field-note-comment-form">
                      <input
                        value={commentDrafts[note.id] ?? ""}
                        placeholder="コメントを追加"
                        onChange={(event) => setCommentDrafts((drafts) => ({ ...drafts, [note.id]: event.target.value }))}
                      />
                      <button type="button" className="secondary-button" onClick={() => addComment(note.id)}>追加</button>
                    </div>
                    <em>{note.createdLabel}{note.recordedBy ? ` · ${note.recordedBy}` : ""}</em>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      </section>
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function formatNumber(value: number) {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}
