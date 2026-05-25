"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, LogOut, MessageSquareWarning, PackageCheck, Search, Store, Truck, UserCog } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { suppliers as initialSuppliers } from "../../../lib/mock-data";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OpsNavList } from "../components/OpsNavList";
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
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "発注依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "発注管理", href: "/ops/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/ops/history", icon: FileText },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "スタッフ管理", href: "/ops/staff", icon: UserCog },
  { label: "発注先管理", href: "/ops/suppliers", icon: Truck },
  { label: "現場記録", href: "/ops/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/ops/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/ops/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

const noteTypeLabels: Record<string, string> = {
  idea: "アイデア",
  new_product: "新商品",
  supplier_visit: "発注先訪問",
  price_hint: "価格情報"
};

export default function FieldNotesPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [notes, setNotes] = useState<FieldNote[]>([]);
  const [query, setQuery] = useState("");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");

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
    showNotice("現場記録を保存しました。");
    await loadData();
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/ops" aria-label="ダッシュボードへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Ops</p>
            <h1>発注管理</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OpsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">現場で見つけたヒントを残す</p>
            <h2>現場記録</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
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
              <label>
                <span>写真</span>
                <input name="photo" type="file" accept="image/*" capture="environment" />
              </label>
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
                    <p>{[note.productName, note.supplierName, note.supplierLocation].filter(Boolean).join(" · ") || "詳細未設定"}</p>
                    {note.observedPrice ? <small>見かけた価格 ¥{formatNumber(note.observedPrice)}</small> : null}
                    {note.note ? <small>{note.note}</small> : null}
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
